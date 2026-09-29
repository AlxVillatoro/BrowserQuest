'use strict';

/**
 * Volcado del protocolo: conecta un único bot y muestra TODO lo que recibe.
 *
 * Es la herramienta para distinguir los dos caminos de envío del servidor, que
 * fallan de forma muy distinta y se confunden con facilidad:
 *
 *   1. Envío directo  — `connection.send` / `connection.sendUTF8`, usado para el
 *      centinela "go", "timeout" y WELCOME (player.js).
 *   2. Envío por cola — `pushToPlayer` acumula en `worldserver.outgoingQueues` y
 *      `processQueues` los vacía en cada tick (50 ups) mediante
 *      `this.server.getConnection(id).send(...)`.
 *
 * Si llegan los del primer tipo pero no los del segundo, el problema está en la
 * cola o en la resolución de la conexión, no en el jugador ni en las zonas.
 *
 * Uso:  node tools/diag-protocol.js [host] [puerto] [segundos]
 */

const WebSocket = require('ws');
const Types = require('../shared/js/gametypes');

const HOST = process.argv[2] || 'localhost';
const PORT = parseInt(process.argv[3] || '8000', 10);
const SECONDS = parseInt(process.argv[4] || '4', 10);

const MESSAGE_NAMES = Object.keys(Types.Messages).reduce((map, name) => {
    map[Types.Messages[name]] = name;
    return map;
}, {});

function label(frame) {
    if (!Array.isArray(frame)) {
        return 'CRUDO   ' + JSON.stringify(frame);
    }
    const name = MESSAGE_NAMES[frame[0]] || ('tipo ' + frame[0]);
    return 'JSON    ' + name + '  ' + JSON.stringify(frame);
}

const t0 = Date.now();
const stamp = () => String(Date.now() - t0).padStart(5, ' ') + ' ms';

const socket = new WebSocket('ws://' + HOST + ':' + PORT + '/');
let welcome = null;

socket.on('open', () => {
    console.log(stamp() + '  conectado\n');
});

socket.on('message', (data) => {
    const text = data.toString('utf8');
    let parsed = null;

    try {
        parsed = JSON.parse(text);
    } catch (e) {
        // Centinelas de texto crudo.
    }

    if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
        // Lote: el servidor manda el array completo de la cola en un frame.
        console.log(stamp() + '  LOTE de ' + parsed.length + ' mensajes');
        parsed.forEach((f) => console.log('           ' + label(f)));
        return;
    }

    console.log(stamp() + '  ' + label(parsed === null ? text : parsed));

    if (Array.isArray(parsed) && parsed[0] === Types.Messages.WELCOME && !welcome) {
        welcome = parsed;
    }
});

socket.on('error', (error) => {
    console.log(stamp() + '  ERROR ' + error.message);
});

socket.on('close', () => {
    console.log(stamp() + '  cerrado');
});

// Handshake: HELLO = [0, nombre, kindArmadura, kindArma]
socket.on('open', () => {
    setTimeout(() => {
        const hello = [Types.Messages.HELLO, 'DiagProto', Types.Entities.CLOTHARMOR, Types.Entities.SWORD1];
        console.log(stamp() + '  -> ' + label(hello) + '\n');
        socket.send(JSON.stringify(hello));
    }, 150);
});

// Al cabo de 1 s, pedir explícitamente el SPAWN de una entidad conocida (WHO).
// Es una respuesta que va por la cola, así que confirma si la cola se vacía.
setTimeout(() => {
    if (!welcome) {
        console.log('\n' + stamp() + '  sin WELCOME: no se puede pedir WHO');
        return;
    }
    const who = [Types.Messages.WHO, welcome[1]];
    console.log('\n' + stamp() + '  -> ' + label(who) + '   (respuesta por cola)\n');
    socket.send(JSON.stringify(who));
}, 1200);

setTimeout(() => {
    console.log('\n' + stamp() + '  fin del volcado');
    socket.close();
    process.exit(0);
}, SECONDS * 1000);
