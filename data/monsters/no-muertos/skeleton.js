'use strict';

/**
 * Esqueleto.
 *
 * El primer no-muerto de la carpeta. En Tibia es el monstruo que enseña dos cosas
 * a la vez: que hay criaturas inmunes a la muerte, y que la vida que te chupan no
 * es daño físico, así que la armadura no la detiene.
 *
 * DATOS: contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/skeleton): 50 hp, 35 de experiencia, 2 de
 * armadura, 17 de daño físico más 13 de drenaje de vida, débil a lo sagrado e
 * inmune a muerte y ahogamiento.
 *
 * APROXIMACIÓN: la ficha no publica umbral de huida para el esqueleto, y en Tibia
 * un esqueleto no huye. Se deja `runHealth: 0` por eso, no porque se haya
 * consultado un número.
 *
 * RACE: 'undead' y no 'blood'. En Tibia un esqueleto es The Undead, y esa
 * distinción es la que usará el día de mañana cualquier hechizo que trate distinto a
 * los vivos y a los muertos.
 *
 * ATAQUES: el drenaje de vida (13) va declarado como segundo ataque y hoy no se
 * aplica, porque el motor usa solo `attacks[0]`. Se deja escrito porque es la
 * mitad del peligro de esta criatura.
 *
 * SIN DIBUJO: su `lookType` real es el 33 y no está en la tabla de
 * `client/avillatoro/js/browserquest.js` (21, 34, 35, 36 y 37), así que se dibuja
 * con el rectángulo de procedimiento. La tabla de aspectos del motor,
 * `data/XML/outfits.xml`, sí declara un 33, pero eso es lo que el motor acepta al
 * vestirse, no lo que el cliente sabe dibujar: son dos listas distintas y solo la
 * segunda hace que se vea un sprite.
 *
 * SIN LOOT REAL: el hueso, la antorcha, el hacha pequeña o el yelmo vikingo que
 * suelta en Tibia no existen en `data/items/items.xml`.
 */

module.exports = {
    type: 'monster',
    name: 'Skeleton',

    description: 'a skeleton',
    experience: 35,
    health: 50,
    maxHealth: 50,
    race: 'undead',
    speed: 77,
    manaCost: 300,

    outfit: {
        lookType: 33,
        head: 110,
        body: 110,
        legs: 110,
        feet: 110,
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
     * `canWalkOnPoison: true` porque un esqueleto no se envenena: caminar sobre el
     * veneno sin sufrirlo es la forma que tiene el motor de decir "esto no le
     * afecta".
     */
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
        canWalkOnPoison: true
    },

    attacks: [
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -17 },
        { name: 'lifedrain', interval: 4000, chance: 25, minDamage: 0, maxDamage: -13 }
    ],

    defenses: {
        defense: 2,
        armor: 2
    },

    /**
     * Recibe un 125% de lo sagrado: un 25% MÁS de daño se escribe -25.
     */
    elements: [
        { type: 'holy', percent: -25 }
    ],

    /** Inmune a muerte y a ahogamiento: los dos son 0% de daño en la ficha. */
    immunities: [
        { type: 'death', percent: 100 },
        { type: 'drown', percent: 100 }
    ],

    voices: {
        interval: 6000,
        chance: 10,
        lines: [
            { text: 'Clank', yell: false },
            { text: 'Chrrrr', yell: false }
        ]
    },

    loot: [
        { id: 3031, chance: 55000, maxCount: 10 }   // gold coin
    ]
};
