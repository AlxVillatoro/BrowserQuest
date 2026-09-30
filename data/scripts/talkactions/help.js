'use strict';

/**
 * Comando `/ayuda`: qué se puede escribir y qué hace cada cosa.
 *
 * LA LISTA ESTÁ ESCRITA A MANO, Y ES UN DATO DUPLICADO. El registro sabe qué comandos hay
 * —`registry.talkActions`—, pero el contenido no lo alcanza: `Game`
 * (`engine/scripting/game.js`) expone `getStats`, y ese devuelve CUÁNTOS comandos hay, no
 * CUÁLES. Así que no hay forma de generar esta lista sola, y se escribe a mano. El precio es
 * que puede quedarse vieja: el día que se añada un comando en `commands.js` —que es de otro
 * ámbito y no se toca desde aquí—, hay que venir a añadirlo a esta lista. Se dice aquí, en
 * el sitio donde hay que acordarse, y no en un informe que nadie vuelve a leer.
 *
 * Y POR ESO LA LISTA ES CORTA Y EXACTA: sólo salen los seis comandos que existen de verdad
 * hoy. Un `/ayuda` que anuncie un `/banco` que nadie ha escrito es peor que no tener ayuda,
 * porque manda al jugador a escribir algo que no responde.
 *
 * La firma es la de TFS y tiene CUATRO argumentos:
 *
 *     onSay(player, words, param, type)
 *
 * `param` se usa de verdad: `/ayuda stats` explica sólo el comando `stats`. Un comando de
 * ayuda que ignore su argumento es un comando de ayuda a medias, y el argumento ya viene
 * separado por el registro.
 */

/**
 * Un comando por línea: cómo se escribe, qué hace, y el ejemplo cuando el uso no se
 * entiende sin uno.
 *
 * El orden es el de la utilidad y no el alfabético: primero lo que se usa todo el rato
 * (`/pos`, `/i`), después lo que se usa de vez en cuando.
 */
const COMANDOS = [
    { nombre: 'pos', uso: '/pos', que: 'tu posicion, tu vida, tu nivel y tu vocacion' },
    { nombre: 'i', uso: '/i', que: 'lo que llevas encima y cuanto pesa' },
    { nombre: 'stats', uso: '/stats', que: 'tus numeros y los del mundo en el que estas' },
    { nombre: 'item', uso: '/item <id>', que: 'el nombre de un objeto, por su id' },
    {
        nombre: 'outfit',
        uso: '/outfit <tipo> [cabeza] [cuerpo] [piernas] [pies] [anadidos]',
        que: 'cambia tu aspecto. Los colores son indices de la paleta del cliente, no ' +
            'valores de color: el 78 es "el color 78", no "un poco de azul"'
    },
    { nombre: 'ayuda', uso: '/ayuda [comando]', que: 'esto mismo, o el detalle de uno' }
];

module.exports = {
    type: 'talkaction',
    words: '/ayuda',

    onSay(player, words, param, type) {
        const pedido = String(param || '').trim().toLowerCase().replace(/^\//, '');

        // Con argumento: se busca y, si no está, se dice —sin volver a soltar la lista
        // entera, que para eso está `/ayuda` a secas.
        if (pedido !== '') {
            const encontrado = COMANDOS.find((comando) =>
                comando.nombre === pedido || comando.uso === '/' + pedido);

            if (!encontrado) {
                player.sendTextMessage('No hay ningun comando "' + pedido + '". Escribe /ayuda.');
                return true;
            }

            player.sendTextMessage(encontrado.uso + '  -  ' + encontrado.que);
            return true;
        }

        player.sendTextMessage('Comandos disponibles:');

        COMANDOS.forEach((comando) => {
            player.sendTextMessage('  ' + comando.uso + '  -  ' + comando.que);
        });

        player.sendTextMessage('Escribe /ayuda <comando> para ver uno solo.');

        return true;
    }
};
