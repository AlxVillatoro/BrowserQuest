'use strict';

/**
 * Oso.
 *
 * No es un monstruo de mazmorra sino de superficie: bosques y montañas. Aguanta
 * mucho para lo que pega (80 de vida contra 25 de daño) y huye cuando le queda
 * poco, así que el combate se alarga y se convierte en una persecución. En Tibia
 * es el primer bicho que enseña a un novato que perseguir no siempre sale bien.
 *
 * DATOS: contrastados con la ficha de la criatura en TibiaXplorer
 * (https://www.tibiaxplorer.com/creatures/bear): 80 hp, 23 de experiencia, 6 de
 * armadura, 25 de daño máximo, huida a 15 hp, fuerte contra lo sagrado y débil a
 * hielo y muerte. La velocidad es la de la ficha, con el aviso de siempre: la
 * escala de este motor no es la de Tibia.
 *
 * SIN DIBUJO: su `lookType` real es el 16 y no está en la tabla de
 * `client/avillatoro/js/browserquest.js` (21, 34, 35, 36 y 37), así que se dibuja
 * con el rectángulo de procedimiento.
 *
 * SIN LOOT REAL: la carne, el jamón, la pata de oso y el panal de miel que suelta
 * en Tibia no existen en `data/items/items.xml`, que solo define los ids 102-113,
 * 1948, 1387, 3031, 2160 y el rango 1950-1954. El botín se queda, por tanto, en la
 * moneda de oro.
 */

module.exports = {
    type: 'monster',
    name: 'Bear',

    description: 'a bear',
    experience: 23,
    health: 80,
    maxHealth: 80,
    race: 'blood',
    speed: 78,
    manaCost: 300,

    outfit: {
        lookType: 16,
        head: 80,
        body: 60,
        legs: 60,
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

    /**
     * `pushable: false`: un oso no se empuja, y eso cambia por completo cómo se le
     * puede bloquear el paso a un jugador que huye.
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
        runHealth: 15,
        healthHidden: false,
        isBlockable: false,
        canWalkOnEnergy: false,
        canWalkOnFire: false,
        canWalkOnPoison: false
    },

    attacks: [
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -25 }
    ],

    defenses: {
        defense: 6,
        armor: 6
    },

    /**
     * Fuerte contra lo sagrado (recibe un 90%: +10) y débil a hielo (110%: -10) y
     * muerte (105%: -5).
     */
    elements: [
        { type: 'holy', percent: 10 },
        { type: 'ice', percent: -10 },
        { type: 'death', percent: -5 }
    ],

    immunities: [],

    voices: {
        interval: 6000,
        chance: 15,
        lines: [
            { text: 'Grrrr', yell: false },
            { text: 'Groarrr', yell: false }
        ]
    },

    loot: [
        { id: 3031, chance: 55000, maxCount: 12 }   // gold coin
    ]
};
