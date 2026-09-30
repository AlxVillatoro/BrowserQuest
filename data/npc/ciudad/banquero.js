'use strict';

/**
 * El banquero.
 *
 * ESTE NPC EXISTE SOBRE TODO PARA DECIR UNA COSA QUE NO SE PUEDE HACER, y por eso el
 * comentario es mas largo que su guion. En Tibia un banquero guarda el dinero del jugador
 * fuera del zurron, y ese dinero no se cae al suelo al morir: es media economia del juego.
 * Aqui eso NO SE PUEDE ESCRIBIR TODAVIA, y no por falta de ganas:
 *
 *   - La unica via que tiene el contenido para mover objetos de un inventario es la tienda
 *     (`buyFromNpc` / `sellToNpc`), porque `giveItem` y `takeItem` viven en el mundo
 *     (`engine/world/world.js`) y no estan en el envoltorio del jugador. Un banquero
 *     necesita justo eso: quitarle las monedas y apuntarlas.
 *   - Los `storages` —`setStorageValue`— guardan NUMEROS, no objetos. Un saldo apuntado en
 *     un storage seria un numero que no corresponde a ninguna moneda: el jugador tendria
 *     "1000 en el banco" y las 1000 monedas seguiran en su inventario, o no, segun por
 *     donde se mire el problema. Dos fuentes de verdad para el mismo dinero es la peor
 *     forma de empezar una economia.
 *
 * Asi que el banco esta "por abrir": dice el saldo —que si puede leer, con `getMoney`— y
 * avisa de lo que cuesta llevarlo encima. Cuando el motor deje mover objetos desde el
 * contenido, este modulo tendra `depositar` y `retirar` de verdad; ponerlos hoy seria un
 * NPC que promete y no cumple, o peor, que duplica dinero.
 *
 * Y HAY UN DETALLE QUE CONVIENE DECIR EN VOZ ALTA: el saldo son MONEDAS DE ORO, y solo
 * esas. `moneyItemId` vale 3031 en el mundo, asi que la moneda de cristal no cuenta como
 * dinero aunque lo parezca: es un objeto que pesa y que se cae al suelo como cualquier otro.
 * Por eso el banquero manda al tendero, que es quien la compra.
 *
 * DIBUJO: `client/avillatoro/js/browserquest.js` tiene una tabla NPC que va de NOMBRE a
 * dibujo y hoy solo conoce a Guia y Herrero. A este le tocaria 'agent', que es el unico
 * dibujo con traje de la lista.
 */

module.exports = {

    type: 'npc',
    name: 'Banquero',

    default: (npc) => {
        npc.say('No te entiendo. Dime "saldo", "depositar" o "cuanto llevo".');
    },

    keywords: [
        {
            words: ['hola', 'hi', 'buenas', 'buenos dias'],
            greeting: true,
            say: (npc, player) => {
                // `getName()` y no `player.name`: en el envoltorio el nombre es un metodo.
                npc.say('Buenas, ' + player.getName() + '. Dime "saldo" y te digo lo que llevas.');
            }
        },

        {
            /*
             * DEPOSITAR va antes que "saldo" y que "dinero" a proposito: "quiero guardar mi
             * dinero" es una peticion, no una pregunta, y si ganara la palabra generica el
             * banquero contestaria el saldo a quien venia a ingresarlo. Es el mismo orden
             * que hace falta en la tienda con "comprar" y el nombre del objeto.
             */
            words: ['depositar', 'ingresar', 'guardar', 'deposito', 'meter'],
            say: (npc) => {
                npc.say('La caja fuerte esta por abrir: todavia no hay donde dejarlo. Hoy ' +
                    'el dinero se lleva encima, con todo lo que eso tiene.');
            }
        },

        {
            words: ['retirar', 'sacar', 'extraer', 'withdraw'],
            say: (npc) => {
                npc.say('No hay nada tuyo que sacar: no guardo dinero de nadie todavia.');
            }
        },

        {
            words: ['saldo', 'cuenta', 'balance', 'cuanto llevo', 'cuanto tengo'],
            say: (npc, player) => {
                npc.say('Llevas ' + player.getMoney() + ' monedas de oro encima.');
                npc.say('Y solo cuento el oro: la moneda de cristal es una cosa que pesa, no ' +
                    'un saldo. Esa la compra el tendero.');
            }
        },

        {
            words: ['dinero', 'monedas', 'oro'],
            say: (npc, player) => {
                npc.say('En el zurron: ' + player.getMoney() + ' monedas de oro.');
            }
        },

        {
            words: ['cristal', 'moneda de cristal', 'crystal'],
            say: (npc) => {
                npc.say('La de cristal no es dinero para mi. Te la compra el tendero a 100 ' +
                    'de oro cada una.');
            }
        },

        {
            words: ['morir', 'muerte', 'caer', 'perder'],
            say: (npc) => {
                npc.say('Al caer pierdes una decima parte de la experiencia y sueltas TODO ' +
                    'lo que lleves, monedas incluidas. Por eso un banco vale mas de lo que ' +
                    'parece.');
            }
        },

        {
            words: ['interes', 'prestamo', 'deuda', 'credito'],
            say: (npc) => {
                npc.say('Prestamos no hago. Todavia no hay con que responder si no me los ' +
                    'devolvieras.');
            }
        },

        {
            words: ['peso', 'carga', 'capacidad'],
            say: (npc, player) => {
                npc.say('Vas con ' + player.getWeightText() + ' de ' +
                    player.getCapacityText() + '. Y las monedas pesan: cien de oro son ' +
                    'diez onzas, aunque no lo parezca.');
            }
        },

        {
            words: ['adios', 'bye', 'chao', 'hasta luego'],
            farewell: true,
            say: (npc) => {
                npc.say('Cuida ese zurron.');
            }
        }
    ]
};
