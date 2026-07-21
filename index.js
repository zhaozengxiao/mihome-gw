'use strict';

const fs = require('fs');
const path = require('path');
const { Hub } = require('./lib/Hub');

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

function buildDiscovery(sid, type, data) {
    // 根据设备类型生成 HA MQTT discovery config 消息
    const base = output.prefix || 'mihome/';
    const stateTopic = base + 'state/' + sid + '/' + type;
    const name = (type + '_' + sid).slice(0, 32);

    // 设备元数据(归入同一网关设备下)
    const device = {
        identifiers: ['mihome_' + sid],
        name: type + ' ' + sid,
        manufacturer: 'Xiaomi',
        model: type
    };

    if (type === 'sensor_ht') {
        return [
            { topic: 'homeassistant/sensor/' + sid + '_temp/config', payload: {
                name: 'Temp ' + sid, device_class: 'temperature', unit_of_measurement: '°C',
                state_topic: stateTopic, value_template: '{{ value_json.temperature }}',
                unique_id: sid + '_temp', device } },
            { topic: 'homeassistant/sensor/' + sid + '_hum/config', payload: {
                name: 'Hum ' + sid, device_class: 'humidity', unit_of_measurement: '%',
                state_topic: stateTopic, value_template: '{{ value_json.humidity }}',
                unique_id: sid + '_hum', device } }
        ];
    }
    if (type === 'magnet' || type === 'motion') {
        return [{ topic: 'homeassistant/binary_sensor/' + sid + '/config', payload: {
            name: name, device_class: type === 'magnet' ? 'door' : 'motion',
            state_topic: stateTopic, value_template: '{{ value_json.state }}',
            unique_id: sid, device } }];
    }
    if (type === 'ctrl_neutral1' || type === 'ctrl_ln1.aq1' || type === 'plug' || type.indexOf('switch') !== -1) {
        const attr = 'channel_0';
        return [{ topic: 'homeassistant/switch/' + sid + '_ch0/config', payload: {
            name: name + ' CH0', state_topic: stateTopic,
            value_template: '{{ value_json.channel_0 }}',
            command_topic: base + 'cmd/' + sid + '/' + attr,
            payload_on: 'on', payload_off: 'off',
            unique_id: sid + '_ch0', device } }];
    }
    if (type === 'gateway') {
        return [{ topic: 'homeassistant/sensor/' + sid + '_illum/config', payload: {
            name: 'Illum ' + sid, device_class: 'illuminance',
            state_topic: stateTopic, value_template: '{{ value_json.illumination }}',
            unique_id: sid + '_illum', device } }];
    }
    // 默认: 通用 sensor, 把整个 data 发过去
    return [{ topic: 'homeassistant/sensor/' + sid + '_raw/config', payload: {
        name: name, state_topic: stateTopic, value_template: '{{ value_json | tojson }}',
        unique_id: sid + '_raw', device } }];
}

if (output.type === 'mqtt') {
    const mqtt = require('mqtt');
    out = {
        discovered: {},
        init() {
            mqttClient = mqtt.connect(output.url, { reconnectPeriod: 5000 });
            mqttClient.on('connect', () => {
                console.log('[mqtt] connected');
                // 订阅所有控制指令
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
            const { Hub } = require('./lib/Hub');
            // topic 形如 device/<sid> 或 state/<sid>/<type>
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
    const v = (value === 'true' || value === 'on' || value === '1');
    console.log('[mqtt] 收到控制指令', sid, attr, '=', v);
    // 先刷新 token 再 Control
    const gwIp = (gateways[0] && gateways[0].ip) || '192.168.50.115';
    try { hub.socket.send('{"cmd":"get_id_list"}', 0, 17, 9898, gwIp); } catch (e) {}
    setTimeout(() => { try { sensor.Control(attr, v); } catch (e) { console.error('[mqtt] Control 失败:', e.message); } }, 500);
}

// ---- Hub ----
const keys = (gateways || []).map(g => ({ ip: g.ip, key: g.key }));
const hub = new Hub({ keys: keys, port: port, bind: bind }, true);
hub.listen();

hub.on('message', msg => { if (config.debug) console.log('[raw]', JSON.stringify(msg)); });
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
    if (out.discover) out.discover(sid, type, data);
    out.send(`state/${sid}/${type}`, data);
    if (type === 'magnet') handleDoor(sid, data);
    runRules(sid, data);
});

// ---- Trigger 规则引擎 ----
const ruleTimers = {};
const ruleHeldByDoor = {};
const doorStates = {};

function getVal(obj, attr) {
    return obj && obj.hasOwnProperty(attr) ? obj[attr] : undefined;
}
function ruleKey(rule) { return rule.name || (rule.target.sid + '/' + rule.target.attr); }

function scheduleOff(rule) {
    const key = ruleKey(rule);
    if (ruleTimers[key]) clearTimeout(ruleTimers[key]);
    ruleTimers[key] = setTimeout(() => {
        const dg = rule.doorGuard;
        if (dg && doorStates[dg] === false) {
            ruleHeldByDoor[key] = true;
            console.log(`[trigger] ${rule.name || rule.target.sid}: 到点但门(${dg})关着, 保持亮灯(heldByDoor)`);
            delete ruleTimers[key];
            return;
        }
        applyControl(rule, rule.offValue);
        ruleHeldByDoor[key] = false;
        console.log(`[trigger] ${rule.name || rule.target.sid}: 超时 ${rule.delay}s -> offValue=${rule.offValue}`);
        delete ruleTimers[key];
    }, (rule.delay || 10) * 1000);
}

function runRules(sid, data) {
    if (config.enable_triggers === false) {
        console.log('[trigger] enable_triggers=false, 跳过规则');
        return;
    }
    for (const rule of rules) {
        if (!rule.match || rule.match.sid !== sid) continue;
        const v = getVal(data, rule.match.attr);
        if (v === undefined) continue;
        if (String(v) !== String(rule.match.equals)) continue;
        applyControl(rule, rule.onValue);
        ruleHeldByDoor[ruleKey(rule)] = false;
        console.log(`[trigger] ${rule.name || rule.target.sid}: 命中 -> onValue=${rule.onValue}`);
        scheduleOff(rule);
    }
}

function handleDoor(sid, data) {
    if (config.enable_triggers === false) return;
    const st = getVal(data, 'state');
    if (st === undefined) return;
    const wasClosed = doorStates[sid] === false;
    doorStates[sid] = !!st;
    if (st === true && wasClosed) {
        for (const rule of rules) {
            if (rule.doorGuard !== sid) continue;
            const key = ruleKey(rule);
            if (ruleHeldByDoor[key]) {
                applyControl(rule, rule.offValue);
                ruleHeldByDoor[key] = false;
                console.log(`[trigger] 门(${sid})打开, 补关 ${rule.name || rule.target.sid} -> offValue=${rule.offValue}`);
            }
        }
    }
}

function applyControl(rule, value) {
    const sensor = hub.getSensor(rule.target.sid);
    if (!sensor) { console.error(`[trigger] 找不到目标设备 ${rule.target.sid}`); return; }
    if (typeof sensor.Control !== 'function') { console.error(`[trigger] 设备 ${rule.target.sid} 不支持 Control`); return; }
    // HA 需先刷新 token 再 Control
    const gwIp = (gateways[0] && gateways[0].ip) || '192.168.50.115';
    try { hub.socket.send('{"cmd":"get_id_list"}', 0, 17, 9898, gwIp); } catch (e) {}
    setTimeout(() => {
        try { sensor.Control(rule.target.attr, value); }
        catch (e) { console.error(`[trigger] Control 失败: ${e.message}`); }
    }, 500);
}

// 保活 + 定期重发现
const rediscoverInterval = (config.rediscoverInterval || 60) * 1000;
setInterval(() => {
    try { hub.socket && hub.socket.send('{"cmd":"whois"}', 0, 13, 4321, '224.0.0.50'); }
    catch (e) { /* ignore */ }
}, rediscoverInterval).unref();
setInterval(() => {}, 1000000);

console.log(`[mihome] started. listen=${port} gateway=9898 bind=${bind} gateways=${gateways.length} output=${output.type} rules=${rules.length}`);