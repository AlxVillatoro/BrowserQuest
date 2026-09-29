'use strict';

/**
 * Prueba de humo end-to-end del servidor de juego.
 *
 * Abre dos conexiones WebSocket reales, completa el handshake de las dos y
 * recorre el protocolo completo:
 *
 *   1. centinela "go" (texto crudo, no JSON) al conectar
 *   2. HELLO -> WELCOME
 *   3. MOVE de A visto por B   (comprueba el broadcast por zonas)
 *   4. CHAT de A visto por B y por A mismo (ignoreSelf=false)
 *
 * Es la red de seguridad para el trabajo de 2.5D / Tibia: si esto pasa, el
 * servidor y el protocolo siguen sanos.
 *
 * Uso:  node tools/smoke-test.js [host] [puerto]
 * Salida: código 0 si todo pasa, 1 si algo falla.
 */

const WebSocket = require('ws');
const Types = require('../shared/js/gametypes');

const HOST = process.argv[2] || 'localhost';
const PORT = parseInt(process.argv[3] || '8000', 10);
const STEP_TIMEOUT = 8000;

/** Guerrero recién creado: armadura de tela y espada corta. */
const CLOTHARMOR = Types.Entities.CLOTHARMOR;
const SWORD1 = Types.Entities.SWORD1;

const CHAT_TEXT = 'hola desde la prueba de humo';

let failures = 0;

function ok(label, detail) {
    console.log('  \u001b[32mPASS\u001b[0m  ' + label + (detail ? '  \u001b[90m' + detail + '\u001b[0m' : ''));
}

function fail(label, detail) {
    failures += 1;
    console.log('  \u001b[31mFAIL\u001b[0m  ' + label + (detail ? '  ' + detail : ''));
}

/** Nombre legible de cada tipo de mensaje, para los resúmenes de diagnóstico. */
const MESSAGE_NAMES = Object.keys(Types.Messages).reduce((map, name) => {
    map[Types.Messages[name]] = name;
    return map;
}, {});

/**
 * Zona (grupo) a la que pertenece una posición, replicando la fórmula del
 * servidor (map.js:getGroupIdFromPosition, con zoneWidth=28 y zoneHeight=12).
 *
 * Es la clave para entender la visibilidad: el servidor sólo difunde a la zona
 * propia y a las 8 adyacentes (worldserver.js:pushToAdjacentGroups), así que
 * dos jugadores en zonas no adyacentes NO se ven entre sí. Esto no es un fallo,
 * es el diseño de zonas de BrowserQuest.
 */
const ZONE_WIDTH = 28;
const ZONE_HEIGHT = 12;

function zoneOf(x, y) {
    return Math.floor((x - 1) / ZONE_WIDTH) + '-' + Math.floor((y - 1) / ZONE_HEIGHT);
}


class Bot {
    constructor(name) {
        this.name = name;
        this.messages = [];
        this.sentinels = [];
        this.socket = null;
        this._waiters = [];
    }

    connect() {
        return new Promise((resolve, reject) => {
            const socket = new WebSocket('ws://' + HOST + ':' + PORT + '/');
            this.socket = socket;

            const timer = setTimeout(function () {
                reject(new Error(this.name + ': timeout conectando'));
            }.bind(this), STEP_TIMEOUT);

            socket.on('open', () => {
                clearTimeout(timer);
                resolve();
            });

            socket.on('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });

            socket.on('message', (data) => {
                const text = data.toString('utf8');
                let parsed = null;

                try {
                    parsed = JSON.parse(text);
                } catch (e) {
                    // El servidor manda "go" y "timeout" como texto crudo
                    // (player.js usa connection.sendUTF8 para eso).
                    this.sentinels.push(text);
                }

                if (parsed) {
                    // El servidor agrupa toda la cola del tick en un único frame:
                    // un array de arrays (worldserver.processQueues). El cliente
                    // real lo desempaqueta en receiveActionBatch
                    // (client/js/gameclient.js), y aquí hay que hacer lo mismo o
                    // los predicados ven lotes en vez de acciones y nunca casan.
                    if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
                        parsed.forEach((action) => this.messages.push(action));
                    } else {
                        this.messages.push(parsed);
                    }
                }

                const waiters = this._waiters.slice();
                waiters.forEach((waiter) => waiter.retry());
            });
        });
    }

    send(message) {
        this.socket.send(JSON.stringify(message));
    }

    /**
     * Espera un mensaje que cumpla `predicate`.
     * @param {number} [fromIndex] índice desde el que mirar (para exigir que
     *        el mensaje sea nuevo y no uno ya recibido antes).
     * @param {number} [timeout] ms de espera; por defecto STEP_TIMEOUT.
     */
    waitFor(predicate, label, fromIndex, timeout) {
        const start = fromIndex === undefined ? 0 : fromIndex;
        const limit = timeout === undefined ? STEP_TIMEOUT : timeout;

        return new Promise((resolve, reject) => {
            const search = () => {
                for (let i = start; i < this.messages.length; i += 1) {
                    if (predicate(this.messages[i])) {
                        return this.messages[i];
                    }
                }
                return null;
            };

            const found = search();
            if (found) {
                resolve(found);
                return;
            }

            const entry = {
                retry: () => {
                    const match = search();
                    if (match) {
                        clearTimeout(timer);
                        this._waiters = this._waiters.filter((w) => w !== entry);
                        resolve(match);
                    }
                }
            };

            const timer = setTimeout(() => {
                this._waiters = this._waiters.filter((w) => w !== entry);
                reject(new Error(this.name + ': timeout esperando ' + label));
            }, limit);

            this._waiters.push(entry);
        });
    }

    /** Espera un centinela de texto crudo (no JSON): "go" o "timeout". */
    waitForSentinel(text) {
        return new Promise((resolve, reject) => {
            const search = () => this.sentinels.indexOf(text) !== -1;
            if (search()) {
                resolve();
                return;
            }

            const entry = {
                retry: () => {
                    if (search()) {
                        clearTimeout(timer);
                        this._waiters = this._waiters.filter((w) => w !== entry);
                        resolve();
                    }
                }
            };

            const timer = setTimeout(() => {
                this._waiters = this._waiters.filter((w) => w !== entry);
                reject(new Error(this.name + ': timeout esperando el centinela "' + text + '"'));
            }, STEP_TIMEOUT);

            this._waiters.push(entry);
        });
    }

    /** Resumen compacto de lo recibido, para diagnosticar un fallo. */
    summary() {
        const counts = new Map();
        this.messages.forEach((m) => {
            const name = MESSAGE_NAMES[m[0]] || ('tipo ' + m[0]);
            counts.set(name, (counts.get(name) || 0) + 1);
        });

        const parts = Array.from(counts.entries()).map(([name, n]) => name + '\u00d7' + n);
        const sentinels = this.sentinels.length
            ? '  centinelas=' + JSON.stringify(this.sentinels)
            : '';

        return (parts.join(', ') || 'nada') + sentinels;
    }

    close() {
        if (this.socket) {
            try {
                this.socket.close();
            } catch (e) {
                /* ya cerrado */
            }
        }
    }
}


// Los bots se crean fuera de main() a propósito: así se puede volcar su resumen
// de mensajes incluso cuando main() aborta por una excepción, que es justo el
// momento en el que más falta hace saber qué llegó y qué no.
const botA = new Bot('bot-A');
const botB = new Bot('bot-B');

async function main() {
    console.log('Prueba de humo contra ws://' + HOST + ':' + PORT + '/\n');

    const a = botA;
    const b = botB;

    // 1. Conexión y centinela de handshake
    await a.connect();
    await a.waitForSentinel('go');
    ok('bot-A conectado, recibió el centinela "go"');

    await b.connect();
    await b.waitForSentinel('go');
    ok('bot-B conectado, recibió el centinela "go"');

    // 2. HELLO -> WELCOME   [WELCOME, id, name, x, y, hitPoints]
    a.send([Types.Messages.HELLO, 'SmokeA', CLOTHARMOR, SWORD1]);
    const welcomeA = await a.waitFor(
        (m) => m[0] === Types.Messages.WELCOME, 'WELCOME de bot-A');
    ok('bot-A completó el handshake (WELCOME)',
        'id=' + welcomeA[1] + ' pos=(' + welcomeA[3] + ',' + welcomeA[4] + ') hp=' + welcomeA[5]);

    b.send([Types.Messages.HELLO, 'SmokeB', CLOTHARMOR, SWORD1]);
    const welcomeB = await b.waitFor(
        (m) => m[0] === Types.Messages.WELCOME, 'WELCOME de bot-B');
    ok('bot-B completó el handshake (WELCOME)',
        'id=' + welcomeB[1] + ' pos=(' + welcomeB[3] + ',' + welcomeB[4] + ') hp=' + welcomeB[5]);

    // 3. Conseguir que los dos bots compartan zona.
    //
    // El servidor sólo difunde a la zona propia y a las 8 adyacentes
    // (worldserver.pushToAdjacentGroups), y cada bot aparece en una posición
    // aleatoria, así que la prueba tiene que forzar la convivencia.
    //
    // Se teleporta A al tile de B: el servidor valida los límites del mapa y la
    // colisión de terreno, pero NO la distancia recorrida
    // (worldserver.isValidPosition). Justo después se envía ZONE, porque el
    // servidor NO recalcula el grupo al mover —move_callback sólo reacciona a
    // los atacantes—: depende de que el cliente lo pida, que es lo que hace el
    // cliente real al cruzar un borde de zona (client/js/game.js -> sendZone).
    //
    // El propio CHAT hace de sonda: es la comprobación que interesa, así que si
    // llega, la premisa ya está demostrada. El protocolo no expone en qué zona
    // está un jugador, así que deducirlo desde fuera no es viable.
    const candidatos = [
        [welcomeB[3], welcomeB[4]],
        [welcomeB[3] - 1, welcomeB[4]],
        [welcomeB[3] + 1, welcomeB[4]],
        [welcomeB[3], welcomeB[4] - 1],
        [welcomeB[3], welcomeB[4] + 1]
    ];

    const sonda = CHAT_TEXT + ' (sonda)';
    let posicionA = null;

    for (const [x, y] of candidatos) {
        const cursorSonda = b.messages.length;
        a.send([Types.Messages.MOVE, x, y]);
        a.send([Types.Messages.ZONE]);
        a.send([Types.Messages.CHAT, sonda]);

        try {
            await b.waitFor(
                (m) => m[0] === Types.Messages.CHAT, 'la sonda de CHAT', cursorSonda, 800);
            posicionA = [x, y];
            ok('los dos bots comparten zona',
                'A teleportado a (' + x + ',' + y + '), zona ' + zoneOf(x, y));
            break;
        } catch (e) {
            // Tile no válido, o la zona todavía no es la misma: siguiente candidato.
        }
    }

    if (!posicionA) {
        fail('los dos bots comparten zona',
            'ninguno de los ' + candidatos.length + ' tiles candidatos funcionó');
    }

    // 4. MOVE: con la zona ya correcta, el movimiento de A sí llega a B.
    //    Se mueve A a su propio tile, que es siempre una posición válida, así que
    //    la comprobación no depende de las colisiones de un mapa concreto.
    if (posicionA) {
        const cursorMove = b.messages.length;
        a.send([Types.Messages.MOVE, posicionA[0], posicionA[1]]);
        const moveSeen = await b.waitFor(
            (m) => m[0] === Types.Messages.MOVE && m[1] === welcomeA[1],
            'el MOVE de bot-A', cursorMove);
        ok('bot-B recibió el MOVE de bot-A', JSON.stringify(moveSeen));
    }

    // 5. CHAT en los dos sentidos. Se emite a la zona con ignoreSelf=false, así
    //    que el emisor también recibe su propio mensaje.
    const cursorChatA = a.messages.length;
    const cursorChatB = b.messages.length;
    a.send([Types.Messages.CHAT, CHAT_TEXT]);

    const chatPropio = await a.waitFor(
        (m) => m[0] === Types.Messages.CHAT && m[2] === CHAT_TEXT,
        'el CHAT propio en bot-A', cursorChatA);
    ok('bot-A recibió su propio CHAT', JSON.stringify(chatPropio));

    const chatAjeno = await b.waitFor(
        (m) => m[0] === Types.Messages.CHAT && m[2] === CHAT_TEXT,
        'el CHAT en bot-B', cursorChatB);
    ok('bot-B recibió el CHAT de bot-A', JSON.stringify(chatAjeno));

    const cursorChatA2 = a.messages.length;
    b.send([Types.Messages.CHAT, CHAT_TEXT]);
    const chatDeVuelta = await a.waitFor(
        (m) => m[0] === Types.Messages.CHAT && m[2] === CHAT_TEXT,
        'el CHAT de bot-B en bot-A', cursorChatA2);
    ok('bot-A recibió el CHAT de bot-B (difusión bidireccional)', JSON.stringify(chatDeVuelta));

    // 6. Desconexión limpia de B: A debe ver el DESPAWN.
    const cursorDespawn = a.messages.length;
    b.close();
    try {
        const despawn = await a.waitFor(
            (m) => m[0] === Types.Messages.DESPAWN && m[1] === welcomeB[1],
            'el DESPAWN de bot-B', cursorDespawn);
        ok('bot-A recibió el DESPAWN de bot-B al desconectarse', JSON.stringify(despawn));
    } catch (e) {
        fail('bot-A no recibió el DESPAWN de bot-B', e.message);
    }

    a.close();
    return { a, b };
}

main()
    .then((bots) => {
        // Resumen de lo recibido por cada bot: imprescindible para diagnosticar
        // un fallo sin tener que volver a instrumentar el servidor.
        console.log('');
        console.log('\u001b[90mbot-A recibió: ' + bots.a.summary() + '\u001b[0m');
        console.log('\u001b[90mbot-B recibió: ' + bots.b.summary() + '\u001b[0m');
        console.log('');

        if (failures === 0) {
            console.log('\u001b[32mTodo OK\u001b[0m — el servidor y el protocolo funcionan.');
            process.exit(0);
        }
        console.log('\u001b[31m' + failures + ' comprobación(es) fallaron\u001b[0m');
        process.exit(1);
    })
    .catch((error) => {
        console.log('');
        fail('excepción no controlada', error.message);
        console.log('');
        console.log('\u001b[90mbot-A recibió: ' + botA.summary() + '\u001b[0m');
        console.log('\u001b[90mbot-B recibió: ' + botB.summary() + '\u001b[0m');
        console.log('\u001b[31m' + failures + ' comprobación(es) fallaron\u001b[0m');
        process.exit(1);
    });
