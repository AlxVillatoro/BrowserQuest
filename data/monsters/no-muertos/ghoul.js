'use strict';

/**
 * Carroñero (ghoul).
 *
 * El no-muerto que sí da miedo de verdad a nivel bajo: 100 de vida, 70 de daño
 * físico y 27 de drenaje de vida, además de curarse solo. Es el techo de esta
 * carpeta y está a propósito: todo lo demás se puede pelear a nivel 1, esto no.
 *
 * DATOS: contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/ghoul): 100 hp, 85 de experiencia, 8 de
 * armadura, 70 de daño físico más 27 de drenaje y curación de 9 a 15, débil a lo
 * sagrado, fuerte contra hielo, tierra y energía, e inmune a muerte y ahogamiento.
 *
 * APROXIMACIÓN: la ficha dice literalmente que huye a 0 puntos de vida, es decir,
 * que no huye. Se traduce a `runHealth: 0`.
 *
 * RACE: 'undead'. A diferencia de otros no-muertos, un carroñero SÍ deja sangre al
 * ser herido; aun así se marca como no-muerto, que es su clase real en Tibia y lo
 * que decidirá qué hechizos le afectan.
 *
 * ATAQUES: el drenaje (27) y la curación (9-15) van declarados y hoy no se aplican,
 * porque el motor solo usa `attacks[0]`. Son justo las dos habilidades que hacen
 * temible a esta criatura, así que se dejan escritas.
 *
 * SIN DIBUJO: su `lookType` real es el 18 y no está en la tabla de
 * `client/avillatoro/js/browserquest.js` (21, 34, 35, 36 y 37).
 *
 * SIN LOOT REAL: ni el trapo podrido, ni el gusano, ni la pata de oso que suelta en
 * Tibia existen en `data/items/items.xml`, que solo define los ids 102-113, 1948,
 * 1387, 3031, 2160 y el rango 1950-1954.
 */

module.exports = {
    type: 'monster',
    name: 'Ghoul',

    description: 'a ghoul',
    experience: 85,
    health: 100,
    maxHealth: 100,
    race: 'undead',
    speed: 72,
    manaCost: 480,

    outfit: {
        lookType: 18,
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
     * `runHealth: 0`: no huye nunca. `canWalkOnPoison: true`: no se envenena.
     */
    flags: {
        summonable: true,
        attackable: true,
        hostile: true,
        convinceable: true,
        pushable: false,
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
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -70 },
        { name: 'lifedrain', interval: 4000, chance: 25, minDamage: 0, maxDamage: -27 },
        /**
         * La curación va con el máximo en POSITIVO a propósito. En un datapack de
         * TFS la convención del signo negativo es para "quita vida", así que drenar
         * vida se escribe negativo y curarse se escribe positivo; poner -15 aquí
         * diría justo lo contrario de lo que hace un carroñero.
         */
        { name: 'healing', interval: 4000, chance: 15, minDamage: 0, maxDamage: 15 }
    ],

    defenses: {
        defense: 8,
        armor: 8
    },

    /**
     * Fuerte contra hielo (90%: +10), tierra (80%: +20) y energía (70%: +30); débil
     * a lo sagrado (125%: -25).
     */
    elements: [
        { type: 'ice', percent: 10 },
        { type: 'earth', percent: 20 },
        { type: 'poison', percent: 20 },
        { type: 'energy', percent: 30 },
        { type: 'holy', percent: -25 }
    ],

    immunities: [
        { type: 'death', percent: 100 },
        { type: 'drown', percent: 100 }
    ],

    voices: {
        interval: 6000,
        chance: 15,
        lines: [
            { text: 'Hoooohhh', yell: false },
            { text: 'Aaaahhh', yell: false }
        ]
    },

    loot: [
        { id: 3031, chance: 70000, maxCount: 30 }   // gold coin
    ]
};
