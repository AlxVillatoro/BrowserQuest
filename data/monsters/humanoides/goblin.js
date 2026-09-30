'use strict';

/**
 * Goblin.
 *
 * El primer humanoide de la carpeta y el primer monstruo que ataca a distancia:
 * pega 10 en cuerpo a cuerpo y lanza piedras pequeñas a distancia para 25. Tiene
 * 50 de vida y huye a 15, así que ni aguanta ni se queda.
 *
 * DATOS: contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/goblin): 50 hp, 25 de experiencia, 6 de
 * armadura, 10 de cuerpo a cuerpo y 25 a distancia, huida a 15 hp, fuerte contra
 * energía y sagrado y débil a tierra y muerte.
 *
 * EL ATAQUE A DISTANCIA NO SE APLICA TODAVÍA: el motor usa solo `attacks[0]`, así
 * que hoy el goblin pelea como si no tuviera honda. Se declara igual porque es de
 * los datos que definen a la criatura y porque, cuando la IA recorra la lista, el
 * goblin empezará a tirar piedras sin tocar el fichero.
 *
 * SIN DIBUJO: su `lookType` real es el 61 y no está en la tabla de
 * `client/avillatoro/js/browserquest.js` (21, 34, 35, 36 y 37).
 *
 * SIN LOOT REAL: ni el pescado, ni la espada corta, ni la oreja de goblin existen
 * en `data/items/items.xml` (ids 102-113, 1948, 1387, 3031, 2160 y 1950-1954).
 */

module.exports = {
    type: 'monster',
    name: 'Goblin',

    description: 'a goblin',
    experience: 25,
    health: 50,
    maxHealth: 50,
    race: 'blood',
    speed: 72,
    manaCost: 290,

    outfit: {
        lookType: 61,
        head: 85,
        body: 75,
        legs: 75,
        feet: 60,
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
        runHealth: 15,
        healthHidden: false,
        isBlockable: false,
        canWalkOnEnergy: false,
        canWalkOnFire: false,
        canWalkOnPoison: false
    },

    attacks: [
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -10 },
        { name: 'physical', interval: 2000, chance: 25, minDamage: 0, maxDamage: -25, range: 4 }
    ],

    defenses: {
        defense: 6,
        armor: 6
    },

    elements: [
        { type: 'energy', percent: 20 },    // recibe un 80%: fuerte contra energía
        { type: 'holy', percent: 20 },      // recibe un 80%: fuerte contra sagrado
        { type: 'earth', percent: -10 },    // recibe un 110%: débil a tierra
        { type: 'death', percent: -10 }     // recibe un 110%: débil a muerte
    ],

    immunities: [],

    voices: {
        interval: 5000,
        chance: 15,
        lines: [
            { text: 'Zig Zag!', yell: false },
            { text: 'Gobo attack!', yell: false },
            { text: 'Me green, me mean!', yell: false }
        ]
    },

    loot: [
        { id: 3031, chance: 60000, maxCount: 9 }    // gold coin
    ]
};
