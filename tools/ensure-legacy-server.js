'use strict';

/**
 * Arranca el servidor heredado si no está escuchando.
 *
 * Existe porque `smoke-test` y `check-client` comprueban cosas POR HTTP, así que
 * necesitan un servidor vivo. Hasta ahora había que arrancarlo a mano, y eso hace
 * que las dos pruebas fallen con un `fetch failed` que parece un fallo del código
 * cuando lo único que pasa es que nadie levantó el servidor. Pasó de verdad: al
 * matar un servidor de una prueba anterior, las dos empezaron a fallar en rojo.
 *
 * Si el puerto YA está escuchando, no arranca nada y deja el que había: eso permite
 * apuntar las pruebas a un servidor propio con `[host] [puerto]`.
 *
 * El `spawn` usa `stdio: 'ignore'` y no el `'pipe'` por defecto: capturar la salida
 * de otro proceso por tuberías no está permitido en este entorno y falla con EPERM.
 * Como aquí no hace falta leer su salida, ignorarla es además lo correcto.
 */

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 8000;
const BOOT_TIMEOUT_MS = 8000;

/** ¿Hay alguien escuchando en ese puerto? */
function isPortOpen(port, host, timeoutMs) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        let settled = false;

        const finish = (open) => {
            if (settled) {
                return;
            }
            settled = true;
            socket.destroy();
            resolve(open);
        };

        socket.setTimeout(timeoutMs || 400);
        socket.once('connect', () => finish(true));
        socket.once('timeout', () => finish(false));
        socket.once('error', () => finish(false));

        socket.connect(port, host === 'localhost' ? '127.0.0.1' : host);
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Garantiza que hay un servidor en ese puerto.
 *
 * @returns {Promise<{started: boolean, stop: Function, port: number, host: string}>}
 */
async function ensureServer(options) {
    const opts = options || {};
    const host = opts.host || DEFAULT_HOST;
    const port = opts.port || DEFAULT_PORT;

    if (await isPortOpen(port, host, 400)) {
        return {
            started: false,
            host: host,
            port: port,
            stop: async () => {}
        };
    }

    const child = spawn(
        process.execPath,
        ['server/js/main.js', 'server/config.json'],
        { cwd: ROOT, stdio: 'ignore', detached: false }
    );

    let exited = false;
    child.once('exit', () => { exited = true; });

    const deadline = Date.now() + BOOT_TIMEOUT_MS;

    while (Date.now() < deadline) {
        if (exited) {
            throw new Error('el servidor heredado termino nada mas arrancar');
        }
        if (await isPortOpen(port, host, 300)) {
            return {
                started: true,
                host: host,
                port: port,
                stop: async () => {
                    if (!exited) {
                        child.kill();
                        // Un momento para que suelte el puerto antes de que otra
                        // prueba quiera usarlo.
                        await sleep(150);
                    }
                }
            };
        }
        await sleep(150);
    }

    child.kill();
    throw new Error('el servidor heredado no abrio el puerto ' + port +
        ' en ' + BOOT_TIMEOUT_MS + ' ms');
}

/**
 * Engancha el cierre del servidor al final del proceso.
 *
 * Se usa esto y no un `finally` alrededor del cuerpo de la prueba porque el cuerpo
 * es largo y envolverlo entero sería un cambio enorme para ganar nada: al salir del
 * proceso, el hijo se mata igual.
 */
function keepAliveUntilExit(server) {
    process.on('exit', () => {
        if (server && server.started) {
            server.stop();
        }
    });
    return server;
}

module.exports = { ensureServer, keepAliveUntilExit, isPortOpen, DEFAULT_HOST, DEFAULT_PORT };
