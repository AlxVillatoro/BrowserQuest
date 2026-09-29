'use strict';

/**
 * El herrero.
 *
 * Existe para enseñar dos cosas que el guía no tiene: **pasea** —lo dice su XML, con
 * `walkradius`— y **se calla mientras trabaja**, que es lo que hace `onThink`.
 *
 * `onThink` se llama cada vez que el NPC piensa, antes de decidir si da un paso. Sirve
 * para lo que un NPC tenga que hacer por su cuenta: mirar alrededor, volver a su sitio,
 * decir algo de vez en cuando.
 */

/**
 * La tienda.
 *
 * `buy` es lo que cuesta comprárselo AL HERRERO y `sell` lo que él paga por quitártelo de
 * las manos. Son dos precios distintos y no uno con un descuento: en Tibia el margen lo
 * fija cada mercader, y hay cosas que uno vende y no compra.
 *
 * QUE FALTE UN PRECIO SIGNIFICA QUE NO HACE ESA OPERACIÓN, y no que sea gratis. Es la
 * diferencia entre "no lo vendo" y "te lo regalo", y confundirlas regalaría objetos.
 */
const SHOP = {
    items: [
        // La espada: la vende y la compra, más barata de lo que la vende.
        { id: 2400, buy: 1000, sell: 400, name: 'espada' },

        // El anillo: sólo lo vende. No lo compra porque no le interesan las joyas.
        { id: 2376, buy: 3000, name: 'anillo' },

        // Las monedas: las compra al mismo precio al que las da, que es lo que hace que
        // cambiar monedas grandes por pequeñas no sea un negocio. Un mercader que pagara
        // más de lo que cobra sería una máquina de fabricar dinero.
        { id: 3031, buy: 1, sell: 1, name: 'moneda' }
    ]
};

module.exports = {

    type: 'npc',
    name: 'Herrero',

    shop: SHOP,

    /**
     * Se queja si se aleja demasiado de su taller.
     *
     * Es el uso típico de `onThink`: el motor ya impide que se aleje más de su radio al
     * dar los pasos, pero sólo el NPC sabe que eso ha pasado y puede comentarlo. Un
     * monstruo que se aleja de su guarida vuelve andando; un NPC que se aleja de su
     * tienda tiene que volver, y el camino de vuelta lo da el motor.
     */
    onThink: (npc, world, now) => {
        if (!npc.isWithinHome() && !npc.goingHome) {
            npc.goingHome = true;
            npc.say('Me he alejado del taller. Vuelvo.');
        }
    },

    default: (npc, player) => {
        npc.say('No te he entendido. Dime "hola", "ofrezco", "comprar espada" o "vender espada".');
    },

    keywords: [
        {
            words: ['hola', 'hi', 'buenas'],
            greeting: true,
            say: (npc) => {
                npc.say('Buenas. Soy el herrero. Dime "ofrezco" para ver lo que tengo, ' +
                    'o "comprar espada" y "vender espada".');
            }
        },

        {
            // El listado de la tienda.
            words: ['ofrezco', 'ofreces', 'tienes', 'mercancia', 'mercancia', 'tienda', 'trade'],
            say: (npc, player) => {
                const list = npc.shopList();
                const vendibles = list.filter((entry) => entry.buy > 0);

                if (vendibles.length === 0) {
                    npc.say('Ahora mismo no tengo nada que vender.');
                    return;
                }

                npc.say('Tengo ' + vendibles.length + ' cosa(s) a la venta:');

                vendibles.forEach((entry) => {
                    npc.say('  ' + entry.name + ': ' + entry.buy + ' monedas' +
                        (entry.sell > 0 ? ' (te las compro a ' + entry.sell + ')' : ''));
                });

                npc.say('Llevas ' + player.getMoney() + ' monedas.');
            }
        },

        {
            // COMPRAR. Va antes que la palabra genérica para que "comprar espada" no caiga
            // en el listado: el orden de la lista es lo que decide, y esta es más concreta.
            words: ['comprar', 'buy', 'quiero'],
            say: (npc, player, words) => {
                const result = npc.buyFor(player, words);

                if (result.ok) {
                    npc.say('Aqui tienes ' + result.count + 'x ' + result.offer.name +
                        '. Te he cobrado ' + result.total + ' monedas.');
                    return;
                }

                // Cada motivo tiene su mensaje. Un "no puedes" genérico obliga al jugador a
                // adivinar si le falta dinero, si no existe o si se ha equivocado al
                // escribir, y son tres cosas que se arreglan de tres maneras distintas.
                if (result.reason === 'notSold') {
                    npc.say('Eso no lo vendo. Dime "ofrezco" para ver lo que tengo.');
                } else if (result.reason === 'notEnoughMoney') {
                    npc.say('Te faltan monedas: cuesta ' + result.price +
                        ' y llevas ' + result.money + '.');
                } else {
                    npc.say('No he podido hacer la compra.');
                }
            }
        },

        {
            words: ['vender', 'sell'],
            say: (npc, player, words) => {
                const result = npc.sellFor(player, words);

                if (result.ok) {
                    npc.say('Te doy ' + result.total + ' monedas por ' +
                        result.count + 'x ' + result.offer.name + '.');
                    return;
                }

                if (result.reason === 'notBought') {
                    npc.say('Eso no lo compro.');
                } else if (result.reason === 'notOwned') {
                    npc.say('No llevas eso encima.');
                } else {
                    npc.say('No he podido hacer la venta.');
                }
            }
        },

        {
            words: ['armas', 'espada', 'espadas'],
            say: (npc) => {
                npc.say('Forjo espadas de ataque 48. Se nota mucho contra las ratas.');
            }
        },

        {
            words: ['dinero', 'monedas', 'oro'],
            say: (npc, player) => {
                npc.say('Llevas ' + player.getMoney() + ' monedas encima.');
            }
        },

        {
            words: ['trabajo', 'haces', 'oficio'],
            say: (npc) => {
                npc.say('Trabajo el hierro. Por eso me ves dando vueltas por aqui.');
            }
        },

        {
            words: ['adios', 'bye', 'chao'],
            farewell: true,
            say: (npc) => {
                npc.say('Que te vaya bien.');
            }
        }
    ]
};
