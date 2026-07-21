'use strict';

function Curtain(sid, ip, hub, model) {
    this.sid       = sid;
    this.ip        = ip;
    this.hub       = hub;
    this.className = model;

    this.curtain_level = null;
}

Curtain.prototype.getData = function (data) {
    let newData = false;
    let obj = {};

    if (data.curtain_level !== undefined) {
        this.curtain_level = parseInt(data.curtain_level, 10);
        obj.curtain_level  = this.curtain_level;
        newData            = true;
    }
    if (data.status !== undefined) {
        if (data.status === 'open' || data.status === 'close' || data.status === 'stop') {
            obj[data.status] = true;
            newData = true;
        }
    }
    return newData ? obj : null;
};

Curtain.prototype.heartBeat = function (token, data) {
    if (data) {
        const obj = this.getData(data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
Curtain.prototype.onMessage = function (message) {
    if (message.data) {
        const obj = this.getData(message.data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
Curtain.prototype.Control = function (attr, value) {
    const message = {
        cmd:      'write',
        model:    this.className,
        sid:      this.sid,
        short_id: 0,
        data: {}
    };
    if (attr === 'curtain_level') {
        message.data['curtain_level'] = value;
    }
    message.data['key'] = this.hub.getKey(this.ip);
    this.hub.sendMessage(message, this.ip);
};
module.exports = Curtain;
