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
const { UNITS_PER_OUNCE } = require('./weight');
const { Item } = require('./item');
const { Player, Monster, DIRECTION, resetIdCounter } = require('./creature');
const { createNpc } = require('./npc');
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

        /** Los diálogos de NPC, por nombre. Los rellena el registro. */
        this.npcTypes = new Map();

        /** Los NPC vivos, por nombre, para poder encontrarlos sin recorrer el mundo. */
        this.npcs = new Map();

        /**
         * Qué objeto hace de dinero.
         *
         * Es configurable y no una constante porque el día que un datapack use otra moneda
         * —o varias— no debería haber que tocar el motor. El valor por defecto es el de
         * Tibia: 3031, la moneda de oro.
         */
        this.moneyItemId = 3031;

        /**
         * Lo que puede cargar cualquier criatura antes de contar su vocación.
         *
         * Son 4 onzas en las unidades de Tibia (centésimas de onza). El número es el suyo:
         * con él, un personaje de nivel 1 carga 4,05 oz si es mago y 4,25 si es caballero, y
         * las diferencias entre vocaciones sólo se notan al subir de nivel, que es cuando
         * tienen que notarse.
         */
        this.baseCapacityOz = 400;

        /** Las vocaciones, para saber cuánta capacidad gana cada nivel. Las pone el motor. */
        this.vocations = null;

        /** Lo que gana por nivel una criatura sin vocacion conocida. */
        this.defaultGainCap = 5;

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
            onPlayerDeath: [],       // (player, killer, dropped)
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

        /*
         * Se avisa de que la casilla cambió.
         *
         * Sin esto, un objeto creado por contenido —el botín de un monstruo, lo que crea
         * `/item`— existe en el motor y NO en la pantalla del jugador hasta que se mueve. El
         * motor está bien y el cliente miente, que es la peor combinación porque ninguna
         * prueba del motor lo ve: es el mismo fallo que el de recoger y soltar, por el otro
         * lado.
         */
        this.emit('onTileChanged', target, tile);

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

        // Y se avisa, por lo mismo que al ponerlo: quitarlo del motor no lo quita de la
        // pantalla. Va DESPUÉS de sacarlo de la tabla, para que quien escuche y mire el mundo
        // lo encuentre ya coherente y no a medias.
        this.emit('onTileChanged', item.position, null);

        return true;
    }

    getItem(instanceId) {
        return this.items.get(Number(instanceId)) || null;
    }

    // =======================================================================
    // El inventario
    // =======================================================================

    /**
     * Recoge el objeto que hay encima de una casilla.
     *
     * SÓLO SE PUEDE COGER EL DE MÁS ARRIBA, y si no se puede coger, no se coge nada. Es
     * la regla de Tibia y tiene una consecuencia que sorprende hasta que se entiende: una
     * moneda debajo de una mesa NO se puede recoger, porque la mesa está por encima. Hay
     * que quitar la mesa primero. Permitir coger de en medio sería más cómodo y rompería
     * la única razón por la que el apilado importa para algo que no sea dibujar.
     *
     * @returns {{ok: boolean, reason?: string, item?: Object, stacked?: boolean}}
     */
    pickUpItem(creature, x, y, z) {
        if (!this.map) {
            return { ok: false, reason: 'noMap' };
        }

        /*
         * LA DISTANCIA SE COMPRUEBA ANTES QUE EL TILE, y el orden importa para el
         * mensaje: si se mira primero el tile, recoger de la otra punta del mapa dice
         * "aquí no hay nada", que es cierto y no explica nada. Sin esta comprobación,
         * además, se podría recoger del otro lado del mapa mandando coordenadas, que es
         * la clase de agujero que un cliente modificado encuentra el primer día.
         */
        const distance = Math.max(
            Math.abs(creature.position.x - Number(x)),
            Math.abs(creature.position.y - Number(y)));

        if (creature.position.z !== Number(z) || distance > 1) {
            return { ok: false, reason: 'tooFar' };
        }

        const tile = this.map.getTile(Number(x), Number(y), Number(z));
        if (!tile) {
            return { ok: false, reason: 'emptyTile' };
        }

        const stack = tile.getItems();
        const top = stack[stack.length - 1];

        /*
         * Si lo de más arriba es el SUELO, la casilla está vacía a efectos de recoger.
         *
         * El suelo es un objeto más de la pila, así que sin esta comprobación el motivo
         * sería "no se puede coger", que es verdad y es inútil: lo que quiere saber quien
         * lo intenta es que ahí no hay nada. Decir el motivo de verdad es la diferencia
         * entre un mensaje que orienta y uno que confunde.
         */
        if (!top || top === tile.ground) {
            return { ok: false, reason: 'emptyTile' };
        }
        if (!top.hasFlag('pickupable')) {
            return { ok: false, reason: 'notPickupable' };
        }

        /*
         * ¿CABE?
         *
         * Se comprueba ANTES de tocar el inventario, igual que en el comercio: si se metiera
         * y luego se deshiciera, un fallo a mitad dejaría el objeto en los dos sitios o en
         * ninguno. Preguntar antes es más simple y no puede quedar a medias.
         *
         * El peso se devuelve en el motivo para que el mensaje pueda decir CUÁNTO sobra, que
         * es lo que el jugador necesita para decidir qué soltar.
         */
        const weight = this.weightOfItem(top.typeId, top.count);

        if (!this.canCarry(creature, weight)) {
            return {
                ok: false,
                reason: 'tooHeavy',
                weight: weight,
                free: this.capacityOf(creature) - this.weightOf(creature)
            };
        }

        if (!(creature.inventory instanceof Array)) {
            creature.inventory = [];
        }

        /*
         * Si el objeto se apila y ya hay uno igual, se suma a su cantidad.
         *
         * Es lo que espera cualquiera: cien monedas recogidas de una en una tienen que
         * acabar siendo UNA entrada de cien, no cien entradas de una. También es lo que
         * hace que el inventario no crezca sin límite al matar monstruos.
         *
         * PENDIENTE: el tope por pila (en Tibia, 100 monedas) necesita un `maxCount` en la
         * definición del objeto, que `items.xml` todavía no declara.
         */
        let stacked = false;

        if (top.hasFlag('stackable')) {
            const existing = creature.inventory.find((entry) =>
                entry.typeId === top.typeId && entry.slot === 'backpack');

            if (existing) {
                existing.count += Math.max(1, top.count);
                stacked = true;
            }
        }

        if (!stacked) {
            creature.inventory.push({
                slot: 'backpack',
                position: creature.inventory.length,
                typeId: top.typeId,
                count: Math.max(1, top.count),
                attributes: top.attributes && Object.keys(top.attributes).length > 0
                    ? { ...top.attributes }
                    : null
            });
        }

        // Se quita del tile Y de la tabla de objetos sueltos, si estaba en ella. Las dos
        // cosas son necesarias: el tile es lo que se dibuja y lo que bloquea el paso, y la
        // tabla es lo que permite encontrar el objeto por su identificador. Quitar sólo una
        // deja el objeto en el sitio equivocado.
        tile.removeItem(top);

        if (top.instanceId && this.items.has(top.instanceId)) {
            this.items.delete(top.instanceId);
        }

        return { ok: true, item: top, stacked: stacked };
    }

    /**
     * Suelta un objeto del inventario en la casilla donde está la criatura.
     *
     * @param {Creature} creature
     * @param {number} index posición en el inventario
     * @returns {{ok: boolean, reason?: string, item?: Object}}
     */
    dropItem(creature, index) {
        const inventory = creature.inventory;
        const slot = Number(index);

        if (!(inventory instanceof Array) || slot < 0 || slot >= inventory.length) {
            return { ok: false, reason: 'badSlot' };
        }

        const entry = inventory[slot];
        const definition = this.itemTypes.get(entry.typeId);

        if (!definition) {
            return { ok: false, reason: 'unknownItem' };
        }

        const item = new Item(definition, {
            count: entry.count,
            attributes: entry.attributes || null
        });
        item.instanceId = this._allocateItemId();
        this.items.set(item.instanceId, item);

        if (!this.addItemToTile(item, creature.position)) {
            // Si no se pudo poner en el suelo, se deshace todo: dejar el objeto en la
            // tabla sin tile sería un objeto invisible que nadie puede recoger.
            this.items.delete(item.instanceId);
            return { ok: false, reason: 'noTile' };
        }

        inventory.splice(slot, 1);
        this._reindexInventory(inventory);

        return { ok: true, item: item };
    }

    /**
     * Renumera las posiciones del inventario.
     *
     * Se hace al quitar algo para que las posiciones sigan siendo correlativas. Si no,
     * al soltar el objeto 2 de 5 quedaría un hueco, y el `/soltar 3` del jugador
     * apuntaría a un sitio distinto del que ve.
     */
    _reindexInventory(inventory) {
        inventory.forEach((entry, index) => {
            entry.position = index;
        });
        return inventory;
    }

    /** Crea un NPC y lo coloca en el mundo. */
    createNpc(definition, position) {
        const npc = createNpc(definition, Position.from(position));

        npc.outfit = normalizeOutfit(definition.outfit);

        // El diálogo se le engancha AQUÍ y no en el constructor: el módulo de contenido
        // puede recargarse, y entonces hay que volver a engancharlo. Si viviera dentro
        // del NPC, recargar el contenido dejaría a los NPC con el diálogo viejo.
        this.attachDialogue(npc, definition.name);

        this.creatures.set(npc.id, npc);
        this.npcs.set(npc.name, npc);
        this._registerCreature(npc);

        // Lo que diga el NPC sale al mundo en el momento, por el mismo camino que el habla
        // de un jugador. Así el cliente no necesita saber que existe algo llamado NPC: ve
        // una criatura que habla, que es exactamente lo que es.
        npc.onSayLine = (text) => this.creatureSay(npc.id, text);

        /**
         * El comercio, del lado del NPC.
         *
         * Se engancha aquí y no en la clase `Npc` para que la clase siga sin conocer el
         * mundo: un NPC sabe a quién tiene delante y qué dice, y no cómo se mueven los
         * objetos entre inventarios. El día que el comercio cambie —precios por reputación,
         * impuestos, trueques— se cambia en un sitio y la clase no se entera.
         *
         * El jugador que llega puede ser un envoltorio de contenido, así que se traduce a
         * la criatura de verdad antes de operar.
         */
        npc.shopList = () => this.npcShopList(npc);

        /**
         * Con qué se envuelve a quien le habla.
         *
         * Lo pone el registro al arrancar, porque el envoltorio vive en la capa de
         * contenido y el mundo no la conoce. Si nadie lo pone, el diálogo recibe la
         * criatura tal cual y sigue funcionando; lo que se pierde es la protección, no la
         * funcionalidad.
         */
        if (this.wrapForContent) {
            npc.wrapSpeaker = this.wrapForContent;
        }

        npc.buyFor = (playerWrapper, words) => {
            const player = this._unwrapPlayer(playerWrapper);
            if (!player) {
                return { ok: false, reason: 'noPlayer' };
            }

            const offer = this.npcOfferFromWords(npc, words, 'buy');
            if (!offer) {
                return { ok: false, reason: 'notSold' };
            }

            const result = this.buyFromNpc(player, npc, offer.typeId, 1);
            result.offer = result.offer || offer;
            return result;
        };

        npc.sellFor = (playerWrapper, words) => {
            const player = this._unwrapPlayer(playerWrapper);
            if (!player) {
                return { ok: false, reason: 'noPlayer' };
            }

            const offer = this.npcOfferFromWords(npc, words, 'sell');
            if (!offer) {
                return { ok: false, reason: 'notBought' };
            }

            const result = this.sellToNpc(player, npc, offer.typeId, 1);
            result.offer = result.offer || offer;
            return result;
        };

        return npc;
    }

    /**
     * Del envoltorio de contenido a la criatura de verdad.
     *
     * El contenido recibe envoltorios —para que no pueda tocar el mundo a mano— y el
     * comercio necesita la criatura. La traducción se hace en un solo sitio en vez de que
     * cada método acepte las dos formas, que es como se acaba con la mitad de los métodos
     * aceptando una y la otra mitad la otra.
     */
    _unwrapPlayer(candidate) {
        if (!candidate) {
            return null;
        }

        /*
         * SE RESUELVE POR `id`, y no preguntando si es un jugador.
         *
         * La primera versión preguntaba `candidate.isPlayer()` y el ENVOLTORIO también
         * responde que sí —delega en la criatura, que es justo lo que debe hacer—, así que
         * devolvía el envoltorio y el comercio contaba el inventario del envoltorio, que no
         * existe: siempre cero monedas.
         *
         * El identificador lo tienen los dos y el mundo sabe traducirlo, así que es la
         * pregunta que no se puede contestar mal. Es el mismo error que el `undefined !==
         * null` del generador de apariciones: comprobar una propiedad que las dos cosas
         * comparten no distingue nada.
         */
        if (candidate.id !== undefined) {
            const resolved = this.getPlayer(candidate.id);
            if (resolved) {
                return resolved;
            }
        }

        // Si no está en el mundo, se acepta sólo si tiene posición, que es lo que
        // distingue a una criatura de verdad de un envoltorio.
        return (candidate.isPlayer && candidate.isPlayer() && candidate.position)
            ? candidate
            : null;
    }

    /**
     * Engancha a un NPC el diálogo registrado con su nombre.
     *
     * Es lo que hace que recargar el contenido cambie lo que dicen los NPC que ya están
     * en el mundo, sin tener que reiniciar ni volver a colocarlos.
     */
    attachDialogue(npc, name) {
        const dialogue = this.npcTypes.get(String(name));

        // Se limpia siempre antes: si el diálogo nuevo tiene menos palabras clave que el
        // viejo, sin esto sobrevivirían las que ya no existen.
        npc.keywords = [];
        npc.defaultHandler = null;

        if (!dialogue) {
            return false;
        }

        (dialogue.keywords || []).forEach((entry) => {
            npc.addKeyword(entry.words, entry.say, {
                greeting: entry.greeting,
                farewell: entry.farewell
            });
        });

        if (typeof dialogue.default === 'function') {
            npc.setDefault(dialogue.default);
        }

        npc.dialogue = dialogue;
        npc.onThink = typeof dialogue.onThink === 'function' ? dialogue.onThink : null;

        return true;
    }

    /** Vuelve a enganchar el diálogo a todos los NPC vivos. Tras recargar el contenido. */
    refreshDialogues() {        let count = 0;
        this.npcs.forEach((npc) => {
            if (this.attachDialogue(npc, npc.name)) {
                count += 1;
            }
        });
        return count;
    }

    getNpc(name) {
        return this.npcs.get(String(name)) || null;
    }

    /**
     * Reparte lo que alguien ha dicho entre los NPC que puedan oírlo.
     *
     * Recorre TODOS los NPC y deja que cada uno decida si le oye, en vez de calcular
     * distancias aquí. La razón es que "oír" es una regla del NPC —tiene radio, y podría
     * depender de si está dormido o enfadado— y repartirla entre dos sitios acaba con la
     * regla escrita dos veces y distinta.
     */
    npcsHear(speaker, text, now) {
        const replies = [];

        this.npcs.forEach((npc) => {
            const result = npc.hear(speaker, text, now);
            if (result.replied) {
                replies.push({ npc: npc, result: result });
            }
        });

        return replies;
    }

    // =======================================================================
    // El dinero y el comercio
    // =======================================================================

    /**
     * Cuánto dinero lleva encima.
     *
     * Se cuenta sumando las pilas en vez de guardar un saldo aparte. Un saldo sería más
     * rápido y crearía una segunda fuente de verdad: el día que un objeto de dinero se
     * cayera al suelo o se recogiera por otro camino, el saldo y lo que lleva encima
     * dirían cosas distintas y no habría forma de saber cuál es la buena.
     */
    countMoney(creature) {
        const moneyId = this.moneyItemId;

        return (creature.inventory instanceof Array ? creature.inventory : [])
            .filter((entry) => entry.typeId === moneyId)
            .reduce((total, entry) => total + entry.count, 0);
    }

    /** ¿Puede pagar esto? NO toca nada: sólo mira. */
    canPayMoney(creature, amount) {
        return this.countMoney(creature) >= Number(amount);
    }

    /**
     * Mete objetos en el inventario, apilando si ya hay.
     *
     * @returns {number} cuántas pilas nuevas hizo falta crear
     */
    giveItem(creature, typeId, count) {
        const id = Number(typeId);
        const amount = Math.max(1, Number(count) || 1);

        if (!(creature.inventory instanceof Array)) {
            creature.inventory = [];
        }

        const definition = this.itemTypes.get(id);

        if (definition && definition.attributes && definition.attributes.stackable) {
            const existing = creature.inventory.find((entry) => entry.typeId === id);

            if (existing) {
                existing.count += amount;
                return 0;
            }
        }

        creature.inventory.push({
            slot: 'backpack',
            position: creature.inventory.length,
            typeId: id,
            count: amount,
            attributes: null
        });

        return 1;
    }

    /**
     * Saca objetos del inventario.
     *
     * @returns {number} cuántos quitó de verdad
     *
     * SE QUITA DE LA ÚLTIMA PILA HACIA LA PRIMERA, y da igual cuál sea, porque el dinero
     * es fungible: da lo mismo de qué pila salen las monedas. Lo que sí importa es que
     * devuelva CUÁNTOS quitó, porque quien llama tiene que poder comprobar que sacó todo
     * lo que quería antes de dar nada a cambio.
     */
    takeItem(creature, typeId, count) {
        const id = Number(typeId);
        let remaining = Math.max(0, Number(count) || 0);
        let taken = 0;

        if (!(creature.inventory instanceof Array)) {
            return 0;
        }

        for (let index = creature.inventory.length - 1; index >= 0 && remaining > 0;
            index -= 1) {

            const entry = creature.inventory[index];
            if (entry.typeId !== id) {
                continue;
            }

            const used = Math.min(entry.count, remaining);
            entry.count -= used;
            remaining -= used;
            taken += used;

            if (entry.count <= 0) {
                creature.inventory.splice(index, 1);
            }
        }

        this._reindexInventory(creature.inventory);

        return taken;
    }

    /**
     * Busca en la tienda de un NPC lo que ofrece para un objeto.
     *
     * @param {Npc} npc
     * @param {number} typeId
     * @param {'buy'|'sell'} mode desde el punto de vista del JUGADOR
     */
    npcOffer(npc, typeId, mode) {
        const shop = npc && npc.dialogue && npc.dialogue.shop;

        if (!shop || !(shop.items instanceof Array)) {
            return null;
        }

        const id = Number(typeId);
        const offer = shop.items.find((entry) => Number(entry.id) === id);

        if (!offer) {
            return null;
        }

        const price = mode === 'buy' ? offer.buy : offer.sell;

        // Un precio ausente significa que el NPC NO hace esa operación. Un 0 sería
        // "gratis" o "no lo quiero", que son cosas distintas de "no lo vendo", y
        // confundirlas regalaría objetos.
        if (price === undefined || price === null || Number(price) <= 0) {
            return null;
        }

        return {
            typeId: id,
            price: Number(price),
            name: offer.name || (this.itemTypes.get(id)
                ? this.itemTypes.get(id).name
                : 'objeto ' + id)
        };
    }

    /** Lo que un NPC tiene a la venta, para poder listarlo. */
    npcShopList(npc) {
        const shop = npc && npc.dialogue && npc.dialogue.shop;
        if (!shop || !(shop.items instanceof Array)) {
            return [];
        }

        return shop.items.map((entry) => ({
            typeId: Number(entry.id),
            buy: entry.buy === undefined ? null : Number(entry.buy),
            sell: entry.sell === undefined ? null : Number(entry.sell),
            name: entry.name || (this.itemTypes.get(Number(entry.id))
                ? this.itemTypes.get(Number(entry.id)).name
                : 'objeto ' + entry.id)
        }));
    }

    /**
     * Encuentra en la tienda lo que el jugador ha nombrado.
     *
     * Un jugador escribe "comprar espada" y no "comprar 2400", así que hay que reconocer
     * el nombre. Se busca la frase COMPLETA primero —"magic sword" antes que "sword"— y si
     * no, palabra por palabra, porque si no, quien escriba "comprar sword" se llevaría el
     * primer objeto que contenga esa palabra y no el que quería.
     *
     * @returns {Object|null} la oferta, ya con su precio
     */
    npcOfferFromWords(npc, words, mode) {
        const list = Array.isArray(words) ? words : [];
        if (list.length === 0) {
            return null;
        }

        const sentence = ' ' + list.join(' ') + ' ';
        const shop = this.npcShopList(npc);

        /**
         * Cada entrada se puede llamar de DOS maneras, y hay que aceptar las dos.
         *
         * El nombre canónico es el de `items.xml` —"magic sword", que es el de Tibia— y el
         * del mercader es el que le ponga la tienda. Un jugador que escribe "espada"
         * espera que le entiendan, y uno que escribe "magic sword" también. Quedarse con
         * uno de los dos obliga a adivinar cuál, que es lo peor de las dos opciones.
         */
        const candidates = shop.map((entry) => {
            const canonical = this.itemTypes.get(entry.typeId);
            return {
                typeId: entry.typeId,
                buy: entry.buy,
                sell: entry.sell,
                names: canonical && canonical.name !== entry.name
                    ? [entry.name, canonical.name]
                    : [entry.name]
            };
        });

        const sellable = candidates.filter((entry) =>
            mode === 'buy' ? entry.buy > 0 : entry.sell > 0);

        const flatten = (entry) => entry.names.join(' ').toLowerCase();

        // Primero el nombre entero dentro de la frase.
        const whole = sellable
            .filter((entry) => entry.names.some((name) =>
                sentence.indexOf(' ' + name.toLowerCase() + ' ') !== -1))
            .sort((a, b) => flatten(b).length - flatten(a).length)[0];

        if (whole) {
            return this.npcOffer(npc, whole.typeId, mode);
        }

        // Y si no, la palabra más LARGA que aparezca, que es la que más probablemente
        // sea el nombre del objeto y no un artículo.
        const single = sellable
            .filter((entry) => list.some((word) => entry.names.some((name) =>
                name.toLowerCase().split(' ').indexOf(word) !== -1)))
            .sort((a, b) => flatten(b).length - flatten(a).length)[0];

        return single ? this.npcOffer(npc, single.typeId, mode) : null;
    }

    /**
     * Comprar a un NPC.
     *
     * LO PRIMERO ES COMPROBAR TODO, Y SÓLO DESPUÉS SE TOCA ALGO.
     *
     * Una compra a medias —el dinero cobrado y el objeto no entregado, o al revés— es el
     * peor fallo posible en un comercio, porque el jugador pierde algo y no hay forma de
     * deshacerlo. Por eso aquí no se paga hasta que está comprobado que se puede pagar Y
     * que el objeto existe: las dos condiciones se miran antes de la primera escritura.
     */
    buyFromNpc(player, npc, typeId, count) {
        const amount = Math.max(1, Number(count) || 1);
        const offer = this.npcOffer(npc, typeId, 'buy');

        if (!offer) {
            return { ok: false, reason: 'notSold' };
        }
        if (!this.itemTypes.has(offer.typeId)) {
            // La tienda ofrece algo que no está definido. Es un fallo del contenido y se
            // dice, en vez de entregar un objeto que no existe y romper el inventario.
            return { ok: false, reason: 'unknownItem' };
        }

        const total = offer.price * amount;

        if (!this.canPayMoney(player, total)) {
            return {
                ok: false, reason: 'notEnoughMoney',
                price: total, money: this.countMoney(player)
            };
        }

        // El peso se mira DESPUÉS del dinero, y el orden de los mensajes importa: a quien no
        // le llega el dinero no le sirve saber que además no le cabe, y al revés sí, porque
        // ya tiene el dinero y lo que le falta es sitio.
        const weight = this.weightOfItem(offer.typeId, amount);

        if (!this.canCarry(player, weight)) {
            return {
                ok: false, reason: 'tooHeavy',
                weight: weight,
                free: this.capacityOf(player) - this.weightOf(player),
                price: total
            };
        }

        const paid = this.takeItem(player, this.moneyItemId, total);
        if (paid !== total) {
            // No debería pasar: se acaba de contar. Si pasa, se devuelve lo cobrado en
            // vez de seguir, porque seguir dejaría al jugador sin dinero y sin objeto.
            this.giveItem(player, this.moneyItemId, paid);
            return { ok: false, reason: 'paymentFailed' };
        }

        this.giveItem(player, offer.typeId, amount);

        return { ok: true, offer: offer, count: amount, total: total };
    }

    /**
     * Vender a un NPC.
     *
     * Igual que la compra: primero se comprueba que el jugador TIENE lo que dice vender y
     * que el NPC lo compra, y sólo entonces se quita y se paga.
     */
    sellToNpc(player, npc, typeId, count) {
        const amount = Math.max(1, Number(count) || 1);
        const offer = this.npcOffer(npc, typeId, 'sell');

        if (!offer) {
            return { ok: false, reason: 'notBought' };
        }

        const owned = this.countOf(player, offer.typeId);

        if (owned < amount) {
            return { ok: false, reason: 'notOwned', owned: owned };
        }

        const taken = this.takeItem(player, offer.typeId, amount);
        if (taken !== amount) {
            this.giveItem(player, offer.typeId, taken);
            return { ok: false, reason: 'takeFailed' };
        }

        const total = offer.price * amount;
        this.giveItem(player, this.moneyItemId, total);

        return { ok: true, offer: offer, count: amount, total: total };
    }

    /** Cuántos objetos de un tipo lleva encima. */
    countOf(creature, typeId) {
        const id = Number(typeId);
        return (creature.inventory instanceof Array ? creature.inventory : [])
            .filter((entry) => entry.typeId === id)
            .reduce((total, entry) => total + entry.count, 0);
    }

    // =======================================================================
    // Peso y capacidad
    // =======================================================================

    /**
     * Cuánto pesa todo lo que lleva encima.
     *
     * Las unidades son las de Tibia: centésimas de onza. Una moneda son 10, o sea 0,10 oz,
     * y una espada 4200, o sea 42 oz. Se guardan así y no en onzas porque es lo que dicen
     * los archivos de Tibia, y convertir en la frontera obliga a recordar en qué unidad
     * está cada número.
     *
     * Un objeto SIN peso declarado pesa 0, y por eso `items.xml` puede ir declarando pesos
     * poco a poco sin que lo que falte se vuelva impagable.
     */
    weightOf(creature) {
        const inventory = creature.inventory instanceof Array ? creature.inventory : [];

        return inventory.reduce((total, entry) => {
            const definition = this.itemTypes.get(entry.typeId);
            const unit = definition && definition.attributes && definition.attributes.weight
                ? Number(definition.attributes.weight)
                : 0;

            return total + unit * Math.max(1, entry.count);
        }, 0);
    }

    /**
     * Cuánto puede cargar.
     *
     * Es DERIVADA del nivel y la vocación, no un campo que se guarde. Guardarla sería una
     * segunda fuente de verdad: el día que alguien subiera de nivel sin actualizarla, el
     * personaje cargaría lo que dijera el número viejo, y no habría forma de saber cuál de
     * los dos es el bueno. Es la misma decisión que con el dinero.
     *
     * La fórmula es la de Tibia: una base fija más lo que aporta cada nivel según la
     * vocación. Un caballero (gaincap 25) acaba cargando cinco veces más que un mago
     * (gaincap 5), que es exactamente lo que hace que elegir vocación importe.
     */
    capacityOf(creature) {
        // La fórmula está en ONZAS —400 más lo que aporte cada nivel— y el peso se guarda en
        // centésimas de onza. La conversión se hace AQUÍ, una vez, y no dejando el resultado
        // en onzas: comparar onzas con centésimas daría un límite cien veces más pequeño del
        // que toca, y el fallo se vería como "no puedes con una espada" en un personaje que
        // debería cargar diez.
        const ounces = this.baseCapacityOz +
            Math.max(1, creature.level || 1) * this.gainCapOf(creature);

        return ounces * UNITS_PER_OUNCE;
    }

    /**
     * Lo que aporta cada nivel esta criatura, según su vocación.
     *
     * Se busca POR NOMBRE, y no por identificador como está cargado `vocations.xml`. La
     * primera versión hacía `map.get(creature.vocation)` sobre un mapa indexado por id, así
     * que siempre devolvía indefinido y las cinco vocaciones acababan con la misma capacidad:
     * un mago cargaba lo mismo que un caballero y el fallo no daba ningún error.
     */
    gainCapOf(creature) {
        if (!this.vocations || this.vocations.size === 0) {
            return this.defaultGainCap;
        }

        // Son cinco vocaciones: recorrerlas es más barato que mantener un segundo índice que
        // se pueda quedar desincronizado con el primero.
        for (const vocation of this.vocations.values()) {
            if (vocation.name === creature.vocation) {
                return vocation.gainCap === undefined || Number(vocation.gainCap) <= 0
                    ? this.defaultGainCap
                    : Number(vocation.gainCap);
            }
        }

        // Sin vocación conocida se usa la más restrictiva y no la más generosa: si un datapack
        // se equivoca en el nombre de una vocación, es mejor que los personajes carguen poco
        // —y que se note— a que carguen sin límite y nadie se entere.
        return this.defaultGainCap;
    }

    /** ¿Cabe esto en lo que le queda libre? */
    canCarry(creature, extraWeight) {
        return this.weightOf(creature) + Number(extraWeight) <= this.capacityOf(creature);
    }

    /**
     * Cuánto pesaría meter `count` objetos de este tipo.
     *
     * Se calcula ANTES de meterlos, que es lo que permite comprobarlo todo antes de tocar
     * nada. Preguntar cuánto pesa algo después de haberlo metido no sirve para decidir si
     * se mete.
     */
    weightOfItem(typeId, count) {
        const definition = this.itemTypes.get(Number(typeId));
        const unit = definition && definition.attributes && definition.attributes.weight
            ? Number(definition.attributes.weight)
            : 0;

        return unit * Math.max(1, Number(count) || 1);
    }

    /**
     * Todo lo que lleva encima una criatura, para el comando de listar. */
    inventoryOf(creature) {        return (creature.inventory instanceof Array ? creature.inventory : [])
            .map((entry, index) => {
                const definition = this.itemTypes.get(entry.typeId);
                return {
                    index: index,
                    typeId: entry.typeId,
                    count: entry.count,
                    name: definition ? definition.name : 'objeto ' + entry.typeId
                };
            });
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
     * El inventario, listo para mandarlo.
     *
     * Existe para que la sesión y el mensaje de bienvenida no armen el mismo mensaje por
     * separado: son dos sitios que tienen que producir EXACTAMENTE lo mismo, y dos copias
     * de una estructura son dos sitios donde equivocarse. Ya pasó con el reparto de abajo y
     * arriba de los tiles, que hubo que añadir en los dos.
     *
     * @returns {{count: number, weight: number, capacity: number, flat: Array}}
     */
    inventoryPayload(creature) {
        const entries = this.inventoryOf(creature)
            .map((entry) => [entry.index, entry.typeId, entry.count, entry.name]);

        return {
            count: entries.length,
            weight: this.weightOf(creature),
            capacity: this.capacityOf(creature),
            flat: entries.reduce((all, entry) => all.concat(entry), [])
        };
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
