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
        this._doorClosed = {};       // 定时期间门是否关了
        this._motionAfterClose = {};  // 关门后是否又检测到人体
        this._lastTokenRefresh = {};  // 上次 token 刷新时间 (ms)
    }

    get hub() { return this._hub(); }

    // ---- 工具方法 ----

    _getVal(obj, attr) {
        return obj && obj.hasOwnProperty(attr) ? obj[attr] : undefined;
    }

    _ruleKey(rule) {
        return rule.name || (rule.target.sid + '/' + rule.target.attr);
    }

    /** 检查目标设备当前状态是否满足 condition */
    _checkCondition(rule) {
        const cond = rule.condition;
        if (!cond) return true;
        const sensor = this.hub.getSensor(cond.sid);
        if (!sensor) return false;
        const cur = this._getVal(sensor, cond.attr);
        return String(cur) === String(cond.equals);
    }

    // ---- 发送控制指令 ----
    // token 有效期内直接发送，过期 (>10s) 才发 get_id_list 刷新

    _applyControl(rule, value) {
        const hub = this.hub;
        const sensor = hub.getSensor(rule.target.sid);
        if (!sensor) {
            console.error(`[trigger] TDDE ${rule.target.sid}`);
            return;
        }
        if (typeof sensor.Control !== 'function') {
            console.error(`[trigger] ${rule.target.sid} Control`);
            return;
        }

        const gwIp = (this._gateways[0] && this._gateways[0].ip) || '192.168.50.115';
        const now = Date.now();
        const lastRefresh = this._lastTokenRefresh[gwIp] || 0;
        const tokenAge = now - lastRefresh;

        const doControl = () => {
            try { sensor.Control(rule.target.attr, value); }
            catch (e) { console.error(`[trigger] Control : ${e.message}`); }
        };

        if (tokenAge > 10000) {
            try { hub.socket.send('{"cmd":"get_id_list"}', 0, 17, 9898, gwIp); } catch (e) {}
            this._lastTokenRefresh[gwIp] = now;
            setTimeout(doControl, 500);
        } else {
            doControl();
        }
    }

    // ---- 定时器 (可被 _scheduleOff 和 onDoor 复用) ----

    _startTimer(rule, delay) {
        const key = this._ruleKey(rule);
        if (this._timers[key]) clearTimeout(this._timers[key]);

        this._timers[key] = setTimeout(() => {
            const dg = rule.doorGuard;
            if (dg && this._doorClosed[key] && this._motionAfterClose[key]) {
                this._heldByDoor[key] = true;
                console.log(`[trigger] ${rule.name}: 门关了且关门后有人活动, 保持亮灯等门开`);
            } else {
                this._applyControl(rule, rule.offValue);
                this._heldByDoor[key] = false;
                console.log(`[trigger] ${rule.name}: ${delay / 1000}s -> offValue=${rule.offValue}` + (dg ? ` (门${this._doorClosed[key] ? '' : '未'}关)` : ''));
            }
            delete this._timers[key];
            delete this._doorClosed[key];
            delete this._motionAfterClose[key];
        }, delay);
    }

    // ---- 延时关闭调度 ----

    _scheduleOff(rule) {
        const key = this._ruleKey(rule);
        this._heldByDoor[key] = false;
        if (rule.doorGuard) {
            if (this._doorClosed[key] !== true) {
                this._doorClosed[key] = (this._doorStates[rule.doorGuard] === false);
            }
            if (!this._doorClosed[key]) {
                this._motionAfterClose[key] = false;
            }
        }
        this._startTimer(rule, (rule.delay || 10) * 1000);
    }

    // ---- 公共接口: 传感器数据到达时调用 ----

    onData(sid, data) {
        if (this._config.enable_triggers === false) return;
        for (const rule of this._rules) {
            if (!rule.match || rule.match.sid !== sid) continue;
            const v = this._getVal(data, rule.match.attr);
            if (v === undefined) continue;
            if (String(v) !== String(rule.match.equals)) continue;

            // 条件检查: 如 "灯关着才开"
            if (!this._checkCondition(rule)) {
                console.log(`[trigger] ${rule.name}: 条件不满足, 跳过`);
                continue;
            }

            const key = this._ruleKey(rule);
            if (rule.doorGuard && this._doorClosed[key]) {
                this._motionAfterClose[key] = true;
                console.log(`[trigger] ${rule.name}: 关门后检测到人体, 确认人在里面`);
            }

            this._applyControl(rule, rule.onValue);
            console.log(`[trigger] ${rule.name}: 命中 -> onValue=${rule.onValue}`);

            // 有 delay 的规则才启动定时关灯
            if (rule.delay) {
                this._scheduleOff(rule);
            }
        }
    }

    /**
     * 处理门磁数据，用于门磁守卫逻辑
     */
    onDoor(sid, data) {
        if (this._config.enable_triggers === false) return;
        const st = this._getVal(data, 'state');
        if (st === undefined) return;
        const wasClosed = this._doorStates[sid] === false;
        this._doorStates[sid] = !!st;

        if (st === false) {
            for (const rule of this._rules) {
                if (rule.doorGuard !== sid) continue;
                const key = this._ruleKey(rule);
                if (this._timers[key]) {
                    this._doorClosed[key] = true;
                    console.log(`[trigger] ${rule.name}: 定时期间门关闭, 等待关门后人体确认`);
                }
            }
        }

        if (st === true && wasClosed) {
            for (const rule of this._rules) {
                if (rule.doorGuard !== sid) continue;
                const key = this._ruleKey(rule);
                if (this._heldByDoor[key]) {
                    this._applyControl(rule, rule.offValue);
                    this._heldByDoor[key] = false;
                    console.log(`[trigger] ${sid}, ${rule.name} -> offValue=${rule.offValue}`);
                }
            }
        }
    }
}

module.exports = TriggerEngine;
