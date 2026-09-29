'use strict';

/**
 * World: el estado vivo y el bucle de simulación.
 *
 * Aquí es donde el motor pasa a ser **autoritativo**: el mundo decide si un paso
 * es válido, cuánto tarda, qué criatura ocupa qué tile y qué ocurre cuando algo
 * cambia. Los módulos de contenido no tocan nada de esto directamente; piden
 * cosas por la API y el mundo las valida.
 *
 * Sobre los tiles y las criaturas. Un tile guarda sus criaturas porque el apilado
 * las necesita: el cliente dibuja suelo, items de abajo, criaturas e items de
 * arriba, y ese orden no se puede reconstruir sin saber quién está en el tile. Por
 * eso crear una criatura **materializa** su tile, aunque el mapa fuera disperso.
 *
 * Eso tiene una consecuencia que conviene tener presente: un jugador que recorre
 * medio mapa va dejando tiles materializados detrás. Están vacíos y son idénticos
 * al suelo por defecto, así que `compact()` los devuelve al estado disperso. Sin
 * esa limpieza, el consumo crece con el tiempo de juego en vez de con el contenido
 * del mundo, que es justo lo que el almacenamiento disperso venía a evitar.
 */

const { Position, DIRECTIONS, directionFrom } = require('./position');
const { Item } = require('./item');
const { Player, Monster, DIRECTION, resetIdCounter } = require('./creature');
const { normalizeOutfit } = require('./outfit');

/** Desplazamiento por número de dirección de Tibia. */
const DIRECTION_DELTA = {
    [DIRECTION.NORTH]: { x: 0, y: -1, diagonal: false },
    [DIRECTION.EAST]: { x: 1, y: 0, diagonal: false },
    [DIRECTION.SOUTH]: { x: 0, y: 1, diagonal: false },
    [DIRECTION.WEST]: { x: -1, y: 0, diagonal: false }
};

/** Cada cuántos ticks se limpian los tiles que quedaron vacíos. */
const COMPACT_EVERY_TICKS = 600;   // a 20 Hz, cada 30 segundos

class World {
    constructor(options) {
        const opts = options || {};

        this.log = opts.logger || null;
        this.scheduler = opts.scheduler || null;
        this.now = opts.now || (() => Date.now());

        /** Contenido estático, lo rellena el motor. */
        this.itemTypes = new Map();
        this.monsterTypes = new Map();

        /**
         * Los aspectos que existen, cargados de `data/XML/outfits.xml`.
         *
         * El motor sólo necesita la LISTA: qué apariencias hay y cuáles tienen
         * añadidos. Los sprites y la paleta son del cliente.
         */
        this.outfitTypes = new Map();

        this.map = null;

        /** Estado vivo. */
        this.players = new Map();
        this.monsters = new Map();
        this.creatures = new Map();
        this.items = new Map();          // instanceId -> Item suelto en el suelo

        /**
         * Enganches con el resto del motor.
         *
         * Cada evento admite VARIOS suscriptores, no uno. Con una sola ranura, el
         * segundo sistema que quisiera enterarse de una muerte pisaría al primero
         * sin que nada avisara, y el fallo aparecería en el sistema que dejó de
         * funcionar, no en el que se suscribió. El gestor de spawns y, mañana, un
         * sistema de misiones o de logros quieren lo mismo.
         *
         * El mundo no conoce el registro de contenido: sólo avisa de lo que pasa y
         * quien esté suscrito decide. Sin esta separación, el mundo tendría que
         * saber qué es un `onStepIn`.
         */
        this.hooks = {
            onStepIn: [],            // (creature, tile, fromPosition)
            onStepOut: [],           // (creature, tile, toPosition)
            onCreatureAppear: [],    // (creature)
            onCreatureDisappear: [], // (creature)
            onMonsterDeath: [],      // (monster, killer)
            onTextMessage: [],       // (player, text) privado, para uno
            onCreatureSay: []        // (creature, text) en voz alta, para quien oiga
        };

        /** Registro para las pruebas y para depurar sin instrumentar. */
        this.messages = [];
        this.teleports = [];
        this.says = [];

        this.startTime = this.now();

        /** Bucle. */
        this.tickIntervalMs = opts.tickIntervalMs || 50;
        this.timer = null;
        this.tickCount = 0;
        this.compactCounter = 0;
    }

    // =======================================================================
    // Suscripción a eventos
    // =======================================================================

    /**
     * Suscribe un handler a un evento del mundo.
     *
     * @param {string} event uno de los nombres de `this.hooks`
     * @param {Function} handler
     * @returns {Function} función para desuscribirse
     */
    on(event, handler) {
        if (!this.hooks[event]) {
            this.hooks[event] = [];
        }
        this.hooks[event].push(handler);

        return () => {
            this.hooks[event] = this.hooks[event].filter((fn) => fn !== handler);
        };
    }

    /**
     * Avisa a los suscriptores de un evento.
     *
     * Es la contrapartida de `on`, y lo usan los sistemas del propio motor (el
     * combate avisa de una muerte, la IA de nada). Un suscriptor que falla no
     * impide a los demás, igual que en el planificador: si un sistema revienta,
     * los otros siguen funcionando. Es lo que se quiere en un servidor vivo.
     */
    emit(event, ...args) {
        const listeners = this.hooks[event];
        if (!listeners || listeners.length === 0) {
            return 0;
        }

        listeners.forEach((handler) => {
            try {
                handler(...args);
            } catch (error) {
                if (this.log) {
                    this.log.error('un suscriptor de ' + event + ' fallo:\n' +
                        (error && error.stack ? error.stack : error));
                }
            }
        });

        return listeners.length;
    }

    // =======================================================================
    // Jugadores
    // =======================================================================

    createPlayer(name, position) {
        const player = new Player({
            name: name,
            position: position,
            speed: 220,
            maxHealth: 150,
            level: 1,
            vocation: 'None'
        });

        this.players.set(player.id, player);
        this._registerCreature(player);
        return player;
    }

    getPlayer(id) {
        return this.players.get(Number(id)) || null;
    }

    removePlayer(id) {
        const player = this.players.get(Number(id));
        if (!player) {
            return false;
        }
        this.players.delete(player.id);
        this._unregisterCreature(player);
        return true;
    }

    // =======================================================================
    // Monstruos
    // =======================================================================

    /**
     * Crea un monstruo a partir de su TIPO.
     *
     * La definición no se copia: el monstruo la referencia. Copiarla parecería más
     * seguro, pero significaría que recargar el contenido en caliente no afecta a
     * los monstruos ya vivos, y que doscientos monstruos del mismo tipo ocupan
     * doscientas veces lo mismo.
     */
    createMonster(typeName, position, spawn) {
        const definition = this.monsterTypes.get(typeName);
        if (!definition) {
            if (this.log) {
                this.log.warning('no existe el tipo de monstruo "' + typeName + '"');
            }
            return null;
        }

        const monster = new Monster({
            name: typeName,
            position: position,
            speed: definition.speed === undefined ? 220 : definition.speed,
            maxHealth: definition.maxHealth || definition.health || 100,
            monsterType: definition,
            spawn: spawn || null
        });

        // El aspecto lo declara la definición del monstruo. Si no lo declara se queda
        // el genérico, y eso es visible a propósito: un monstruo sin aspecto propio se
        // ve como un jugador, y es la señal de que falta declararlo.
        if (definition.outfit) {
            monster.outfit = normalizeOutfit(definition.outfit);
        }

        this.monsters.set(monster.id, monster);
        this._registerCreature(monster);

        this.emit('onCreatureAppear', monster);
        return monster;
    }

    getMonster(id) {
        return this.monsters.get(Number(id)) || null;
    }

    /**
     * Quita un monstruo del mundo SIN considerarlo una muerte.
     *
     * Es para limpieza: recargar el contenido, vaciar una zona, apagar el
     * servidor. No dispara el enganche de muerte a propósito, porque si lo
     * hiciera, recargar el datapack haría reaparecer a todos los monstruos como si
     * los hubieran matado.
     */
    removeMonster(id) {
        const monster = this.monsters.get(Number(id));
        if (!monster) {
            return false;
        }

        this.monsters.delete(monster.id);
        this._unregisterCreature(monster);

        this.emit('onCreatureDisappear', monster);
        return true;
    }

    /**
     * Mata a un monstruo: lo quita del mundo y AVISA de la muerte.
     *
     * El aviso es lo que hace que el gestor de spawns programe la reaparición.
     * Está separado de `removeMonster` para que "morir" y "desaparecer" no sean
     * indistinguibles: son cosas distintas y el motor necesita poder hacer una sin
     * la otra.
     */
    killMonster(id, killer) {
        const monster = this.monsters.get(Number(id));
        if (!monster) {
            return false;
        }

        this.removeMonster(monster.id);

        this.emit('onMonsterDeath', monster, killer || null);
        return true;
    }

    // =======================================================================
    // Criaturas: registro común
    // =======================================================================

    _registerCreature(creature) {
        this.creatures.set(creature.id, creature);

        const tile = this.map ? this.map.getOrCreateTile(
            creature.position.x, creature.position.y, creature.position.z) : null;

        if (tile) {
            tile.addCreature(creature);
            creature.tile = tile;
        }
    }

    _unregisterCreature(creature) {
        this.creatures.delete(creature.id);

        if (creature.tile) {
            creature.tile.removeCreature(creature);
            creature.tile = null;
        }
    }

    getCreature(id) {
        return this.creatures.get(Number(id)) || null;
    }

    /**
     * ¿Hay alguna criatura en esa celda?
     *
     * Se consulta al tile y no a un índice aparte para que no puedan
     * desincronizarse: el tile ES el índice.
     */
    hasCreatureAt(x, y, z) {
        const tile = this.map ? this.map.getTile(x, y, z) : null;
        return !!(tile && tile.creatures.length > 0);
    }

    getCreaturesAt(x, y, z) {
        const tile = this.map ? this.map.getTile(x, y, z) : null;
        return tile ? tile.creatures.slice() : [];
    }

    // =======================================================================
    // Movimiento
    // =======================================================================

    /**
     * Normaliza lo que llega como "hacia dónde" a un desplazamiento.
     *
     * Se aceptan las dos formas porque las dos son naturales en sitios distintos:
     * el cliente envía un DESPLAZAMIENTO (noroeste es {-1,-1}), mientras que para
     * girar o mirar se usa una DIRECCIÓN cardinal. Aceptar sólo una obligaría a
     * convertir en cada llamante.
     *
     * Se normaliza con `sign` para que un desplazamiento de (3,0) sea el mismo que
     * (1,0): un paso es un paso, y validar la distancia es cosa de `map.canWalk`.
     *
     * @param {number|Object} input dirección 0..3, o `{x, y}`
     * @returns {{x: number, y: number, diagonal: boolean}|null}
     */
    _normalizeOffset(input) {
        let x = 0;
        let y = 0;

        if (typeof input === 'number') {
            const delta = DIRECTION_DELTA[input];
            if (!delta) {
                return null;
            }
            x = delta.x;
            y = delta.y;
        } else if (input && typeof input === 'object') {
            x = Math.sign(Number(input.x) || 0);
            y = Math.sign(Number(input.y) || 0);
        } else {
            return null;
        }

        if (x === 0 && y === 0) {
            return null;
        }

        return { x: x, y: y, diagonal: x !== 0 && y !== 0 };
    }

    /** ¿Puede esta criatura dar este paso? No lo da, sólo lo comprueba. */
    canWalk(creature, offsetInput) {
        const offset = this._normalizeOffset(offsetInput);
        if (!offset) {
            return { allowed: false, reason: 'badDirection' };
        }

        const from = creature.position;
        const to = {
            x: from.x + offset.x,
            y: from.y + offset.y,
            z: from.z
        };

        return this.map.canWalk(from, to);
    }

    /**
     * Mueve una criatura un paso.
     *
     * Devuelve un resultado explícito en vez de un booleano porque quien llama
     * necesita distinguir "no se puede" de "todavía no le toca": lo primero es un
     * rechazo, lo segundo es el ritmo normal del juego, y confundirlos hace que el
     * cliente muestre mensajes de error al caminar.
     *
     * @param {Creature} creature
     * @param {number|Object} offsetInput dirección 0..3 o desplazamiento `{x,y}`,
     *        cada componente en {-1, 0, 1}
     */
    moveCreature(creature, offsetInput) {
        const now = this.now();

        if (creature.removed) {
            return { moved: false, reason: 'removed' };
        }
        if (now < creature.nextStepAt) {
            return { moved: false, reason: 'exhausted', waitMs: creature.nextStepAt - now };
        }

        const offset = this._normalizeOffset(offsetInput);
        if (!offset) {
            return { moved: false, reason: 'badDirection' };
        }

        const from = creature.position.copy();
        const to = new Position(from.x + offset.x, from.y + offset.y, from.z);

        const check = this.map.canWalk(from, to);
        if (!check.allowed) {
            // Aun sin moverse, la criatura mira hacia donde intentaba ir: es lo
            // que hace Tibia y lo que espera cualquiera al chocar con una pared.
            creature.faceTowards(to);
            return { moved: false, reason: check.reason };
        }

        this._relocate(creature, to, offset);

        // El coste del paso lo pone el SUELO de destino, no el de origen: caminar
        // hacia un charco es más lento, y salir de él no.
        const ground = this.map.getGround(to.x, to.y, to.z);
        const groundSpeed = ground ? ground.getAttribute('groundSpeed') : undefined;

        creature.nextStepAt = now + creature.getStepDuration({
            groundSpeed: groundSpeed === undefined ? undefined : Number(groundSpeed),
            diagonal: offset.diagonal
        });

        /**
         * Cuanto duro este paso. El protocolo lo envia al cliente para que
         * interpole el desplazamiento durante exactamente ese tiempo: si el
         * cliente eligiera la duracion por su cuenta, el muneco iria a un ritmo
         * distinto del que el motor considera real y el desfase se veria en cada
         * paso.
         */
        creature.lastStepDuration = creature.nextStepAt - now;

        return {
            moved: true,
            from: from,
            to: to,
            diagonal: offset.diagonal,
            duration: creature.lastStepDuration,
            nextStepAt: creature.nextStepAt
        };
    }

    /**
     * Cambia de tile sin comprobar nada. Lo usan el movimiento y el teletransporte.
     *
     * @param {Object} [offset] desplazamiento, para poder orientar a la criatura
     */
    _relocate(creature, to, offset) {
        const fromTile = creature.tile;
        const fromPosition = creature.position.copy();

        if (fromTile) {
            fromTile.removeCreature(creature);
        }

        const toTile = this.map.getOrCreateTile(to.x, to.y, to.z);
        if (toTile) {
            toTile.addCreature(creature);
        }
        creature.tile = toTile;
        creature._applyPosition(to);

        // La orientación se toma del desplazamiento, no de comparar con el
        // destino: una vez aplicada la posición, la criatura y el destino son el
        // mismo punto y la comparación no encontraría desplazamiento alguno.
        if (offset) {
            creature.faceOffset(offset);
        }

        if (fromTile) {
            this.emit('onStepOut', creature, fromTile, to);
        }
        if (toTile) {
            this.emit('onStepIn', creature, toTile, fromPosition);
        }

        return to;
    }

    /**
     * Teletransporta sin comprobar el camino.
     *
     * En Tibia subir escaleras es esto: un teletransporte disfrazado, no un paso.
     * Por eso no pasa por `moveCreature` ni paga coste de movimiento.
     */
    teleportCreature(creature, position) {
        const target = Position.from(position);

        if (!this.map.inBounds(target.x, target.y, target.z)) {
            return { moved: false, reason: 'outOfBounds' };
        }

        const from = creature.position.copy();
        this._relocate(creature, target);

        // Un teletransporte no deja exhausto, pero sí reinicia el reloj del paso
        // a "ahora", para que no se pueda encadenar un paso inmediatamente
        // después aprovechando un contador viejo.
        creature.nextStepAt = this.now();

        /**
         * Y la duración del paso se pone a cero, porque un teletransporte NO se
         * anda. Sin esto, el cliente recibiría el salto con la duración del último
         * paso que dio la criatura y vería al muñeco deslizarse por media pantalla
         * durante medio segundo en vez de aparecer.
         */
        creature.lastStepDuration = 0;

        return { moved: true, from: from, to: target };
    }

    // =======================================================================
    // Items
    // =======================================================================

    /**
     * Crea una instancia de item y, si se le da posición, la pone en el suelo.
     */
    createItem(typeId, count, position) {
        const definition = this.itemTypes.get(Number(typeId));
        if (!definition) {
            if (this.log) {
                this.log.warning('createItem con un tipo desconocido: ' + typeId);
            }
            return null;
        }

        const item = new Item(definition, { count: count || 1 });
        item.instanceId = this._allocateItemId();
        this.items.set(item.instanceId, item);

        if (position) {
            this.addItemToTile(item, position);
        }
        return item;
    }

    _allocateItemId() {
        // Se reutiliza el contador de criaturas para que los identificadores de
        // instancia sean únicos en todo el mundo. Dos contadores distintos
        // acabarían chocando en el protocolo, que no distingue de qué tabla sale
        // cada id.
        const { allocateId } = require('./creature');
        return allocateId();
    }

    addItemToTile(item, position) {
        const target = Position.from(position);
        const tile = this.map.getOrCreateTile(target.x, target.y, target.z);
        if (!tile) {
            return false;
        }
        tile.addItem(item);
        return true;
    }

    removeItem(instanceId) {
        const item = this.items.get(Number(instanceId));
        if (!item) {
            return false;
        }

        // Quitarlo del tile es imprescindible: si sólo se borrara de la tabla,
        // seguiría dibujándose y bloqueando el paso, y el fallo aparecería mucho
        // después de su causa.
        if (item.position) {
            const tile = this.map.getTile(item.position.x, item.position.y, item.position.z);
            if (tile) {
                tile.removeItem(item);
            }
        }
        this.items.delete(item.instanceId);
        return true;
    }

    getItem(instanceId) {
        return this.items.get(Number(instanceId)) || null;
    }

    // =======================================================================
    // Efectos observables
    // =======================================================================

    /**
     * Un mensaje privado para un jugador.
     *
     * SE AVISA ADEMÁS DE APUNTARLO, y eso faltaba: durante mucho tiempo esto sólo
     * guardaba el texto en una lista interna para que las pruebas pudieran mirarla, y
     * **no llegaba nunca al cliente**. Todo lo que el contenido le decía a un jugador
     * —el resultado de un comando, el aviso de una misión— era invisible en el juego,
     * y las pruebas pasaban porque comprobaban la lista.
     *
     * Es el fallo más engañoso de todos los que han aparecido: la pieza funcionaba, la
     * prueba la verificaba, y el camino hasta el jugador no existía.
     */
    sendTextMessage(playerId, text) {
        const player = this.getPlayer(playerId);

        this.messages.push({
            playerId: Number(playerId),
            playerName: player ? player.name : null,
            text: text
        });

        this.emit('onTextMessage', player, String(text));
    }

    /**
     * Una criatura dice algo en voz alta.
     *
     * Se guarda aparte de los mensajes privados porque son cosas distintas: un
     * mensaje privado va a un jugador, y esto lo oye quien esté alrededor. Por eso lo
     * que se avisa es el HECHO de hablar, y quien lo escucha decide a quién le llega.
     *
     * Igual que con los mensajes privados, avisar es lo que hace que un monstruo pueda
     * hablar: el contenido llama aquí y el motor difunde, sin que el contenido sepa
     * nada del protocolo ni de qué jugadores hay cerca.
     */
    creatureSay(creatureId, text) {
        const creature = this.getCreature(creatureId);

        this.says.push({
            creatureId: Number(creatureId),
            creatureName: creature ? creature.name : null,
            text: text
        });

        if (creature) {
            this.emit('onCreatureSay', creature, String(text));
        }
    }

    teleportPlayer(playerId, x, y, z) {
        const player = this.getPlayer(playerId);
        if (!player) {
            return false;
        }
        const from = player.position.copy();
        const result = this.teleportCreature(player, { x: x, y: y, z: z });
        if (result.moved) {
            this.teleports.push({ playerId: player.id, from: from, to: result.to });
        }
        return result.moved;
    }

    getWorldTime() {
        return Math.floor((this.now() - this.startTime) / 1000);
    }

    // =======================================================================
    // Bucle de simulación
    // =======================================================================

    /**
     * Arranca el bucle. El intervalo es el presupuesto de simulación, no el de
     * red: el protocolo agrupa y envía por su cuenta.
     */
    start() {
        if (this.timer) {
            return false;
        }
        this.timer = setInterval(() => this.tick(), this.tickIntervalMs);

        // No bloquear el cierre del proceso por este temporizador.
        if (this.timer.unref) {
            this.timer.unref();
        }
        return true;
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        return true;
    }

    tick() {
        this.tickCount += 1;

        if (this.scheduler) {
            this.scheduler.tick(this.tickIntervalMs);
        }

        this.compactCounter += 1;
        if (this.compactCounter >= COMPACT_EVERY_TICKS && this.map) {
            this.compactCounter = 0;
            this.map.compact();
        }

        // El aviso de tick va AL FINAL: quien lo escuche (la capa de red) debe ver
        // el mundo ya simulado, no a medio simular. Enviar la vista antes de que
        // las criaturas se hayan movido mandaria el estado del tick anterior con
        // un tick de retraso.
        this.emit('onTick', this.tickCount);

        return this.tickCount;
    }

    // =======================================================================
    // Información
    // =======================================================================

    stats() {
        return {
            players: this.players.size,
            monsters: this.monsters.size,
            creatures: this.creatures.size,
            items: this.items.size,
            worldTime: this.getWorldTime(),
            ticks: this.tickCount,
            scheduled: this.scheduler ? this.scheduler.size : 0
        };
    }
}

module.exports = { World, DIRECTION_DELTA, COMPACT_EVERY_TICKS, resetIdCounter };
