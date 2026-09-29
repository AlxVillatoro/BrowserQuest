'use strict';

/**
 * API primitiva expuesta a Lua como tabla global `Engine`.
 *
 * Aquí sólo hay Frontera: cada función recibe identificadores y devuelve
 * números, cadenas o nada. Ninguna construye objetos de juego ni copia estado.
 *
 * La API pública que ve el que escribe scripts (`Game`, `Player`, `Position`...)
 * se construye encima, en `data/lib/`, en Lua. Esa separación es deliberada:
 *
 *   - Medido, cruzar la frontera con un entero es el suelo de coste. Copiar un
 *     objeto cuesta ~2x y envolverlo como userdata 3,9-5,1x.
 *   - El azúcar orientado a objetos hecho en Lua cuesta 2,0-3,8x, menos que el
 *     userdata, y encima queda como código que el usuario del datapack puede
 *     leer, depurar y extender sin tocar el motor.
 *
 * Se evalúo la alternativa de exponer userdata con métodos (lo que hace TFS con
 * sus userdata de C++) y se descartó por medida, no por gusto.
 */

const { lua, to_luastring } = require('fengari');
const { toJs } = require('./runtime');

function argInt(state, index) {
    if (lua.lua_type(state, index) !== lua.LUA_TNUMBER) {
        return 0;
    }
    return lua.lua_tointeger(state, index);
}

function argString(state, index) {
    const type = lua.lua_type(state, index);
    if (type === lua.LUA_TSTRING) {
        return lua.lua_tojsstring(state, index);
    }
    if (type === lua.LUA_TNUMBER) {
        return String(lua.lua_tonumber(state, index));
    }
    return '';
}

function pushString(state, value) {
    if (value === null || value === undefined) {
        lua.lua_pushnil(state);
    } else {
        lua.lua_pushstring(state, to_luastring(String(value)));
    }
}

/** Normaliza un argumento que puede ser un número suelto o una tabla de números. */
function toIdList(state, index) {
    const value = toJs(state, index, 0);
    if (value === null || value === undefined) {
        return [];
    }
    const list = Array.isArray(value) ? value : [value];
    return list.map(Number).filter((n) => !Number.isNaN(n));
}

/**
 * @param {Object} deps
 * @param {Object} deps.runtime instancia de LuaRuntime
 * @param {Object} deps.world estado del mundo
 * @param {Object} deps.log logger
 */
function createPrimitives(deps) {
    const runtime = deps.runtime;
    const world = deps.world;

    // El nombre del script que se está cargando, para poder decir de dónde sale
    // cada registro cuando algo choque.
    const currentScript = () => runtime.currentScript || 'desconocido';

    return {

        // ---------------------------------------------------------------
        // Jugadores
        // ---------------------------------------------------------------

        getPlayerName(state) {
            const player = world.getPlayer(argInt(state, 1));
            if (!player) {
                lua.lua_pushnil(state);
                return 1;
            }
            pushString(state, player.name);
            return 1;
        },

        getPlayerPosition(state) {
            const player = world.getPlayer(argInt(state, 1));
            const position = player ? player.position : { x: 0, y: 0, z: 0 };
            lua.lua_pushinteger(state, position.x);
            lua.lua_pushinteger(state, position.y);
            lua.lua_pushinteger(state, position.z);
            return 3;
        },

        getPlayerHealth(state) {
            const player = world.getPlayer(argInt(state, 1));
            lua.lua_pushinteger(state, player ? player.health : 0);
            lua.lua_pushinteger(state, player ? player.maxHealth : 0);
            return 2;
        },

        getPlayerLevel(state) {
            const player = world.getPlayer(argInt(state, 1));
            lua.lua_pushinteger(state, player ? player.level : 0);
            return 1;
        },

        getPlayerVocation(state) {
            const player = world.getPlayer(argInt(state, 1));
            pushString(state, player ? player.vocation : null);
            return 1;
        },

        sendTextMessage(state) {
            world.sendTextMessage(argInt(state, 1), argString(state, 2));
            return 0;
        },

        teleportPlayer(state) {
            const moved = world.teleportPlayer(
                argInt(state, 1), argInt(state, 2), argInt(state, 3), argInt(state, 4));
            lua.lua_pushboolean(state, moved);
            return 1;
        },

        // ---------------------------------------------------------------
        // Tipos e instancias de item
        // ---------------------------------------------------------------

        getItemName(state) {
            const definition = world.itemTypes.get(argInt(state, 1));
            pushString(state, definition ? definition.name : null);
            return 1;
        },

        getItemAttribute(state) {
            const definition = world.itemTypes.get(argInt(state, 1));
            const key = argString(state, 2);
            if (!definition || !definition.attributes || definition.attributes[key] === undefined) {
                lua.lua_pushnil(state);
                return 1;
            }
            runtime._pushJsValue(definition.attributes[key]);
            return 1;
        },

        createItem(state) {
            const item = world.createItem(argInt(state, 1), argInt(state, 2));
            lua.lua_pushinteger(state, item.id);
            return 1;
        },

        getItemId(state) {
            const item = world.getItem(argInt(state, 1));
            lua.lua_pushinteger(state, item ? item.itemId : 0);
            return 1;
        },

        getItemCount(state) {
            const item = world.getItem(argInt(state, 1));
            lua.lua_pushinteger(state, item ? item.count : 0);
            return 1;
        },

        removeItem(state) {
            lua.lua_pushboolean(state, world.items.delete(argInt(state, 1)));
            return 1;
        },

        // ---------------------------------------------------------------
        // Mundo
        // ---------------------------------------------------------------

        getWorldTime(state) {
            lua.lua_pushinteger(state, world.getWorldTime());
            return 1;
        },

        log(state) {
            deps.log.info('[lua] ' + argString(state, 1));
            return 0;
        },

        // ---------------------------------------------------------------
        // Registro de contenido
        //
        // Estas son las que convierten a Lua en un datapack extensible. La
        // función del script se guarda como referencia en el registro de Lua,
        // no como copia: se invoca cuando ocurre el evento.
        // ---------------------------------------------------------------

        registerAction(state) {
            const ids = toIdList(state, 1);
            // Se duplica la función (argumento 2) porque luaL_ref la desapila.
            lua.lua_pushvalue(state, 2);
            const ref = runtime._refTop();
            const script = currentScript();

            ids.forEach((id) => {
                if (runtime.actions.has(id)) {
                    deps.log.warning('accion duplicada para el item ' + id +
                        ': ' + runtime.actions.get(id).script + ' y ' + script);
                }
                runtime.actions.set(id, { ref: ref, script: script });
            });
            return 0;
        },

        registerMovement(state) {
            const type = argString(state, 1);
            const ids = toIdList(state, 2);
            lua.lua_pushvalue(state, 3);
            const ref = runtime._refTop();
            const script = currentScript();

            ids.forEach((id) => {
                runtime.movements.set(type + ':' + id, { ref: ref, script: script });
            });
            return 0;
        },

        registerTalkAction(state) {
            const words = argString(state, 1).toLowerCase();
            lua.lua_pushvalue(state, 2);
            const ref = runtime._refTop();

            runtime.talkActions.push({ words: words, ref: ref, script: currentScript() });
            return 0;
        },

        registerMonsterType(state) {
            const name = argString(state, 1);
            const definition = toJs(state, 2, 0);

            if (!name) {
                deps.log.error('Game.createMonsterType sin nombre, en ' + currentScript());
                return 0;
            }

            definition.name = name;
            definition.script = currentScript();
            world.monsterTypes.set(name, definition);
            return 0;
        }
    };
}

module.exports = { createPrimitives };
