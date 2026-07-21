'use strict';

class TriggerEngine {
    constructor(hubGetter, gateways, rules, config) {
        this._hub = hubGetter;
        this._gateways = gateways;
        this._rules = rules;
        this._config = config;
        this._timers = {};
        this._heldByDoor = {};       // 按 doorGuard 共享
        this._doorStates = {};
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

    /** 取消同 doorGuard 所有规则的定时器 */
    _cancelAllTimers(dg) {
        for (const rule of this._rules) {
            if (rule.doorGuard !== dg) continue;
            const key = this._ruleKey(rule);
            if (this._timers[key]) {
                clearTimeout(this._timers[key]);
                delete this._timers[key];
            }
        }
    }

    _startTimer(rule, delay) {
        const key = this._ruleKey(rule);
        if (this._timers[key]) clearTimeout(this._timers[key]);

        this._timers[key] = setTimeout(() => {
            const dg = rule.doorGuard;
            if (dg && this._heldByDoor[dg]) {
                console.log(`[trigger] ${rule.name}: 保持亮灯等门开`);
            } else {
                this._applyControl(rule, rule.offValue);
                console.log(`[trigger] ${rule.name}: ${delay / 1000}s -> offValue=${rule.offValue}` + (dg ? ` (门${this._doorStates[dg] ? '开' : '关'})` : ''));
            }
            delete this._timers[key];
        }, delay);
    }

    _scheduleOff(rule) {
        if (rule.doorGuard) {
            this._heldByDoor[rule.doorGuard] = false;
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

            const dg = rule.doorGuard;

            // 第二次信号 + 门关着 → 取消所有定时器，保持亮灯等门开
            if (dg && this._doorStates[dg] === false) {
                this._cancelAllTimers(dg);
                this._heldByDoor[dg] = true;
                console.log(`[trigger] ${rule.name}: 门关着, 取消定时, 保持亮灯等门开`);
                continue;
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

        if (st === true && wasClosed && this._heldByDoor[sid]) {
            // 门开了 → 关所有关联的灯
            for (const rule of this._rules) {
                if (rule.doorGuard !== sid) continue;
                this._applyControl(rule, rule.offValue);
                console.log(`[trigger] ${sid}, ${rule.name} -> offValue=${rule.offValue}`);
            }
            this._heldByDoor[sid] = false;
        }
    }
}

module.exports = TriggerEngine;
