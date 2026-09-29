'use strict';

/**
 * Comandos de chat: /pos, /item, /outfit y /i.
 *
 * Este archivo exporta un ARRAY, que es la forma de declarar varios registros en
 * el mismo módulo. Es lo que sustituye a llamar a `:register()` dos veces.
 *
 * La firma de `onSay` es la de TFS y tiene CUATRO argumentos:
 *
 *     onSay(player, words, param, type)
 *
 * `param` es lo que va después del comando, y `type` es el canal (hablar,
 * susurrar, gritar). Recortar el cuarto argumento sería recortar la API real.
 */

module.exports = [

    {
        type: 'talkaction',
        words: '/pos',

        onSay(player, words, param, type) {
            const position = player.getPosition();

            player.sendTextMessage(
                'Posicion: ' + position +
                '  Vida: ' + player.getHealth() + '/' + player.getMaxHealth() +
                '  Nivel: ' + player.getLevel() +
                '  Vocacion: ' + player.getVocation());

            return true;
        }
    },

    {
        type: 'talkaction',
        words: '/item',

        onSay(player, words, param, type) {
            const itemId = Number(param);

            if (!param || Number.isNaN(itemId)) {
                player.sendTextMessage('Uso: /item <id>');
                return true;
            }

            const name = Game.getItemName(itemId);
            if (name === null) {
                player.sendTextMessage('No existe ningun item con id ' + itemId);
                return true;
            }

            Game.createItem(itemId, 1);
            player.sendTextMessage('Creado: ' + name);
            return true;
        }
    },

    {
        type: 'talkaction',
        words: '/outfit',

        /**
         * Cambia el aspecto.
         *
         * Uso:  /outfit <lookType> [cabeza] [cuerpo] [piernas] [pies] [anadidos]
         *
         * Los colores son ÍNDICES de una paleta de 133 que tiene el cliente, no valores
         * de color. Escribir `/outfit 136 78 69 58 115` no significa "un poco de azul",
         * significa "los colores 78, 69, 58 y 115 de la paleta".
         *
         * EL COMANDO NO COMPRUEBA EL RANGO DE LOS COLORES a propósito: de eso se encarga
         * el motor al normalizar, y tener la misma regla en dos sitios es como se acaba
         * con dos reglas distintas. Aquí sólo se comprueba lo que el motor no puede
         * saber, que es si el número es un número.
         */
        onSay(player, words, param, type) {
            const parts = String(param || '').trim().split(/\s+/).filter(Boolean);

            if (parts.length === 0) {
                player.sendTextMessage('Uso: /outfit <tipo> [cabeza] [cuerpo] [piernas] [pies] [anadidos]');
                return true;
            }

            const numbers = parts.map(Number);
            if (numbers.some((value) => Number.isNaN(value))) {
                player.sendTextMessage('Los valores tienen que ser numeros.');
                return true;
            }

            const current = player.getOutfit();

            const requested = {
                lookType: numbers[0],
                lookHead: numbers.length > 1 ? numbers[1] : current.lookHead,
                lookBody: numbers.length > 2 ? numbers[2] : current.lookBody,
                lookLegs: numbers.length > 3 ? numbers[3] : current.lookLegs,
                lookFeet: numbers.length > 4 ? numbers[4] : current.lookFeet,
                lookAddons: numbers.length > 5 ? numbers[5] : current.lookAddons
            };

            const result = player.setOutfit(requested);

            if (!result.ok) {
                player.sendTextMessage('No se puede: ' + result.reason);
                return true;
            }

            const applied = player.getOutfit();

            player.sendTextMessage(
                'Aspecto: tipo ' + applied.lookType +
                ', colores ' + applied.lookHead + ' ' + applied.lookBody + ' ' +
                applied.lookLegs + ' ' + applied.lookFeet +
                ', anadidos ' + applied.lookAddons);

            return true;
        }
    },

    {
        type: 'talkaction',
        words: '/i',

        /**
         * Lista lo que lleva encima.
         *
         * El inventario también se ve en la barra de abajo del cliente, así que este
         * comando parece redundante. No lo es: la barra sólo funciona si el cliente está
         * funcionando, y este comando va por el mismo camino que todo lo demás, así que
         * sirve para comprobar desde una consola que lo que el jugador lleva es lo que el
         * motor cree que lleva. Cuando los dos no coinciden, poder preguntárselo al motor
         * por un camino distinto es la diferencia entre encontrar el fallo y suponerlo.
         */
        onSay(player, words, param, type) {
            const items = player.getInventory();

            if (items.length === 0) {
                player.sendTextMessage('No llevas nada.');
                return true;
            }

            player.sendTextMessage('Llevas ' + items.length + ' cosa(s):');

            items.forEach((entry) => {
                player.sendTextMessage(
                    '  ' + entry.index + '. ' +
                    (entry.count > 1 ? entry.count + 'x ' : '') +
                    entry.name + ' (id ' + entry.typeId + ')');
            });

            // El peso va al final y no al principio: primero se dice QUÉ llevas y después
            // cuánto pesa, que es el orden en que se piensa la pregunta.
            player.sendTextMessage('Peso: ' + player.getWeightText() +
                ' de ' + player.getCapacityText() + '.');

            return true;
        }
    }

];
