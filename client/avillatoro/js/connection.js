/**
 * La conexión: el socket.
 *
 * Lo único que hace es transportar. No interpreta el mundo ni decide nada: lo que
 * llega se lo pasa a quien lo haya pedido, y lo que se manda ya viene preparado.
 *
 * DOS DETALLES QUE IMPORTAN
 *
 * 1. LOS MARCOS VIENEN AGRUPADOS. El servidor junta todos los mensajes de un tick
 *    en un solo marco, así que lo que llega es un array de mensajes. Desempaquetarlo
 *    es responsabilidad de esta capa, para que nadie más tenga que saberlo.
 *
 * 2. SE RECONECTA SOLO. Un servidor de juego se cae, se reinicia o se queda sin red
 *    un momento, y eso no debería obligar a recargar la página. La reconexión
 *    vuelve a entrar al mundo desde cero, porque el estado del cliente ya no vale
 *    para nada: lo que tuviera de la sesión anterior está caducado.
 */

import { unwrapFrame, CLIENT } from '/shared/js/protocol.mjs';

/** Espera entre intentos, en milisegundos. Crece para no machacar al servidor. */
const RETRY_DELAYS = [500, 1000, 2000, 4000, 8000];

export class Connection {
    constructor(options) {
        const opts = options || {};

        this.url = opts.url;
        this.name = opts.name || 'Aventurero';

        /** Se llaman cuando llega algo. */
        this.onMessages = opts.onMessages || (() => {});
        this.onOpen = opts.onOpen || (() => {});
        this.onClose = opts.onClose || (() => {});
        this.onError = opts.onError || (() => {});

        this.socket = null;
        this.connected = false;
        this.attempts = 0;
        this.closedByUs = false;

        this.stats = { frames: 0, messages: 0, sent: 0 };
    }

    connect() {
        this.closedByUs = false;

        try {
            this.socket = new WebSocket(this.url);
        } catch (error) {
            // Una URL mal formada no se arregla reintentando.
            this.onError(error);
            return this;
        }

        this.socket.onopen = () => {
            this.connected = true;
            this.attempts = 0;

            // El servidor no habla primero: hay que pedir entrar. El saludo y el
            // mapa llegan como respuesta a esto.
            this.send([CLIENT.ENTER_WORLD, this.name]);
            this.onOpen();
        };

        this.socket.onmessage = (event) => {
            let parsed;
            try {
                parsed = JSON.parse(event.data);
            } catch (error) {
                // Un marco que no es JSON se ignora: no hay nada que hacer con él y
                // cerrar la conexión por eso sería peor.
                return;
            }

            const messages = unwrapFrame(parsed);
            this.stats.frames += 1;
            this.stats.messages += messages.length;
            this.onMessages(messages);
        };

        this.socket.onclose = () => {
            const wasConnected = this.connected;
            this.connected = false;
            this.onClose(wasConnected);

            if (!this.closedByUs) {
                this._scheduleRetry();
            }
        };

        this.socket.onerror = (error) => {
            this.onError(error);
        };

        return this;
    }

    _scheduleRetry() {
        const delay = RETRY_DELAYS[Math.min(this.attempts, RETRY_DELAYS.length - 1)];
        this.attempts += 1;

        setTimeout(() => {
            if (!this.closedByUs) {
                this.connect();
            }
        }, delay);
    }

    send(message) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            return false;
        }
        this.socket.send(JSON.stringify(message));
        this.stats.sent += 1;
        return true;
    }

    close() {
        this.closedByUs = true;
        if (this.socket) {
            this.socket.close();
        }
    }
}
