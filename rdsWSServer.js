require('mootools');
try {
    require('rdsGlobals');
    var execCmd = require('rdsExecCommand');

    var conf = require('rdsConfig');
    var rdsLogs = require('rdsLogs');
    var rdsUtils = require("rdsUtils");
} catch (e) {
    console.log("rdsWSServer.js ERROR: " + e.message);
}
//Funcionamiento
try {
    if (conf.socket.enabled == 1) {
        //        var rdsAVLDataBase = require("rdsAVLDataBase");
        var rdsAVLDataBase = require("rdsAVLDataBasePASO");
        var rdsGFCDataBase = require("rdsGFCDataBase");
        global.rdsSocketServer = require("socket.io").listen(conf.socket.port);

        //        var cAVL = require('rdsAVL'); 
        var cAVL = require('rdsAVLPASO');

        global.rdsSocketServer.configure(function() {
            if (conf.socket.debug == 0) {
                global.rdsSocketServer.disable('log');
            } else
                global.rdsSocketServer.enable('log');
        });

        //Evento cuando un nuevo cliente se conecta 
        global.rdsSocketServer.sockets.on("connection", onNewConnection);
        //Enviar estado del servidor cada 1 minuto
        function sendServerStatus(error, stdout, stderr) {
            if (error == null) {

                var date = new Date();
                var hora = date.getHours() + "h" + date.getMinutes();
                countSQLCnn = stdout.substring(0, stdout.length - 1);
                global.rdsSocketServer.sockets.to("rdsAdmin").emit("srvStatus", {
                    "status": hora + "," + global.countCln + "," + global.countAVL + "," + global.countUpdatePos + "," + countSQLCnn
                });
                global.countUpdatePos = 0;
            }
        }
        setInterval(function() {
//                    "status": hora + "," + global.countCln + "," + global.countAVL + "," + global.countUpdatePos 
            var cmd = "mysql -u root -ppaco2000 -NBe 'show global status like \"Threads_connected\";' | cut -f2";
            execCmd(cmd, sendServerStatus);
        }, 15000);
    }
} catch (e) {
    console.log(e);
    rdsLogs.addLog("require | ERROR : " + e.message);
}
//});
//Carga de MÓDULOS de DECODIFICACIÓN de tramas UDP 15minutos después
try {
        require('decodeSureLinxPASO');
        require('decodeTT8750+');
        require('decodeTT8750');
        require('decodeTT8750Porta');
        require('decodeTT8850');
        require('decodeSyrrus');
        require('decodeMVT340');
        require('decodeMVT4340');
    console.log("Sube");
} catch (e) {
    rdsLogs.addLog("require | ERROR : " + e.message);
}
//Funcion cuando un nuevo usuario se conecta
function onNewConnection(usuario) {
    rdsLogs.addLog("onConnection | " + usuario.handshake.address.address + ":" + usuario.handshake.address.port + " ||| " + usuario.id);
    global.countCln++;
    global.AVLs.each(function(oAVL, index) {
        if (global.AVLs[oAVL.vhc_mdmid].vhc_estela.length > 0) {
            global.rdsSocketServer.sockets.emit("whatsUp", {
                "estela": global.AVLs[oAVL.vhc_mdmid].getEstela(),
                "type": "ack"
            });
        }
    });

    usuario.on("srvLoadGeonfences", function() {
        rdsGFCDataBase = require("rdsGFCDataBase");
    });
    //Cuando el usuario se desconecta
    usuario.on("disconnect", function() {
        try {
            global.countCln--;
            rdsLogs.addLog("onDisconnect | " + usuario.handshake.address.address + ":" + usuario.handshake.address.port + " | " + usuario.id);
        } catch (e) {
            rdsLogs.addLog("onDisconnect | ERROR : " + e.message, 0);
        }
    });

    //Establecer el tipo de usuario
    usuario.emit("wsType", {
        "texto": "Client Type"
    });

    ///
    usuario.on("srvAVLRequest", function(data) {
        try {
            if (global.AVLs[data.vhc_mdmid]) {
                avlResponse = {
                    "vhc_name": data.vhc_mdmid,
                    "lastReportTime": global.AVLs[data.vhc_mdmid].lastReportTime
                };
                console.log("srvAVLRequest: " + data.vhc_mdmid + " : " + global.AVLs[data.vhc_mdmid].lastReportTime);
                usuario.emit("srvAVLResponse", {
                    "avl": avlResponse
                });
            }
        } catch (e) {
            console.log(e + "  " + data.vhc_mdmid)
        }
    });

    ///Cuando el comando enviado ha recibido una respuesta
    usuario.on("srvCmdResponse", function(data) {
//        console.log(data);
        try {
            if (data.avl_port && data.avl_ip) {
                global.AVLs.each(function(oAVL, index) {
                    if ((oAVL.avl_ip === data.avl_ip) && (oAVL.avl_port === data.avl_port)) {
                        usuario.broadcast.to(oAVL.vhc_mdmid).emit("cmdResponse", {
                            "vhc_mdmid": oAVL.vhc_mdmid,
                            "rsp": " " + oAVL.vhc_alias + data.rsp
                        });
                        oAVL.lastReportTime = rdsUtils.DateToMySQLFormat(new Date( ));
                    }
                });
            }
        } catch (e) {
            rdsLogs.addLog("srvCmdResponse: " + " | " + e, 2);
        }
    });

    ///Cuando el comando enviado a recibido una respuesta
    usuario.on("srvUpdateIP", function(data) {
        if (global.AVLs[data.vhc_mdmid]) {
            global.AVLs[data.vhc_mdmid].setType(data.avl_type);
            global.AVLs[data.vhc_mdmid].avl_ip = data.avl_ip;
            global.AVLs[data.vhc_mdmid].avl_port = data.avl_port;

            usuario.broadcast.emit("whatsUp", {
                "estela": global.AVLs[data.vhc_mdmid].getEstela(),
                "type": "ack"
            });
        }
    });

    ///Cuando un usuario le dice el tipo
    usuario.on("clnSetType", function(clnType) {
        ///Pueden ser 4 tipos de user rdsAdmin, rdsServer, cmpAdmin, cmpUser
        try {
            var tipo = clnType.type;
            if (tipo.substr(0, 8) == "cmpAdmin")
                tipo = "cmpAdmin"
            switch (tipo) {
                case "rdsAdmin":
                    usuario.join(clnType.type);
                    break;
                case "cmpAdmin":
                    usuario.join(clnType.type);
                    break;
                case "rdsServer": // AVL Gateway Servers
                    usuario.join(clnType.type);
                    break;
            }
            rdsLogs.addLog("onclnSetType: " + usuario.id + " | " + clnType.type, 0);
        } catch (e) {
            rdsLogs.addLog("clnSetType | ERROR : " + e.message);
        }
    });

    //manera mas cool de cargar los AVLs
    usuario.on("coolCreate", function(infoAVL) {
        try {
            if (!global.AVLs[infoAVL.vhc_mdmid]) {
                global.AVLs[infoAVL.vhc_mdmid] = new cAVL(infoAVL.vhc_mdmid);
            } else {
                console.log(infoAVL.vhc_mdmid + " -------------------");
            }
//            if (!global.AVLs[infoAVL.vhc_mdmid])
//                global.AVLs[infoAVL.vhc_mdmid].setData(infoAVL);
        } catch (e) {
            console.log("rdsWSServer.coolCreate ERROR : " + e);
        }
    });
    //Reiniciar Decodificadores
    usuario.on("clnReloadDecode", function(infoAVL) {
        try {
            usuario.broadcast.to("rdsServer").emit("clnReloadDecode", infoAVL);
        } catch (e) {
            console.log("rdsWSServer.clnReloadDecode ERROR : " + e);
        }
    });

    //TRABAJANDO CON EL SERVIDOR
    usuario.on("srvUpdatePos", function(infoAVL) {
        global.countUpdatePos++;
        try {
            var mdmid = parseInt(infoAVL.vhc_mdmid);
            if (mdmid > 0) {
                if (!global.AVLs[mdmid]) { // si no EXISTE, lo CREA
                    global.AVLs[mdmid] = new cAVL(mdmid);
                }
                if (global.AVLs[mdmid] !== null) { // si EXISTE ...
                    infoAVL.vhc_odometer = infoAVL.vhc_odometer / 10000;
                    global.AVLs[mdmid].updatePos(infoAVL, true); // le dice al AVL que actualice SU posición

                    if (global.AVLs[mdmid].avl_report == false) { // ACTUALIZA cantidad de AVL que se están REPORTANDO
                        global.AVLs[mdmid].avl_report = true;
                        global.countAVL++;
                    }

                    // Comunicar a TODOS los que están monitoriando el AVL, su actualización de POSICIÓN
                    usuario.broadcast.to(mdmid).emit("updatePos", global.AVLs[mdmid].getEstela());
                    usuario.broadcast.to(mdmid).emit("logMessage", {
                        "msg": "" + global.AVLs[mdmid].getLastPositionToString()
                    });

                    // Comunicar a TODOS los ADMINISTRADORES de la COMPAÑÍA(a la que pertenece el AVL), su actualización de POSICIÓN
                    cmpAdmin = "cmpAdmin" + global.AVLs[mdmid].cmp_id;

                    usuario.broadcast.to(cmpAdmin).emit("logMessage", {
                        "msg": "" + global.AVLs[mdmid].getLastPositionToString()
                    });
                    usuario.broadcast.to(cmpAdmin).emit("whatsUp", {
                        "estela": global.AVLs[mdmid].getEstela(),
                        "type": "up"
                    });

                    // Comunicar a TODOS los ADMINISTRADORES de RDS, su actualización de POSICIÓN
                    //                usuario.broadcast.to("rdsAdmin").emit("logMessage", {
                    //                    "msg":"[" + countCln +"|"+countAVL+ "] " + global.AVLs[infoAVL.vhc_mdmid].getLastPositionToString()
                    //                } );

                    usuario.broadcast.to("rdsAdmin").emit("whatsUp", {
                        "estela": global.AVLs[mdmid].getEstela(),
                        "type": "up"
                    });
                }
                //Enviar a todos los usuarios unidos a la sala de ese AVL que hizo un update
                //         VerificarEventosPANAVIAL(infoAVL);

                rdsLogs.addLog("onsrvUpdatePos: " + mdmid + " - " + global.AVLs[mdmid].getLastPositionToString(), 0, infoAVL.type + ".log");
            }
        } catch (e) {
            rdsLogs.addLog("srvUpdatePos: " + e.message, 2);
        }
    });

    ///Cuando empieza a registrar logs
    usuario.on("srvLogMessage", function(messageLog) {
        try {
            rdsLogs.addLog("onsrvLogMessage: " + messageLog.msg, 0);
            //usuario.broadcast.to("rdsAdmin").emit( "logMessage", messageLog );
        } catch (e) {
            rdsLogs.addLog("srvLogMessage: " + e.message, 2);
        }
    });

    usuario.on("LogAdminMessage", function(messageLog) {
        usuario.broadcast.to("rdsAdmin").emit("logMessage", messageLog);
    });

    //ERROR
    usuario.on("error", function(razon) {
        try {
            rdsLogs.addLog("onError: " + razon, 2);
        } catch (e) {
            rdsLogs.addLog("onError: " + e.message, 2);
        }
    });

    ///CLIENTE
    //Cuando el cliente pide monitorear un Vehicle
    usuario.on("clnNewVehicle", function(mdmid) {
        try {
            if (global.AVLs[mdmid] != null) {
                if (global.AVLs[mdmid].vhc_estela.length > 0) {
                    usuario.emit("setDataAVL", global.AVLs[mdmid].getDataAVL());
                    usuario.join(mdmid);
                    usuario.emit("updatePos", global.AVLs[mdmid].getEstela());
                    rdsLogs.addLog("updatePos: " + mdmid);
                } else {
                    usuario.emit("alerta", mdmid);
                    rdsLogs.addLog("Posición no definida del AVL " + global.AVLs[mdmid].vhc_name, 1);
                }
            }
        } catch (e) {
            rdsLogs.addLog("clnNewVehicle: " + e.message, 2);
        }
    });

    ///Cuando un usuario deja de monitorear un Vehicle
    usuario.on("clnQuitVehicle", function(mdmid) {
        try {
            if (global.AVLs[mdmid] != null) {
                usuario.leave(mdmid);
            }

            rdsLogs.addLog("onclnQuitVehicle: " + mdmid, 0);
        } catch (e) {
            rdsLogs.addLog("clnQuitVehicle: " + e.message, 2);
        }
    });


    ///Manejo de Comandos
    usuario.on("clnCommand", function(data) {
        try {
            var coman = "AT";
            switch (data.type) {
                case 1:
                    coman = "AT";
                    break;
                case 2:
                    coman = "Abrir Puertas";
                    break;
                case 3:
                    coman = "Cerrar Puertas";
                    break;
                case 4:
                    coman = "Motor ON";
                    break;
                case 5:
                    coman = "Motor OFF";
                    break;
            }
            if (global.AVLs[data.mdmid].avl_ip == '') {
                rdsLogs.addLog("Comando Solicitado : " + data.mdmid + " cmd: " + coman + " | " + data.msg + "(AVL sin TIPO)", 2);
            } else {
                //recibir y enviar el comando al GATEWAY
                rdsLogs.addLog("Comando Solicitado: " + data.mdmid + " ( " + global.AVLs[data.mdmid].avl_ip + ":" + global.AVLs[data.mdmid].avl_port + " ) | " + coman + " |" + data.msg, 0);
                data.avl_port = global.AVLs[data.mdmid].avl_port;
                data.avl_ip = global.AVLs[data.mdmid].avl_ip;
                data.avl_type = global.AVLs[data.mdmid].type;
                usuario.broadcast.to("rdsServer").emit("clnCommand", data);
            }
        } catch (e) {
            rdsLogs.addLog("clnCommand: " + e.message, 2);
        }
    });

    ///Envio de Mail cancelado 
    usuario.on("clnCancelMail", function(data) {
        try {
            if (global.AVLs[data.mdmid] != null) {
                global.AVLs[data.mdmid].vhc_alert = false;
                global.AVLs[data.mdmid].vhc_alert1 = false;
                global.AVLs[data.mdmid].vhc_alert2 = false;
                global.AVLs[data.mdmid].vhc_alert3 = false;
                global.AVLs[data.mdmid].vhc_mail = 0;
                usuario.emit("updatePos", global.AVLs[data.mdmid].getEstela());

                cmpAdmin = "cmpAdmin" + global.AVLs[data.mdmid].cmp_id;
                usuario.broadcast.to(cmpAdmin).emit("whatsUp", global.AVLs[data.mdmid].getEstela());

                usuario.broadcast.to("rdsAdmin").emit("whatsUp", global.AVLs[data.mdmid].getEstela());

                //clearInterval(global.AVLs[data.mdmid].vhc_intervalMail);
                rdsLogs.addLog("clnCancelMail: " + data, 0);
            }
        } catch (e) {
            rdsLogs.addLog("clnCancelMail: " + e.message, 2);
        }
    });

    ///Envio de Mail cancelado 
    usuario.on("clnUpdateGeofence", function(data) {
        try {
            //TODO Foreach AVL cargar GEOFENCE
            rdsLogs.addLog("clnUpdateGeofence: " + data, 0);
            //            data = {
            //                "fncName":CargarAVLs,
            //                "query":"SELECT id, vhc_name, vhc_alias, db_ip FROM rds_vts_vehicles"
            //            }
            //         data = {
            //            "fncName":CargarAVLs,
            //            "query":"SELECT v.id, vhc_name, vhc_alias, db_ip, c.cmp_id FROM rds_vts_vehicles AS v INNER JOIN rds_vts_clients AS c ON user_id = usr_id"
            //         }
            //         mysqlQuery(data);
        } catch (e) {
            rdsLogs.addLog("clnUpdateGeofence: " + e.message, 2);
        }
    });
}