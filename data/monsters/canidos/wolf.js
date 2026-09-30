'use strict';

/**
 * Lobo.
 *
 * El depredador de superficie más flojo y el primero que enseña lo que es un
 * monstruo rápido: pega 17, pero llega antes que casi todo lo de su nivel y huye a
 * 8 puntos de vida, así que se pasa media pelea corriendo.
 *
 * DATOS: contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/wolf): 25 hp, 18 de experiencia, 1 de
 * armadura, 17 de daño máximo, huida a 8 hp, fuerte contra lo sagrado y débil a
 * hielo y muerte. En Tibia un lobo no suelta monedas, solo carne y una pata de lobo
 * rara, pero NINGUNO de esos dos ids existe en `data/items/items.xml` (que solo
 * define los ids 102-113, 1948, 1387, 3031, 2160 y 1950-1954).
 *
 * DECISIÓN DE BOTÍN: dejarlo sin nada sería fiel al original y dejaría un monstruo
 * que no da nada, que en un juego en construcción es peor que una licencia. Se le
 * pone moneda de oro con una probabilidad BAJA (25%) y se deja dicho aquí: es una
 * desviación consciente de Tibia, no un dato suyo.
 *
 * SIN DIBUJO: su `lookType` real es el 27 y no está en la tabla de
 * `client/avillatoro/js/browserquest.js` (21, 34, 35, 36 y 37).
 */

module.exports = {
    type: 'monster',
    name: 'Wolf',

    description: 'a wolf',
    experience: 18,
    health: 25,
    maxHealth: 25,
    race: 'blood',
    speed: 82,
    manaCost: 255,

    outfit: {
        lookType: 27,
        head: 60,
        body: 60,
        legs: 60,
        feet: 90,
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
        runHealth: 8,
        healthHidden: false,
        isBlockable: false,
        canWalkOnEnergy: false,
        canWalkOnFire: false,
        canWalkOnPoison: false
    },

    attacks: [
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -17 }
    ],

    defenses: {
        defense: 1,
        armor: 1
    },

    elements: [
        { type: 'holy', percent: 30 },      // recibe un 70%: bastante resistente
        { type: 'ice', percent: -10 },
        { type: 'death', percent: -5 }
    ],

    immunities: [],

    voices: {
        interval: 6000,
        chance: 15,
        lines: [
            { text: 'Yoooohhuuuu!', yell: false },
            { text: 'Grrrrrrr', yell: false }
        ]
    },

    loot: [
        { id: 3031, chance: 25000, maxCount: 4 }    // gold coin
    ]
};
