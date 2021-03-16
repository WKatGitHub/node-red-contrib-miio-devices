
module.exports = function(RED){
    "use strict";
    const miio = require('miio');
    
    const connectDevice = (id)=>{  
        if(!miioDevs[id]){
            let dev = regDevs[id];
            if(dev && dev.status !== 'Connecting'){
                dev.status = 'Connecting';
                dev.rssi= '...';
                dev.connect()
                    .then((device)=>{
                        miioDevs[id] = device;
                        dev.status = 'Connected';
                        device.management.info()
                            .then((info) => { 
                                dev.rssi= info.ap.rssi;
                                dev.updateStats();
                            }).catch((err)=>{ //console.log('---------------------------------- device.management.info() error: '+ err +'-------------------------------------');
                                dev.updateStats();
                            });
                    }).catch((err)=>{
                        dev.status = 'Connection error';
                        dev.updateStats(err);
                        
                        const reConnDev= () => connectDevice(id);
                        setTimeout(reConnDev, 10 * 60000); // try to reconnect after 10 minutes
                });
            }
        }
    }

    let miioDevs = {}; // connected miio devices
    let regDevs = {};  // registered miio devices
    let broker = undefined;

    const miioBroker = ()=>{
        const registerDevice = (reg)=>{ //miiRED.log.info('Run test of miio-devices f2 --------------------> registerDevice reg: ' + JSON.stringify(reg));
            if(!regDevs[reg.id]){
                regDevs[reg.id] = {};
            }
            let dev = regDevs[reg.id];
            dev.address = reg.address;
            dev.port = reg.port;
            dev.token = reg.token ? reg.token : dev.token; 
            dev.connect = reg.connect;
            dev.model = reg.model || 'unknown'; // Miio, to get a device model, requires the correct configuration of the dns server, eg. when using mDNS and Avahi:
                                                // /etc/nsswitch.conf hosts: mdns4_minimal files [NOTFOUND = return] dns mdns4
            if(dev.nodeId){                     // To check local hostnames by using Avahi, execute command: avahi-browse -at
                connectDevice(reg.id);
            } //RED.log.info('Run test of miio-devices f2 --------------------> registerDevice dev: ' + JSON.stringify(dev)); //RED.log.info('Run test of miio-devices f2 --------------------> registerDevice regDevs: ' + JSON.stringify(regDevs));
        }

        const unregisterDevice = (reg)=>{
            const device = miioDevs[reg.id];
            if(!device) return;                
            device.destroy();
            miioDevs[reg.id] = undefined;

            let dev = regDevs[reg.id];
            if(dev.nodeId){
                if(!dev.disconnEpoch) { 
                    dev.disconnEpoch = [];
                }
                let now = Date.now();
                if(dev.disconnEpoch.length === 3){
                    dev.disconnEpoch.shift();
                    dev.disconnEpoch.push(now);
                    dev.disconnCount = 0;
                    for(let i in dev.disconnEpoch){ 
                        dev.disconnCount += ((now - dev.disconnEpoch[i]) < 3600000) ? 1 : 0;
                    }
                } else {   
                    dev.disconnEpoch.push(now);
                }
                dev.status = 'Disconnected';
                dev.updateStats();
            }
        }

        if(broker){
            broker.stop();
            broker = undefined;
            RED.log.info('Miio broker -> stopped');
            return;
        }

        broker = miio.browse({
            cacheTime: 60 // 5 minutes. Default is 1800 seconds (30 minutes)
        });
        broker.on('available', registerDevice);
        broker.on('unavailable', unregisterDevice);
        RED.log.info('Miio broker -> starting registration of devices');   
    }

    function MiioDevice(n){ //RED.log.info('Run test of miio-devices f4 --------------------> MiioDevice ');
        RED.nodes.createNode(this, n);
        const node = this;
        const confirmCmd = n.confirmCmd;
        const listenEvents = n.listenEvents;
        const devName = n.name;
        const devId = n.devId;
        let devConnError = "✘ Connection lost";

    //  let dev = {
            // name : n.name,
            // nodeId: n.id,
            // address: reg.address,
            // rssi: info.ap.rssi,
            // token: reg.token / n.devToken,
            // port: reg.port,
            // connect: reg.connect,
            // model: reg.model / info.model,
            // status: 'Connecting'/'Connection error'/'Connected'/ 'Disconnected', 
            // updateStats : function() {},
            // disconnEpoch : [],
            // disconnCount : 0;
    //   };

        function eventHandler(e) { //RED.log.info('Run test of miio-devices f5 --------------------> eventHandler ');
            let evalue = e.value, eunit;
            if (e.key === 'temperature') {
                evalue = e.value.value;
                eunit = e.value.unit;
            }
            let msg = {
                payload: {
                    [e.key]: evalue,
                    unit: eunit,
                    deviceName: devName,
                    timeStamp: Date.now()
                }
            };
            if (e.action) {
                msg.payload.action = e.action;
                msg.payload.amount = e.data.amount;
            }
            node.send(msg);
        }

        function updateStats(err){
            let device = miioDevs[devId];
            let statSuffix = '  ID: '+ devId +'  IP: '+ this.address +'  Rssi: '+ this.rssi +'dB';
            let logSuffix = this.name +'  Model: '+ this.model + statSuffix;

            if(this.status === 'Connected' && device){
                node.send({payload:{deviceStatus: this.status, deviceName: devName}, topic: 'status'});
                node.status({fill:'green', shape:'dot', text: this.status + statSuffix});
                RED.log.info('Device connected: '+ logSuffix);

                if(listenEvents){ // Turn on events listeners
                    device.on('stateChanged', eventHandler);
                    device.on('action', eventHandler);
                }
            } else if(this.status === 'Connection error'){
                node.status({fill:'red', shape:'dot', text: this.status + statSuffix});
                RED.log.error(err +'  '+ logSuffix);

            } else if(this.status === 'Disconnected'){
                node.status({fill:'gray', shape:'ring', text: this.status + statSuffix});
                RED.log.info('Device disconnected: '+ logSuffix);
            }
            if(this.disconnCount === 3){devConnError = "✘ WiFi Rssi: "+ this.rssi} // Change the status if there were 3 disconnections in the last hour
        }

        if(!broker){ // turn on miio broker
            miioBroker();
        }
        if(devId) { // assign device to node
            if(!regDevs[devId]) {
                regDevs[devId] = {};
            }
            let dev = regDevs[devId]; 
            if(!dev.nodeId) {
                dev.name = devName;
                dev.nodeId = n.id; // reserve device for this node 
                dev.token = dev.token ? dev.token : n.devToken;
                dev.updateStats = updateStats;
            }
            if(dev.nodeId === n.id) { 
                if(dev.address){
                    connectDevice(devId); 
                } else {
                    node.status({fill:'green', shape:'ring', text: 'Configured  ID: '+ devId});
                }
            } else { // device is assigned to other node
                node.status({fill:'grey',shape:'ring',text: 'Device: '+ devId +' is assigned to node: '+ dev.nodeId});
                return;
            }
        } else { // node is not configured  RED.log.info('Run test of miio-devices f7 --------------------> unconfigured device');
            node.status({fill:'grey',shape:'ring',text: 'Unconfigured'});
            return;
        }
        
        node.on('input', (msg) => {
                let payload = msg.payload;
                let device = miioDevs[devId];
                if (device) {
                    if (payload.deviceName === undefined || payload.deviceName === devName) {
                        for (let key in payload) {
                            if (typeof device[key] === 'function') { //console.log( key+'(',payload[key],')');
                                (async () => {
                                    try {
                                        let arg = payload[key];
                                        if (arg === null) { arg = undefined; }
                                        let res = await device[key](arg); //console.log(key + '('+ JSON.stringify(payload[key]) +') > ' + JSON.stringify(res));
                                        if (res !== undefined) {
                                            if (!res.error) {
                                                if (typeof res === 'object') {
                                                    res.deviceName = devName;
                                                    msg.payload = res;
                                                    node.send(msg);
                                                } else if (confirmCmd === true) { //confirmation of commands
                                                    msg.payload = { [key]: res, deviceName: devName };
                                                    node.send(msg);
                                                }
                                            } else { //send an error to display as an alert
                                                res.error = devName + ' > ' + res.error;
                                                res.deviceName = devName;
                                                node.send({ payload: res, topic: 'error' });
                                            }
                                        }
                                    } catch (err) { //log other errors
                                        let dev = regDevs[devId];
                                        RED.log.error(key + '(' + JSON.stringify(payload[key]) + ') > ' + err + '  ' + devName +
                                            '  IP address: ' + dev.address +'  Rssi: '+ dev.rssi +'dB  Model: ' + dev.model + '  ID: ' + devId);
                                    }
                                })();
                            }
                        }
                    }
                } else { // device is disconnected
                    if (msg.topic === 'status') {
                        msg.payload = { deviceStatus: devConnError, deviceName: devName };
                        node.send(msg);
                    }
                }
            });

        node.on('close', () => {
                if(broker){ // turn off miio broker
                    miioBroker();
                }
                let device = miioDevs[devId];
                device.destroy();
                miioDevs[devId] = undefined; //console.log('Device: '+ devName +' disconnected -------------------------------------> DevId:' + devId);
            });
    }
    RED.nodes.registerType("miio-device", MiioDevice);

    RED.httpAdmin.get("/miiodevices", RED.auth.needsPermission('miio-devices.read'), (req, res) => {
        let devList = {};
        for (let key in regDevs) {
            devList[key] = {
                address: regDevs[key].address,
                model: regDevs[key].model,
                token: regDevs[key].token ? 'y' : ''
            };
        } // console.log('Run test of miio-devices f11 --------------------> get miiodevices devList: ' + JSON.stringify(devList));
        res.json(devList);
    });
} // end of module.exports