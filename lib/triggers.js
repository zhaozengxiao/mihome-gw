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
            // token 可能已过期，刷新后再发
            try { hub.socket.send('{"cmd":"get_id_list"}', 0, 17, 9898, gwIp); } catch (e) {}
            this._lastTokenRefresh[gwIp] = now;
            setTimeout(doControl, 500);
        } else {
            // token 有效，直接发送 (0 延迟)
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
                // 门关了 + 关门后还有人活动 → 人在里面 → 等门开再关
                this._heldByDoor[key] = true;
                console.log(`[trigger] ${rule.name}: 门关了且关门后有人活动, 保持亮灯等门开`);
            } else {
                // 门一直开 或 门关后无人活动 → 直接关
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
            // 保留 onDoor 已设置的 doorClosed 状态，避免被覆盖
            if (this._doorClosed[key] !== true) {
                this._doorClosed[key] = (this._doorStates[rule.doorGuard] === false);
            }
            this._motionAfterClose[key] = false;
        }
        this._startTimer(rule, (rule.delay || 10) * 1000);
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

            // 如果定时期间门已关，这次人体触发说明人在里面
            const key = this._ruleKey(rule);
            if (rule.doorGuard && this._doorClosed[key]) {
                this._motionAfterClose[key] = true;
                console.log(`[trigger] ${rule.name}: 关门后检测到人体, 确认人在里面`);
            }

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
            // 门关了 → 标记所有活跃定时器，延长至 65 秒覆盖人体传感器 ~60s 冷却期
            for (const rule of this._rules) {
                if (rule.doorGuard !== sid) continue;
                const key = this._ruleKey(rule);
                if (this._timers[key]) {
                    this._doorClosed[key] = true;
                    this._startTimer(rule, 65000);
                    console.log(`[trigger] ${rule.name}: 定时期间门关闭, 延长至65秒等待人体确认`);
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
                    console.log(`[trigger] ${sid}, ${rule.name} -> offValue=${rule.offValue}`);
                }
            }
        }
    }
}

module.exports = TriggerEngine;
