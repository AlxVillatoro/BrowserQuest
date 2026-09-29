'use strict';

/**
 * Comandos de chat: /pos y /item.
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
    }

];
