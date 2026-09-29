'use strict';

/**
 * Criaturas: jugadores y monstruos.
 *
 * Toda criatura tiene posición, dirección, velocidad y salud. Lo que cambia entre
 * un jugador y un monstruo es lo que saben hacer, no lo que son: por eso comparten
 * base y el motor puede tratarlas igual al moverlas, al mirarlas o al hacerles
 * daño. Es el mismo reparto que hace The Forgotten Server con `Creature`.
 *
 * Sobre las direcciones: Tibia usa cuatro, numeradas de norte a oeste en sentido
 * horario. Se copian los números en vez de inventar un enum propio porque viajan
 * en el protocolo, y traducirlos solo añadiría una tabla de conversión donde
 * antes no había nada.
 */

const { Position, DIRECTIONS, directionFrom } = require('./position');
const { stepDuration } = require('./stepcost');
const { DEFAULT_OUTFIT } = require('./outfit');

const DIRECTION = {
    NORTH: 0,
    EAST: 1,
    SOUTH: 2,
    WEST: 3
};

/** De nombre de dirección a número de Tibia. */
const DIRECTION_FROM_NAME = {
    north: DIRECTION.NORTH,
    east: DIRECTION.EAST,
    south: DIRECTION.SOUTH,
    west: DIRECTION.WEST
};

/**
 * Contador de identificadores.
 *
 * Es global al proceso a propósito: dos mundos en el mismo proceso (por ejemplo
 * dos pruebas) no deben poder generar el mismo id, o al depurar aparecerían
 * criaturas que se pisan entre sí.
 */
let nextId = 1;

function allocateId() {
    return nextId++;
}

/** Sólo para las pruebas: devuelve el contador a su estado inicial. */
function resetIdCounter() {
    nextId = 1;
}

class Creature {
    constructor(options) {
        const opts = options || {};

        this.id = opts.id === undefined ? allocateId() : opts.id;
        this.name = opts.name || 'creature';
        this.position = Position.from(opts.position);
        this.direction = opts.direction === undefined ? DIRECTION.SOUTH : opts.direction;

        /**
         * Velocidad de la criatura. No es "píxeles por segundo" ni nada parecido:
         * es el número que entra en la fórmula del coste de paso, y sólo tiene
         * sentido comparado con otras velocidades.
         */
        this.speed = opts.speed === undefined ? 220 : opts.speed;

        this.maxHealth = opts.maxHealth === undefined ? 100 : opts.maxHealth;
        this.health = opts.health === undefined ? this.maxHealth : opts.health;

        /**
         * El tile que la contiene, para poder sacarla de él sin buscarla.
         *
         * Esta referencia hacia atrás hace que el grafo del mundo sea CIRCULAR
         * (criatura -> tile -> criaturas). Es intencionado: sin ella, quitar una
         * criatura de su tile obligaría a recorrer el mapa. La consecuencia es que
         * el estado del mundo no es serializable tal cual, así que la persistencia
         * tendrá que escribir los campos que le interesan y no volcar el objeto.
         */
        this.tile = null;

        /** Cuándo (ms epoch) podrá volver a moverse. Lo lleva el mundo. */
        this.nextStepAt = 0;

        /** Cuánto duró su último paso, que es lo que el cliente necesita para
         *  interpolar el desplazamiento. Lo pone el mundo al mover. */
        this.lastStepDuration = 0;

        /** Cuándo (ms epoch) podrá volver a atacar. Lo lleva el combate. */
        this.nextAttackAt = 0;

        this.removed = false;
    }

    get kind() {
        return 'creature';
    }

    isPlayer() {
        return false;
    }

    isMonster() {
        return false;
    }

    getPosition() {
        return this.position.copy();
    }

    /**
     * Mueve la criatura sin tocar el mapa.
     *
     * Es deliberadamente de bajo nivel: NO comprueba si se puede caminar ni
     * actualiza los tiles. Quien mueve de verdad es el mundo, que es el único que
     * conoce el mapa. Esto existe para que el mundo tenga una forma de aplicar el
     * movimiento ya validado.
     *
     * Copia siempre, aunque ya sea una `Position`. Guardarla por referencia
     * dejaría al llamante con un alias de la posición de la criatura, y bastaría
     * con que reutilizara su objeto para moverla sin querer.
     */
    _applyPosition(position) {
        this.position = position instanceof Position
            ? position.copy()
            : Position.from(position);
        return this;
    }

    setDirection(direction) {
        this.direction = direction;
        return this;
    }

    /**
     * Orienta la criatura según un desplazamiento.
     *
     * Existe aparte de `faceTowards` porque hay dos momentos distintos y
     * confundirlos da un fallo silencioso: para mirar hacia una posición hay que
     * compararla con la posición ACTUAL, así que sólo sirve ANTES de moverse. Una
     * vez movida, la criatura y el destino coinciden, `faceTowards` no encuentra
     * desplazamiento y la orientación se queda como estaba. Eso hacía que al
     * caminar hacia el norte la criatura siguiera mirando al sur.
     */
    faceOffset(offset) {
        if (!offset || (offset.x === 0 && offset.y === 0)) {
            return this;
        }

        if (offset.x !== 0) {
            // En diagonal se elige el eje horizontal, que es el que usa el cliente
            // al dibujar. Tibia no tiene direcciones intermedias: son cuatro.
            this.direction = offset.x > 0 ? DIRECTION.EAST : DIRECTION.WEST;
        } else {
            this.direction = offset.y > 0 ? DIRECTION.SOUTH : DIRECTION.NORTH;
        }
        return this;
    }

    /** Dirección hacia otra posición, o null si no hay desplazamiento. */
    faceTowards(target) {
        const name = directionFrom(this.position, target);
        if (name && DIRECTION_FROM_NAME[name] !== undefined) {
            // En diagonal, Tibia mira hacia el eje dominante y usa el norte o el
            // sur como preferencia. Aquí basta con elegir el horizontal, que es
            // lo que hace el cliente al dibujar.
            if (DIRECTIONS[name].diagonal) {
                this.direction = DIRECTIONS[name].x !== 0
                    ? DIRECTION_FROM_NAME[DIRECTIONS[name].x > 0 ? 'east' : 'west']
                    : DIRECTION_FROM_NAME[DIRECTIONS[name].y > 0 ? 'south' : 'north'];
            } else {
                this.direction = DIRECTION_FROM_NAME[name];
            }
        }
        return this;
    }

    /** Cuántos milisegundos tarda un paso, según el suelo y si es diagonal. */
    getStepDuration(options) {
        return stepDuration(this.speed, options);
    }

    isDead() {
        return this.health <= 0;
    }

    /** Aplica daño y devuelve la salud resultante. */
    damage(amount) {
        this.health = Math.max(0, this.health - Math.max(0, amount));
        return this.health;
    }

    heal(amount) {
        this.health = Math.min(this.maxHealth, this.health + Math.max(0, amount));
        return this.health;
    }

    toString() {
        return this.kind + '(' + this.id + ', ' + this.name + ' @ ' + this.position + ')';
    }
}

class Player extends Creature {
    constructor(options) {
        const opts = options || {};
        super(opts);

        this.level = opts.level === undefined ? 1 : opts.level;

        /**
         * Experiencia ACUMULADA, no la que falta para el siguiente nivel.
         * Guardarla acumulada hace que comprobar una subida de nivel sea una sola
         * comparación en vez de sumar tramos, y evita que un redondeo se acumule.
         */
        this.experience = opts.experience === undefined ? 0 : opts.experience;

        this.vocation = opts.vocation === undefined ? 'None' : opts.vocation;

        /** Lo que el jugador lleva equipado. Un solo hueco de cada tipo. */
        this.armor = opts.armor === undefined ? 0 : opts.armor;
        this.weapon = opts.weapon === undefined ? 0 : opts.weapon;

        /** Nivel de armadura, que es lo que usa el combate para reducir daño. */
        this.armorLevel = opts.armorLevel === undefined ? 0 : opts.armorLevel;

        /** Ataque del arma equipada, para el cálculo de daño del jugador. */
        this.weaponAttack = opts.weaponAttack === undefined ? 0 : opts.weaponAttack;

        /** Habilidad de ataque, que todavía no se entrena. */
        this.attackSkill = opts.attackSkill === undefined ? 10 : opts.attackSkill;

        /**
         * Lo que lleva encima.
         *
         * Cada entrada es `{ slot, position, typeId, count, attributes }`, que es
         * exactamente la forma de la tabla `player_items`. Se copia la forma de la
         * base a propósito: traducir entre dos representaciones parecidas es donde
         * se pierden los campos.
         */
        this.inventory = [];

        /**
         * La memoria del contenido: lo que un módulo necesita recordar entre
         * partidas.
         *
         * Sin esto, un módulo no puede saber que un jugador ya mató a un dragón ni
         * en qué paso va de una misión, y el contenido deja de poder contar nada.
         * Es la pieza que hace que el datapack sea algo más que decorado.
         */
        this.storages = new Map();

        /** Identidad persistente. Nulos si el motor corre sin base de datos. */
        this.accountId = null;
        this.characterId = null;

        /**
         * Cómo se ve esta criatura.
         *
         * Cinco números: el conjunto de sprites y cuatro colores de una paleta que
         * tiene el CLIENTE. El motor no sabe dibujar y no necesita saberlo.
         *
         * Los monstruos también lo llevan, y por la misma razón que los jugadores: en
         * el protocolo una criatura no se identifica por su nombre sino por su
         * aspecto, y es lo que permite que el mismo monstruo cambie de apariencia al
         * transformarse.
         */
        this.outfit = { ...DEFAULT_OUTFIT };
    }

    get kind() {
        return 'player';
    }

    isPlayer() {
        return true;
    }
}

class Monster extends Creature {
    constructor(options) {
        const opts = options || {};
        super(opts);

        /** La definición cargada de data/monsters, no una copia de sus datos. */
        this.monsterType = opts.monsterType || null;

        /** De dónde salió y dónde debe reaparecer. */
        this.spawn = opts.spawn || null;

        /** A quién persigue ahora mismo, o null. */
        this.target = null;

        /** Cuándo (ms epoch) debe volver a su punto de aparición. */
        this.returnAt = 0;

        /**
         * Camino que está siguiendo y hacia dónde.
         *
         * Se guarda en el monstruo y no se recalcula en cada turno: recalcularlo
         * serían cuatro búsquedas por segundo y por monstruo, y con doscientos
         * monstruos eso se come el tick.
         */
        this.path = null;
        this.pathGoal = null;
    }

    get kind() {
        return 'monster';
    }

    isMonster() {
        return true;
    }

    /** Experiencia que otorga al morir. */
    get experience() {
        return this.monsterType && this.monsterType.experience !== undefined
            ? this.monsterType.experience
            : 0;
    }

    /** Botín declarado en su definición. */
    get loot() {
        return (this.monsterType && this.monsterType.loot) || [];
    }
}

module.exports = {
    Creature,
    Player,
    Monster,
    DIRECTION,
    DIRECTION_FROM_NAME,
    allocateId,
    resetIdCounter
};
