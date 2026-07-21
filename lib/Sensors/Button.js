'use strict';

function Button(sid, ip, hub, model) {
    this.sid          = sid;
    this.ip           = ip;
    this.hub          = hub;
    this.className    = model;

    this.voltage      = null;
    this.percent      = null;
    this.click        = null;
    this.double       = null;
    this.long         = null;
}

Button.prototype.getData = function (data) {
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

    if (data.status !== undefined) {
        obj.click  = (data.status === 'click');
        obj.double = (data.status === 'double_click');
        obj.long   = (data.status === 'long_click_press');
        if (data.status === 'click') {
            setTimeout(() => this.hub.emit('data', this.sid, this.className, {click: false}), 100);
        }
        newData = true;
    } else if (data.voltage !== undefined) {
        obj.click  = false;
        obj.double = false;
        obj.long   = false;
        newData    = true;
    }
    return newData ? obj : null;
};

Button.prototype.heartBeat = function (token, data) {
    if (data) {
        const obj = this.getData(data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
Button.prototype.onMessage = function (message) {
    if (message.data) {
        const obj = this.getData(message.data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
module.exports = Button;
