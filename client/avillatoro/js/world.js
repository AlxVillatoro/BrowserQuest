/**
 * El mundo tal y como lo ve el cliente: sólo lo que le ha llegado.
 *
 * Este módulo es la prueba de la separación de responsabilidades. No calcula nada
 * del juego —ni colisiones, ni visibilidad, ni alcance— porque no tiene con qué:
 * únicamente guarda lo que el motor le ha mandado y lo mantiene ordenado para
 * poder dibujarlo. Si el motor no manda un tile, aquí no existe.
 *
 * LO ÚNICO QUE SÍ CALCULA es la interpolación de las criaturas que se mueven, y no
 * es una excepción a la regla: el motor manda "esta criatura va de aquí a allá en
 * 550 ms", y convertir eso en una posición por fotograma es trabajo de dibujo. La
 * duración la pone el motor, que es lo importante.
 */

/*
 * El protocolo se importa con una ruta RELATIVA y no con `/shared/js/protocol.mjs`.
 *
 * Las dos funcionan en el navegador, pero sólo la relativa funciona además en Node, que
 * es donde corren las pruebas: una ruta que empieza por `/` es una ruta del MONTAJE del
 * servidor, y en el disco no significa nada. Importarlo así es lo que permite que la
 * prueba de extremo a extremo use ESTE archivo tal cual, sin copiarlo ni adaptarlo.
 *
 * Desde `client/avillatoro/js/`, tres niveles arriba es la raíz del proyecto, y de ahí
 * a `shared/js/protocol.mjs`. En el navegador, con la base `/avillatoro/js/`, los tres
 * `../` se salen de la raíz y quedan en `/shared/js/protocol.mjs`, que es exactamente
 * donde está montado.
 */
import {
    CREATURE_FIELD as F,
    TILE_FIELD as T,
    MOVE_FIELD as M,
    LOGIN_FIELD as L,
    UPDATE_FIELD as U,
    INVENTORY_FIELD as I
} from '../../../shared/js/protocol.mjs';

/**
 * Una criatura que se está moviendo.
 *
 * Guarda el trayecto y cuándo empezó, para poder preguntar dónde está "ahora". No
 * hay temporizador: se calcula al dibujar, así que no puede desincronizarse de la
 * pantalla.
 */
class MovingCreature {
    constructor(from, to, direction, durationMs, startedAt) {
        this.fromX = from.x;
        this.fromY = from.y;
        this.toX = to.x;
        this.toY = to.y;
        this.direction = direction;
        this.duration = Math.max(1, durationMs || 1);
        this.startedAt = startedAt;
    }

    /** Posición interpolada, o el destino si ya se acabó el tiempo. */
    positionAt(now, tileSize) {
        const elapsed = now - this.startedAt;

        if (elapsed >= this.duration) {
            return { x: this.toX, y: this.toY, done: true };
        }
        if (elapsed <= 0) {
            return { x: this.fromX, y: this.fromY, done: false };
        }

        const ratio = elapsed / this.duration;
        return {
            x: this.fromX + (this.toX - this.fromX) * ratio,
            y: this.fromY + (this.toY - this.fromY) * ratio,
            done: false
        };
    }
}

export class ClientWorld {
    constructor(options) {
        const opts = options || {};

        /** Reloj inyectable, para poder probar la interpolación sin esperar. */
        this.now = opts.now || (() => Date.now());

        /** tiles: "x,y,z" -> { ground, items, downCount, z } */
        this.tiles = new Map();

        /** creatures: id -> { id, name, x, y, z, direction, health, kind, moving } */
        this.creatures = new Map();

        this.playerId = null;
        this.player = null;

        /**
         * Lo que lleva encima, tal y como se lo ha dicho el motor.
         *
         * El cliente NO lleva la cuenta por su cuenta: recibe el inventario entero cada
         * vez que cambia. Calcularlo aquí a partir de lo que va recogiendo sería más
         * rápido y se desincronizaría en cuanto una operación fallara, que es
         * exactamente cuando el jugador más necesita saber qué tiene.
         */
        this.inventory = [];

        /** Cuántas veces ha muerto en esta sesión. */
        this.deaths = 0;

        /** El motivo del último rechazo de entrada, o null. */
        this.loginError = null;

        /** El mundo que declaró el motor en el saludo. */
        this.size = { width: 0, height: 0, floors: 16 };

        /** Lo que el motor ha dicho, para depurar y para la interfaz. */
        this.messages = [];
        this.texts = [];
        this.says = [];
        this.lastFloorChange = null;
    }

    static key(x, y, z) {
        return x + ',' + y + ',' + z;
    }

    getTile(x, y, z) {
        return this.tiles.get(ClientWorld.key(x, y, z)) || null;
    }

    // -----------------------------------------------------------------------
    // Aplicar lo que llega
    // -----------------------------------------------------------------------

    /**
     * Aplica los mensajes de un marco.
     *
     * Los mensajes llegan YA agrupados por el servidor y EN ORDEN, así que se
     * aplican en orden sin reordenar nada: el orden es información.
     *
     * @param {Array<Array>} messages
     * @param {Object} P la tabla de opcodes, que se le pasa para no duplicarla
     * @returns {{tiles: number, creatures: number, events: Array}}
     */
    apply(messages, P) {
        let tiles = 0;
        let creatures = 0;
        const events = [];
        const now = this.now();

        messages.forEach((message) => {
            const opcode = message[0];

            switch (opcode) {
                case P.SERVER.HELLO:
                    this.size = {
                        width: message[2] || 0,
                        height: message[3] || 0,
                        floors: message[4] || 16
                    };
                    events.push({ type: 'hello', size: this.size });
                    break;

                case P.SERVER.LOGIN_OK:
                    this.playerId = message[L.ID];
                    this.player = {
                        id: message[L.ID],
                        name: message[L.NAME],
                        x: message[L.X],
                        y: message[L.Y],
                        z: message[L.Z],
                        health: message[L.HEALTH],
                        maxHealth: message[L.MAX_HEALTH],
                        level: message[L.LEVEL],
                        experience: message[L.EXPERIENCE],
                        vocation: message[L.VOCATION]
                    };
                    events.push({ type: 'login', player: this.player });
                    break;

                case P.SERVER.LOGIN_ERROR:
                    // El motor dice POR QUE no se pudo entrar, y el cliente tiene que
                    // poder enseñarlo: una pantalla en negro sin explicación es lo
                    // peor que se le puede hacer a alguien que intenta entrar.
                    this.loginError = message[1];
                    events.push({ type: 'loginError', error: message[1] });
                    break;

                case P.SERVER.TILE_ADD:
                case P.SERVER.TILE_UPDATE:
                    this._setTile(message, now);
                    tiles += 1;
                    break;

                case P.SERVER.TILE_REMOVE:
                    this.tiles.delete(ClientWorld.key(message[1], message[2], message[3]));
                    tiles += 1;
                    break;

                case P.SERVER.CREATURE_ADD:
                    this._addCreature(message, now);
                    creatures += 1;
                    break;

                case P.SERVER.CREATURE_MOVE:
                    this._moveCreature(message, now);
                    creatures += 1;
                    break;

                case P.SERVER.CREATURE_REMOVE:
                    this.creatures.delete(message[1]);
                    creatures += 1;
                    break;

                case P.SERVER.CREATURE_UPDATE:
                    this._updateCreature(message);
                    break;

                case P.SERVER.CREATURE_SAY:
                    this.says.push({
                        creatureId: message[1],
                        name: message[2],
                        text: message[3]
                    });
                    events.push({ type: 'say', name: message[2], text: message[3] });
                    break;

                case P.SERVER.TEXT:
                    this.texts.push(message[2]);
                    events.push({ type: 'text', text: message[2] });
                    break;

                case P.SERVER.FLOOR_CHANGE:
                    // El motor avisa de que hay que olvidar todo lo anterior. Si no
                    // se hiciera, quedarían tiles de la planta vieja dibujándose
                    // encima de la nueva.
                    this.tiles.clear();
                    this.creatures.clear();
                    this.lastFloorChange = message[1];
                    events.push({ type: 'floorChange', z: message[1] });
                    break;

                case P.SERVER.INVENTORY: {
                    const count = message[I.COUNT];
                    const entries = [];

                    for (let index = 0; index < count; index += 1) {
                        const base = I.ENTRIES + index * I.STRIDE;
                        entries.push({
                            index: message[base],
                            typeId: message[base + 1],
                            count: message[base + 2],
                            name: message[base + 3]
                        });
                    }

                    this.inventory = entries;

                    // El peso viene en el mismo mensaje porque es la misma pregunta: lo que
                    // llevas y lo que puedes llevar. Se guarda crudo, en centésimas de onza,
                    // y se formatea al pintarlo: el motor manda números y el cliente los
                    // presenta.
                    this.weight = message[I.WEIGHT];
                    this.capacity = message[I.CAPACITY];

                    events.push({
                        type: 'inventory',
                        entries: entries,
                        weight: this.weight,
                        capacity: this.capacity
                    });
                    break;
                }

                case P.SERVER.PLAYER_DEATH:
                    this.deaths += 1;
                    events.push({
                        type: 'death',
                        killer: message[1],
                        dropped: message[2]
                    });
                    break;

                case P.SERVER.PLAYER_STATS:
                    if (this.player) {
                        this.player.health = message[1];
                        this.player.maxHealth = message[2];
                        this.player.level = message[3];
                        this.player.experience = message[4];
                    }
                    events.push({ type: 'stats' });
                    break;

                default:
                    // Un opcode que este cliente no conoce. No se rompe nada: se
                    // ignora. Es lo que permite que el motor añada mensajes sin
                    // obligar a actualizar todos los clientes a la vez.
                    break;
            }
        });

        return { tiles: tiles, creatures: creatures, events: events };
    }

    _setTile(message, now) {
        const x = message[T.X];
        const y = message[T.Y];
        const z = message[T.Z];
        const ground = message[T.GROUND];
        const downCount = message[T.DOWN_COUNT];
        const totalCount = message[T.ITEM_COUNT];

        const items = [];
        for (let index = 0; index < totalCount; index += 1) {
            const base = T.ITEMS + index * T.ITEM_STRIDE;
            items.push({
                id: message[base],
                count: message[base + 1],
                instanceId: message[base + 2]
            });
        }

        this.tiles.set(ClientWorld.key(x, y, z), {
            x: x, y: y, z: z,
            ground: ground,
            items: items,
            // El corte entre abajo y arriba, que es lo que permite meter a las
            // criaturas en medio al dibujar.
            downCount: downCount,
            updatedAt: now
        });
    }

    _addCreature(message, now) {
        const id = message[F.ID];

        const creature = {
            id: id,
            // El aspecto: qué sprites y de qué colores. El cliente los resuelve con su
            // paleta; el motor sólo manda los números.
            outfit: {
                lookType: message[F.LOOK_TYPE],
                head: message[F.HEAD],
                body: message[F.BODY],
                legs: message[F.LEGS],
                feet: message[F.FEET],
                addons: message[F.ADDONS]
            },
            name: message[F.NAME],
            x: message[F.X],
            y: message[F.Y],
            z: message[F.Z],
            direction: message[F.DIRECTION],
            health: message[F.HEALTH],
            kind: message[F.KIND],
            moving: null,
            isPlayer: id === this.playerId
        };

        // Si ya existía (el jugador se recibe a sí mismo y luego llega otra vez), se
        // conserva el movimiento en curso para no dar un salto.
        const previous = this.creatures.get(id);
        if (previous && previous.moving) {
            creature.moving = previous.moving;
        }

        this.creatures.set(id, creature);
    }

    _moveCreature(message, now) {
        const id = message[M.ID];
        const creature = this.creatures.get(id);

        const to = { x: message[M.TO_X], y: message[M.TO_Y], z: message[M.TO_Z] };
        const direction = message[M.DIRECTION];
        const duration = message[M.DURATION];

        if (!creature) {
            // Se movió una criatura que no conocíamos. Puede pasar si el mensaje de
            // aparición se perdió; se crea en el destino para no dejarla invisible.
            this.creatures.set(id, {
                id: id, name: '?', x: to.x, y: to.y, z: to.z,
                direction: direction, health: 100, kind: 0,
                outfit: null, moving: null, isPlayer: id === this.playerId
            });
            return;
        }

        // El origen lo dice el propio mensaje, y se usa ése y no la posición actual:
        // si el servidor va por delante, interpolar desde donde el cliente cree que
        // está produciría un salto.
        creature.moving = new MovingCreature(
            { x: message[M.FROM_X], y: message[M.FROM_Y] },
            to, direction, duration, now);

        creature.x = message[M.FROM_X];
        creature.y = message[M.FROM_Y];
        creature.z = message[M.TO_Z];
        creature.direction = direction;

        // El jugador propio se interpola IGUAL que los demás, y eso es una decisión
        // que se corrigió: al principio se colocaba de golpe, con el argumento de
        // que es el centro de la cámara. Es justo al revés. Si él salta, la cámara
        // salta con él y el mundo entero da un tirón de una casilla por paso; si se
        // desliza, el desplazamiento es continuo y el muñeco se queda centrado, que
        // es lo que hace Tibia.
        //
        // LO QUE FALTA AQUÍ es predicción: el cliente sólo empieza a andar cuando el
        // motor confirma, así que la respuesta al teclado tarda lo que tarde la ida
        // y vuelta. Con 20 ms no se nota; con 150 sí. La predicción consiste en
        // empezar el paso al pulsar y corregir cuando llegue la confirmación, y es
        // la siguiente mejora de esta capa.
    }

    _updateCreature(message) {
        const creature = this.creatures.get(message[U.ID]);
        if (!creature) {
            return;
        }
        creature.direction = message[U.DIRECTION];
        creature.health = message[U.HEALTH];
    }

    // -----------------------------------------------------------------------
    // Consultar
    // -----------------------------------------------------------------------

    /**
     * Avanza la interpolación: cierra los movimientos que ya terminaron.
     *
     * Es un paso EXPLÍCITO y no un efecto secundario de consultar la posición. Un
     * getter que muta es una trampa, y aquí se cayó en ella: la posición lógica de
     * una criatura sólo avanzaba si alguien había preguntado por ella, así que
     * dependía de que el renderer hubiera dibujado. En una prueba sin renderer, los
     * muñecos se quedaban a medio camino para siempre.
     *
     * @returns {number} cuántos movimientos se cerraron
     */
    update(now) {
        const at = now === undefined ? this.now() : now;
        let completed = 0;

        this.creatures.forEach((creature) => {
            if (!creature.moving) {
                return;
            }

            if (at - creature.moving.startedAt >= creature.moving.duration) {
                creature.x = creature.moving.toX;
                creature.y = creature.moving.toY;
                creature.moving = null;
                completed += 1;
            }
        });

        return completed;
    }

    /**
     * Posición de una criatura AHORA, interpolando si se está moviendo.
     *
     * Es una CONSULTA PURA: no cambia nada. Lo que haya que cerrar lo cierra
     * `update()`.
     */
    creaturePosition(creature, now) {
        if (!creature.moving) {
            return { x: creature.x, y: creature.y, moving: false };
        }

        const position = creature.moving.positionAt(
            now === undefined ? this.now() : now);

        return { x: position.x, y: position.y, moving: !position.done };
    }

    /** Las criaturas que hay en un tile, sin las que están de paso. */
    creaturesAt(x, y, z) {
        const found = [];
        this.creatures.forEach((creature) => {
            const position = this.creaturePosition(creature);
            const cx = Math.round(position.x);
            const cy = Math.round(position.y);
            if (cx === x && cy === y && creature.z === z) {
                found.push(creature);
            }
        });
        return found;
    }

    /**
     * Las plantas que el cliente puede dibujar, de la más profunda a la más alta.
     *
     * No se aplica ninguna regla de visibilidad: las plantas que aparecen son
     * exactamente las que el motor ha mandado. Si aquí saliera una planta que el
     * motor no envió, es que hay un tile suelto que habría que haber borrado.
     */
    floors() {
        const found = new Set();
        this.tiles.forEach((tile) => found.add(tile.z));
        this.creatures.forEach((creature) => found.add(creature.z));

        // De mayor z (más profunda) a menor (más alta): las de arriba se pintan
        // después, y por eso tapan a las de abajo. Es el orden de OTClient.
        return Array.from(found).sort((a, b) => b - a);
    }

    /** Cuánto se ha recibido, para la interfaz de diagnóstico. */
    stats() {
        return {
            tiles: this.tiles.size,
            creatures: this.creatures.size,
            floors: this.floors().length,
            texts: this.texts.length,
            says: this.says.length
        };
    }
}

export { MovingCreature };
