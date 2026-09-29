'use strict';

/**
 * Sesiones: el puente entre una conexión y una criatura del mundo.
 *
 * Una sesión es lo que hace que un mensaje del cliente se convierta en algo que el
 * motor decide. El cliente PIDE; el motor decide. Ningún mensaje del cliente
 * cambia el mundo por sí mismo.
 *
 * SOBRE EL TRANSPORTE. Esta capa no sabe qué hay debajo: recibe mensajes ya
 * deserializados por un `send` que le inyectan. Eso permite probar todo el
 * protocolo, el movimiento y la vista **sin abrir un socket**, que es lo que hace
 * que las pruebas de esta parte sean deterministas en vez de depender de la red.
 * El servidor WebSocket real es sólo un adaptador encima.
 *
 * SOBRE EL MOVIMIENTO. El jugador que camina recibe su propio mensaje de
 * movimiento al instante, pero los DEMÁS lo reciben por el diff de su vista, en el
 * siguiente tick. Son dos caminos distintos a propósito: el jugador que camina ya
 * sabe que se movió (lo pidió él), y darle la vuelta al suyo por el diff añadiría
 * un tick de retraso a los propios movimientos, que es justo donde se nota.
 */

const P = require('./protocol');
const { DIRECTION } = require('../world/creature');

/** Cómo se llama el jugador si no manda nombre. */
const DEFAULT_PLAYER_NAME = 'Aventurero';

/** Distancia máxima para oír a alguien que habla. */
const SAY_RADIUS = 10;

class GameSession {
    constructor(options) {
        const opts = options || {};

        this.engine = opts.engine;
        this.world = opts.world;
        this.view = opts.view;
        this.combat = opts.combat;
        this.log = opts.logger || null;

        /**
         * El gestor al que pertenece. La sesión se registra ELLA MISMA al entrar
         * al mundo, y no quien la crea: al crearla todavía no tiene jugador, así
         * que registrarla entonces la dejaría fuera de la lista para siempre, sin
         * ningún error y sin que el jugador recibiera nada.
         */
        this.manager = opts.manager || null;

        /** Cómo se envía al cliente. Lo inyecta el adaptador. */
        this.send = opts.send || (() => {});

        this.player = null;
        this.playerId = null;
        this.closed = false;
        this.entered = false;

        this.stats = { received: 0, sent: 0, rejected: 0, steps: 0 };
    }

    // -----------------------------------------------------------------------
    // Ciclo de vida
    // -----------------------------------------------------------------------

    /**
     * El cliente entra al mundo.
     *
     * El jugador se coloca en el waypoint `temple` del mapa si existe, y si no en
     * el primer tile transitable de la planta 0. No se inventa una posición: un
     * jugador dentro de un muro sería un fallo visible desde el primer segundo.
     */
    enterWorld(name) {
        if (this.entered) {
            return false;
        }

        const spawn = this._findSpawnPosition();
        const player = this.world.createPlayer(name || DEFAULT_PLAYER_NAME, spawn);

        this.player = player;
        this.playerId = player.id;
        this.entered = true;

        this.view.addPlayer(player.id);

        // El saludo y los datos del jugador, y luego el mapa: el cliente necesita
        // saber su propia posición ANTES de recibir tiles, o no sabría dónde está
        // el centro de lo que le llega.
        this.view.loginMessages(player).forEach((message) => this._send(message));

        this._flushView();

        if (this.manager) {
            this.manager.register(this);
        }

        return true;
    }

    _findSpawnPosition() {
        const map = this.world.map;
        if (!map) {
            return { x: 0, y: 0, z: 0 };
        }

        const temple = map.getWaypoint('temple');
        if (temple && map.isWalkable(temple.x, temple.y, temple.z)) {
            return temple;
        }

        // Primer tile transitable de la planta 0, en orden: es determinista, así
        // que dos arranques dan el mismo resultado y un fallo es reproducible.
        for (let y = 0; y < map.height; y += 1) {
            for (let x = 0; x < map.width; x += 1) {
                if (map.isWalkable(x, y, 0)) {
                    return { x: x, y: y, z: 0 };
                }
            }
        }

        return { x: 0, y: 0, z: 0 };
    }

    close() {
        if (this.closed) {
            return false;
        }
        this.closed = true;

        if (this.playerId !== null) {
            this.view.removePlayer(this.playerId);
            this.world.removePlayer(this.playerId);
            if (this.manager) {
                this.manager.unregister(this);
            }
        }
        return true;
    }

    // -----------------------------------------------------------------------
    // Entrada
    // -----------------------------------------------------------------------

    /**
     * Procesa un mensaje del cliente.
     *
     * Todo se valida aquí. Un cliente modificado puede mandar cualquier cosa, y la
     * única defensa es que el motor no se crea nada de lo que le llega.
     *
     * @param {Array} message [opcode, ...datos]
     */
    handle(message) {
        if (this.closed || !Array.isArray(message) || message.length === 0) {
            return { handled: false, reason: 'malformed' };
        }

        const opcode = message[0];
        this.stats.received += 1;

        if (!this.entered && opcode !== P.CLIENT.ENTER_WORLD) {
            // Hablar antes de entrar no es un error del servidor: es un cliente
            // que se adelantó. Se ignora sin más.
            this.stats.rejected += 1;
            return { handled: false, reason: 'notInWorld' };
        }

        switch (opcode) {
            case P.CLIENT.ENTER_WORLD:
                return { handled: this.enterWorld(message[1]) };

            case P.CLIENT.WALK_NORTH:
            case P.CLIENT.WALK_EAST:
            case P.CLIENT.WALK_SOUTH:
            case P.CLIENT.WALK_WEST:
            case P.CLIENT.WALK_NORTH_EAST:
            case P.CLIENT.WALK_SOUTH_EAST:
            case P.CLIENT.WALK_SOUTH_WEST:
            case P.CLIENT.WALK_NORTH_WEST:
                return this._handleWalk(opcode);

            case P.CLIENT.TURN_NORTH:
            case P.CLIENT.TURN_EAST:
            case P.CLIENT.TURN_SOUTH:
            case P.CLIENT.TURN_WEST:
                this.player.setDirection(P.TURN_DIRECTIONS[opcode]);
                this.view.markDirty(this.playerId);
                return { handled: true, action: 'turn' };

            case P.CLIENT.SAY:
                return this._handleSay(message[1]);

            case P.CLIENT.LOOK:
                return this._handleLook(message[1], message[2], message[3]);

            case P.CLIENT.ATTACK:
                return this._handleAttack(message[1]);

            case P.CLIENT.LOGOUT:
                this.close();
                return { handled: true, action: 'logout' };

            default:
                this.stats.rejected += 1;
                return { handled: false, reason: 'unknownOpcode', opcode: opcode };
        }
    }

    /**
     * Un paso.
     *
     * Aquí está la inversión respecto al cliente heredado, que era autoritativo:
     * el cliente pide y el MOTOR decide. Si el paso no es válido no se responde
     * nada, porque caminar contra una pared es normal y no un error que merezca un
     * mensaje.
     */
    _handleWalk(opcode) {
        const offset = P.WALK_OFFSETS[opcode];
        if (!offset) {
            return { handled: false, reason: 'badOffset' };
        }

        const from = this.player.position.copy();
        const result = this.world.moveCreature(this.player, offset);

        if (result.moved) {
            this.stats.steps += 1;
            // El mensaje del propio movimiento se manda ya, sin esperar al diff:
            // es el único caso en que un tick de retraso se notaría. Y se apunta
            // en la vista para que el diff no lo repita.
            this._send(this.view.moveMessage(this.player, from, result.to));
            this.view.noteMoved(this.player);
            this.view.markDirty(this.playerId);
            return { handled: true, action: 'walk', to: result.to, duration: result.duration };
        }

        // Aun sin moverse, girar hacia donde se intentaba es lo que hace Tibia.
        this.view.markDirty(this.playerId);
        return { handled: true, action: 'walk', moved: false, reason: result.reason };
    }

    _handleSay(text) {
        if (text === undefined || text === null) {
            return { handled: false, reason: 'emptySay' };
        }

        const message = String(text).slice(0, 255);
        this.world.creatureSay(this.playerId, message);

        // El habla se difunde por cercanía, no por vista: quien está al otro lado
        // de una pared y a dos casillas oye, y quien está lejos no. Es la regla de
        // Tibia y la que espera cualquiera al gritar en una mazmorra.
        this.engine.broadcastSay(this.player, message);

        return { handled: true, action: 'say', text: message };
    }

    /** Mirar un tile: describe lo que hay, para depurar y para el examen. */
    _handleLook(x, y, z) {
        const map = this.world.map;
        const tile = map ? map.getTile(Number(x), Number(y), Number(z)) : null;

        const parts = [];
        const ground = map ? map.getGround(Number(x), Number(y), Number(z)) : null;
        if (ground && ground.getName()) {
            parts.push(ground.getName());
        }
        if (tile) {
            tile.downItems.concat(tile.topItems).forEach((item) => {
                const name = item.getName();
                if (name) {
                    parts.push(item.count > 1 ? item.count + ' ' + name : name);
                }
            });
        }

        const creatures = this.world.getCreaturesAt(Number(x), Number(y), Number(z));
        creatures.forEach((creature) => parts.push(creature.name));

        const text = parts.length > 0
            ? 'Ves ' + parts.join(', ') + '.'
            : 'No ves nada especial.';

        this._send(P.message(P.SERVER.TEXT, 0, text));
        return { handled: true, action: 'look', text: text };
    }

    _handleAttack(creatureId) {
        const target = this.world.getCreature(Number(creatureId));

        if (!target || target.id === this.playerId) {
            return { handled: false, reason: 'badTarget' };
        }

        const result = this.combat.attack(this.player, target);
        this.player.target = target;

        if (result.hit) {
            this.view.markDirty(this.playerId);
        }

        return { handled: true, action: 'attack', result: result };
    }

    /** Empuja los cambios de vista al cliente. */
    update() {
        if (this.closed || !this.entered) {
            return 0;
        }
        return this._flushView();
    }

    /** Las estadísticas del jugador, cuando cambian. */
    sendStats() {
        const player = this.player;
        this._send(P.message(P.SERVER.PLAYER_STATS,
            player.health, player.maxHealth,
            player.level, player.experience || 0));
    }

    _flushView() {
        const messages = this.view.update(this.player);
        messages.forEach((message) => this._send(message));
        return messages.length;
    }

    _send(message) {
        if (this.closed) {
            return false;
        }
        this.stats.sent += 1;
        this.send(message);
        return true;
    }
}

/**
 * Gestor de sesiones.
 *
 * Mantiene las sesiones vivas, las actualiza en cada tick y difunde lo que afecta
 * a varios jugadores.
 */
class SessionManager {
    constructor(options) {
        const opts = options || {};

        this.engine = opts.engine;
        this.world = opts.world;
        this.view = opts.view;
        this.log = opts.logger || null;

        /** id de jugador -> sesión. */
        this.sessions = new Map();
    }

    /** Crea una sesión con un transporte ya resuelto. */
    createSession(send) {
        const session = new GameSession({
            engine: this.engine,
            world: this.world,
            view: this.view,
            combat: this.engine.combat,
            logger: this.log,
            manager: this,
            send: send
        });
        return session;
    }

    /** Registra la sesión cuando el jugador ya está en el mundo. */
    register(session) {
        if (session && session.playerId !== null) {
            this.sessions.set(session.playerId, session);
        }
        return session;
    }

    unregister(session) {
        if (session && session.playerId !== null) {
            this.sessions.delete(session.playerId);
        }
    }

    get(playerId) {
        return this.sessions.get(Number(playerId)) || null;
    }

    get size() {
        return this.sessions.size;
    }

    /** Difunde un mensaje a quien pueda ver una posición. */
    broadcastAround(position, message, exceptId) {
        const map = this.world.map;
        let sent = 0;

        this.sessions.forEach((session) => {
            if (!session.entered || session.playerId === exceptId) {
                return;
            }

            const viewer = session.player.position;

            if (map && !map.canSee(viewer.z, position.z)) {
                return;
            }

            const halfWidth = Math.floor(this.view.viewWidth / 2);
            const halfHeight = Math.floor(this.view.viewHeight / 2);
            if (Math.abs(viewer.x - position.x) > halfWidth ||
                Math.abs(viewer.y - position.y) > halfHeight) {
                return;
            }

            session.send(message);
            sent += 1;
        });

        return sent;
    }

    /** Difunde lo que alguien dice, incluido a quien lo dice. */
    broadcastSay(creature, text) {
        const message = P.message(P.SERVER.CREATURE_SAY,
            creature.id, creature.name, text);
        const map = this.world.map;

        this.sessions.forEach((session) => {
            if (!session.entered) {
                return;
            }

            const viewer = session.player.position;

            if (map && !map.canSee(viewer.z, creature.position.z)) {
                return;
            }
            if (Math.abs(viewer.x - creature.position.x) > SAY_RADIUS ||
                Math.abs(viewer.y - creature.position.y) > SAY_RADIUS) {
                return;
            }

            session.send(message);
        });

        return true;
    }

    /** Un tick: cada sesión empuja sus cambios. */
    updateAll() {
        let messages = 0;
        this.sessions.forEach((session) => {
            messages += session.update();
        });
        return messages;
    }

    closeAll() {
        this.sessions.forEach((session) => {
            session.close();
        });
        this.sessions.clear();
    }

    stats() {
        return {
            sessions: this.sessions.size,
            entered: Array.from(this.sessions.values()).filter((s) => s.entered).length,
            steps: Array.from(this.sessions.values())
                .reduce((total, s) => total + s.steps, 0)
        };
    }
}

module.exports = { GameSession, SessionManager, DEFAULT_PLAYER_NAME, SAY_RADIUS };
