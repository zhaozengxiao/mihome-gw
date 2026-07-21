'use strict';

function Plug(sid, ip, hub, model) {
    this.sid           = sid;
    this.ip            = ip;
    this.hub           = hub;
    this.className     = model;

    this.voltage       = null;
    this.percent       = null;
    this.state         = null;
    this.load_power    = null;
    this.power_consumed= null;
    this.inuse         = null;
}

Plug.prototype.getData = function (data) {
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
        this.state = (data.status === 'on');
        obj.state  = this.state;
        newData    = true;
    }
    if (data.load_power !== undefined) {
        this.load_power = data.load_power;
        obj.load_power  = this.load_power;
        newData         = true;
    }
    if (data.power_consumed !== undefined) {
        this.power_consumed = data.power_consumed;
        obj.power_consumed  = this.power_consumed;
        newData             = true;
    }
    if (data.inuse !== undefined) {
        this.inuse = (data.inuse === 'true' || data.inuse === true);
        obj.inuse  = this.inuse;
        newData    = true;
    }
    if (data.channel_0 !== undefined) {
        this.state = (data.channel_0 === 'on' || data.channel_0 === true);
        obj.state  = this.state;
        newData    = true;
    }
    return newData ? obj : null;
};

Plug.prototype.heartBeat = function (token, data) {
    if (data) {
        const obj = this.getData(data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
Plug.prototype.onMessage = function (message) {
    if (message.data) {
        const obj = this.getData(message.data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
Plug.prototype.Control = function (attr, value) {
    const message = {
        cmd:      'write',
        model:    this.className,
        sid:      this.sid,
        short_id: 0,
        data: {
            key: this.hub.getKey(this.ip)
        }
    };
    if (attr === 'channel_0') {
        message.data['channel_0'] = value ? 'on' : 'off';
    } else {
        message.data[attr] = value ? 'on' : 'off';
    }
    this.hub.sendMessage(message, this.ip);
};
module.exports = Plug;
