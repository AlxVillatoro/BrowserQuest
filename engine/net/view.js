'use strict';

/**
 * Gestor de vista: qué ve cada jugador y qué hay que avisarle.
 *
 * Aquí vive la regla que hace que el cliente sea un terminal: **el cliente no
 * calcula qué se ve**. No sabe de plantas, ni de alcance, ni de qué tiles existen.
 * El motor calcula el área visible de cada jugador y le manda únicamente eso. Un
 * cliente modificado no puede ver más de lo que recibe, porque lo que no llega no
 * existe para él.
 *
 * CUATRO DECISIONES QUE IMPORTAN
 *
 * 1. VISIBILIDAD DE JUEGO Y DE DIBUJO SON COSAS DISTINTAS, y al principio las
 *    confundí. La regla de Tibia («la superficie ve toda la superficie y nada del
 *    subsuelo; el subsuelo ve dos plantas arriba y dos abajo») decide quién puede
 *    VER A QUIÉN para atacar o hablar. Pero mandar ocho plantas de superficie
 *    porque la regla las permite sería ocho veces el tráfico para dibujar una
 *    sola. Así que hay dos rangos: `canSee` para las criaturas, y un rango de
 *    DIBUJO mucho más corto para los tiles. Los tiles usan la intersección, para
 *    que un jugador en la calle no reciba el plano de la mazmorra: eso sería una
 *    fuga de información, no una optimización.
 *
 * 2. Las criaturas NO van dentro del tile. Un tile se serializa con su suelo y sus
 *    items, y las criaturas se siguen aparte. Si fueran dentro, cada paso de
 *    cualquier criatura obligaría a reenviar el tile entero a todos los que lo
 *    ven. Es también lo que hace Tibia: el mapa se describe una vez y los
 *    movimientos van sueltos.
 *
 * 3. El cliente dibuja los items EN EL ORDEN EN QUE LLEGAN. La serialización usa
 *    el orden de dibujo (suelo, items de abajo, items de arriba), no el de
 *    almacenamiento, así que el cliente no necesita conocer las bandas de apilado
 *    ni `FLAG_ALWAYSONTOP`: eso es una regla del mundo y se queda en el mundo.
 *
 * 4. Los tiles se recalculan SÓLO cuando el jugador se mueve. Un tile no cambia
 *    porque una criatura pase por encima (no están dentro), así que recalcular la
 *    vista veinte veces por segundo para descubrir que nada cambió es trabajo
 *    tirado. Las criaturas sí se revisan en cada actualización, porque se mueven.
 *
 * PENDIENTE, y conviene saberlo: al moverse se recalcula el rectángulo entero
 * aunque sólo entre y salga una franja de una casilla. Con pocos jugadores no se
 * nota; a partir de decenas habrá que pasar al diff por franjas. La estructura
 * está preparada (el diff es contra lo enviado, no contra el mundo), pero la
 * optimización no está hecha.
 */

const P = require('./protocol');

/** Tamaño del área visible, en tiles, alrededor del jugador. */
const DEFAULT_VIEW_WIDTH = 18;
const DEFAULT_VIEW_HEIGHT = 14;

/**
 * Plantas que se envían por debajo y por encima de la actual.
 *
 * Dos abajo es lo que hace falta para que se vea el fondo de un desnivel, y una
 * arriba para que el borde de un tejado no desaparezca al pasar por debajo. El
 * número exacto hay que ajustarlo cuando exista el renderer: enviar plantas que
 * nadie dibuja es puro desperdicio.
 */
const DEFAULT_FLOORS_BELOW = 2;
const DEFAULT_FLOORS_ABOVE = 1;

function key(x, y, z) {
    return x + ',' + y + ',' + z;
}

function parseKey(k) {
    const parts = k.split(',');
    return { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) };
}

class ViewManager {
    constructor(options) {
        const opts = options || {};

        this.world = opts.world;
        this.log = opts.logger || null;
        this.viewWidth = opts.viewWidth || DEFAULT_VIEW_WIDTH;
        this.viewHeight = opts.viewHeight || DEFAULT_VIEW_HEIGHT;
        this.floorsBelow = opts.floorsBelow === undefined ? DEFAULT_FLOORS_BELOW : opts.floorsBelow;
        this.floorsAbove = opts.floorsAbove === undefined ? DEFAULT_FLOORS_ABOVE : opts.floorsAbove;

        /**
         * Estado por jugador: lo último que se le ENVIÓ.
         *
         * Se guarda lo enviado y no lo que hay, porque el diff es contra lo que el
         * cliente cree tener. Comparar contra el mundo mandaría cambios que el
         * cliente ya tiene.
         */
        this.states = new Map();

        this.stats = { updates: 0, tileComputes: 0, tileAdds: 0, tileUpdates: 0,
            tileRemoves: 0, creatureAdds: 0, creatureMoves: 0, creatureRemoves: 0,
            creatureUpdates: 0, skipped: 0 };
    }

    addPlayer(playerId) {
        this.states.set(playerId, {
            tiles: new Map(),
            creatures: new Map(),
            z: null,
            lastX: null,
            lastY: null,
            dirty: true
        });
    }

    removePlayer(playerId) {
        this.states.delete(playerId);
    }

    /** Marca que algo del mundo cambió y hay que recalcular los tiles. */
    markDirty(playerId) {
        const state = this.states.get(playerId);
        if (state) {
            state.dirty = true;
        }
    }

    markAllDirty() {
        this.states.forEach((state) => { state.dirty = true; });
    }

    /** Las plantas que se ENVÍAN desde una posición, ya cruzadas con `canSee`. */
    visibleFloors(z) {
        const map = this.world.map;
        const floors = [];

        if (!map) {
            return floors;
        }

        const from = Math.max(0, z - this.floorsBelow);
        const to = Math.min(map.floors - 1, z + this.floorsAbove);

        for (let floor = from; floor <= to; floor += 1) {
            // La intersección con la visibilidad de JUEGO no es una optimización:
            // sin ella, un jugador en la calle recibiría el plano de la mazmorra.
            if (map.canSee(z, floor)) {
                floors.push(floor);
            }
        }

        return floors;
    }

    /**
     * Calcula los tiles visibles desde una posición.
     *
     * NO se excluye el tile que pisa el jugador. Excluirlo parecía una
     * optimización razonable («el cliente ya sabe dónde está») y era un error:
     * cuando el jugador se movía, el tile al que llegaba dejaba de estar excluido
     * y el de partida pasaba a estarlo, así que el cliente recibía un borrado del
     * suelo que estaba pisando. Además hace falta para dibujar el suelo bajo el
     * muñeco, que es justo lo que Tibia sí envía.
     *
     * @returns {Map<string, {serialized: string, data: Array}>}
     */
    computeView(center) {
        const map = this.world.map;
        const view = new Map();

        if (!map) {
            return view;
        }

        const halfWidth = Math.floor(this.viewWidth / 2);
        const halfHeight = Math.floor(this.viewHeight / 2);

        this.visibleFloors(center.z).forEach((z) => {
            for (let dy = -halfHeight; dy <= halfHeight; dy += 1) {
                for (let dx = -halfWidth; dx <= halfWidth; dx += 1) {
                    const x = center.x + dx;
                    const y = center.y + dy;

                    if (!map.inBounds(x, y, z)) {
                        continue;
                    }

                    const tile = map.getTile(x, y, z);
                    const ground = map.getGround(x, y, z);

                    // Sin suelo y sin tile es un agujero: no se envía.
                    if (!tile && !ground) {
                        continue;
                    }

                    this.stats.tileComputes += 1;

                    const data = P.describeTile(tile, ground);
                    const k = key(x, y, z);
                    view.set(k, {
                        serialized: k + '|' + data.join(','),
                        data: [x, y, z].concat(data)
                    });
                }
            }
        });

        return view;
    }

    /**
     * Las criaturas visibles desde una posición, con la regla de JUEGO.
     *
     * Se recorre la tabla de criaturas y se filtra. A la escala de este proyecto
     * es lo más simple y lo bastante rápido; con miles de criaturas haría falta un
     * índice espacial, y ese es el siguiente paso si el perfilado lo pide.
     */
    computeCreatures(center) {
        const map = this.world.map;
        const found = new Map();

        if (!map) {
            return found;
        }

        const halfWidth = Math.floor(this.viewWidth / 2);
        const halfHeight = Math.floor(this.viewHeight / 2);

        this.world.creatures.forEach((creature) => {
            const position = creature.position;

            if (!map.canSee(center.z, position.z)) {
                return;
            }
            if (Math.abs(position.x - center.x) > halfWidth ||
                Math.abs(position.y - center.y) > halfHeight) {
                return;
            }

            found.set(creature.id, creature);
        });

        return found;
    }

    /**
     * Compara lo que el jugador debería ver con lo que ya tiene y devuelve los
     * mensajes que hacen falta para ponerlo al día.
     *
     * @param {Creature} player
     * @returns {Array<Array>} mensajes listos para enviar
     */
    update(player) {
        const state = this.states.get(player.id);
        if (!state) {
            return [];
        }

        this.stats.updates += 1;

        const messages = [];
        const center = player.position;

        const moved = state.lastX !== center.x || state.lastY !== center.y;

        // --- Tiles ---
        // Sólo se recalculan si el jugador se movió o si algo del mundo cambió.
        // Un tile no cambia porque una criatura pase por encima, así que
        // recalcular veinte veces por segundo para descubrir que nada cambió es
        // trabajo tirado.
        const floorChanged = state.z !== null && state.z !== center.z;

        if (floorChanged) {
            // Sin esto habría que mandar un borrado por cada tile de la planta
            // anterior: cientos de mensajes para decir lo mismo.
            messages.push(P.message(P.SERVER.FLOOR_CHANGE, center.z));
            state.tiles.clear();
            state.creatures.clear();
        }

        if (moved || state.dirty || floorChanged || state.z === null) {
            const view = this.computeView(center);

            view.forEach((entry, k) => {
                const previous = state.tiles.get(k);

                if (previous === undefined) {
                    messages.push(P.message(P.SERVER.TILE_ADD, ...entry.data));
                    this.stats.tileAdds += 1;
                } else if (previous.serialized !== entry.serialized) {
                    messages.push(P.message(P.SERVER.TILE_UPDATE, ...entry.data));
                    this.stats.tileUpdates += 1;
                } else {
                    return;
                }

                state.tiles.set(k, entry);
            });

            state.tiles.forEach((entry, k) => {
                if (!view.has(k)) {
                    const position = parseKey(k);
                    messages.push(P.message(P.SERVER.TILE_REMOVE,
                        position.x, position.y, position.z));
                    state.tiles.delete(k);
                    this.stats.tileRemoves += 1;
                }
            });

            state.dirty = false;
        } else {
            this.stats.skipped += 1;
        }

        state.z = center.z;
        state.lastX = center.x;
        state.lastY = center.y;

        // --- Criaturas ---
        // Estas sí se revisan siempre: se mueven por su cuenta.
        const creatures = this.computeCreatures(center);

        creatures.forEach((creature, id) => {
            const serialized = P.describeCreature(creature).join(',');
            const previous = state.creatures.get(id);

            if (previous === undefined) {
                messages.push(P.message(P.SERVER.CREATURE_ADD,
                    ...P.describeCreature(creature)));
                this.stats.creatureAdds += 1;
            } else if (previous.x !== creature.position.x ||
                       previous.y !== creature.position.y ||
                       previous.z !== creature.position.z) {
                // La duración del paso va en el mensaje: es lo que permite al
                // cliente interpolar durante exactamente el tiempo que el motor
                // calculó, y no a un ritmo inventado por el cliente.
                messages.push(P.message(P.SERVER.CREATURE_MOVE,
                    id,
                    previous.x, previous.y, previous.z,
                    creature.position.x, creature.position.y, creature.position.z,
                    creature.direction,
                    creature.lastStepDuration || 0));
                this.stats.creatureMoves += 1;
            } else if (previous.serialized !== serialized) {
                messages.push(P.message(P.SERVER.CREATURE_UPDATE,
                    id, creature.direction, P.healthPercent(creature)));
                this.stats.creatureUpdates += 1;
            } else {
                return;
            }

            state.creatures.set(id, {
                serialized: serialized,
                x: creature.position.x,
                y: creature.position.y,
                z: creature.position.z,
                direction: creature.direction,
                health: P.healthPercent(creature)
            });
        });

        state.creatures.forEach((entry, id) => {
            if (!creatures.has(id)) {
                messages.push(P.message(P.SERVER.CREATURE_REMOVE, id));
                state.creatures.delete(id);
                this.stats.creatureRemoves += 1;
            }
        });

        return messages;
    }

    /** Mensaje de bienvenida: los datos del jugador y su posición. */
    loginMessages(player) {
        const messages = [
            P.message(P.SERVER.HELLO, P.PROTOCOL_VERSION,
                this.world.map ? this.world.map.width : 0,
                this.world.map ? this.world.map.height : 0,
                this.world.map ? this.world.map.floors : 0),
            P.message(P.SERVER.LOGIN_OK,
                player.id, player.name,
                player.position.x, player.position.y, player.position.z,
                player.health, player.maxHealth,
                player.level, player.experience || 0,
                player.vocation || 'None')
        ];

        // El inventario va con la bienvenida: un jugador que vuelve tiene que ver lo que
        // llevaba ANTES de que pase nada, y si se mandara sólo al cambiar no lo vería
        // hasta tocar algo.
        const entries = this.world.inventoryOf(player)
            .map((entry) => [entry.index, entry.typeId, entry.count, entry.name]);

        messages.push(P.message(P.SERVER.INVENTORY, entries.length,
            ...entries.reduce((flat, entry) => flat.concat(entry), [])));

        return messages;
    }

    /** El movimiento de una criatura, para enviarlo con su duración. */
    moveMessage(creature, from, to) {
        return P.message(P.SERVER.CREATURE_MOVE,
            creature.id,
            from.x, from.y, from.z,
            to.x, to.y, to.z,
            creature.direction,
            creature.lastStepDuration || 0);
    }

    /**
     * Anota que un movimiento YA se envió por otro camino.
     *
     * Es lo que evita que el jugador reciba su propio paso dos veces: la sesión se
     * lo manda al instante (para no añadirle un tick de retraso justo donde más se
     * nota) y a continuación lo apunta aquí, de modo que el diff del siguiente
     * tick ve la posición ya actualizada y no lo repite.
     *
     * El cliente SÍ recibe su propia criatura: necesita saber que existe para
     * dibujarse y para las barras de estado.
     */
    noteMoved(creature) {
        const state = this.states.get(creature.id);
        if (!state) {
            return false;
        }

        const entry = state.creatures.get(creature.id);
        if (!entry) {
            return false;
        }

        entry.x = creature.position.x;
        entry.y = creature.position.y;
        entry.z = creature.position.z;
        entry.direction = creature.direction;
        entry.serialized = P.describeCreature(creature).join(',');
        return true;
    }

    snapshot(playerId) {
        const state = this.states.get(playerId);
        if (!state) {
            return null;
        }
        return {
            tiles: state.tiles.size,
            creatures: state.creatures.size,
            z: state.z,
            at: state.lastX + ',' + state.lastY
        };
    }
}

module.exports = {
    ViewManager,
    DEFAULT_VIEW_WIDTH,
    DEFAULT_VIEW_HEIGHT,
    DEFAULT_FLOORS_BELOW,
    DEFAULT_FLOORS_ABOVE,
    key,
    parseKey
};
