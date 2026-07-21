'use strict';

function Alarm(sid, ip, hub, model) {
    this.sid       = sid;
    this.ip        = ip;
    this.hub       = hub;
    this.className = model;

    this.voltage   = null;
    this.percent   = null;
    this.state     = false;
    this.desc      = null;
}

Alarm.prototype.getData = function (data) {
    let newData = false;
    let obj = {};
    if (this.voltage !== data.voltage && data.voltage !== undefined) {
        data.voltage = parseInt(data.voltage, 10);
        this.voltage = data.voltage / 1000;
        this.percent = Math.round(((data.voltage - 2655) / 3.45) * 10) / 10;
        if (this.percent > 100) {
            this.percent = 100;
        }
        if (this.percent < 0) {
            this.percent = 0;
        }
        obj.voltage = this.voltage;
        obj.percent = this.percent;
        newData = true;
    }

    if (data.alarm !== undefined) {
        this.state = (data.alarm === '1' || data.alarm === 1 || data.alarm === true);
        obj.state  = this.state;
        if (data.alarm === '1' || data.alarm === 1 || data.alarm === true) {
            this.desc = 'Alarm triggered';
            obj.description = this.desc;
        } else {
            this.desc = 'Normal';
            obj.description = this.desc;
        }
        newData    = true;
    }
    if (data.desc !== undefined) {
        this.desc = data.desc;
        obj.description = this.desc;
        newData   = true;
    }
    return newData ? obj : null;
};

Alarm.prototype.heartBeat = function (token, data) {
    if (data) {
        const obj = this.getData(data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
Alarm.prototype.onMessage = function (message) {
    if (message.data) {
        const obj = this.getData(message.data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
module.exports = Alarm;
