'use strict';

class TriggerEngine {
    /**
     * @param {Function} hubGetter 返回当前 hub 实例的函数 (因为重连时 hub 会变)
     * @param {Array} gateways 网关列表 [{ip, key}]
     * @param {Array} rules 规则列表
     * @param {Object} config 配置对象 (需要 enable_triggers 字段)
     */
    constructor(hubGetter, gateways, rules, config) {
        this._hub = hubGetter;
        this._gateways = gateways;
        this._rules = rules;
        this._config = config;
        this._timers = {};
        this._heldByDoor = {};
        this._doorStates = {};
        this._timerMetClosedDoor = {}; // 定时期间门是否关过
    }

    get hub() { return this._hub(); }

    // ---- 工具方法 ----

    _getVal(obj, attr) {
        return obj && obj.hasOwnProperty(attr) ? obj[attr] : undefined;
    }

    _ruleKey(rule) {
        return rule.name || (rule.target.sid + '/' + rule.target.attr);
    }

    // ---- 发送控制指令 ----
    // 先发 get_id_list 刷新 token, 等 500ms 网关回包后用最新 token 加密写命令

    _applyControl(rule, value) {
        const hub = this.hub;
        const sensor = hub.getSensor(rule.target.sid);
        if (!sensor) {
            console.error(`[trigger] 找不到目标设备 ${rule.target.sid}`);
            return;
        }
        if (typeof sensor.Control !== 'function') {
            console.error(`[trigger] 设备 ${rule.target.sid} 不支持 Control`);
            return;
        }
        const gwIp = (this._gateways[0] && this._gateways[0].ip) || '192.168.50.115';
        try { hub.socket.send('{"cmd":"get_id_list"}', 0, 17, 9898, gwIp); } catch (e) {}
        setTimeout(() => {
            try { sensor.Control(rule.target.attr, value); }
            catch (e) { console.error(`[trigger] Control 失败: ${e.message}`); }
        }, 500);
    }

    // ---- 延时关闭调度 ----

    _scheduleOff(rule) {
        const key = this._ruleKey(rule);
        if (this._timers[key]) clearTimeout(this._timers[key]);

        // 重置状态，记录当前门是否已关
        this._heldByDoor[key] = false;
        const dg = rule.doorGuard;
        this._timerMetClosedDoor[key] = dg ? (this._doorStates[dg] === false) : false;

        this._timers[key] = setTimeout(() => {
            if (dg && this._timerMetClosedDoor[key]) {
                // 定时期间门关过（或一开始就关着）→ 人在里面 → 等门开再关
                this._heldByDoor[key] = true;
                console.log(`[trigger] ${rule.name}: 定时期间门(${dg})关过, 保持亮灯等门开`);
                delete this._timers[key];
                delete this._timerMetClosedDoor[key];
                return;
            }
            // 门一直开着 → 人只是路过 → 直接关
            this._applyControl(rule, rule.offValue);
            this._heldByDoor[key] = false;
            console.log(`[trigger] ${rule.name}: 超时 ${rule.delay}s -> offValue=${rule.offValue}`);
            delete this._timers[key];
            delete this._timerMetClosedDoor[key];
        }, (rule.delay || 10) * 1000);
    }

    // ---- 公共接口: 传感器数据到达时调用 ----

    /**
     * 处理传感器数据，匹配规则并触发
     * @param {string} sid 设备 sid
     * @param {Object} data 传感器上报的数据
     */
    onData(sid, data) {
        if (this._config.enable_triggers === false) {
            return;
        }
        for (const rule of this._rules) {
            if (!rule.match || rule.match.sid !== sid) continue;
            const v = this._getVal(data, rule.match.attr);
            if (v === undefined) continue;
            if (String(v) !== String(rule.match.equals)) continue;
            this._applyControl(rule, rule.onValue);
            console.log(`[trigger] ${rule.name}: 命中 -> onValue=${rule.onValue}`);
            this._scheduleOff(rule);
        }
    }

    /**
     * 处理门磁数据，用于门磁守卫逻辑
     * @param {string} sid 门磁设备 sid
     * @param {Object} data 门磁上报的数据
     */
    onDoor(sid, data) {
        if (this._config.enable_triggers === false) return;
        const st = this._getVal(data, 'state');
        if (st === undefined) return;
        const wasClosed = this._doorStates[sid] === false;
        this._doorStates[sid] = !!st;

        if (st === false) {
            // 门关了 → 标记所有活跃定时器的门关过
            for (const rule of this._rules) {
                if (rule.doorGuard !== sid) continue;
                const key = this._ruleKey(rule);
                if (this._timers[key]) {
                    this._timerMetClosedDoor[key] = true;
                    console.log(`[trigger] ${rule.name}: 定时期间门(${sid})关闭, 标记等门开`);
                }
            }
        }

        if (st === true && wasClosed) {
            // 门从关变开 → 补关所有被暂缓的灯
            for (const rule of this._rules) {
                if (rule.doorGuard !== sid) continue;
                const key = this._ruleKey(rule);
                if (this._heldByDoor[key]) {
                    this._applyControl(rule, rule.offValue);
                    this._heldByDoor[key] = false;
                    console.log(`[trigger] 门(${sid})打开, 补关 ${rule.name} -> offValue=${rule.offValue}`);
                }
            }
        }
    }
}

module.exports = TriggerEngine;
