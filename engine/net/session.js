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
const { TALKTYPE } = require('./protocol');
const { DIRECTION } = require('../world/creature');
const { formatWeight } = require('../world/weight');

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

        /**
         * El repositorio de personajes, o null si el motor corre sin persistencia.
         * La sesión no sabe de bases de datos: sólo le pide a éste que meta y saque
         * personajes.
         */
        this.repository = opts.repository || null;

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
     * Con persistencia, autentica y CARGA el personaje; sin ella, crea uno efímero.
     * Los dos caminos acaban en el mismo sitio, así que el resto de la sesión no
     * necesita saber cuál se usó.
     *
     * @param {Object} credentials { account, password, character }
     * @returns {{handled: boolean, reason?: string, created?: boolean}}
     */
    login(credentials) {
        if (this.entered) {
            return { handled: false, reason: 'alreadyInWorld' };
        }

        const credentials_ = credentials || {};
        let player = null;
        let created = false;

        if (this.repository && this.repository.isOpen) {
            const result = this.repository.login(credentials_);

            if (result.error) {
                // Se le dice al cliente POR QUÉ, que es lo mínimo para que pueda
                // corregir la contraseña en vez de mirar una pantalla en negro.
                this._send(P.message(P.SERVER.LOGIN_ERROR, result.error));
                this.stats.rejected += 1;
                return { handled: false, reason: 'loginFailed', error: result.error };
            }

            player = result.player;
            created = result.created;
        } else {
            // Sin base de datos: personaje efímero. Es el atajo de desarrollo, y por
            // eso se avisa en el registro: un servidor de verdad no debe correr así.
            const name = credentials_.character || credentials_.account || DEFAULT_PLAYER_NAME;
            player = this.world.createPlayer(name, this._findSpawnPosition());
            if (this.log) {
                this.log.warning('entra ' + player.name + ' SIN persistencia: ' +
                    'el personaje se perdera al cerrar');
            }
        }

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

        return { handled: true, created: created };
    }

    /** El nombre del personaje en el mundo, para los registros y el chat. */
    enterWorld(name) {
        return this.login({ character: name });
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

        // Se GUARDA antes de sacarlo del mundo, y en ese orden: al revés, si el
        // guardado fallara el personaje ya no estaría en el mundo y lo que hubiera
        // hecho se perdería sin que nadie lo notara.
        if (this.repository && this.player) {
            try {
                this.repository.logout(this.player);
            } catch (error) {
                if (this.log) {
                    this.log.error('no se pudo guardar a ' + this.player.name +
                        ' al desconectar: ' + (error && error.message));
                }
            }
        }

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

        if (!this.entered && opcode !== P.CLIENT.ENTER_WORLD &&
            opcode !== P.CLIENT.LOGIN) {
            // Hablar antes de entrar no es un error del servidor: es un cliente
            // que se adelantó. Se ignora sin más.
            this.stats.rejected += 1;
            return { handled: false, reason: 'notInWorld' };
        }

        switch (opcode) {
            case P.CLIENT.LOGIN:
                // [cuenta, contrasena, personaje]
                return this.login({
                    account: message[1],
                    password: message[2],
                    character: message[3]
                });

            case P.CLIENT.ENTER_WORLD:
                // Atajo sin credenciales. Sirve para un cliente que sólo quiere
                // entrar con un nombre, y el motor decide si hay persistencia.
                return this.login({ character: message[1] });

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

            case P.CLIENT.PICKUP:
                return this._handlePickup(message[1], message[2], message[3]);

            case P.CLIENT.DROP:
                return this._handleDrop(message[1]);

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

    /**
     * Alguien dice algo.
     *
     * PRIMERO SE COMPRUEBA SI ES UN COMANDO, y esto faltaba: los talkactions estaban
     * registrados, se probaban, y **el cliente no los alcanzaba nunca** porque el
     * mensaje se difundía como charla y no se despachaba. Es el fallo clásico de las
     * piezas que funcionan por separado y no están conectadas: cada mitad pasa su
     * prueba y el camino completo no existe.
     *
     * Si un talkaction consume el mensaje, NO se difunde: un comando no es una frase, y
     * verlo aparecer en el chat como si lo hubieras dicho en voz alta sería raro.
     */
    _handleSay(text) {
        if (text === undefined || text === null) {
            return { handled: false, reason: 'emptySay' };
        }

        const message = String(text).slice(0, 255);

        const command = this.engine.registry.dispatchTalkAction(message, {
            playerId: this.playerId,
            type: TALKTYPE.SAY
        });

        if (command.handled) {
            return { handled: true, action: 'command', text: message };
        }

        // El habla se difunde por cercanía, no por vista, y de eso se encarga el motor
        // al avisar del hecho de hablar: la sesión no reparte nada por su cuenta. Es lo
        // que hace que un monstruo que dice algo use el mismo camino.
        this.world.creatureSay(this.playerId, message);

        return { handled: true, action: 'say', text: message };
    }

    /** Un mensaje privado para este jugador. */
    sendText(text) {
        return this._send(P.message(P.SERVER.TEXT, 0, String(text)));
    }

    /**
     * Avisa al cliente de que su jugador ha muerto.
     *
     * Va aparte del mensaje de texto porque son dos cosas distintas: el texto explica qué
     * ha pasado y esto le dice al cliente que puede reaccionar sin tener que interpretar
     * una frase. Un cliente que quisiera poner una pantalla de muerte no debería tener que
     * buscar la palabra "muerto" en un mensaje.
     */
    sendDeath(killerName, droppedCount) {
        return this._send(P.message(P.SERVER.PLAYER_DEATH,
            killerName || '', Number(droppedCount) || 0));
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

    /**
     * Recoger lo que hay encima de una casilla.
     *
     * Se exige que la casilla esté AL LADO, y el motivo es de jugabilidad antes que de
     * seguridad: recoger de lejos convertiría el inventario en algo que se llena sin
     * moverse, y el mundo dejaría de importar. La comprobación de verdad la hace el mundo,
     * que es quien conoce las reglas; aquí sólo se traduce el mensaje.
     */
    _handlePickup(x, y, z) {
        const result = this.world.pickUpItem(this.player, x, y, z);

        if (!result.ok) {
            // Sólo se responde cuando hay algo que explicar. Recoger de una casilla vacía
            // es normal y no merece un mensaje.
            if (result.reason === 'tooFar') {
                this.sendText('Esta demasiado lejos.');
            } else if (result.reason === 'notPickupable') {
                this.sendText('Eso no se puede recoger.');
            } else if (result.reason === 'tooHeavy') {
                // Se dice CUÁNTO falta, no sólo que no cabe: sin el número, el jugador sabe
                // que no puede pero no cuánto tiene que soltar, y acaba probando a ciegas.
                this.sendText('No puedes con eso: pesa ' + formatWeight(result.weight) +
                    ' y te quedan ' + formatWeight(result.free) + ' libres.');
            }
            return { handled: true, action: 'pickup', picked: false, reason: result.reason };
        }

        // El inventario cambió, así que hay que decírselo al cliente: si no, el objeto
        // desaparece del suelo y no aparece en ninguna parte.
        this.sendText('Has recogido ' + this._itemLabel(result.item.typeId, result.item.count) +
            (result.stacked ? ' (se suma a lo que ya llevabas)' : '') + '.');
        this.sendInventory();

        /*
         * Y HAY QUE MARCAR LA VISTA COMO SUCIA.
         *
         * La vista sólo recalcula las casillas cuando el jugador se mueve o cuando se le dice
         * que algo cambió. Recoger cambia una casilla —la que se queda sin el objeto— y sin
         * esto el cliente seguía viendo el objeto en el suelo hasta que el jugador daba un
         * paso. El inventario sí se actualizaba, así que el objeto aparecía en los dos sitios
         * a la vez: en la barra de abajo y en el suelo.
         *
         * Es el mismo fallo de siempre en este proyecto: dos piezas correctas y el cable que
         * las une, que no está. Y no se veía en ninguna prueba porque todas miraban el
         * inventario o el tile del MOTOR, y el motor sí estaba bien.
         */
        this.view.markDirty(this.playerId);

        return { handled: true, action: 'pickup', picked: true, item: result.item };
    }

    /** Soltar un objeto del inventario. */
    _handleDrop(index) {
        const result = this.world.dropItem(this.player, index);

        if (!result.ok) {
            return { handled: true, action: 'drop', dropped: false, reason: result.reason };
        }

        this.sendText('Has soltado ' + this._itemLabel(result.item.typeId, result.item.count) + '.');
        this.sendInventory();

        // Igual que al recoger: soltar pone un objeto en el suelo, y el cliente no lo vería
        // hasta moverse. Aquí el fallo es al revés —el objeto no aparece— y se nota menos,
        // que es justo lo que lo hace durar más.
        this.view.markDirty(this.playerId);

        return { handled: true, action: 'drop', dropped: true, item: result.item };
    }

    /** El nombre de un objeto con su cantidad, para los mensajes. */
    _itemLabel(typeId, count) {
        const definition = this.world.itemTypes.get(Number(typeId));
        const name = definition ? definition.name : 'objeto ' + typeId;

        if (count !== undefined && count !== 1) {
            return count + ' ' + name;
        }
        return name;
    }

    /**
     * Manda el inventario al cliente.
     *
     * Se manda ENTERO cada vez que cambia, en vez de mandar sólo lo que cambió. Un
     * inventario son decenas de entradas, y calcular diferencias para ahorrar eso es
     * mucho más código y una fuente de desincronizaciones entre lo que el jugador cree
     * que lleva y lo que lleva de verdad.
     */
    sendInventory() {
        const payload = this.world.inventoryPayload(this.player);

        return this._send(P.message(P.SERVER.INVENTORY,
            payload.count, payload.weight, payload.capacity, ...payload.flat));
    }

    _handleAttack(creatureId) {        const target = this.world.getCreature(Number(creatureId));

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

        /** El repositorio de personajes, compartido por todas las sesiones. */
        this.repository = opts.repository || null;

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
            repository: this.repository,
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
    /**
     * Marca todas las vistas como sucias.
     *
     * Es a proposito la version burda: no se calcula QUE vista cubre la casilla que cambio,
     * se marcan todas. Cuesta un recuento de casillas de mas por cada jugador conectado y
     * ahorra el indice espacial que haria falta para acertar, ademas de la clase entera de
     * fallos que aparece cuando ese indice se desincroniza del mundo. Con pocos jugadores es
     * gratis, y el dia que no lo sea ya se sabra por que.
     */
    markAllDirty() {
        this.view.markAllDirty();
    }

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
