'use strict';

const fs = require('fs');
const path = require('path');
const { Hub } = require('./lib/Hub');
const TriggerEngine = require('./lib/triggers');

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'config.json');

let config;
try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
} catch (e) {
    console.error('[mihome] 无法读取配置文件 ' + CONFIG_PATH + ': ' + e.message);
    process.exit(1);
}

const port = config.port || 9898;
const bind = config.bind || '0.0.0.0';
const gateways = config.gateways || [];
const output = config.output || { type: 'console' };
// 规则: 优先用 config.json 里的 rules, 否则用内置默认(人体开灯-10秒延时关门禁)
const DEFAULT_RULES = [
    {
        name: "人体开灯-10秒延时关",
        match:   { sid: "158d000258361c", attr: "state", equals: true },
        target:  { sid: "158d0002b062cd", attr: "channel_0" },
        onValue: true,
        offValue: false,
        delay: 10,
        doorGuard: "158d00032b73ec"
    }
];
const rules = (config.rules && config.rules.length) ? config.rules : DEFAULT_RULES;

// ---- 输出后端 ----
let out;
let mqttClient = null;

// ---- 设备类型辅助 ----
const SENSOR_TYPES = {
    temperature: ['sensor_ht', 'weather.v1', 'weather'],
    door:        ['magnet', 'sensor_magnet', 'sensor_magnet.aq2'],
    motion:      ['motion', 'sensor_motion', 'sensor_motion.aq2'],
    switch_ctrl: ['plug', '86plug', 'ctrl_86plug', 'ctrl_86plug.aq1',
                  'ctrl_ln1', 'ctrl_ln1.aq1', 'ctrl_ln2', 'ctrl_ln2.aq1',
                  'ctrl_neutral1', 'ctrl_neutral2', 'switch_b2nacn02', 'switch.b2nacn02'],
    gateway:     ['gateway', 'acpartner.v3'],
    button:      ['switch', 'sensor_switch', 'sensor_switch.aq2', 'sensor_switch.aq3',
                  'remote.b1acn01', 'remote.b186acn01', 'remote.b186acn02',
                  'remote.b286acn01', 'remote.b286acn02',
                  '86sw1', '86sw2', 'sensor_86sw1', 'sensor_86sw2'],
    cube:        ['cube', 'sensor_cube.aqgl01'],
    alarm:       ['natgas', 'smoke'],
    curtain:     ['curtain'],
    lock:        ['lock.aq1', 'lock.v1'],
    vibration:   ['vibration'],
    water:       ['sensor_wleak.aq1'],
    relay:       ['relay.c2acn01']
};

function deviceName(sid, type) { return (type + '_' + sid).slice(0, 32); }
function baseDevice(sid, type) {
    return { identifiers: ['mihome_' + sid], name: type + ' ' + sid, manufacturer: 'Xiaomi', model: type };
}

function buildDiscovery(sid, type, data) {
    const base = output.prefix || 'mihome/';
    const stateTopic = base + 'state/' + sid + '/' + type;
    const cmdTopic = base + 'cmd/' + sid;
    const dev = baseDevice(sid, type);
    const msgs = [];

    // ---- 温湿度传感器 ----
    if (SENSOR_TYPES.temperature.includes(type)) {
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_temp/config', payload: {
            name: 'Temp ' + sid, device_class: 'temperature', unit_of_measurement: '°C',
            state_topic: stateTopic, value_template: '{{ value_json.temperature }}',
            unique_id: sid + '_temp', device: dev } });
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_hum/config', payload: {
            name: 'Hum ' + sid, device_class: 'humidity', unit_of_measurement: '%',
            state_topic: stateTopic, value_template: '{{ value_json.humidity }}',
            unique_id: sid + '_hum', device: dev } });
        if (type === 'weather.v1' || type === 'weather') {
            msgs.push({ topic: 'homeassistant/sensor/' + sid + '_pres/config', payload: {
                name: 'Pressure ' + sid, device_class: 'atmospheric_pressure', unit_of_measurement: 'hPa',
                state_topic: stateTopic, value_template: '{{ value_json.pressure }}',
                unique_id: sid + '_pres', device: dev } });
        }
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_bat/config', payload: {
            name: 'Battery ' + sid, device_class: 'battery', unit_of_measurement: '%',
            state_topic: stateTopic, value_template: '{{ value_json.percent }}',
            unique_id: sid + '_bat', device: dev } });
        return msgs;
    }

    // ---- 门磁 ----
    if (SENSOR_TYPES.door.includes(type)) {
        msgs.push({ topic: 'homeassistant/binary_sensor/' + sid + '/config', payload: {
            name: deviceName(sid, type), device_class: 'door',
            state_topic: stateTopic, value_template: '{{ value_json.state }}',
            payload_on: 'true', payload_off: 'false',
            unique_id: sid, device: dev } });
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_bat/config', payload: {
            name: 'Battery ' + sid, device_class: 'battery', unit_of_measurement: '%',
            state_topic: stateTopic, value_template: '{{ value_json.percent }}',
            unique_id: sid + '_bat', device: dev } });
        return msgs;
    }

    // ---- 人体传感器 ----
    if (SENSOR_TYPES.motion.includes(type)) {
        msgs.push({ topic: 'homeassistant/binary_sensor/' + sid + '/config', payload: {
            name: deviceName(sid, type), device_class: 'motion',
            state_topic: stateTopic, value_template: '{{ value_json.state }}',
            payload_on: 'true', payload_off: 'false',
            unique_id: sid, device: dev } });
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_no_motion/config', payload: {
            name: 'No Motion ' + sid, unit_of_measurement: 's',
            state_topic: stateTopic, value_template: '{{ value_json.no_motion }}',
            unique_id: sid + '_no_motion', device: dev } });
        if (type === 'sensor_motion.aq2') {
            msgs.push({ topic: 'homeassistant/sensor/' + sid + '_lux/config', payload: {
                name: 'Lux ' + sid, device_class: 'illuminance', unit_of_measurement: 'lux',
                state_topic: stateTopic, value_template: '{{ value_json.lux }}',
                unique_id: sid + '_lux', device: dev } });
        }
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_bat/config', payload: {
            name: 'Battery ' + sid, device_class: 'battery', unit_of_measurement: '%',
            state_topic: stateTopic, value_template: '{{ value_json.percent }}',
            unique_id: sid + '_bat', device: dev } });
        return msgs;
    }

    // ---- 可控开关 (插座/墙壁开关) ----
    if (SENSOR_TYPES.switch_ctrl.includes(type)) {
        const hasCH0 = ['plug', '86plug', 'ctrl_86plug', 'ctrl_86plug.aq1',
                        'ctrl_ln1', 'ctrl_ln1.aq1', 'ctrl_neutral1'].includes(type);
        const isPlug = ['plug', '86plug', 'ctrl_86plug', 'ctrl_86plug.aq1'].includes(type);
        const attr0 = isPlug ? 'state' : 'channel_0';
        msgs.push({ topic: 'homeassistant/switch/' + sid + '_ch0/config', payload: {
            name: deviceName(sid, type) + ' CH0',
            state_topic: stateTopic, value_template: '{{ value_json.' + attr0 + ' }}',
            command_topic: cmdTopic + '/' + attr0,
            payload_on: 'true', payload_off: 'false',
            state_on: 'true', state_off: 'false',
            unique_id: sid + '_ch0', device: dev } });
        if (!hasCH0) {
            msgs.push({ topic: 'homeassistant/switch/' + sid + '_ch1/config', payload: {
                name: deviceName(sid, type) + ' CH1',
                state_topic: stateTopic, value_template: '{{ value_json.channel_1 }}',
                command_topic: cmdTopic + '/channel_1',
                payload_on: 'true', payload_off: 'false',
                state_on: 'true', state_off: 'false',
                unique_id: sid + '_ch1', device: dev } });
        }
        if (isPlug) {
            msgs.push({ topic: 'homeassistant/sensor/' + sid + '_power/config', payload: {
                name: 'Power ' + sid, device_class: 'power', unit_of_measurement: 'W',
                state_topic: stateTopic, value_template: '{{ value_json.load_power }}',
                unique_id: sid + '_power', device: dev } });
            msgs.push({ topic: 'homeassistant/sensor/' + sid + '_energy/config', payload: {
                name: 'Energy ' + sid, device_class: 'energy', unit_of_measurement: 'Wh',
                state_topic: stateTopic, value_template: '{{ value_json.power_consumed }}',
                unique_id: sid + '_energy', device: dev } });
        }
        return msgs;
    }

    // ---- 网关 ----
    if (SENSOR_TYPES.gateway.includes(type)) {
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_illum/config', payload: {
            name: 'Illum ' + sid, device_class: 'illuminance', unit_of_measurement: 'lux',
            state_topic: stateTopic, value_template: '{{ value_json.illumination }}',
            unique_id: sid + '_illum', device: dev } });
        msgs.push({ topic: 'homeassistant/light/' + sid + '/config', payload: {
            name: 'Gateway Light ' + sid, schema: 'json',
            state_topic: stateTopic,
            command_topic: cmdTopic + '/rgb',
            brightness_state_topic: stateTopic, brightness_value_template: '{{ value_json.dimmer }}',
            brightness_command_topic: cmdTopic + '/dimmer',
            rgb_state_topic: stateTopic, rgb_value_template: '{{ value_json.rgb }}',
            rgb_command_topic: cmdTopic + '/rgb',
            unique_id: sid + '_light', device: dev } });
        msgs.push({ topic: 'homeassistant/binary_sensor/' + sid + '_conn/config', payload: {
            name: 'Gateway ' + sid + ' connected', device_class: 'connectivity',
            state_topic: stateTopic, value_template: '{{ value_json.connected }}',
            payload_on: 'true', payload_off: 'false',
            unique_id: sid + '_conn', device: dev } });
        if (type === 'acpartner.v3') {
            msgs.push({ topic: 'homeassistant/sensor/' + sid + '_ac_power/config', payload: {
                name: 'AC Power ' + sid,
                state_topic: stateTopic, value_template: '{{ value_json.ac_power }}',
                unique_id: sid + '_ac_power', device: dev } });
        }
        return msgs;
    }

    // ---- 按钮/无线开关 ----
    if (SENSOR_TYPES.button.includes(type)) {
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_action/config', payload: {
            name: deviceName(sid, type),
            state_topic: stateTopic, value_template: '{{ value_json | tojson }}',
            unique_id: sid + '_action', device: dev } });
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_bat/config', payload: {
            name: 'Battery ' + sid, device_class: 'battery', unit_of_measurement: '%',
            state_topic: stateTopic, value_template: '{{ value_json.percent }}',
            unique_id: sid + '_bat', device: dev } });
        return msgs;
    }

    // ---- 魔方 ----
    if (SENSOR_TYPES.cube.includes(type)) {
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_action/config', payload: {
            name: deviceName(sid, type),
            state_topic: stateTopic, value_template: '{{ value_json | tojson }}',
            unique_id: sid + '_action', device: dev } });
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_bat/config', payload: {
            name: 'Battery ' + sid, device_class: 'battery', unit_of_measurement: '%',
            state_topic: stateTopic, value_template: '{{ value_json.percent }}',
            unique_id: sid + '_bat', device: dev } });
        return msgs;
    }

    // ---- 报警器 (天然气/烟雾) ----
    if (SENSOR_TYPES.alarm.includes(type)) {
        const devClass = type === 'natgas' ? 'gas' : 'smoke';
        msgs.push({ topic: 'homeassistant/binary_sensor/' + sid + '/config', payload: {
            name: deviceName(sid, type), device_class: devClass,
            state_topic: stateTopic, value_template: '{{ value_json.state }}',
            payload_on: 'true', payload_off: 'false',
            unique_id: sid, device: dev } });
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_bat/config', payload: {
            name: 'Battery ' + sid, device_class: 'battery', unit_of_measurement: '%',
            state_topic: stateTopic, value_template: '{{ value_json.percent }}',
            unique_id: sid + '_bat', device: dev } });
        return msgs;
    }

    // ---- 窗帘 ----
    if (SENSOR_TYPES.curtain.includes(type)) {
        msgs.push({ topic: 'homeassistant/cover/' + sid + '/config', payload: {
            name: deviceName(sid, type), device_class: 'curtain',
            state_topic: stateTopic, position_template: '{{ value_json.curtain_level }}',
            command_topic: cmdTopic + '/curtain_level',
            set_position_topic: cmdTopic + '/curtain_level',
            payload_open: 'open', payload_close: 'close', payload_stop: 'stop',
            unique_id: sid, device: dev } });
        return msgs;
    }

    // ---- 门锁 ----
    if (SENSOR_TYPES.lock.includes(type)) {
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_action/config', payload: {
            name: deviceName(sid, type),
            state_topic: stateTopic, value_template: '{{ value_json | tojson }}',
            unique_id: sid + '_action', device: dev } });
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_bat/config', payload: {
            name: 'Battery ' + sid, device_class: 'battery', unit_of_measurement: '%',
            state_topic: stateTopic, value_template: '{{ value_json.percent }}',
            unique_id: sid + '_bat', device: dev } });
        return msgs;
    }

    // ---- 震动传感器 ----
    if (SENSOR_TYPES.vibration.includes(type)) {
        msgs.push({ topic: 'homeassistant/binary_sensor/' + sid + '/config', payload: {
            name: deviceName(sid, type), device_class: 'vibration',
            state_topic: stateTopic, value_template: '{{ value_json.state }}',
            payload_on: 'true', payload_off: 'false',
            unique_id: sid, device: dev } });
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_bat/config', payload: {
            name: 'Battery ' + sid, device_class: 'battery', unit_of_measurement: '%',
            state_topic: stateTopic, value_template: '{{ value_json.percent }}',
            unique_id: sid + '_bat', device: dev } });
        return msgs;
    }

    // ---- 水浸传感器 ----
    if (SENSOR_TYPES.water.includes(type)) {
        msgs.push({ topic: 'homeassistant/binary_sensor/' + sid + '/config', payload: {
            name: deviceName(sid, type), device_class: 'moisture',
            state_topic: stateTopic, value_template: '{{ value_json.state }}',
            payload_on: 'true', payload_off: 'false',
            unique_id: sid, device: dev } });
        msgs.push({ topic: 'homeassistant/sensor/' + sid + '_bat/config', payload: {
            name: 'Battery ' + sid, device_class: 'battery', unit_of_measurement: '%',
            state_topic: stateTopic, value_template: '{{ value_json.percent }}',
            unique_id: sid + '_bat', device: dev } });
        return msgs;
    }

    // ---- 双路继电器 ----
    if (SENSOR_TYPES.relay.includes(type)) {
        msgs.push({ topic: 'homeassistant/switch/' + sid + '_ch0/config', payload: {
            name: deviceName(sid, type) + ' CH0',
            state_topic: stateTopic, value_template: '{{ value_json.channel_0 }}',
            command_topic: cmdTopic + '/channel_0',
            payload_on: 'true', payload_off: 'false',
            state_on: 'true', state_off: 'false',
            unique_id: sid + '_ch0', device: dev } });
        msgs.push({ topic: 'homeassistant/switch/' + sid + '_ch1/config', payload: {
            name: deviceName(sid, type) + ' CH1',
            state_topic: stateTopic, value_template: '{{ value_json.channel_1 }}',
            command_topic: cmdTopic + '/channel_1',
            payload_on: 'true', payload_off: 'false',
            state_on: 'true', state_off: 'false',
            unique_id: sid + '_ch1', device: dev } });
        return msgs;
    }

    // 默认: 通用 sensor, 把整个 data 发过去
    return [{ topic: 'homeassistant/sensor/' + sid + '_raw/config', payload: {
        name: deviceName(sid, type), state_topic: stateTopic, value_template: '{{ value_json | tojson }}',
        unique_id: sid + '_raw', device: dev } }];
}

if (output.type === 'mqtt') {
    const mqtt = require('mqtt');
    out = {
        discovered: {},
        init() {
            mqttClient = mqtt.connect(output.url, { reconnectPeriod: 5000 });
            mqttClient.on('connect', () => {
                console.log('[mqtt] connected');
                mqttClient.subscribe((output.prefix || 'mihome/') + 'cmd/#', err => {
                    if (err) console.error('[mqtt] subscribe err', err.message);
                });
            });
            mqttClient.on('error', e => console.error('[mqtt] error', e.message));
            mqttClient.on('message', (topic, message) => {
                handleMqttCommand(topic, message.toString());
            });
        },
        send(topic, payload) {
            if (!mqttClient || !mqttClient.connected) {
                console.log(JSON.stringify({ topic, payload }));
                return;
            }
            mqttClient.publish((output.prefix || 'mihome/') + topic, JSON.stringify(payload), { qos: 0 });
        },
        discover(sid, type, data) {
            if (this.discovered[sid + type]) return;
            const msgs = buildDiscovery(sid, type, data);
            for (const m of msgs) {
                mqttClient.publish(m.topic, JSON.stringify(m.payload), { qos: 0, retain: true });
                console.log('[mqtt] discovery:', m.topic);
            }
            this.discovered[sid + type] = true;
        }
    };
    out.init();
} else if (output.type === 'webhook') {
    const http = require('http');
    out = {
        send(topic, payload) {
            const data = JSON.stringify({ topic, payload });
            const url = new URL(output.url);
            const req = http.request({
                hostname: url.hostname, port: url.port || 80, path: url.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            }, res => { res.resume(); });
            req.on('error', e => console.error('[webhook] error', e.message));
            req.write(data); req.end();
        }
    };
} else {
    out = { send(topic, payload) { console.log(JSON.stringify({ topic, payload })); } };
}

// HA 反向控制: 收到 mihome/cmd/<sid>/<attr> -> Control
function handleMqttCommand(topic, value) {
    const prefix = (output.prefix || 'mihome/') + 'cmd/';
    if (topic.indexOf(prefix) !== 0) return;
    const rest = topic.slice(prefix.length); // <sid>/<attr>
    const parts = rest.split('/');
    if (parts.length < 2) return;
    const [sid, attr] = parts;
    const sensor = hub.getSensor(sid);
    if (!sensor || typeof sensor.Control !== 'function') {
        console.error('[mqtt] 控制目标不存在或无 Control:', sid);
        return;
    }
    // 布尔值转换
    let v = value;
    if (v === 'true' || v === 'on' || v === '1') v = true;
    else if (v === 'false' || v === 'off' || v === '0') v = false;
    console.log('[mqtt] 收到控制指令', sid, attr, '=', v);
    // 先刷新 token 再 Control
    const gwIp = (gateways[0] && gateways[0].ip) || '192.168.50.115';
    try { hub.socket.send('{"cmd":"get_id_list"}', 0, 17, 9898, gwIp); } catch (e) {}
    setTimeout(() => { try { sensor.Control(attr, v); } catch (e) { console.error('[mqtt] Control 失败:', e.message); } }, 500);
}

// ---- Hub ----
const keys = (gateways || []).map(g => ({ ip: g.ip, key: g.key }));
let hub = new Hub({ keys: keys, port: port, bind: bind }, true);
hub.listen();

// ---- 规则引擎 ----
let triggers = new TriggerEngine(() => hub, gateways, rules, config);

let lastMessageTime = Date.now();
let reconnectTimer = null;
const RECONNECT_TIMEOUT = (config.heartbeatTimeout || 120) * 1000;

function bindHubEvents() {
    hub.on('message', msg => {
        lastMessageTime = Date.now();
        if (config.debug) console.log('[raw]', JSON.stringify(msg));
    });
    hub.on('error', err => console.error('[hub] error:', err));
    hub.on('debug', msg => { if (config.debug) console.debug('[hub] debug:', msg); });
    hub.on('warning', msg => console.warn('[hub] warn:', msg));
    hub.on('device', (sensor, name) => {
        const sid = sensor.sid;
        const type = sensor.className || sensor.type;
        const ip = sensor.ip;
        console.log(`[device] ${type} sid=${sid} ip=${ip}`);
        if (out.discover) out.discover(sid, type, {});
        out.send(`device/${sid}`, { event: 'present', type, ip });
    });
    hub.on('data', (sid, type, data) => {
        if (!data) return;
        lastMessageTime = Date.now();
        if (out.discover) out.discover(sid, type, data);
        out.send(`state/${sid}/${type}`, data);
        // 匹配所有门磁类型 (magnet, sensor_magnet, sensor_magnet.aq2)
        if (SENSOR_TYPES.door.includes(type)) triggers.onDoor(sid, data);
        triggers.onData(sid, data);
    });
}
bindHubEvents();

// ---- 重连机制 ----
function checkHealth() {
    const elapsed = Date.now() - lastMessageTime;
    if (elapsed > RECONNECT_TIMEOUT) {
        console.warn(`[hub] ${Math.round(elapsed / 1000)}s 无消息, 触发重连...`);
        reconnect();
    }
}

function reconnect() {
    if (reconnectTimer) return;
    try {
        hub.stop(() => {
            hub = null;
            console.log('[hub] 已停止, 3秒后重建...');
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                hub = new Hub({ keys: keys, port: port, bind: bind }, true);
                hub.listen();
                triggers = new TriggerEngine(() => hub, gateways, rules, config);
                bindHubEvents();
                lastMessageTime = Date.now();
                console.log('[hub] 重连完成');
            }, 3000);
        });
    } catch (e) {
        console.error('[hub] 停止失败:', e.message);
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            hub = new Hub({ keys: keys, port: port, bind: bind }, true);
            hub.listen();
            triggers = new TriggerEngine(() => hub, gateways, rules, config);
            bindHubEvents();
            lastMessageTime = Date.now();
        }, 3000);
    }
}

// 保活 + 定期重发现 + 健康检查
const rediscoverInterval = (config.rediscoverInterval || 60) * 1000;
const healthCheckInterval = 30000;

setInterval(() => {
    try { hub && hub.socket && hub.socket.send('{"cmd":"whois"}', 0, 13, 4321, '224.0.0.50'); }
    catch (e) { /* ignore */ }
}, rediscoverInterval).unref();

setInterval(() => {
    checkHealth();
}, healthCheckInterval).unref();

setInterval(() => {}, 1000000);

console.log(`[mihome] started. listen=${port} gateway=9898 bind=${bind} gateways=${gateways.length} output=${output.type} rules=${rules.length} heartbeatTimeout=${RECONNECT_TIMEOUT / 1000}s`);
