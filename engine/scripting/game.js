'use strict';

/**
 * `Game`: la API que los módulos de contenido usan sin tener que importar nada.
 *
 * Sobre la única global del proyecto. Todo lo demás evita globales a propósito
 * (basta ver tools/audit-globals.js y el fallo que motivó ese script), así que
 * conviene justificar por qué aquí sí:
 *
 *   - Es la superficie de scripting, y The Forgotten Server hace exactamente
 *     esto: un `Game` global con estas funciones. Copiarlo significa que quien
 *     sabe escribir un datapack reconoce la API.
 *   - La alternativa es que cada módulo de contenido haga
 *     `require('../../../../engine/...')`, una ruta relativa que se rompe en
 *     cuanto se mueve el archivo. Eso es peor: frágil y fea de leer.
 *   - Node permite la autorreferencia por nombre de paquete, pero obliga a
 *     declarar `exports` y a que el datapack conozca el nombre del paquete. Más
 *     ceremonia para el mismo resultado.
 *
 * Lo que la hace aceptable es que es UNA global, DELIBERADA, documentada, y que
 * el motor guarda y restaura el valor anterior al cerrarse, para no pisar a nadie.
 *
 * Nótese que aquí NO se exponen entidades del mundo: sólo funciones que devuelven
 * envoltorios (ver entities.js) o datos. Un script no puede alcanzar el estado
 * interno ni mutarlo sin pasar por la API.
 */

function createGame(deps) {
    const world = deps.world;
    const registry = deps.registry;
    const log = deps.logger;
    const config = deps.config || {};

    return {

        // -------------------------------------------------------------------
        // Mundo
        // -------------------------------------------------------------------

        /** Segundos de juego transcurridos. */
        getWorldTime() {
            return world.getWorldTime();
        },

        /** Busca un jugador conectado por nombre. Devuelve null si no está. */
        getPlayerByName(name) {
            const wanted = String(name).toLowerCase();
            for (const player of world.players.values()) {
                if (player.name.toLowerCase() === wanted) {
                    return registry.entities.player(player.id);
                }
            }
            return null;
        },

        /** Jugadores conectados. */
        getPlayerCount() {
            return world.players.size;
        },

        // -------------------------------------------------------------------
        // Items
        // -------------------------------------------------------------------

        /** Nombre del TIPO de item. `Game.getItemName(3031)` -> 'gold coin'. */
        getItemName(itemId) {
            const definition = world.itemTypes.get(Number(itemId));
            return definition ? definition.name : null;
        },

        /** Atributo declarado en items.xml, o undefined. */
        getItemAttribute(itemId, key) {
            const definition = world.itemTypes.get(Number(itemId));
            if (!definition || !definition.attributes) {
                return undefined;
            }
            return definition.attributes[key];
        },

        /** ¿Existe ese id de item? */
        itemTypeExists(itemId) {
            return world.itemTypes.has(Number(itemId));
        },

        /**
         * Crea una instancia de item en el mundo.
         * Devuelve un envoltorio `Item`, o null si el id no existe.
         */
        createItem(itemId, count) {
            if (!world.itemTypes.has(Number(itemId))) {
                log.warning('Game.createItem con un id desconocido: ' + itemId);
                return null;
            }
            const item = world.createItem(Number(itemId), count || 1, null);
            return registry.entities.item(item.id);
        },

        // -------------------------------------------------------------------
        // Monstruos
        // -------------------------------------------------------------------

        getMonsterType(name) {
            return world.monsterTypes.get(name) || null;
        },

        getMonsterTypeNames() {
            return Array.from(world.monsterTypes.keys());
        },

        // -------------------------------------------------------------------
        // Diagnóstico y administración
        // -------------------------------------------------------------------

        /** Escribe en el log del servidor, no en el chat de nadie. */
        log(...args) {
            log.info('[contenido] ' + args.map((a) =>
                typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
        },

        /**
         * Recarga el contenido de data/ sin reiniciar.
         *
         * Equivale al `/reload` de TFS, y hereda sus dos límites, que conviene
         * tener presentes: NO recarga el mapa ni la configuración estática
         * (puertos, nombre del mapa). Sólo las definiciones de los módulos.
         */
        reload() {
            if (!deps.reloadContent) {
                log.warning('Game.reload no esta disponible en este motor');
                return null;
            }
            return deps.reloadContent();
        },

        /** Informe de lo que hay cargado. */
        getStats() {
            return {
                items: world.itemTypes.size,
                monsterTypes: world.monsterTypes.size,
                actions: registry.actions.size,
                movements: registry.movements.size,
                talkActions: registry.talkActions.length,
                players: world.players.size,
                worldType: config.worldType
            };
        }
    };
}

/**
 * Instala `Game` como global y devuelve una función para restaurar el estado
 * anterior. El motor la usa al arrancar y al cerrarse.
 */
function installGame(game) {
    const previous = globalThis.Game;
    globalThis.Game = game;

    return function restore() {
        if (previous === undefined) {
            delete globalThis.Game;
        } else {
            globalThis.Game = previous;
        }
    };
}

module.exports = { createGame, installGame };
