'use strict';

/**
 * Minotauro.
 *
 * El primer monstruo de esta carpeta con armadura de verdad (11 puntos) y el
 * primero que pega lo suficiente como para que un novato tenga que llevar vendas.
 * En Tibia vive en ciudades subterráneas propias, no en una cueva suelta, y esa
 * diferencia se nota al diseñar una zona: aquí llegan en manada.
 *
 * DATOS: contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/minotaur): 100 hp, 50 de experiencia, 11
 * de armadura, 45 de daño máximo, fuerte contra fuego y sagrado y débil a hielo y
 * muerte. No huye.
 *
 * SIN DIBUJO: su `lookType` real es el 25 y no está en la tabla de
 * `client/avillatoro/js/browserquest.js` (21, 34, 35, 36 y 37), así que se dibuja
 * con el rectángulo de procedimiento.
 *
 * SIN LOOT REAL: el cuerno, la piel, el yelmo de latón, la maza o la armadura de
 * cadenas que suelta en Tibia no existen en `data/items/items.xml`, que solo define
 * los ids 102-113, 1948, 1387, 3031, 2160 y el rango 1950-1954.
 */

module.exports = {
    type: 'monster',
    name: 'Minotaur',

    description: 'a minotaur',
    experience: 50,
    health: 100,
    maxHealth: 100,
    race: 'blood',
    speed: 84,
    manaCost: 330,

    outfit: {
        lookType: 25,
        head: 95,
        body: 115,
        legs: 95,
        feet: 115,
        addons: 0
    },

    changeTarget: { interval: 4000, chance: 20 },

    strategiesTarget: {
        nearest: 100,
        health: 100,
        damage: 100,
        random: 0
    },

    flags: {
        summonable: true,
        attackable: true,
        hostile: true,
        convinceable: true,
        pushable: true,
        rewardBoss: false,
        illusionable: true,
        canPushItems: false,
        canPushCreatures: false,
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
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -45 }
    ],

    defenses: {
        defense: 11,
        armor: 11
    },

    /**
     * Fuerte contra fuego (80%: +20) y sagrado (90%: +10); débil a hielo y muerte
     * (110%: -10).
     */
    elements: [
        { type: 'fire', percent: 20 },
        { type: 'holy', percent: 10 },
        { type: 'ice', percent: -10 },
        { type: 'death', percent: -10 }
    ],

    immunities: [],

    voices: {
        interval: 6000,
        chance: 15,
        lines: [
            { text: 'Kaplar!', yell: false },
            { text: 'Hurr', yell: false }
        ]
    },

    loot: [
        { id: 3031, chance: 65000, maxCount: 25 }   // gold coin
    ]
};
