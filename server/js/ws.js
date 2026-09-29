'use strict';

/**
 * Servidor WebSocket moderno, sobre el paquete `ws`.
 *
 * Reemplaza por completo al `MultiVersionWebsocketServer` original, que
 * arrastraba `websocket-server` (miksago) y `websocket` (Worlize) sólo para
 * negociar los drafts hixie-75/76/hybi-08, además de `bison` como codec
 * binario alternativo. Ningún navegador actual usa esos drafts, así que toda
 * esa maquinaria desaparece y el protocolo queda en JSON puro sobre `ws`.
 *
 * Se conserva a propósito la misma superficie pública que ya consumen
 * `main.js` y `worldserver.js`, para no tener que tocar el resto del servidor:
 *
 *   servidor: onConnect, onError, onRequestStatus, broadcast,
 *             forEachConnection, addConnection, removeConnection, getConnection
 *   conexión: id, remoteAddress, onClose, listen, send(objeto), sendUTF8(texto), close(motivo)
 */

const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');
const cls = require('./lib/class');
const Utils = require('./utils');
const StaticServer = require('./staticserver');

/** WebSocket.OPEN — constante del protocolo, no la tomamos de la instancia. */
const SOCKET_OPEN = 1;

const WS = {};

module.exports = WS;


/**
 * Clase base abstracta (misma forma que la original).
 */
const Server = cls.Class.extend({
    init: function (port, clientRoot) {
        this.port = port;
        this.clientRoot = clientRoot || null;
        this._connections = {};
        this._counter = 0;
    },

    onConnect: function (callback) {
        this.connection_callback = callback;
    },

    onError: function (callback) {
        this.error_callback = callback;
    },

    onRequestStatus: function (callback) {
        this.status_callback = callback;
    },

    broadcast: function (message) {
        this.forEachConnection(function (connection) {
            connection.send(message);
        });
    },

    forEachConnection: function (callback) {
        Object.keys(this._connections).forEach(function (id) {
            callback(this._connections[id], id);
        }, this);
    },

    addConnection: function (connection) {
        this._connections[connection.id] = connection;
    },

    removeConnection: function (id) {
        delete this._connections[id];
    },

    getConnection: function (id) {
        return this._connections[id];
    }
});


/**
 * Servidor concreto: un único servidor HTTP que atiende
 *   - GET /status      -> callback de estado (JSON)
 *   - todo lo demás    -> archivos estáticos del cliente
 *   - upgrade          -> WebSocket del juego
 */
WS.WebsocketServer = Server.extend({
    init: function (port, clientRoot, sharedRoot) {
        this._super(port, clientRoot);

        this.sharedRoot = sharedRoot || null;

        const self = this;

        // El cliente pide el módulo compartido fuera de su propio árbol (ver
        // client/js/game.js): hay que montar también `shared/`. Sin esto el
        // navegador recibe un 404 en /shared/js/gametypes.js y el cliente muere
        // con "Types is not defined".
        this.staticHandler = clientRoot ? StaticServer.createHandler({
            '/': clientRoot,
            '/shared': sharedRoot
        }) : null;

        this._httpServer = http.createServer(function (request, response) {
            // URL de WHATWG en vez de url.parse(): elimina el aviso de
            // deprecación DEP0169 y el parseo no estandarizado. La base es
            // ficticia porque sólo se usa la ruta.
            let pathname;
            try {
                pathname = new URL(request.url, 'http://localhost').pathname;
            } catch (e) {
                pathname = '/';
            }

            if (pathname === '/status' && self.status_callback) {
                const body = self.status_callback();
                response.writeHead(200, {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Length': Buffer.byteLength(body)
                });
                response.end(body);
                return;
            }

            if (self.staticHandler && self.staticHandler(request, response, pathname)) {
                return;
            }

            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            response.end('404 Not Found');
        });

        this._wss = new WebSocketServer({ server: this._httpServer });

        this._wss.on('connection', function (socket, request) {
            const connection = new WS.SocketConnection(self._createId(), socket, request, self);

            if (self.connection_callback) {
                self.connection_callback(connection);
            }
            self.addConnection(connection);
        });

        this._wss.on('error', function (error) {
            if (self.error_callback) {
                self.error_callback(error);
            }
        });

        this._httpServer.listen(port, function () {
            log.info('Server is listening on port ' + port);
            if (self.clientRoot) {
                log.info('Client: http://localhost:' + port + '/  (sirviendo ' +
                    path.resolve(self.clientRoot) +
                    (self.sharedRoot ? ' y ' + path.resolve(self.sharedRoot) + ' en /shared' : '') + ')');
            }
        });
    },

    _createId: function () {
        return '5' + Utils.random(99) + '' + (this._counter++);
    }
});

/** Alias histórico: el nombre viejo sigue resolviendo. */
WS.MultiVersionWebsocketServer = WS.WebsocketServer;


/**
 * Conexión concreta sobre un socket de `ws`.
 */
WS.SocketConnection = cls.Class.extend({
    init: function (id, socket, request, server) {
        const self = this;

        this.id = id;
        this._socket = socket;
        this._server = server;
        this.remoteAddress = (request && request.socket && request.socket.remoteAddress) || 'unknown';

        this._isClosing = false;
        this._notifiedClose = false;

        socket.on('message', function (data) {
            if (!self.listen_callback) {
                return;
            }

            const text = typeof data === 'string' ? data : data.toString('utf8');

            let message;
            try {
                message = JSON.parse(text);
            } catch (e) {
                self.close('Received message was not valid JSON.');
                return;
            }

            self.listen_callback(message);
        });

        socket.on('close', function () {
            self._handleClose();
        });

        socket.on('error', function (error) {
            // Un error de socket siempre va seguido de 'close', así que no
            // cerramos aquí; sólo dejamos rastro para diagnosticar.
            log.debug('WebSocket error de ' + self.remoteAddress + ': ' + error.message);
        });
    },

    onClose: function (callback) {
        this.close_callback = callback;
    },

    listen: function (callback) {
        this.listen_callback = callback;
    },

    send: function (message) {
        this.sendUTF8(JSON.stringify(message));
    },

    /**
     * Envía texto crudo, sin serializar. El protocolo lo usa para los
     * centinelas "go" y "timeout" del handshake (ver player.js:235 y :380).
     */
    sendUTF8: function (data) {
        if (this._isClosing || this._socket.readyState !== SOCKET_OPEN) {
            return;
        }
        this._socket.send(data);
    },

    close: function (logError) {
        if (this._isClosing) {
            return;
        }
        this._isClosing = true;

        log.info('Closing connection to ' + this.remoteAddress + '. Error: ' + logError);

        if (this._socket.readyState === SOCKET_OPEN) {
            this._socket.close();
        } else {
            // El evento 'close' no va a llegar: notificamos nosotros.
            this._handleClose();
        }
    },

    _handleClose: function () {
        if (this._notifiedClose) {
            return;
        }
        this._notifiedClose = true;
        this._isClosing = true;

        if (this.close_callback) {
            this.close_callback();
        }
        this._server.removeConnection(this.id);
    }
});
