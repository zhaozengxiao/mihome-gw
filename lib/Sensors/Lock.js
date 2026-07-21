'use strict';

function Lock(sid, ip, hub, model) {
    this.sid       = sid;
    this.ip        = ip;
    this.hub       = hub;
    this.className = model;

    this.voltage        = null;
    this.percent        = null;
}

Lock.prototype.getData = function (data) {
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

    if (data.fing_verified !== undefined) {
        obj.fing_verified = data.fing_verified;
        newData = true;
    }
    if (data.psw_verified !== undefined) {
        obj.psw_verified = data.psw_verified;
        newData = true;
    }
    if (data.card_verified !== undefined) {
        obj.card_verified = data.card_verified;
        newData = true;
    }
    if (data.verified_wrong !== undefined) {
        obj.verified_wrong = data.verified_wrong;
        newData = true;
    }
    return newData ? obj : null;
};

Lock.prototype.heartBeat = function (token, data) {
    if (data) {
        const obj = this.getData(data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
Lock.prototype.onMessage = function (message) {
    if (message.data) {
        const obj = this.getData(message.data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
module.exports = Lock;
