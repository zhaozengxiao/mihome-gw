'use strict';

function VibrationSensor(sid, ip, hub, model) {
    this.sid           = sid;
    this.ip            = ip;
    this.hub           = hub;
    this.className     = model;

    this.voltage       = null;
    this.percent       = null;
    this.state         = false;
}

VibrationSensor.prototype.getData = function (data) {
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
        this.state = (data.status === 'vibrate' || data.status === 'true');
        obj.state  = this.state;
        newData    = true;
    }
    if (data.tilt_angle !== undefined) {
        obj.tilt_angle = parseFloat(data.tilt_angle);
        newData = true;
    }
    if (data.orientationX !== undefined) {
        obj.orientationX = parseFloat(data.orientationX);
        newData = true;
    }
    if (data.orientationY !== undefined) {
        obj.orientationY = parseFloat(data.orientationY);
        newData = true;
    }
    if (data.orientationZ !== undefined) {
        obj.orientationZ = parseFloat(data.orientationZ);
        newData = true;
    }
    if (data.bed_activity !== undefined) {
        obj.bed_activity = parseFloat(data.bed_activity);
        newData = true;
    }
    return newData ? obj : null;
};

VibrationSensor.prototype.heartBeat = function (token, data) {
    if (data) {
        const obj = this.getData(data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
VibrationSensor.prototype.onMessage = function (message) {
    if (message.data) {
        const obj = this.getData(message.data);
        if (obj) {
            this.hub.emit('data', this.sid, this.className, obj);
        }
    }
};
module.exports = VibrationSensor;
