'use strict';

/**
 * Rata.
 *
 * Los monstruos son código y no XML a propósito. Un monstruo acaba necesitando
 * ataques condicionales, invocaciones, gritos con probabilidad y loot con
 * rangos: todo eso es lógica, y forzarla a XML produce dialectos imposibles de
 * mantener. Es la misma decisión que tomó The Forgotten Server, que también los
 * tiene en Lua en vez de en XML.
 *
 * Al ser un módulo, esto es código normal: se pueden generar variantes en bucle,
 * heredar de una plantilla o calcular valores. Con XML no se podría.
 */

module.exports = {
    type: 'monster',
    name: 'Rat',

    description: 'a rat',
    experience: 5,
    health: 20,
    maxHealth: 20,
    race: 'blood',
    corpse: 5965,
    speed: 74,
    manaCost: 250,

    outfit: {
        lookType: 21,
        lookHead: 0,
        lookBody: 0,
        lookLegs: 0,
        lookFeet: 0,
        lookAddons: 0,
        lookMount: 0
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

    /**
     * Ataques. La forma es la de TFS: cada ataque declara su intervalo, su
     * probabilidad y su rango de daño. El daño máximo se escribe NEGATIVO por
     * convención de Tibia, y el motor usa su valor absoluto.
     *
     * La probabilidad es lo que hace que un monstruo no use todas sus habilidades
     * a la vez, y el intervalo es lo que impide que las encadene.
     */
    attacks: [
        { name: 'melee', interval: 2000, chance: 100, minDamage: 0, maxDamage: -8 }
    ],

    defenses: {
        defense: 1,
        armor: 1
    },

    /**
     * Resistencias elementales, con la lectura de Tibia:
     *   percent positivo -> resistente (25 = un 25% menos de daño)
     *   percent = 100    -> inmune
     *   percent negativo -> débil (más daño)
     *
     * Los tipos se nombran en minúscula en vez de usar las constantes `COMBAT_*`
     * de Tibia, que en JavaScript no existen.
     */
    elements: [
        { type: 'fire', percent: 20 },
        { type: 'ice', percent: -10 }
    ],

    immunities: [],

    voices: {
        interval: 5000,
        chance: 10,
        lines: [
            { text: 'Eeek!', yell: false },
            { text: 'Meep!', yell: false }
        ]
    },

    loot: [
        { id: 3031, chance: 40000, maxCount: 4 },   // gold coin
        { id: 2160, chance: 1000 }                  // crystal coin
    ]
};
