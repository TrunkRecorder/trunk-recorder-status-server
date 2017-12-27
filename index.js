var express = require('express');
var util = require("util");

var app = express(),
    http = require('http'),
    server = http.createServer(app);

const WebSocket = require('ws');
const clientWss = new WebSocket.Server({
    noServer: true
});
const serverWss = new WebSocket.Server({
    noServer: true
});

const url = require('url');

var csv = require('csv');
var fs = require('fs');
var path = require('path');

var router = express.Router();

var bodyParser = require('body-parser');

var channels = {};
var clients = [];
var srv = null;
var stats = {};

server.on('upgrade', (request, socket, head) => {
    const pathname = url.parse(request.url).pathname;

    if (pathname === '/client') {
        console.log("Upgrading Client Connection");
        clientWss.handleUpgrade(request, socket, head, (ws) => {
            clientWss.emit('connection', ws);
        });
    } else if (pathname === '/server') {
        console.log("Upgrading Server Connection");
        serverWss.handleUpgrade(request, socket, head, (ws) => {
            serverWss.emit('connection', ws);
        });
    } else {
        socket.destroy();
    }
});

app.use(bodyParser());
app.use(express.static(__dirname + '/public'));

function get_clients(req, res) {
    if (req.params.shortName) {
        var short_name = req.params.shortName.toLowerCase();
    } else {
        var short_name = null;
    }
    for (var i = 0; i < clients.length; i++) {
        var response = [];
        //console.log(util.inspect(clients[i].socket));
        if (!short_name || (clients[i].shortName == short_name)) {
            var age = (Date.now() - clients[i].timestamp) / 1000;
            var obj = {
                shortName: clients[i].shortName,
                filterCode: clients[i].filterCode,
                filterName: clients[i].filterName,
                filterType: clients[i].filterType,
                talkgroupNums: clients[i].talkgroupNums,
                type: clients[i].type,
                timestamp: age
            }
            response.push(obj);
        }

    }
    res.contentType('json');
    res.send(JSON.stringify(response));

}
app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname + '/public/index.html'));
});


app.get('/:shortName/clients', get_clients);
app.get('/clients', get_clients);

function notify_clients(call) {
    call.type = "calls";
    var sent = 0;

    for (var i = 0; i < clients.length; i++) {
        //console.log(util.inspect(clients[i].socket));
        if (clients[i].shortName == call.shortName.toLowerCase()) {
            if (clients[i].filterCode == "") {
                //console.log("Call TG # is set to All");
                sent++;
                clients[i].socket.send(JSON.stringify(call));
            } else if (clients[i].filterType == "unit") {
                var codeArray = clients[i].filterCode.split(',');
                var success = false;
                for (var j = 0; j < codeArray.length; ++j) {
                    for (var k = 0; k < call.srcList.length; k++) {
                        if (codeArray[j] == call.srcList[k]) {
                            sent++;
                            clients[i].socket.send(JSON.stringify(call));
                            success = true;
                            break;
                        }
                    }
                    if (success) {
                        break;
                    }
                }


            } else {
                var codeArray = clients[i].talkgroupNums;
                //console.log("Group Client: " + i + "\tCodes: " + codeArray + "\tTalkgroupNum: " + call.talkgroupNum);
                for (var j = 0; j < codeArray.length; ++j) {
                    if (codeArray[j] == call.talkgroupNum) {
                        console.log("[ " + i + " ] - Sending one filtered call");
                        clients[i].socket.send(JSON.stringify(call));
                        sent++
                        break;
                    }
                }
            }
        }
    }

    if (sent > 0) {
        console.log("Sent calls to " + sent + " clients, System: " + call.shortName.toLowerCase());
    }
}

function heartbeat() {
    this.isAlive = true;
}


clientWss.on('connection', function connection(ws, req) {
    var client = {
        socket: ws
    };
    clients.push(client);

    ws.isAlive = true;
    ws.on('pong', heartbeat);
    console.log((new Date()) + ' WebSocket Connection accepted.');
    ws.on('message', function incoming(message) {
        console.log("Got message: " + message);
        try {
            var data = JSON.parse(message);
            if (typeof data.type !== "undefined") {
                if (data.type == 'add') {

                    var client = {
                        socket: ws,
                        code: null
                    };
                    clients.push(client);
                    console.log("[ " + data.type + " ] Client added");
                    if (srv){
                      console.log("Sending Srv config: " + srv.config);
                      ws.send(JSON.stringify(srv.config));
                      console.log("Sent");
                    }
                }
                var index = clients.indexOf(client);
                if (index != -1) {

                    clients[index].timestamp = new Date();
                    console.log("[ " + data.type + " ] Client updated: " + index);
                } else {
                    console.log("Error - WebSocket: Client not Found!");
                }

            }

        } catch (err) {
            console.log("JSON PArsing Error: " + err);
        }
        console.log('Received Message: ' + message);
    });
    ws.on('close', function(reasonCode, description) {
        console.log((new Date()) + ' Client ' + connection.remoteAddress + ' disconnected.');
        console.log("code: " + reasonCode + " description: " + description);
        for (var i = 0; i < clients.length; i++) {
            // # Remove from our connections list so we don't send
            // # to a dead socket
            if (clients[i].socket == ws) {
                clients.splice(i);
                break;
            }
        }
    });

});

serverWss.on('connection', function connection(ws, req) {


    ws.isAlive = true;
    ws.on('pong', heartbeat);
    console.log((new Date()) + ' WebSocket Connection accepted.');
    ws.on('message', function incoming(message) {
        try {            var data = JSON.parse(message);
            if (typeof data.type !== "undefined") {

                if (data.type == 'config') {

                    srv = {
                        socket: ws,
                        config: data,
                        timestamp: new Date()
                    };

                    console.log("[ " + data.type + " ] Server Live - Config rcv'd");
              } else if (data.type == 'status') {
                console.log("[ " + data.type + " ] Server - Status message ");
              } else if (data.type == 'rate') {
                console.log("[ " + data.type + " ] Server - Rate message ");
              } else {
                console.log("[ " + data.type + " ] Server - Uknown message type");
              }
            } else {
              console.log("Server - Message type not defined");
            }
            clientWss.clients.forEach(function each(client) {
              if (client.readyState === WebSocket.OPEN) {
                client.send(message);
              }
            });
        } catch (err) {
            console.log("JSON PArsing Error: " + err);
        }
        console.log('Received Message: ' + message);
    });
    ws.on('close', function(reasonCode, description) {
        console.log((new Date()) + ' Server ' + connection.remoteAddress + ' disconnected.');
        console.log("code: " + reasonCode + " description: " + description);
        srv = null;
    });

});




server.listen(3010, function() {
    console.log('Web interface is available at: ' + server.address().port + '...');
    console.log('status socket address is probably: http://localhost/server');
    console.log(process.env)
});



module.exports = server;
