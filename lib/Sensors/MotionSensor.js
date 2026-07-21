'use strict';

function MotionSensor(sid, ip, hub, model) {
    this.sid       = sid;
    this.ip        = ip;
    this.hub       = hub;
    this.className = model;

    this.voltage   = null;
    this.percent   = null;
    this.state     = false;
    this.motion    = false;
    this.no_motion = null;
}

MotionSensor.prototype.getData = function (data) {
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
        this.motion = (data.status === 'motion');
        obj.state   = this.motion;
        newData     = true;
    }
    if (this.no_motion !== data.no_motion && data.no_motion !== undefined) {
        this.no_motion = data.no_motion;
        obj.no_motion  = this.no_motion;
        newData        = true;
    }
    if (data.lux !== undefined) {
        obj.lux  = parseInt(data.lux, 10);
        newData  = true;
    }
    return newData ? obj : null;
};

MotionSensor.prototype.heartBeat = function (token, data) {
    if (data) {
        const obj = this.getData(data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
MotionSensor.prototype.onMessage = function (message) {
    if (message.data) {
        const obj = this.getData(message.data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
module.exports = MotionSensor;
