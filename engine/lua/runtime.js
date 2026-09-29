'use strict';

/**
 * Host de Lua del motor.
 *
 * Decisiones de diseño, todas respaldadas por mediciones (ver tools/bench-lua.js
 * y la sección de rendimiento de ARQUITECTURA.md):
 *
 *  1. El puente JS<->Lua sólo cruza ENTEROS y CADENAS. Las entidades no se
 *     copian ni se envuelven: se pasan como identificadores.
 *
 *     Medido: pasar un objeto JS como tabla Lua cuesta ~2x, y envolverlo como
 *     userdata cuesta entre 3,9x y 5,1x. Pasar un entero es el suelo.
 *
 *  2. La ergonomía orientada a objetos (`player:getPosition()`) se construye en
 *     LUA, en `data/lib/`, con una metatabla sobre el identificador. Medido: eso
 *     cuesta 2,0-3,8x el suelo, frente a 3,9-5,1x del userdata, y además queda
 *     como código Lua que cualquiera puede leer y extender.
 *
 *  3. El motor expone una tabla `Engine` con primitivas y NO expone objetos de
 *     juego. La API pública `Game` se construye encima, en Lua.
 *
 * Sobre el nombre: el runtime es fengari, o sea una VM de Lua 5.3 escrita en
 * JavaScript. Se eligió frente a wasmoon (Lua 5.4 en WebAssembly) porque el
 * coste dominante aquí es cruzar la frontera, no ejecutar Lua: medido, fengari
 * despacha 1,5x más eventos por segundo que wasmoon con reentrada en JS.
 */

const fs = require('fs');
const path = require('path');

const fengari = require('fengari');
const interop = require('fengari-interop');

const { lua, lauxlib, lualib, to_luastring } = fengari;

const LUA_REGISTRY = lua.LUA_REGISTRYINDEX;

// ---------------------------------------------------------------------------
// Conversión de valores
// ---------------------------------------------------------------------------

/**
 * Convierte un valor de la pila de Lua a JavaScript.
 *
 * Sólo se usan las conversiones que hacen falta para leer configuración y
 * definiciones: nil, booleano, número, cadena y tabla. Las funciones y los
 * userdata se devuelven como undefined a propósito, porque lo que se hace con
 * ellas es referenciarlas en el registro, no convertirlas.
 */
function toJs(L, index, depth) {
    const level = depth || 0;
    if (level > 12) {
        return undefined;
    }

    switch (lua.lua_type(L, index)) {
        case lua.LUA_TNIL:
            return null;
        case lua.LUA_TBOOLEAN:
            return lua.lua_toboolean(L, index);
        case lua.LUA_TNUMBER:
            return lua.lua_tonumber(L, index);
        case lua.LUA_TSTRING:
            return lua.lua_tojsstring(L, index);
        case lua.LUA_TTABLE:
            return tableToJs(L, index, level);
        default:
            return undefined;
    }
}

/**
 * Convierte una tabla Lua a objeto o array de JavaScript.
 *
 * Se decide si es array al final, no al principio: se recogen las claves y, si
 * son exactamente los enteros 1..n sin huecos, se devuelve un array. Así
 * `{1, 2, 3}` llega como array y `{minlevel=1}` como objeto.
 */
function tableToJs(L, index, depth) {
    const abs = lua.lua_absindex(L, index);
    const collected = new Map();

    lua.lua_pushnil(L);
    while (lua.lua_next(L, abs) !== 0) {
        // La clave queda en -2 y el valor en -1.
        const keyType = lua.lua_type(L, -2);
        let key;

        if (keyType === lua.LUA_TSTRING) {
            key = lua.lua_tojsstring(L, -2);
        } else if (keyType === lua.LUA_TNUMBER) {
            key = lua.lua_tonumber(L, -2);
        } else {
            // Claves que no son cadena ni número: no se pueden representar.
            lua.lua_pop(L, 1);
            continue;
        }

        collected.set(key, toJs(L, -1, depth + 1));
        lua.lua_pop(L, 1);
    }

    const numericKeys = Array.from(collected.keys()).filter((k) => typeof k === 'number');
    const isSequence = numericKeys.length === collected.size &&
        numericKeys.length > 0 &&
        numericKeys.every((k) => Number.isInteger(k) && k >= 1 && k <= numericKeys.length);

    if (isSequence) {
        const array = [];
        for (let i = 1; i <= numericKeys.length; i += 1) {
            array.push(collected.get(i));
        }
        return array;
    }

    const object = {};
    collected.forEach((value, key) => {
        object[key] = value;
    });
    return object;
}

/**
 * Marca un argumento de despacho como "referencia del registro de Lua", para
 * que al empujarlo se resuelva a la FUNCIÓN y no a su número.
 *
 * Sin esto, el envoltorio de despacho recibiría un entero donde espera un
 * handler, y Lua fallaría con "attempt to call a number value". Las referencias
 * viven en JavaScript (son el equivalente a `luaL_ref`) y Lua no puede ver el
 * registro, así que la resolución tiene que ocurrir de este lado.
 */
function luaRef(ref) {
    return { __luaRef: ref };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

class LuaRuntime {
    /**
     * @param {Object} options
     * @param {string} options.rootDir raíz del proyecto (para resolver rutas)
     * @param {Object} options.logger
     */
    constructor(options) {
        this.rootDir = options.rootDir;
        this.log = options.logger;

        this.state = lauxlib.luaL_newstate();
        lualib.luaL_openlibs(this.state);
        // fengari-interop registra la librería `js` dentro del estado.
        lauxlib.luaL_requiref(this.state, to_luastring('js'), interop.luaopen_js, 1);
        lua.lua_pop(this.state, 1);

        // Registro de contenido, tal y como lo dejarían los scripts al cargarse.
        this.actions = new Map();       // itemId -> { ref, script }
        this.movements = new Map();     // "stepin:itemId" -> { ref, script }
        this.talkActions = [];          // { words, ref, script }
        this.monsterTypes = new Map();  // nombre -> definición (objeto JS)

        // Referencias a los envoltorios de despacho definidos en Lua.
        this.dispatchRefs = {};

        this.loadedScripts = [];
        this.currentScript = null;
        this._refs = [];
    }

    // -- ejecución de código ------------------------------------------------

    /**
     * Ejecuta un chunk y devuelve el error como excepción de JavaScript con la
     * ruta y la línea de Lua, que es lo único que hace depurable un script.
     */
    runChunk(source, chunkName) {
        const L = this.state;
        const bytes = to_luastring(source);

        const loadStatus = lauxlib.luaL_loadbuffer(L, bytes, bytes.length, to_luastring(chunkName));
        if (loadStatus !== lua.LUA_OK) {
            const message = lua.lua_tojsstring(L, -1);
            lua.lua_pop(L, 1);
            throw new Error('Error de sintaxis en ' + chunkName + ':\n' + message);
        }

        const callStatus = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
        if (callStatus !== lua.LUA_OK) {
            const message = lua.lua_tojsstring(L, -1);
            lua.lua_pop(L, 1);
            throw new Error('Error en ' + chunkName + ':\n' + message);
        }

        // Se descarta lo que haya dejado el chunk en la pila.
        lua.lua_settop(L, 0);
    }

    runFile(filepath) {
        const source = fs.readFileSync(filepath, 'utf8');
        const relative = path.relative(this.rootDir, filepath).split(path.sep).join('/');
        this.runChunk(source, '@' + relative);
        return relative;
    }

    /** Ejecuta todos los .lua de un directorio, en orden de ruta. */
    runDirectory(dir, options) {
        const settings = options || {};
        if (!fs.existsSync(dir)) {
            return [];
        }

        const files = [];
        const walk = (current) => {
            fs.readdirSync(current, { withFileTypes: true })
                .sort((a, b) => a.name.localeCompare(b.name))
                .forEach((entry) => {
                    const full = path.join(current, entry.name);
                    if (entry.isDirectory()) {
                        walk(full);
                    } else if (entry.name.endsWith('.lua')) {
                        files.push(full);
                    }
                });
        };
        walk(dir);

        const loaded = [];
        files.forEach((file) => {
            // Se recuerda qué script se está cargando: es lo que permite que un
            // registro diga de dónde viene cuando dos scripts chocan por el
            // mismo id, que es el error más común al escribir un datapack.
            this.currentScript = path.relative(this.rootDir, file).split(path.sep).join('/');
            try {
                const relative = this.runFile(file);
                loaded.push(relative);
                this.loadedScripts.push(relative);
                if (settings.verbose) {
                    this.log.debug('script cargado: ' + relative);
                }
            } catch (error) {
                if (settings.onError === 'skip') {
                    this.log.error('script descartado: ' + error.message);
                } else {
                    throw error;
                }
            }
        });

        return loaded;
    }

    // -- globales -----------------------------------------------------------

    getGlobal(name) {
        const L = this.state;
        lua.lua_getglobal(L, to_luastring(name));
        const value = toJs(L, -1, 0);
        lua.lua_pop(L, 1);
        return value;
    }

    setGlobal(name, value) {
        const L = this.state;
        this._pushJsValue(value);
        lua.lua_setglobal(L, to_luastring(name));
    }

    _pushJsValue(value) {
        const L = this.state;
        if (value === null || value === undefined) {
            lua.lua_pushnil(L);
        } else if (typeof value === 'boolean') {
            lua.lua_pushboolean(L, value);
        } else if (typeof value === 'number') {
            lua.lua_pushnumber(L, value);
        } else if (typeof value === 'string') {
            lua.lua_pushstring(L, to_luastring(value));
        } else if (Array.isArray(value)) {
            lua.lua_createtable(L, value.length, 0);
            value.forEach((item, index) => {
                this._pushJsValue(item);
                lua.lua_seti(L, -2, index + 1);
            });
        } else if (typeof value === 'object') {
            lua.lua_createtable(L, 0, Object.keys(value).length);
            Object.keys(value).forEach((key) => {
                this._pushJsValue(value[key]);
                lua.lua_setfield(L, -2, to_luastring(key));
            });
        } else {
            lua.lua_pushnil(L);
        }
    }

    // -- API expuesta a Lua -------------------------------------------------

    /**
     * Publica una tabla de primitivas como global `Engine`.
     *
     * @param {Object} primitives nombre -> función JS. Cada función recibe el
     *        estado de Lua como primer argumento, lee sus parámetros de la pila
     *        (índices 1..n) y devuelve cuántos valores deja en ella.
     */
    registerApi(primitives) {
        const L = this.state;
        lua.lua_newtable(L);
        Object.keys(primitives).forEach((name) => {
            lua.lua_pushjsfunction(L, primitives[name]);
            lua.lua_setfield(L, -2, to_luastring(name));
        });
        lua.lua_setglobal(L, to_luastring('Engine'));
    }

    /**
     * Toma una referencia a la función que está en la cima de la pila, para
     * poder invocarla más tarde sin volver a buscarla.
     */
    _refTop() {
        return lauxlib.luaL_ref(this.state, LUA_REGISTRY);
    }

    _pushRef(ref) {
        lua.lua_rawgeti(this.state, LUA_REGISTRY, ref);
    }

    /** Guarda referencias a los envoltorios de despacho definidos en Lua. */
    resolveDispatchWrappers() {
        ['action', 'movement', 'talkaction'].forEach((name) => {
            const L = this.state;
            lua.lua_getglobal(L, to_luastring('__engine_dispatch'));
            if (lua.lua_type(L, -1) !== lua.LUA_TTABLE) {
                lua.lua_pop(L, 1);
                this.log.warning('data/lib no definió __engine_dispatch: no habrá despacho de eventos');
                return;
            }
            lua.lua_getfield(L, -1, to_luastring(name));
            if (lua.lua_type(L, -1) === lua.LUA_TFUNCTION) {
                this.dispatchRefs[name] = this._refTop();
                // luaL_ref ya desapiló la función; queda la tabla.
            } else {
                lua.lua_pop(L, 1);
            }
            lua.lua_pop(L, 1);
        });
    }

    // -- despacho de eventos ------------------------------------------------

    /**
     * Invoca un handler de script.
     *
     * @param {number} ref referencia en el registro de la función de despacho
     * @param {Array} args argumentos ya listos (números y cadenas)
     * @returns {*} lo que devuelva el script, convertido a JavaScript
     */
    _dispatch(ref, args) {
        const L = this.state;
        const top = lua.lua_gettop(L);

        this._pushRef(ref);
        args.forEach((arg) => {
            if (arg !== null && typeof arg === 'object' && typeof arg.__luaRef === 'number') {
                this._pushRef(arg.__luaRef);
            } else {
                this._pushJsValue(arg);
            }
        });

        if (lua.lua_pcall(L, args.length, 1, 0) !== lua.LUA_OK) {
            const message = lua.lua_tojsstring(L, -1);
            lua.lua_settop(L, top);
            throw new Error('Error en un handler de script:\n' + message);
        }

        const result = toJs(L, -1, 0);
        lua.lua_settop(L, top);
        return result;
    }

    /**
     * Despacha una acción de item (el `onUse` de TFS).
     *
     * @param {number} itemId id del item usado
     * @param {Object} context identificadores de las entidades implicadas
     */
    dispatchAction(itemId, context) {
        const entry = this.actions.get(itemId);
        if (!entry) {
            return { handled: false };
        }

        const ref = this.dispatchRefs.action;
        if (ref === undefined) {
            return { handled: false };
        }

        const c = context || {};
        const result = this._dispatch(ref, [
            luaRef(entry.ref),
            c.playerId || 0,
            itemId,
            c.fromX || 0, c.fromY || 0, c.fromZ || 0,
            c.targetId || 0,
            c.toX || 0, c.toY || 0, c.toZ || 0,
            c.isHotkey ? 1 : 0
        ]);

        return { handled: result === true, result: result, script: entry.script };
    }

    dispatchMovement(type, itemId, context) {
        const entry = this.movements.get(type + ':' + itemId);
        if (!entry || this.dispatchRefs.movement === undefined) {
            return { handled: false };
        }

        const c = context || {};
        const result = this._dispatch(this.dispatchRefs.movement, [
            luaRef(entry.ref),
            c.creatureId || 0,
            itemId,
            c.x || 0, c.y || 0, c.z || 0,
            c.fromX || 0, c.fromY || 0, c.fromZ || 0
        ]);

        return { handled: result === true, result: result, script: entry.script };
    }

    dispatchTalkAction(words, context) {
        const lower = String(words).toLowerCase();

        // Coincidencia por prefijo, que es lo que permite que "/item 3031"
        // active la talkaction registrada como "/item". En TFS esto lo resuelve
        // el separador; aquí se exige que lo que sigue sea un espacio, para que
        // "/itemx" no active "/item". Si varias casan, gana la más específica.
        const match = this.talkActions
            .filter((t) => lower === t.words || lower.startsWith(t.words + ' '))
            .sort((a, b) => b.words.length - a.words.length)[0];

        if (!match || this.dispatchRefs.talkaction === undefined) {
            return { handled: false };
        }

        const c = context || {};
        const result = this._dispatch(this.dispatchRefs.talkaction, [
            luaRef(match.ref),
            c.playerId || 0,
            words,
            match.words
        ]);

        return { handled: result === true, result: result, script: match.script };
    }

    close() {
        if (this.state) {
            lua.lua_close(this.state);
            this.state = null;
        }
    }
}

module.exports = { LuaRuntime, toJs, tableToJs };
