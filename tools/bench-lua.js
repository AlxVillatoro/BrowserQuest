'use strict';

/**
 * Banco de pruebas del runtime de Lua.
 *
 * Mide lo que de verdad decide el diseño de un servidor scriptado: el coste de
 * **cruzar la frontera** entre JavaScript y Lua. No mide "cuánto tarda Lua en
 * sumar", porque eso no es el cuello de botella.
 *
 * Mide tres formas de pasar una entidad a un handler, haciendo las tres el mismo
 * trabajo (dos llamadas a la API más una operación de cadena):
 *
 *   1. Identificadores desnudos      Engine.getPlayerName(id)
 *   2. Shim orientado a objetos      player:getName()   <- el elegido
 *   3. Userdata de JavaScript        player:getName()   (envolviendo el objeto)
 *
 * La 2 se implementa en Lua puro, con una metatabla sobre el identificador. La 3
 * usa `pushjs` de fengari-interop, que envuelve un objeto JavaScript vivo.
 *
 * Y opcionalmente compara los dos runtimes viables, si `wasmoon` está instalado:
 *
 *   node tools/bench-lua.js [iteraciones]
 *
 * Resultados de referencia (20.000 iteraciones, Windows, Node 24). El ORDEN es
 * robusto y se reproduce siempre; las magnitudes NO, porque las variantes con
 * metatabla generan mucha basura para el recolector:
 *
 *   fengari   identificadores  el suelo (muy estable)
 *             shim OO          2,0x - 4,0x
 *             userdata         3,9x - 18,8x
 *   wasmoon   despacho con reentrada en JS ~1,5x mas lento que fengari
 *
 * De ahí salen las dos decisiones de ARQUITECTURA.md: la API cruza sólo enteros
 * y el azúcar orientado a objetos se construye en Lua. La conclusión que sostiene
 * la decisión es cualitativa (el shim es 1,3x-4,7x más rápido que el userdata),
 * no las cifras concretas de una corrida.
 */

const N = parseInt(process.argv[2] || '20000', 10);
const WARMUP = 2000;

const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const interop = require('fengari-interop');

function time(fn) {
    for (let i = 0; i < WARMUP; i += 1) {
        fn();
    }
    const start = Date.now();
    for (let i = 0; i < N; i += 1) {
        fn();
    }
    return Date.now() - start;
}

const perSecond = (ms) => (ms > 0 ? Math.round(N / (ms / 1000)) : 0);

function formatRow(label, ms, baseline) {
    return '  ' + label.padEnd(36) +
        String(Math.round(ms)).padStart(6) + ' ms   ' +
        perSecond(ms).toLocaleString('es-ES').padStart(8) + ' eventos/s   ' +
        (ms / baseline).toFixed(2) + 'x';
}

// ---------------------------------------------------------------------------
// fengari: las tres formas de pasar una entidad
// ---------------------------------------------------------------------------

function benchFengari() {
    const L = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(L);
    lauxlib.luaL_requiref(L, to_luastring('js'), interop.luaopen_js, 1);
    lua.lua_pop(L, 1);

    const player = { id: 1001, name: 'Avillatoro', hp: 100 };

    // La API primitiva: lo único que cruza son enteros.
    lua.lua_pushjsfunction(L, (state) => {
        lua.lua_pushstring(state, to_luastring(player.name));
        return 1;
    });
    lua.lua_setglobal(L, to_luastring('jsGetPlayerName'));

    lua.lua_pushjsfunction(L, (state) => {
        lua.lua_pushinteger(state, player.hp);
        return 1;
    });
    lua.lua_setglobal(L, to_luastring('jsGetPlayerHp'));

    function load(source) {
        if (lauxlib.luaL_dostring(L, to_luastring(source)) !== lua.LUA_OK) {
            throw new Error('Lua error: ' + lua.lua_tojsstring(L, -1));
        }
    }

    function call(name, pushArgs) {
        return () => {
            lua.lua_getglobal(L, to_luastring(name));
            pushArgs();
            if (lua.lua_pcall(L, 2, 1, 0) !== lua.LUA_OK) {
                throw new Error('Lua error: ' + lua.lua_tojsstring(L, -1));
            }
            lua.lua_pop(L, 1);
        };
    }

    // 1) Identificadores desnudos.
    load(`
        function onStepIn_ids(playerId, itemId)
            local name = jsGetPlayerName(playerId)
            local hp = jsGetPlayerHp(playerId)
            return hp + #name
        end
    `);

    const idsMs = time(call('onStepIn_ids', () => {
        lua.lua_pushinteger(L, player.id);
        lua.lua_pushinteger(L, 2160);
    }));

    // 2) Shim orientado a objetos, en Lua, sobre el identificador.
    load(`
        Player = {}
        Player.__index = Player
        function Player.new(id) return setmetatable({ id = id }, Player) end
        function Player:getName() return jsGetPlayerName(self.id) end
        function Player:getHp() return jsGetPlayerHp(self.id) end

        function onStepIn_shim(playerId, itemId)
            local player = Player.new(playerId)
            local name = player:getName()
            local hp = player:getHp()
            return hp + #name
        end
    `);

    const shimMs = time(call('onStepIn_shim', () => {
        lua.lua_pushinteger(L, player.id);
        lua.lua_pushinteger(L, 2160);
    }));

    // 3) Userdata de JavaScript: el objeto envuelto, no copiado.
    load(`
        function onStepIn_userdata(player, itemId)
            local name = player:getName()
            local hp = player:getHp()
            return hp + #name
        end
    `);

    const entity = {
        id: player.id,
        getName() { return player.name; },
        getHp() { return player.hp; }
    };

    const userdataMs = time(() => {
        lua.lua_getglobal(L, to_luastring('onStepIn_userdata'));
        interop.pushjs(L, entity);
        lua.lua_pushinteger(L, 2160);
        if (lua.lua_pcall(L, 2, 1, 0) !== lua.LUA_OK) {
            throw new Error('Lua error: ' + lua.lua_tojsstring(L, -1));
        }
        lua.lua_pop(L, 1);
    });

    lua.lua_close(L);

    return { idsMs, shimMs, userdataMs };
}

// ---------------------------------------------------------------------------
// wasmoon (opcional): sólo para comparar los dos runtimes
// ---------------------------------------------------------------------------

async function benchWasmoon() {
    let LuaFactory;
    try {
        ({ LuaFactory } = require('wasmoon'));
    } catch (e) {
        return null;
    }

    const start = Date.now();
    const luaEngine = await new LuaFactory().createEngine();
    const loadMs = Date.now() - start;

    luaEngine.global.set('jsSay', (name, id) => name.length + id);
    await luaEngine.doString(`
        function onStepIn_ids(name, hp, itemId)
            jsSay(name, itemId)
            return hp - 1
        end
    `);

    const handler = luaEngine.global.get('onStepIn_ids');
    const idsMs = time(() => handler('Avillatoro', 100, 2160));

    luaEngine.global.close();
    return { loadMs, idsMs };
}

// ---------------------------------------------------------------------------

async function main() {
    console.log('Coste de cruzar la frontera JS<->Lua, ' +
        N.toLocaleString('es-ES') + ' iteraciones\n');

    const f = benchFengari();

    console.log('fengari (Lua 5.3 en JavaScript)');
    console.log(formatRow('1) identificadores desnudos', f.idsMs, f.idsMs));
    console.log(formatRow('2) shim OO en Lua (el elegido)', f.shimMs, f.idsMs));
    console.log(formatRow('3) userdata de JavaScript', f.userdataMs, f.idsMs));

    console.log('');
    console.log('  El shim en Lua es ' + (f.userdataMs / f.shimMs).toFixed(1) +
        'x mas rapido que el userdata, con la misma sintaxis.');
    console.log('  El azucar `player:getName()` cuesta ' + (f.shimMs / f.idsMs).toFixed(2) +
        'x sobre identificadores desnudos.');

    const w = await benchWasmoon();

    if (w) {
        console.log('\nwasmoon (Lua 5.4 en WebAssembly), mismo despacho con reentrada');
        console.log('  arranque de la VM ......... ' + String(w.loadMs).padStart(6) + ' ms');
        console.log(formatRow('despacho con reentrada en JS', w.idsMs, w.idsMs));
        console.log('\n  fengari despacha ' + (w.idsMs / f.idsMs).toFixed(1) +
            'x mas rapido que wasmoon, pese a no ser una VM nativa.');
    } else {
        console.log('\n(wasmoon no instalado: `npm install --no-save wasmoon` para comparar)');
    }
}

main();
