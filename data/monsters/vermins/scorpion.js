'use strict';

/**
 * Escorpión.
 *
 * El bicho más peligroso de nivel bajo de Tibia, y no por la vida que tiene, que
 * son 45 puntos, sino por el veneno: una picadura suya envenena durante un buen
 * rato. Aquí eso se refleja con la armadura más alta de la familia y con un daño
 * máximo que dobla al de la araña común.
 *
 * DATOS: contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/scorpion): 45 hp, 45 de experiencia, 14
 * de armadura, huida a 5 hp, inmunidad a la tierra y debilidad a fuego y hielo.
 *
 * APROXIMACIÓN: la ficha de esta criatura NO publica el daño cuerpo a cuerpo (el
 * apartado de amenaza sale vacío), así que el -50 de `maxDamage` es una estimación
 * a partir de su veneno documentado, no un dato de Tibia. Se dice aquí para que
 * nadie lo tome por verificado.
 *
 * SIN DIBUJO: su `lookType` real es el 43 y no está en la tabla de
 * `client/avillatoro/js/browserquest.js` (21, 34, 35, 36 y 37), así que se dibuja
 * con el rectángulo de procedimiento.
 *
 * SIN LOOT REAL: el aguijón de escorpión no existe en `data/items/items.xml`.
 */

module.exports = {
    type: 'monster',
    name: 'Scorpion',

    description: 'a scorpion',
    experience: 45,
    health: 45,
    maxHealth: 45,
    race: 'blood',
    speed: 75,
    manaCost: 310,

    outfit: {
        lookType: 43,
        head: 95,
        body: 95,
        legs: 80,
        feet: 80,
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
     * `convinceable: false` por la misma corrección de 2011 que la araña venenosa:
     * un escorpión convencido mataba a otros jugadores con su veneno y el dueño se
     * llevaba el skull.
     */
    flags: {
        summonable: true,
        attackable: true,
        hostile: true,
        convinceable: false,
        pushable: true,
        rewardBoss: false,
        illusionable: true,
        canPushItems: false,
        canPushCreatures: false,
        staticAttackChance: 90,
        targetDistance: 1,
        runHealth: 5,
        healthHidden: false,
        isBlockable: false,
        canWalkOnEnergy: false,
        canWalkOnFire: false,
        canWalkOnPoison: true
    },

    attacks: [
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -50 }
    ],

    defenses: {
        defense: 14,
        armor: 14
    },

    /**
     * Fuerte contra la energía (recibe un 80%: +20) y débil a fuego y hielo (recibe
     * un 110%: -10).
     */
    elements: [
        { type: 'energy', percent: 20 },
        { type: 'fire', percent: -10 },
        { type: 'ice', percent: -10 }
    ],

    /**
     * Inmune a la tierra, que es donde viaja el veneno en Tibia. Se declara también
     * como 'poison' porque el motor compara el nombre del tipo literalmente y quien
     * escriba un ataque de veneno puede llamarlo de cualquiera de las dos formas.
     */
    immunities: [
        { type: 'earth', percent: 100 },
        { type: 'poison', percent: 100 }
    ],

    voices: {
        interval: 6000,
        chance: 10,
        lines: [
            { text: 'Klack klack', yell: false }
        ]
    },

    loot: [
        { id: 3031, chance: 45000, maxCount: 10 }   // gold coin
    ]
};
