
module.exports = function(RED){
    "use strict";
    const miio = require('miio');
    const connectDevice = (id)=>{  
        if(!miioDevs[id]){
            let dev = regDevs[id];
            if(dev && dev.status !== 'Connecting'){
                dev.status = 'Connecting';
                let reg = {
                    address: dev.address,
                    model: dev.model,
                    token: dev.token
                }
                miio.device(reg)
                    .then((device)=>{
                        miioDevs[id] = device;
                        dev.status = 'Connected';
                        RED.log.info('Device connected: '+ dev.name +'  IP address: '+ dev.address +'  Model: '+ dev.model +'  ID: '+ id);
                        dev.nodeStatus();  
                    }).catch((err)=>{
                        dev.status = 'Connection error';
                        RED.log.error(err +'  '+ dev.name +'  IP address: '+ dev.address +'  Model: '+ dev.model +'  ID: '+ id);
                        dev.nodeStatus();   
                });
            }
        }
    }

    let miioDevs = {}; // connected miio devices
    let regDevs = {}; // registered miio devices
    let nOfNodes = 0; // number off nodes
    let broker = undefined;

    const miioBroker = ()=>{
        const registerDevice = (reg)=>{
            let dev = regDevs[reg.id]
            if(dev){	
                dev.address = reg.address;
                dev.model = reg.model ? reg.model : dev.model;
                dev.token = reg.token ? reg.token : dev.token;
    
                regDevs['12334578'] = {
                    address: '192.168.0.202',
                    model: 'dupa-magnet-max',  
                    token: undefined 
                };
            
                regDevs['87654321'] = {
                    address: '192.168.0.203',
                    model: 'dupa-cube-max',   
                    token: '3245664644632424',    
                };
    
                regDevs['87654361'] = {
                    address: '192.168.0.204',
                    model: 'dupa-motion-max',   
                    token: '3245664644632fd24',    
                };
    
                regDevs['87654324'] = {
                    address: '192.168.0.205',
                    model: 'dupa-sensor_ht-max',   
                    token: '32456646443532fd24',    
                };
    
                regDevs['85654324'] = {
                    address: '192.168.0.206',
                    model: 'dupa-switch-m2',   
                    token: '32456646443532fds24',    
                };
    
                if(dev.status){
                    connectDevice(reg.id);
                }
            } else {
                regDevs[reg.id] = {
                    address: reg.address,
                    model: reg.model,   // Miio, to get a device model, requires the correct configuration of the dns server, eg. when using mDNS and Avahi:
                    token: reg.token,    // /etc/nsswitch.conf hosts: mdns4_minimal files [NOTFOUND = return] dns mdns4
                };
            }
        }
        const unregisterDevice = (reg)=>{ 
            const device = miioDevs[reg.id];
            if(!device) return;                
            device.destroy();
            miioDevs[reg.id] = undefined;
            let dev = regDevs[reg.id];
            if(dev.status){
                if(!dev.disconnEpoch) { 
                    dev.disconnEpoch = [];
                }
                while(dev.disconnEpoch.length > 2){
                    dev.disconnEpoch.shift();
                }
                dev.disconnEpoch.push(Date.now());
                dev.status = 'Disconnected';
                RED.log.info('Device disconnected: '+ dev.name +'  IP address: '+ dev.address +'  Model: '+ dev.model +'  ID: '+ reg.id);
                dev.nodeStatus();
            }
        }

        if(broker){
            if(nOfNodes < 1){
                broker.stop();
                broker = undefined;
                RED.log.info('Miio broker -> stopped');
            }
            return;
        } else if(nOfNodes < 1){return;}

        broker = miio.browse({
            cacheTime: 60 // 5 minutes. Default is 1800 seconds (30 minutes)
        });
        broker.on('available', registerDevice);
        broker.on('unavailable', unregisterDevice);
        RED.log.info('Miio broker -> starting registration of devices');   
    }

    
    function MiioDevice(n){
        RED.nodes.createNode(this, n);
        const node = this;
        const confirmCmd = n.confirmCmd;
        const listenEvents = n.listenEvents;
        const devName = n.name;
        const devId = n.devId;
        let dev = {};
        let devConnStatus = 0;
        const eventHandler = (e)=>{
            let evalue = e.value , eunit;
            if(e.key === 'temperature'){
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
            if(e.action){
                msg.payload.action = e.action;
                msg.payload.amount = e.data.amount; 
            }
            node.send(msg);
        }
        const nodeStatus = ()=>{
            dev = regDevs[devId];
            let device = miioDevs[devId];
            if(dev.status === 'Connected' && device){
                if(listenEvents){ // Turn on events listeners
                    device.on('stateChanged', eventHandler);
                    device.on('action', eventHandler);
                }
                node.send({payload:{deviceStatus: 'Connected', deviceName: devName}, topic: 'status'});
                node.status({fill:'green', shape:'dot', text: 'Connected   ID:'+ devId +'   IP:'+ dev.address});
            } else if(dev.status === 'Connection error'){
                node.status({fill:'red', shape:'dot', text: 'Connection error   ID:'+ devId +'   IP:'+ dev.address});
            } else if(dev.status === 'Disconnected' || !device){
                let now = Date.now(), disconnCount = 0;
                if((dev.disconnEpoch) && dev.disconnEpoch.length === 3){
                    for(let i in dev.disconnEpoch){ // Change the status if there were more than 3 disconnections in the last hour
                        disconnCount += ((now - dev.disconnEpoch[i]) < 3600000) ? 1 : 0;
                    }
                } 
                devConnStatus = disconnCount === 3 ? "✘ WiFi" : "✘ Connection lost";
                node.status({fill:'gray', shape:'ring', text: 'Disconnected   ID:'+ devId +'   IP:'+ dev.address});
            }
        }

        
        if(devId) { // assign device to node
            if(!regDevs[devId]) {
                regDevs[devId] = {};  
                devConnStatus++; 
            }
            dev = regDevs[devId]; 
            if(!dev.status) { 
                dev.name = devName;
                dev.nodeStatus = nodeStatus;
                dev.status = n.id; // reserve device for this node
                dev.token = dev.token ? dev.token : n.devToken;
                devConnStatus++;
            }
            if(dev.name === devName) { 
                devConnStatus++;

                if(nOfNodes < 1){ // turn on miio broker
                    nOfNodes = 1;
                    miioBroker();
                } else {
                    nOfNodes++;
                } //console.log('Number of nodes -->', nOfNodes);
                console.log(devName,'Connection Status: ', devConnStatus); 
                if(devConnStatus !== 3 && !miioDevs[devId]){
                    connectDevice(devId); 
                } else {
                    nodeStatus();
                }
            } else { // device is assigned to other node
                node.status({fill:'grey',shape:'ring',text: 'Device: '+ devId +' is assigned to node: '+ dev.name});
                return;
            }
        } else { // node is not configured
            node.status({fill:'grey',shape:'ring',text: 'Unconfigured'});
            return;
        }
        
        node.on('input', function(msg) {
            let payload = msg.payload;
            let device = miioDevs[devId];
            if(device){
                if(payload.deviceName === undefined || payload.deviceName === devName){
                    for(let key in payload){
                        if(typeof device[key] === 'function'){ //console.log( key+'(',payload[key],')');
                            (async ()=>{
                                try { 
                                    let arg = payload[key];
                                    if(arg === null){arg = undefined}
                                    let res = await device[key](arg); //console.log(key + '('+ JSON.stringify(payload[key]) +') > ' + JSON.stringify(res));
                                    if(res !== undefined){
                                        if(!res.error){
                                            if(typeof res === 'object'){
                                                res.deviceName = devName;
                                                msg.payload = res;
                                                node.send(msg); 
                                            } else if(confirmCmd === true){ //confirmation of commands
                                                msg.payload = {[key]: res, deviceName: devName};
                                                node.send(msg);
                                            }                                           
                                        } else { //send an error to display as an alert
                                            res.error = devName +' > '+ res.error;
                                            res.deviceName = devName;
                                            node.send({payload: res, topic: 'error'});
                                        }
                                    }
                                } catch(err) { //log other errors
                                    RED.log.error(key + '('+ JSON.stringify(payload[key]) +') > ' + err +'  '+ dev.name +
                                                    '  IP address: '+ dev.address +'  Model: '+ dev.model +'  ID: '+ devId);
                                }
                            })(); 
                        }       
                    }
                }
            } else { // device is disconnected
                if(msg.topic === 'status'){
                    msg.payload = {deviceStatus: devConnStatus, deviceName: devName};
                    node.send(msg);
                }
            } 
        });

        node.on('close', function(){
            let device = miioDevs[devId];
            if(device){
                device.destroy();
                miioDevs[devId] = undefined;
            }
            nOfNodes--;
            if(nOfNodes < 1){ // turn off miio broker
                miioBroker();
            }
        });
    }
    RED.nodes.registerType("miio-device", MiioDevice);

    RED.httpAdmin.get("/miiodevices", RED.auth.needsPermission('miio-devices.read'), function(req,res) {
        let devList = {};
        for(let key in regDevs){
            devList[key] = {
                address: regDevs[key].address,
                model: regDevs[key].model,
                token: regDevs[key].token ? 'y' : ''
            }
        }
        res.json(devList);
    });
} // end of module.exports