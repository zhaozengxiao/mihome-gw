'use strict';

function WallButtons(sid, ip, hub, model) {
    this.sid          = sid;
    this.ip           = ip;
    this.hub          = hub;
    this.className    = model;

    this.voltage      = null;
    this.percent      = null;
}

WallButtons.prototype.getData = function (data) {
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

    if (data.channel_0 !== undefined) {
        obj.channel_0 = (data.channel_0 === 'click');
        newData = true;
    }
    if (data.channel_1 !== undefined) {
        obj.channel_1 = (data.channel_1 === 'click');
        newData = true;
    }
    if (data.dual_channel !== undefined) {
        obj.dual_channel = (data.dual_channel === 'click');
        newData = true;
    }
    if (data.status !== undefined) {
        obj.channel_0 = (data.status === 'click');
        newData = true;
    }
    return newData ? obj : null;
};

WallButtons.prototype.heartBeat = function (token, data) {
    if (data) {
        const obj = this.getData(data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
WallButtons.prototype.onMessage = function (message) {
    if (message.data) {
        const obj = this.getData(message.data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
module.exports = WallButtons;
