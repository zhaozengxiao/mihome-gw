'use strict';

function Relay(sid, ip, hub, model) {
    this.sid       = sid;
    this.ip        = ip;
    this.hub       = hub;
    this.className = model;

    this.channel_0 = null;
    this.channel_1 = null;
}

Relay.prototype.getData = function (data) {
    let newData = false;
    let obj = {};

    if (data.channel_0 !== undefined) {
        this.channel_0 = (data.channel_0 === 'on' || data.channel_0 === true);
        obj.channel_0  = this.channel_0;
        newData        = true;
    }
    if (data.channel_1 !== undefined) {
        this.channel_1 = (data.channel_1 === 'on' || data.channel_1 === true);
        obj.channel_1  = this.channel_1;
        newData        = true;
    }
    return newData ? obj : null;
};

Relay.prototype.heartBeat = function (token, data) {
    if (data) {
        const obj = this.getData(data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
Relay.prototype.onMessage = function (message) {
    if (message.data) {
        const obj = this.getData(message.data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
Relay.prototype.Control = function (attr, value) {
    const message = {
        cmd:      'write',
        model:    this.className,
        sid:      this.sid,
        short_id: 0,
        data: {}
    };
    if (attr === 'channel_0') {
        message.data['channel_0'] = value ? 'on' : 'off';
    }
    if (attr === 'channel_1') {
        message.data['channel_1'] = value ? 'on' : 'off';
    }
    message.data['key'] = this.hub.getKey(this.ip);
    this.hub.sendMessage(message, this.ip);
};
module.exports = Relay;
