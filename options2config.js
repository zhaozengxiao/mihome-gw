'use strict';
// 把 HA Supervisor 注入的 /data/options.json 转成 index.js 使用的 config.json
const fs = require('fs');
const path = require('path');

function load() {
    try {
        return JSON.parse(fs.readFileSync('/data/options.json', 'utf8'));
    } catch (e) {
        console.error('[options2config] 无法读取 /data/options.json:', e.message);
        process.exit(1);
    }
}

const opt = load();
const doorOpenCooldownMs = Number(opt.doorOpenCooldownMs);
const config = {
    port: 9898,
    bind: '0.0.0.0',
    debug: !!opt.debug,
    enable_triggers: opt.enable_triggers !== false,
    doorOpenCooldownMs: Number.isFinite(doorOpenCooldownMs) && doorOpenCooldownMs > 0 ? doorOpenCooldownMs : 3000,
    gateways: [
        { ip: opt.gateway_ip, key: opt.gateway_key, sid: '' }
    ],
    output: {
        type: 'mqtt',
        url: 'mqtt://' + (opt.mqtt_user || '') + ':' + (opt.mqtt_password || '') +
             '@' + (opt.mqtt_server || 'core-mosquitto') + ':' + (opt.mqtt_port || 1883),
        prefix: 'mihome/'
    },
    rules: opt.rules || []
};

fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
console.log('[options2config] config.json 已生成');