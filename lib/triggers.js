'use strict';

class TriggerEngine {
    constructor(hubGetter, gateways, rules, config) {
        this._hub = hubGetter;
        this._gateways = gateways;
        this._rules = rules;
        this._config = config;
        this._timers = {};
        this._heldByDoor = {};       // 按 doorGuard sid 共享，多规则可共用
        this._doorStates = {};
        this._doorClosed = {};
        this._motionAfterClose = {};
        this._lastTokenRefresh = {};
    }

    get hub() { return this._hub(); }

    _getVal(obj, attr) {
        return obj && obj.hasOwnProperty(attr) ? obj[attr] : undefined;
    }

    _ruleKey(rule) {
        return rule.name || (rule.target.sid + '/' + rule.target.attr);
    }

    _checkCondition(rule) {
        const cond = rule.condition;
        if (!cond) return true;
        const sensor = this.hub.getSensor(cond.sid);
        if (!sensor) return false;
        const cur = this._getVal(sensor, cond.attr);
        return String(cur) === String(cond.equals);
    }

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

    _startTimer(rule, delay) {
        const key = this._ruleKey(rule);
        if (this._timers[key]) clearTimeout(this._timers[key]);

        this._timers[key] = setTimeout(() => {
            const dg = rule.doorGuard;
            if (dg && this._doorClosed[key] && this._motionAfterClose[key]) {
                // _heldByDoor 按 doorGuard 共享，多规则共用
                this._heldByDoor[dg] = true;
                console.log(`[trigger] ${rule.name}: 门关了且关门后有人活动, 保持亮灯等门开`);
            } else if (dg && this._heldByDoor[dg]) {
                // 其他规则已确认人在里面，本规则也保持
                console.log(`[trigger] ${rule.name}: 其他规则已确认人在里面, 保持亮灯`);
            } else {
                this._applyControl(rule, rule.offValue);
                console.log(`[trigger] ${rule.name}: ${delay / 1000}s -> offValue=${rule.offValue}` + (dg ? ` (门${this._doorClosed[key] ? '' : '未'}关)` : ''));
            }
            delete this._timers[key];
            delete this._doorClosed[key];
            delete this._motionAfterClose[key];
        }, delay);
    }

    _scheduleOff(rule) {
        const key = this._ruleKey(rule);
        if (rule.doorGuard) {
            this._heldByDoor[rule.doorGuard] = false;
            if (this._doorClosed[key] !== true) {
                this._doorClosed[key] = (this._doorStates[rule.doorGuard] === false);
            }
            if (!this._doorClosed[key]) {
                this._motionAfterClose[key] = false;
            }
        }
        this._startTimer(rule, (rule.delay || 10) * 1000);
    }

    onData(sid, data) {
        if (this._config.enable_triggers === false) return;
        for (const rule of this._rules) {
            if (!rule.match || rule.match.sid !== sid) continue;
            const v = this._getVal(data, rule.match.attr);
            if (v === undefined) continue;
            if (String(v) !== String(rule.match.equals)) continue;

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

            if (rule.delay) {
                this._scheduleOff(rule);
            }
        }
    }

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
            // _heldByDoor 按 doorGuard 共享，开门时关所有关联规则的灯
            if (this._heldByDoor[sid]) {
                for (const rule of this._rules) {
                    if (rule.doorGuard !== sid) continue;
                    this._applyControl(rule, rule.offValue);
                    console.log(`[trigger] ${sid}, ${rule.name} -> offValue=${rule.offValue}`);
                }
                this._heldByDoor[sid] = false;
            }
        }
    }
}

module.exports = TriggerEngine;
