'use strict';

/**
 * Cíclope.
 *
 * El monstruo más grande de esta carpeta: 260 de vida, 17 de armadura y 105 de daño
 * de un solo golpe. En Tibia es el primer "jefe de zona" que se encuentra un jugador
 * que sale de las cuevas de novato, y aquí cumple el mismo papel: es el techo contra
 * el que se mide el equipo.
 *
 * DATOS: contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/cyclops): 260 hp, 150 de experiencia, 17
 * de armadura, 105 de daño máximo, fuerte contra energía y sagrado y débil a tierra
 * y muerte. No huye.
 *
 * POR QUÉ NO LLEVA EL `lookType` 36: la tabla de
 * `client/avillatoro/js/browserquest.js` mapea el 36 y el 37 a `boss`, que es un
 * dragón, y un cíclope no es un jefe ni se parece a un dragón. Ponerle el 36 para
 * que se viera "mejor" habría metido un dato falso en el fichero a cambio de un
 * dibujo que tampoco es suyo. Se queda con su `lookType` real, el 22, y se dibuja
 * con el rectángulo de procedimiento como el resto.
 *
 * SIN LOOT REAL: la carne, la espada corta, el dedo de cíclope o el escudo de placas
 * que suelta en Tibia no existen en `data/items/items.xml`, que solo define los ids
 * 102-113, 1948, 1387, 3031, 2160 y el rango 1950-1954.
 */

module.exports = {
    type: 'monster',
    name: 'Cyclops',

    description: 'a cyclops',
    experience: 150,
    health: 260,
    maxHealth: 260,
    race: 'blood',
    speed: 95,
    manaCost: 900,

    outfit: {
        lookType: 22,
        head: 100,
        body: 100,
        legs: 100,
        feet: 100,
        addons: 0
    },

    changeTarget: { interval: 4000, chance: 20 },

    strategiesTarget: {
        nearest: 100,
        health: 100,
        damage: 100,
        random: 0
    },

    /**
     * `canPushItems: true` y `canPushCreatures: true`: la ficha dice que un cíclope
     * aparta de su camino lo que le estorbe y mata a las criaturas débiles que se le
     * crucen. Es la razón de que en Tibia no se le pueda bloquear con objetos, y sin
     * estas dos banderas el motor lo trataría como a cualquier bicho de cueva.
     */
    flags: {
        summonable: true,
        attackable: true,
        hostile: true,
        convinceable: true,
        pushable: false,
        rewardBoss: false,
        illusionable: true,
        canPushItems: true,
        canPushCreatures: true,
        staticAttackChance: 90,
        targetDistance: 1,
        runHealth: 0,
        healthHidden: false,
        isBlockable: false,
        canWalkOnEnergy: false,
        canWalkOnFire: false,
        canWalkOnPoison: false
    },

    attacks: [
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -105 }
    ],

    defenses: {
        defense: 17,
        armor: 17
    },

    /**
     * Fuerte contra energía (75%: +25) y sagrado (80%: +20); débil a tierra y muerte
     * (110%: -10).
     */
    elements: [
        { type: 'energy', percent: 25 },
        { type: 'holy', percent: 20 },
        { type: 'earth', percent: -10 },
        { type: 'death', percent: -10 }
    ],

    immunities: [],

    voices: {
        interval: 7000,
        chance: 15,
        lines: [
            { text: 'Human, uh whil dyh!', yell: true },
            { text: 'Toks utat.', yell: false },
            { text: 'Let da mashing begin!', yell: true }
        ]
    },

    loot: [
        { id: 3031, chance: 80000, maxCount: 47 }   // gold coin
    ]
};
