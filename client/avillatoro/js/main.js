/**
 * El cliente: atar las piezas.
 *
 * Aquí se juntan la conexión, el mundo del cliente, la cámara, la lista de dibujo y
 * el renderer. Es el único archivo de esta carpeta que sabe de todos los demás, y a
 * propósito: las piezas no se conocen entre sí, así que cada una se puede probar
 * sola.
 *
 * SOBRE EL BUCLE. Se dibuja con `requestAnimationFrame`, que va a la frecuencia del
 * monitor, pero eso es sólo el DIBUJO. La simulación no vive aquí: el mundo lo
 * simula el servidor y el cliente se limita a interpolar lo que le llega. Es la
 * diferencia entre un cliente y un motor, y es lo que hace que no se pueda hacer
 * trampa desde aquí.
 */

import { CLIENT, SERVER, OFFSET_TO_WALK } from '/shared/js/protocol.mjs';

import { Connection } from './connection.js';
import { ClientWorld } from './world.js';
import { Camera } from './camera.js';
import { buildDrawList, summarize } from './drawlist.js';
import { Renderer } from './renderer.js';
import { createProvider, TILE } from './sprites.js';

/** Cada cuánto se puede reintentar un paso rechazado. */
const REPEAT_DELAY = 150;

/** Cuánto dura un texto dicho por alguien en pantalla. */
const SAY_DURATION = 4000;

class Game {
    constructor(options) {
        const opts = options || {};

        this.canvas = opts.canvas;
        this.diagnostics = opts.diagnostics || null;

        this.world = new ClientWorld();
        this.camera = new Camera({ width: 960, height: 640, tileSize: TILE });
        this.provider = createProvider({});
        this.renderer = new Renderer({
            canvas: this.canvas,
            provider: this.provider
        });

        this.connection = null;
        this.playerName = opts.name || 'Aventurero';

        /** Teclas de dirección pulsadas ahora mismo. */
        this.pressed = new Set();
        this.lastWalkSentAt = 0;

        /** Lo que se está diciendo, con su caducidad. */
        this.recentSays = [];

        this.running = false;
        this.lastFrameAt = 0;
        this.fps = 0;
    }

    // -----------------------------------------------------------------------
    // Arranque
    // -----------------------------------------------------------------------

    start(url) {
        this.resize();

        this.connection = new Connection({
            url: url,
            name: this.playerName,

            onMessages: (messages) => this._onMessages(messages),
            onOpen: () => this._setStatus('conectado, entrando al mundo...'),
            onClose: (wasConnected) => {
                this._setStatus(wasConnected
                    ? 'desconectado, reintentando...'
                    : 'no se pudo conectar, reintentando...');
                // Al perder la conexión el mundo del cliente ya no vale: lo que
                // tuviera es de una sesión que ya no existe.
                this.world = new ClientWorld();
                this.camera.setCenter(0, 0, 7);
            },
            onError: () => this._setStatus('error de conexion')
        });

        this.connection.connect();

        this.running = true;
        this.lastFrameAt = performance.now();
        requestAnimationFrame((time) => this._frame(time));
    }

    // -----------------------------------------------------------------------
    // Lo que llega
    // -----------------------------------------------------------------------

    _onMessages(messages) {
        const result = this.world.apply(messages, { SERVER: SERVER, CLIENT: CLIENT });

        result.events.forEach((event) => {
            if (event.type === 'text') {
                this._addSay('', event.text);
            } else if (event.type === 'say') {
                this._addSay(event.name, event.text);
            } else if (event.type === 'login') {
                this._setStatus('dentro del mundo como ' + event.player.name);
                this.camera.setCenter(event.player.x, event.player.y, event.player.z);
            } else if (event.type === 'floorChange') {
                this.camera.z = event.z;
            }
        });
    }

    _addSay(name, text) {
        this.recentSays.push({
            line: name ? name + ': ' + text : text,
            until: performance.now() + SAY_DURATION
        });
        if (this.recentSays.length > 6) {
            this.recentSays.shift();
        }
    }

    // -----------------------------------------------------------------------
    // Entrada
    // -----------------------------------------------------------------------

    onKeyDown(key) {
        this.pressed.add(key);
    }

    onKeyUp(key) {
        this.pressed.delete(key);
    }

    clearKeys() {
        this.pressed.clear();
    }

    say(text) {
        if (text && this.connection) {
            this.connection.send([CLIENT.SAY, text]);
        }
    }

    look(x, y, z) {
        if (this.connection) {
            this.connection.send([CLIENT.LOOK, x, y, z]);
        }
    }

    attack(creatureId) {
        if (this.connection) {
            this.connection.send([CLIENT.ATTACK, creatureId]);
        }
    }

    /**
     * El desplazamiento que piden las teclas ahora mismo.
     *
     * Se suman las direcciones para que dos teclas a la vez den una diagonal, que es
     * lo que espera cualquiera que haya jugado a algo de esto.
     */
    _pressedOffset() {
        let x = 0;
        let y = 0;

        if (this.pressed.has('up')) { y -= 1; }
        if (this.pressed.has('down')) { y += 1; }
        if (this.pressed.has('left')) { x -= 1; }
        if (this.pressed.has('right')) { x += 1; }

        if (x === 0 && y === 0) {
            return null;
        }
        return { x: x, y: y };
    }

    /**
     * Pide un paso, si procede.
     *
     * Se pide cuando el paso anterior ya terminó, y no en cada fotograma: así se
     * manda UNA petición por paso y no sesenta por segundo. El motor rechaza lo que
     * no toca de todas formas, pero pedirlo sin necesidad es gastar red y batería
     * para nada.
     *
     * Si el paso se rechaza (un muro), no hay respuesta y `moving` sigue siendo
     * nulo, así que se espera un poco antes de reintentar: sin esa espera, empujar
     * contra una pared mandaría una petición por fotograma.
     */
    _tryWalk(now) {
        const offset = this._pressedOffset();
        if (!offset || !this.world.playerId) {
            return;
        }

        const me = this.world.creatures.get(this.world.playerId);
        if (me && me.moving) {
            return;
        }

        if (now - this.lastWalkSentAt < REPEAT_DELAY) {
            return;
        }

        const opcode = OFFSET_TO_WALK[offset.x + ',' + offset.y];
        if (opcode === undefined) {
            return;
        }

        this.lastWalkSentAt = now;
        this.connection.send([opcode]);
    }

    // -----------------------------------------------------------------------
    // Bucle
    // -----------------------------------------------------------------------

    _frame(time) {
        if (!this.running) {
            return;
        }

        const delta = Math.min(100, time - this.lastFrameAt);
        this.lastFrameAt = time;
        this.fps = this.fps === 0 ? 1000 / Math.max(1, delta)
            : this.fps * 0.9 + (1000 / Math.max(1, delta)) * 0.1;

        this._tryWalk(time);

        // Se cierran los movimientos que ya terminaron ANTES de dibujar, para que
        // las criaturas que llegaron a su casilla ocupen la nueva y no la de salida.
        this.world.update(time);

        this._followPlayer();
        this._expireSays(time);
        this._draw(time);

        requestAnimationFrame((next) => this._frame(next));
    }

    /** La cámara sigue al jugador, deslizándose. */
    _followPlayer() {
        const me = this.world.playerId
            ? this.world.creatures.get(this.world.playerId)
            : null;

        if (!me) {
            return;
        }

        const position = this.world.creaturePosition(me);

        // Se persigue la posición en vez de igualarla: el muñeco se mueve a saltos
        // de casilla en casilla, y si la cámara lo copiara exactamente el mundo
        // daría un tirón por paso. Con un factor de seguimiento el desplazamiento es
        // continuo y el muñeco se queda prácticamente centrado.
        const factor = 0.25;
        this.camera.centerX += (position.x - this.camera.centerX) * factor;
        this.camera.centerY += (position.y - this.camera.centerY) * factor;

        // El ajuste se corta cuando la diferencia es despreciable, para que la
        // cámara llegue a asentarse en vez de oscilar eternamente alrededor.
        if (Math.abs(position.x - this.camera.centerX) < 0.01) {
            this.camera.centerX = position.x;
        }
        if (Math.abs(position.y - this.camera.centerY) < 0.01) {
            this.camera.centerY = position.y;
        }

        this.camera.z = me.z;
    }

    _expireSays(now) {
        this.recentSays = this.recentSays.filter((say) => say.until > now);
    }

    _draw(now) {
        const ops = buildDrawList(this.world, this.camera, { now: now });

        this.renderer.draw(ops, this.camera, {
            recentSays: this.recentSays
        });

        this._updateDiagnostics(ops);
    }

    _updateDiagnostics(ops) {
        if (!this.diagnostics) {
            return;
        }

        const summary = summarize(ops);
        const world = this.world.stats();

        this.diagnostics.textContent =
            'fps ' + this.fps.toFixed(0) +
            '  |  dibujo ' + summary.total + ' ops (' + summary.ground + ' suelo, ' +
            summary.items + ' items, ' + summary.creatures + ' criaturas)' +
            '  |  mundo ' + world.tiles + ' tiles, ' + world.creatures + ' criaturas' +
            '  |  plantas ' + summary.floors.join('/') +
            '  |  camara ' + this.camera.centerX.toFixed(2) + ',' +
            this.camera.centerY.toFixed(2) + ' z' + this.camera.z +
            '  |  red ' + (this.connection ? this.connection.stats.messages : 0) + ' msgs';
    }

    _setStatus(text) {
        const element = document.getElementById('status');
        if (element) {
            element.textContent = text;
        }
    }

    resize() {
        this.renderer.resize();
        this.camera.setViewport(this.renderer.cssWidth, this.renderer.cssHeight);
    }
}

// ---------------------------------------------------------------------------
// Arranque de la página
// ---------------------------------------------------------------------------

function wheelToKey(event) {
    switch (event.key) {
        case 'ArrowUp': case 'w': case 'W': return 'up';
        case 'ArrowDown': case 's': case 'S': return 'down';
        case 'ArrowLeft': case 'a': case 'A': return 'left';
        case 'ArrowRight': case 'd': case 'D': return 'right';
        default: return null;
    }
}

function boot() {
    const canvas = document.getElementById('game');
    const diagnostics = document.getElementById('diagnostics');
    const form = document.getElementById('login');
    const nameInput = document.getElementById('name');
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat');
    const overlay = document.getElementById('overlay');

    const game = new Game({ canvas: canvas, diagnostics: diagnostics });
    window.game = game;

    // Se expone para poder mirar el estado desde la consola del navegador, que es
    // la herramienta de depuración más útil que tiene un cliente.
    window.__avillatoro = game;

    form.addEventListener('submit', (event) => {
        event.preventDefault();

        game.playerName = (nameInput.value || 'Aventurero').slice(0, 20);

        // La dirección del motor se puede forzar con `?ws=host:puerto`, que es lo
        // que hace falta para apuntar a otra máquina sin tocar el código. Por
        // defecto se usa el mismo host que sirvió la página y el puerto del motor.
        const params = new URLSearchParams(window.location.search);
        const override = params.get('ws');

        let url;
        if (override) {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            url = protocol + '//' + override;
        } else {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            url = protocol + '//' + window.location.hostname + ':8080';
        }

        overlay.style.display = 'none';
        game.start(url);
    });

    chatForm.addEventListener('submit', (event) => {
        event.preventDefault();
        game.say(chatInput.value);
        chatInput.value = '';
        chatInput.blur();
    });

    // Mientras se escribe en el chat, las teclas no mueven al muñeco.
    chatInput.addEventListener('focus', () => game.clearKeys());
    chatInput.addEventListener('blur', () => game.clearKeys());

    window.addEventListener('keydown', (event) => {
        if (document.activeElement === chatInput) {
            return;
        }

        // El chat se abre con Intro, como en cualquier juego de estos.
        if (event.key === 'Enter') {
            chatInput.focus();
            event.preventDefault();
            return;
        }

        const key = wheelToKey(event);
        if (key) {
            game.onKeyDown(key);
            // Sin esto, las flechas hacen scroll de la página mientras se camina.
            event.preventDefault();
        }

        if (event.key === ' ') {
            const me = game.world.playerId
                ? game.world.creatures.get(game.world.playerId)
                : null;
            if (me) {
                game.look(me.x, me.y, me.z);
            }
            event.preventDefault();
        }
    });

    window.addEventListener('keyup', (event) => {
        const key = wheelToKey(event);
        if (key) {
            game.onKeyUp(key);
        }
    });

    window.addEventListener('blur', () => game.clearKeys());
    window.addEventListener('resize', () => game.resize());

    // Un clic en el mapa: atacar a la criatura que haya ahí, o mirar el tile.
    canvas.addEventListener('click', (event) => {
        const rect = canvas.getBoundingClientRect();
        const target = game.camera.screenToWorld(
            event.clientX - rect.left, event.clientY - rect.top, game.camera.z);

        const creatures = game.world.creaturesAt(target.x, target.y, target.z);
        if (creatures.length > 0 && creatures[0].id !== game.world.playerId) {
            game.attack(creatures[0].id);
        } else {
            game.look(target.x, target.y, target.z);
        }
    });

    nameInput.focus();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}

export { Game };
