# Motor de juego extensible en Node.js con scripts Lua y definiciones XML

**Informe técnico — modelo The Forgotten Server (TFS)**

> **Fecha de datos:** todos los metadatos de npm/GitHub de este informe se consultaron en la sesión actual (ventana de descargas: 2026‑08‑29 → 2026‑09‑27). Los números de versión, fechas y estrellas son los devueltos por `registry.npmjs.org`, `api.npmjs.org` y `api.github.com` en ese momento.
>
> **Cómo se verificó:** metadatos vía `npm view` (con `npm_config_cache` redirigido al workspace, porque el caché por defecto da `EPERM` bajo el sandbox) y vía las APIs HTTP de npm/GitHub; código de TFS leído directamente de `raw.githubusercontent.com/otland/forgottenserver/master/...`.

---

## 0. Resumen ejecutivo (TL;DR)

| Pregunta | Respuesta corta |
|---|---|
| ¿Qué uso para ejecutar Lua en Node? | **wasmoon** (`1.16.0`, Lua 5.4 real en WASM, MIT) como opción por defecto. `2.0.0-next.0` existe como *next*. |
| ¿Fengari? | Viable y muy ligero, pero es Lua **5.3**, ~25× más lento en bucles puros según el propio benchmark de wasmoon, y su interop es la **API C cruda** salvo que añadas `fengari-interop`. |
| ¿Bindings nativos? | Prácticamente **muertos**: `node-lua@1.0.4` (2017, `node-gyp`, repo sin tocar desde 2017), `luajit` **despublicado** en npm (2017‑12‑18). No los uses. |
| ¿LuaJIT en WASM? | **No existe** un port serio y empaquetado. Hay experimentos (`lua-ffi-wasm`, 10★) y discusiones abiertas (Neovim). Descartable para producción hoy. |
| Patrón de extensibilidad | Replicar el **RevScriptSys** de TFS 1.4+: `data/scripts/**.lua` con constructores `Action`, `TalkAction`, `MoveEvent`, `CreatureEvent`, `GlobalEvent`, `Spell`, `Weapon` + `:register()`, apoyados en XML de registro (`actions.xml`, `movements.xml`, …) y en una API orientada a objetos que usa `:` sobre userdata. |
| XML en Node | **fast-xml-parser** (`5.11.2`) para definiciones grandes; **libxml2-wasm** (`0.7.2`) si necesitas XSD de verdad sin toolchain C++. **libxmljs2** está declarado **NO LONGER MAINTAINED** por su propio autor. |
| ¿XSD merece la pena? | Para `items.xml`/`monsters.xml` **no**: valida por esquema propio en JS y da errores semánticos mejores. Sí para *formatos de terceros*. |
| Configuración | Mantener el patrón `config.lua`: es un **script** que se evalúa al arrancar y define una tabla global. Da aritmética, comentarios, tablas anidadas y lógica condicional gratis. |

---

## 1. Ejecutar Lua dentro de Node.js

### 1.1 Tabla comparativa (datos verificados)

| Opción | Versión actual | Publicada | Licencia | Estrellas GitHub | ¿Compilación nativa? | Lua |
|---|---|---|---|---|---|---|
| [wasmoon](https://www.npmjs.com/package/wasmoon) | `1.16.0` (`latest`), `2.0.0-next.0` (`next`) | 1.16.0 → **2023‑12‑08**; 2.0.0‑next.0 → **2026‑04‑25** | MIT | [702★ ceifa/wasmoon](https://github.com/ceifa/wasmoon) | **No** (WASM precargado, `@types/emscripten` es solo tipos) | **5.4** |
| [fengari](https://www.npmjs.com/package/fengari) | `0.1.5` | **2025‑12‑26** (0.1.4 era de 2018‑11‑18: 7 años de hueco) | MIT | [2032★ fengari-lua/fengari](https://github.com/fengari-lua/fengari) | No (JS puro ES6) | **5.3** |
| [fengari-interop](https://www.npmjs.com/package/fengari-interop) | `0.1.4` | 2025‑12‑21 | MIT | — | No | — |
| [wasmoon-lua5.1](https://www.npmjs.com/package/wasmoon-lua5.1) | `1.18.10` | 2024‑02‑19 | MIT | [X3ZvaWQ/wasmoon-lua5.1](https://github.com/X3ZvaWQ/wasmoon-lua5.1) | No | **5.1** (fork no oficial) |
| [lua-in-js](https://www.npmjs.com/package/lua-in-js) | `2.2.5` | 2024‑07‑13 | MIT | [107★, **archivado**](https://github.com/teoxoy/lua-in-js) | No | transpila a JS |
| [lua-state](https://www.npmjs.com/package/lua-state) | `1.2.0` | 2026‑02‑04 | MIT | [quaternion/node-lua-state](https://github.com/quaternion/node-lua-state) | **Sí** (`node-gyp`) | n/a |
| [node-lua](https://www.npmjs.com/package/node-lua) | `1.0.4` | 2017 (npm `time.modified` 2022) | ISC | [11★ medaeus245/node-lua](https://github.com/medaeus245/node-lua) — último push **2017‑06‑11** | **Sí** (`node-gyp rebuild`) | 5.1 |
| `luajit` (npm) | — | **despublicado 2017‑12‑18** | — | — | — | — |
| `lua.vm.js` | `0.0.1` | 2022 (metadata) | MIT | [kripken/lua.vm.js](https://github.com/kripken/lua.vm.js) | No | 5.1 (proyecto histórico de asm.js) |

**Descargas último mes (2026‑08‑29 → 2026‑09‑27):** `wasmoon` **224.341**, `fengari` **7.005.128** ([api.npmjs.org](https://api.npmjs.org/downloads/point/last-month/wasmoon)). Fengari gana por mucho en descargas porque es dependencia transitiva de herramientas de terceros, no porque se use más como motor embebido.

### 1.2 wasmoon (Lua 5.4 en WASM) — la opción por defecto

El propio autor lo describe como *"A real lua VM with JS bindings made with webassembly"* y su repositorio se titula *"A real lua 5.4 VM"* ([README](https://github.com/ceifa/wasmoon)). Compila el árbol oficial de Lua a WASM y añade una capa de *interop*:

```js
const { LuaFactory } = require('wasmoon')

const factory = new LuaFactory()
const lua = await factory.createEngine()

lua.global.set('sum', (x, y) => x + y)      // función JS → global Lua
await lua.doString(`
  print(sum(10, 10))
  function multiply(x, y) return x * y end
`)
const multiply = lua.global.get('multiply')  // función Lua → callable JS
console.log(multiply(10, 10))
lua.global.close()                           // liberar el estado
```

Puntos clave para un servidor de juego:

* **Rendimiento:** el README publica un benchmark de *heap sort* sobre 2.000 números ×10: **wasmoon 15,267 ms vs fengari 389,923 ms** (~25×). Es del propio autor, así que tómese como orden de magnitud, no como verdad absoluta; el mismo README advierte: *"if you are going to interop a lot between JS and Lua, this may be not be true anymore"* — con **mucho** cruce de frontera la ventaja se estrecha.
* **Tamaño:** 393 kB (130 kB gzip) frente a 214 kB (69 kB) de fengari. Irrelevante en servidor.
* **Interop:** `lua.global.set/get` maneja funciones, tablas y objetos JS (con `injectObjects`). Las **Promesas** se pueden *await* desde Lua con `promise:await()`, lo que permite `dbQuery(...):await()` en un script — muy potente para persistencia.
* **Limitación real e importante:** *"It's not possible to await in a callback from JS into Lua. This is a limitation of Lua"*. Es decir, **no puedes hacer `:await()` dentro de un callback síncrono que vino de JS** (p. ej. dentro de `onUse`). Los errores típicos son `attempt to yield across a C-call boundary` y `cannot resume dead coroutine`. El README propone un *workaround* explícito con `coroutine.create` + `Promise.create`.
* **LuaJIT:** no hay integración. `wasmoon-lua5.1` (fork de tercero, `1.18.10`, feb‑2024) cubre el nicho de Lua 5.1 pero **no** es LuaJIT ni tiene JIT.
* **Windows sin toolchain:** ✅. `npm i wasmoon` baja el `.wasm` ya compilado; el README solo pide Docker/emscripten para **reconstruir** el binario.
* **Mantenimiento:** `latest` congelado desde dic‑2023, pero hay `2.0.0-next.0` de abr‑2026 con build moderno (rolldown, ESM `"type": "module"`, TypeScript 6, `oxlint`), señal de que el proyecto sigue vivo. Para producción usar `1.16.0` (estable) y vigilar el `next`.

### 1.3 fengari (VM Lua 5.3 escrita en JS)

* Es una **traducción 1:1 de la API C de Lua** a JavaScript: *"The JS API is exactly the same as the C API"* — `fengari.lua` expone lo mismo que `lua.h`, `fengari.lauxlib` lo de `lauxlib.h` ([README](https://github.com/fengari-lua/fengari)). Para exponer una API de juego escribirías `lua_pushcfunction` / `luaL_newlib` / `lua_setfield` a mano… o usar **`fengari-interop`**, que es la capa que hace el trabajo sucio ("makes interoperating with JavaScript objects simple").
* **Diferencias que importan:**
  * **Enteros de 32 bits**, no 64: usa `LUA_INT_TYPE=LUA_INT_LONG`. Los IDs de criatura/ítem de TFS caben sobradamente, pero no esperes enteros de 64 bits nativos.
  * Las **cadenas Lua son `Uint8Array`** (8-bit clean): necesitas `lua_tojsstring`, `to_luastring`, `to_jsstring`.
  * **No implementa `lua_gc`/`collectgarbage`**, ni **tablas débiles**, ni **`__gc`**. Depende del GC de JS.
  * `io` completo, `os.remove/rename/tmpname/execute` **solo en Node** (no en navegador).
* **Licencia MIT, 2032★, release reciente (dic‑2025)**: es un proyecto serio y con mantenimiento intermitente pero real.
* **Windows sin toolchain:** ✅ (JS puro).

### 1.4 lua-in-js y alternativas modernas

* **`lua-in-js` (`2.2.5`) está oficialmente deprecado**: el propio registro npm marca la versión como *"Package no longer supported"*, el repositorio de GitHub está **archivado** y su README declara explícitamente las funcionalidades ausentes ([README](https://github.com/teoxoy/lua-in-js)): *"coroutine library, debug library, utf8 library, io library, package.cpath, package.loadlib, string.dump, string.pack, string.unpack, os.clock, os.execute, os.getenv, os.remove, os.rename, os.tmpname"*. Es un **transpilador Lua→JS** (`luaparse`), no una VM. **Descartado**: sin corrutinas no hay `onThink` cooperativo ni `addEvent`.
* **`lua-state` (`1.2.0`, feb‑2026)**: binding nativo (`node-gyp`) y paquete joven (primera publicación nov‑2025). Mantenimiento prometedor pero inmaduro.
* **`lua.vm.js` (`0.0.1`)**: experimento histórico de asm.js de kripken. No usar.

### 1.5 Bindings nativos: ¿siguen vivos? ¿compilan hoy en Windows?

**No, y es un callejón sin salida:**

* **`node-lua@1.0.4`**: `"gypfile": true`, `"scripts": {"install": "node-gyp rebuild"}`, dependencia de `nan@^2.6.2`, `_nodeVersion: 6.10.2` en su metadato de publicación, último push al repo **2017‑06‑11**, 11 estrellas. En un Node moderno (ABI 127+) `nan` de esa época no compila; y aunque compilara necesitarías Visual Studio Build Tools + Python. **Riesgo alto**.
* **`luajit`**: el paquete npm fue **despublicado** el 2017‑12‑18 (`Unpublished on 2017-12-18T23:12:18.045Z`). No hay paquete oficial de LuaJIT para Node.
* El propio TFS usa LuaJIT **en C++** (compila enlazando `luajit/lua.hpp`; su `cmake/FindLuaJIT.cmake` y los binarios `tfs-v1.4.1-windows-msvc-Release-luajit.zip` lo confirman), pero eso no se traslada al ecosistema Node.

**Conclusión de la sección:** en Windows, sin toolchain de C++, la única familia que funciona *hoy* y con Lua ≥5.3 real es la de **WASM/JS puro**: wasmoon (5.4) y fengari (5.3). Cualquier binding nativo te obliga a mantener una cadena de compilación por plataforma/ABI — exactamente el problema que TFS resuelve publicando zips precompilados por SO.

### 1.6 ¿Y LuaJIT vía WASM? ¿Existe algo serio?

**No.** Estado verificado:

* Búsqueda en GitHub de repos con `lua+wasm+luajit` en nombre/descripción: **3 resultados**, ninguno es un runtime LuaJIT empaquetado:
  * [`thenumbernine/lua-ffi-wasm`](https://github.com/thenumbernine/lua-ffi-wasm) — 10★, "for building Lua + luaffifb to wasm for the browser port of my LuaJIT + OpenGL + SDL framework". Es un **script de build personal** para su propio framework, no una librería consumible desde npm ni un port de LuaJIT.
  * `clang194/WasmToLua` — transpilador WASM→LuaJIT, 0★, sin licencia.
  * `whirlinggizmo/experiments-benchmarks` — banco de pruebas de scripting para cliente/servidor, no un port.
* El obstáculo es de fondo, no de falta de ganas: LuaJIT se apoya en **asm generado en tiempo de ejecución** (`mcode`) y en `mmap` con permisos `PROT_EXEC`. WASM es un formato **AOT validado** sin W^X: no hay forma soportada de generar y ejecutar código nativo dentro del sandbox. Ese es exactamente el muro que documenta la discusión de Neovim [*Challenges Running Full Neovim with LuaJIT in WebAssembly* (neovim#36327)](https://github.com/neovim/neovim/discussions/36327).
* Alternativas parciales que la gente usa en su lugar: **Lua 5.1 sobre WASM** (`wasmoon-lua5.1`) cuando el objetivo es *compatibilidad de sintaxis* con LuaJIT, no rendimiento JIT.

### 1.7 Rendimiento relativo, interop y sandboxing — comparativa cualitativa

| Criterio | wasmoon | fengari(+interop) | lua-in-js | node-lua (nativo) |
|---|---|---|---|---|
| Rendimiento en bucles puros | **Alto** (~25× fengari, benchmark del autor) | Bajo | Bajo (y sin corrutinas) | Muy alto |
| Coste de cruzar JS↔Lua | Medio‑alto (marshalling WASM) | Medio (proxies) | n/a | **Muy bajo** (mismo heap) |
| Interop con objetos JS | Nativa, `injectObjects`, `Promise:await()` | Necesita `fengari-interop` | Solo tablas/`loadLib` | Manual, C API |
| Exponer una API de juego | Fácil: `lua.global.set('Game', {...})` | Media: C API + interop | Difícil | Difícil (escribir C) |
| Sandboxing | Se controla **qué** expones y **qué** `require` montas; WASM aísla memoria, pero **no** hay límite de CPU ni de memoria por script | Igual (nada por defecto) | n/a | Peor: cualquier fallo es un segfault del proceso |
| Windows sin C++ | ✅ | ✅ | ✅ | ❌ |

**Sobre sandboxing, sin marketing:** ninguna de estas librerías ofrece un sandbox de seguridad por sí misma. Lo que dan es *aislamiento de memoria* (WASM) que evita que un script corrompa el heap del servidor, pero:

* un `while true do end` en un evento **bloquea el event loop de Node** (Lua en WASM/JS es síncrono);
* nada impide que un script agote la RAM;
* la superficie de ataque real la defines **tú** al montar la API: si expones `os.execute`, `io.open` o un `require` que lee del disco, el script tiene ese poder. Fengari advierte en su README que `require`/`package.loadlib` hacen **XHR síncronos** en navegador y que `package.cpath` se sustituye por `package.jspath`.

**Patrón recomendado para sandboxing en un servidor de juego:**

1. Crea el estado Lua **sin** `io`, `os.execute`, `os.getenv`, `os.remove`, `dofile`, `loadfile`, `package.loadlib`.
2. Monta un `require` propio que resuelva solo rutas dentro de `data/lib/` (con *path traversal* bloqueado).
3. Instrumenta el *timeout* en el lado JS: ejecuta los scripts por evento y mide; si un script supera N ms de presupuesto acumulado, **cuarenténalo** (desregistra sus eventos) en vez de intentar matarlo — no puedes interrumpir Lua de forma limpia desde fuera.
4. Si de verdad necesitas aislamiento fuerte (mods de terceros no confiables), ejecuta los scripts Lua en un **`worker_threads` Worker** con `resourceLimits` (`maxOldGenerationSizeMb`) y comunícate por `MessagePort`. El precio es que cada llamada de API cruza un límite de hilo (asíncrona).

### 1.8 Recomendación razonada para "muchos scripts cortos por evento"

**Usa `wasmoon` (Lua 5.4 en WASM) con UN solo estado Lua compartido, y una capa de registro de eventos en JS.**

Justificación:

1. **El perfil de carga favorece wasmoon.** "Muchos scripts cortos por evento" es, sobre todo, **tiempo dentro de Lua**: bucles sobre inventario, cálculo de daño, iteración de áreas. Ahí el benchmark de 25× de wasmoon sobre fengari aplica casi entero. Si en cambio el 90% del tiempo estuviera en el lado JS (la API), fengari+interop sería competitivo y más ligero.
2. **Lua 5.4 vs 5.3.** El operador de división entera `//`, los enteros de 64 bits y `goto` están limpios en 5.4. Los scripts de la comunidad OT están escritos para 5.1/5.3/LuaJIT, así que **en la práctica escribirás Lua compatible 5.1/5.3** en ambos casos; aquí la ventaja es sobre todo no arrastrar el `Uint8Array` de fengari ni su falta de `__gc`/tablas débiles (que sí importan si haces *cachés de userdata*).
3. **Interop.** `lua.global.set('Game', {createItem, createMonster, ...})` y `lua.global.set('Position', fn)` es literalmente todo lo que necesitas para la API estilo TFS. En fengari eso es `lua_pushcfunction` + `luaL_newlib` + `fengari-interop` a mano: más código propio y más frágil.
4. **Un solo estado, no uno por script.** Crear un `LuaEngine` por evento es carísimo (instanciar el WASM + abrir libs). TFS usa un `LuaEnvironment g_luaEnvironment` global con `LuaScriptInterface`s que comparten estado y guardan *callbacks* en el registro. Replica eso: **un motor, muchos `ScriptInterface` lógicos**, y guarda las funciones registradas como referencias, no re‑cargando el chunk en cada evento.
5. **Compila cada archivo una vez.** `luaL_loadfile` una vez → ejecutar una vez → los `onUse`/`onStepIn` quedan como funciones globales que se capturan en el registro (`getEvent` en TFS hace exactamente eso: lee el global y lo borra con `lua_pushnil` + `lua_setglobal`, guardándolo en una tabla por `runningEventId`). En wasmoon: `lua.global.get('onUse')` tras `doString` y guarda la referencia.
6. **Cuándo elegir fengari en su lugar:** si el servidor corre en un entorno donde no puedes permitirte WASM (restricciones de CSP/`WebAssembly` deshabilitado, bundlers problemáticos) o si el bundle importa. Su release de dic‑2025 y sus 2032★ lo mantienen como plan B sólido.

**Anti‑recomendación explícita:** no construyas sobre `node-lua`/`node-gyp`/LuaJIT nativo para Node. Duplicas el problema de compilación multiplataforma que TFS resuelve a base de publicar binarios por SO, y en Windows atarás el servidor a una versión concreta de Visual Studio.

---

## 2. Patrón de extensibilidad por scripts (el modelo de TFS)

TFS es un emulador de MMORPG en C++ (GPL‑2.0, [1841★, 1143 forks](https://github.com/otland/forgottenserver)), última release estable **v1.6** publicada el **2024‑06‑05** (*"latest stable protocol 13.10 release"*, [release](https://github.com/otland/forgottenserver/releases/tag/v1.6)); las líneas 1.4.x siguen vivas (v1.4.2, protocolo 10.98).

### 2.1 Estructura de `data/`

Listado real del árbol del repositorio ([api.github.com/.../contents/data](https://api.github.com/repos/otland/forgottenserver/contents/data)):

```
data/
├── XML/              groups.xml, mounts.xml, outfits.xml, stages.xml, vocations.xml
├── actions/          actions.xml + scripts/ + lib/
├── chatchannels/     chatchannels.xml + scripts/
├── creaturescripts/  creaturescripts.xml + scripts/ + lib/
├── events/           (event callbacks: hooks globales)
├── globalevents/     globalevents.xml
├── items/            items.xml
├── lib/              librerías Lua compartidas
├── migrations/
├── monster/          monsters.xml + monsters/*.xml  (una definición por monstruo)
├── movements/        movements.xml + scripts/
├── npc/
├── scripts/          ← RevScriptSys: actions/, creaturescripts/, events/,
│                       globalevents/, lib/, monsters/, movements/, network/,
│                       quests/, runes/, spells/, talkactions/, weapons/, xml/
├── spells/           spells.xml
├── talkactions/      talkactions.xml + scripts/
├── weapons/
├── world/
├── global.lua
└── cpplinter.lua
```

**Las dos mitades del sistema conviven:**

| | `data/actions/`, `data/movements/`, `data/talkactions/`, `data/creaturescripts/`, `data/globalevents/`, `data/spells/` | `data/scripts/` (RevScriptSys, TFS 1.3+) |
|---|---|---|
| Registro | **XML**: un `.xml` declara `itemid`/`words`/`type` y apunta a un `.lua` | **Lua**: el `.lua` construye el objeto y llama `:register()` |
| Granularidad | Un `.lua` puede ser referenciado por muchas entradas XML | Un `.lua` = una definición autocontenida (mod "arrastra y suelta") |
| Carga | El XML es la fuente de verdad; TFS recorre los nodos | TFS recorre **todos** los `.lua` de `data/scripts/` recursivamente |
| Desactivar | Quitar/renombrar la línea XML | Prefijar el archivo con `#` (convención oficial: *"To disable loading a certain file, add a `#` symbol at the beginning of file"*) |
| Estado en TFS 1.6 | Sigue soportado (p. ej. `movements.xml` está lleno de `onEquipItem`) | **Es el camino recomendado**: en 1.6, `globalevents.xml` y `spells.xml` son literalmente `<globalevents />` y `<spells />` vacíos con un comentario `<!-- See data/scripts/globalevents -->` |

Ese último detalle es la mejor prueba de la dirección del proyecto: en `master`, `data/spells/spells.xml` es

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- See data/scripts/spells and data/scripts/runes -->
<spells />
```

y `data/globalevents/globalevents.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- See data/scripts/globalevents -->
<globalevents />
```

mientras `creaturescripts.xml` conserva el registro clásico:

```xml
<creaturescripts>
	<event type="login" name="PlayerLogin" script="login.lua" />
	<event type="logout" name="PlayerLogout" script="logout.lua" />
	<event type="death" name="PlayerDeath" script="player_death.lua" />
	<event type="death" name="DropLoot" script="drop_loot.lua" />
	<event type="extendedopcode" name="ExtendedOpcode" script="extended_opcode.lua" />
</creaturescripts>
```

### 2.2 Eventos: nombres reales y firmas exactas

Esta es la parte crítica para replicar el modelo. **Todo lo que sigue está extraído del código C++ de `master`**, donde el propio código documenta la firma Lua en un comentario justo antes de empujar los argumentos a la pila. Las plantillas de `push*` traducen `Player*`/`Creature*`/`Item*` → **userdata con metatabla**, `uint32_t` → `number` y `bool` → `boolean`.

#### Movimientos — [`src/movement.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/movement.cpp)

Mapeo tipo→callback (`MoveEvent::getScriptEventName`):

| `event="..."` en XML | callback Lua |
|---|---|
| `StepIn` | `onStepIn` |
| `StepOut` | `onStepOut` |
| `Equip` | `onEquip` |
| `DeEquip` | `onDeEquip` |
| `AddItem` | `onAddItem` |
| `RemoveItem` | `onRemoveItem` |

Firmas (los comentarios literales del código):

```cpp
// onStepIn(creature, item, pos, fromPosition)
// onStepOut(creature, item, pos, fromPosition)
return scriptInterface->callFunction(4);

// onEquip(player, item, slot, isCheck)
// onDeEquip(player, item, slot, isCheck)
return scriptInterface->callFunction(4);

// onaddItem(moveitem, tileitem, pos)
// onRemoveItem(moveitem, tileitem, pos)
return scriptInterface->callFunction(3);
```

`onStepIn`/`onStepOut` devuelven **boolean**: `false` cancela el movimiento. `onEquip`/`onDeEquip` devuelven boolean donde `false` se traduce a `RETURNVALUE_CANNOTBEDRESSED`. `onAddItem`/`onRemoveItem` también devuelven boolean para permitir/bloquear.

Ejemplo real completo, [`data/movements/scripts/tiles.lua`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/movements/scripts/tiles.lua) — nótese el estilo `:` sobre userdata:

```lua
function onStepIn(creature, item, position, fromPosition)
	if not increasing[item.itemid] then
		return true
	end

	if not creature:isPlayer() or creature:isInGhostMode() then
		return true
	end

	item:transform(increasing[item.itemid])

	if item.actionid >= actionIds.levelDoor then
		if creature:getLevel() < item.actionid - actionIds.levelDoor then
			creature:teleportTo(fromPosition, false)
			position:sendMagicEffect(CONST_ME_MAGIC_BLUE)
			creature:sendTextMessage(MESSAGE_EVENT_ADVANCE, "The tile seems to be protected against unwanted intruders.")
		end
		return true
	end

	if Tile(position):hasFlag(TILESTATE_PROTECTIONZONE) then
		local depotItem = Tile(lookPosition):getItemByType(ITEM_TYPE_DEPOT)
		...
	end
	return true
end

function onStepOut(creature, item, position, fromPosition)
	...
end
```

#### Acciones (usar un ítem) — [`src/actions.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/actions.cpp)

```cpp
// onUse(player, item, fromPosition, target, toPosition, isHotkey)
return scriptInterface->callFunction(6);
```

Devuelve boolean; `false` ⇒ TFS envía `RETURNVALUE_CANNOTUSETHISOBJECT` (si el script no define su propio manejador de error).

#### TalkActions (comandos y palabras) — [`src/talkaction.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/talkaction.cpp)

```cpp
// onSay(player, words, param, type)
return scriptInterface->callFunction(4);
```

Devuelve boolean: `true` ⇒ `TALKACTION_CONTINUE` (sigue buscando otras talkactions), `false` ⇒ `TALKACTION_BREAK` (consume el mensaje). El `separator` del XML decide cómo se parte `param`.

#### CreatureEvents — [`src/creatureevent.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/creatureevent.cpp)

Tabla completa de tipos y firmas, tomada de `CreatureEvent::configureEvent`, `getScriptEventName` y cada `execute*`:

| `type` XML | callback | firma exacta | ¿devuelve valor? |
|---|---|---|---|
| `login` | `onLogin` | `onLogin(player)` | sí (bool) |
| `logout` | `onLogout` | `onLogout(player)` | sí (bool) |
| `reconnect` | `onReconnect` | `onReconnect(player)` | no |
| `think` | `onThink` | `onThink(creature, interval)` | sí (bool) |
| `preparedeath` | `onPrepareDeath` | `onPrepareDeath(creature, killer)` | sí (bool) |
| `death` | `onDeath` | `onDeath(creature, corpse, killer, mostDamageKiller, lastHitUnjustified, mostDamageUnjustified)` | sí (bool) |
| `kill` | `onKill` | `onKill(creature, target)` | no (void) |
| `advance` | `onAdvance` | `onAdvance(player, skill, oldLevel, newLevel)` | sí (bool) |
| `modalwindow` | `onModalWindow` | `onModalWindow(player, modalWindowId, buttonId, choiceId)` | no |
| `textedit` | `onTextEdit` | `onTextEdit(player, item, text, windowTextId)` | sí (bool) |
| `healthchange` | `onHealthChange` | `onHealthChange(creature, attacker, primaryDamage, primaryType, secondaryDamage, secondaryType, origin)` → **devuelve 4 valores** (primaryDamage, primaryType, secondaryDamage, secondaryType) | 4 retornos |
| `manachange` | `onManaChange` | idéntica a `onHealthChange` | 4 retornos |
| `extendedopcode` | `onExtendedOpcode` | `onExtendedOpcode(player, opcode, buffer)` | no |

Detalle importante de `onHealthChange`/`onManaChange`: el script **reescribe el daño** devolviendo cuatro valores, y el motor toma `std::abs()` del valor y re‑aplica el signo según si el tipo es `COMBAT_HEALING`:

```cpp
damage.primary.value = std::abs(tfs::lua::getNumber<int32_t>(L, -4));
damage.primary.type = tfs::lua::getNumber<CombatType_t>(L, -3);
damage.secondary.value = std::abs(tfs::lua::getNumber<int32_t>(L, -2));
damage.secondary.type = tfs::lua::getNumber<CombatType_t>(L, -1);
```

#### GlobalEvents — [`src/globalevent.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/globalevent.cpp)

| `type`/atributo XML | callback | firma |
|---|---|---|
| `type="startup"` | `onStartup` | sin argumentos |
| `type="shutdown"` | `onShutdown` | sin argumentos |
| `type="record"` | `onRecord` | `onRecord(current, old)` |
| `type="save"` | `onSave` | sin argumentos |
| `time="HH:MM:SS"` | `onTime` | `onTime(interval)` |
| `interval="ms"` | `onThink` | `onThink(interval)` |

#### Spells — [`src/spells.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/spells.cpp)

```cpp
// onCastSpell(creature, var)          -- hechizo instantáneo (InstantSpell / CombatSpell)
return scriptInterface->callFunction(2);

// onCastSpell(creature, var, isHotkey) -- runa (RuneSpell)
return scriptInterface->callFunction(3);
```

`var` es un userdata `Variant` con `type` (`VARIANT_NUMBER`, `VARIANT_STRING`, `VARIANT_POSITION`, `VARIANT_TARGETPOSITION`) y acceso vía `var:getNumber()`, `var:getString()`, `var:getPosition()`.

#### Event callbacks (la capa de hooks de `data/events/`)

Además de los eventos por objeto, TFS 1.4 introdujo **event callbacks**: hooks globales que el motor consulta desde su lógica interna (no desde el bucle de eventos del script). La release 1.4 los documenta [en su changelog](https://github.com/otland/forgottenserver/releases/tag/v1.4):

> ### Events
> - Added event callbacks. They're hooks for things located in `data/events` folder. Examples can be found in `data/scripts/eventcallbacks`.
> ### New events
> - `Creature:onHear(speaker, words, type)`
> - `Monster:onDropLoot(corpse)`
> - `Monster:onSpawn(position, startup, artificial)`
> - `Player:onItemMoved(item, count, fromPosition, toPosition, fromCylinder, toCylinder)`
> - `Player:onTradeCompleted(target, item, targetItem, isSuccess)`
> - `Player:onWrapItem(item, position)`

Estos son los que cubren tus `onDropLoot`, `onSpawn`, `onHear`, `onItemMoved`, `onTradeCompleted`. El C++ los invoca como `tfs::events::player::onSpellCheck(player, this)` (visible en `spells.cpp`), es decir: un espacio de nombres `tfs::events::<entidad>::<hook>` con fallback si no hay script.

> **Sobre `onTradeRequest` / `onTradeAccept`:** no los he podido verificar como callbacks propios en `master`. Lo que sí está verificado es `Player:onTradeCompleted(target, item, targetItem, isSuccess)`. En TFS antiguos (0.3/0.4) existían `onTradeRequest(cid, target, item)` y `onTradeAccept(cid, target, item, targetItem)` en `creaturescripts`; **si replicas el modelo, decide explícitamente si mantienes esos dos como compatibilidad.**

### 2.3 RevScriptSys: el modelo que hay que replicar

La release 1.4 lo describe así:

> ## RevScriptSys
> A new way to create scripts has been implemented. It allows the developers to create mods they can drag and drop to `data/scripts`. Example mods can be found in the same folder. Every file from that folder will load automatically. To disable loading a certain file, add a `#` symbol at the beginning of file.
>
> Supported constructors:
> - `Action`
> - `CreatureEvent`
> - `GlobalEvent`
> - `MonsterType`
> - `MoveEvent`
> - `Party`
> - `Spell`
> - `TalkAction`
> - `Weapon`

Y la propia API C++ confirma los métodos de cada constructor ([`src/luascript.h`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/luascript.h)):

| Constructor | Métodos de configuración | Registro |
|---|---|---|
| `Action` | `:onUse(fn)`, `:itemId(...)`, `:actionId(...)`, `:uniqueId(...)`, `:allowFarUse(bool)`, `:blockWalls(bool)`, `:checkFloor(bool)` | `:register()` |
| `TalkAction` | `:onSay(fn)`, `:separator(str)`, `:access(bool)`, `:accountType(n)` | `:register()` |
| `MoveEvent` | `:type(...)`, `:onCallback(fn)`, `:level(n)`, `:slot(...)`, `:magLevel(n)`, `:premium(bool)`, `:vocation(...)`, `:tileItem(...)`, `:itemId(...)`, `:actionId(...)`, `:uniqueId(...)`, `:position(...)` | `:register()` |
| `CreatureEvent` | `:type(...)`, `:onCallback(fn)` | `:register()` |
| `GlobalEvent` | `:type(...)`, `:onCallback(fn)`, `:time(...)`, `:interval(ms)` | `:register()` |
| `Spell` | `:onCastSpell(fn)`, `:name`, `:id`, `:group`, `:cooldown`, `:groupCooldown`, `:level`, `:magicLevel`, `:mana`, `:manaPercent`, `:soul`, `:range`, `:premium`, `:enabled`, `:needTarget`, `:needWeapon`, `:needLearn`, `:selfTarget`, `:blocking`, `:aggressive`, `:pzLock`, `:vocation`, `:words` (instant), `:runeId`/`:charges` (runa)… | `:register()` |
| `Weapon` | `:id`, `:level`, `:magicLevel`, `:mana`, `:health`, `:soul`, `:premium`, `:breakChance`, `:action`, `:vocation`, `:element`, `:attack`, `:defense`, `:range`, `:charges`, `:duration`, `:decayTo`, `:slotType`, `:hitChance`, `:onUseWeapon(fn)`… | `:register()` |
| `MonsterType` | `:name`, `:health`, `:experience`, `:speed`, `:outfit`, `:race`, `:addAttack`, `:addDefense`, `:addElement`, `:addVoice`, `:addLoot`, `:registerEvent`, `:eventOnCallback`, … | `:register()` |

**Ejemplo real y mínimo** — [`data/scripts/creaturescripts/player/update_client_on_advance_level.lua`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/scripts/creaturescripts/player/update_client_on_advance_level.lua):

```lua
local updateClientOnAdvanceLevel = CreatureEvent("Update Client On Advance Level")

function updateClientOnAdvanceLevel.onAdvance(player, skill, oldLevel, newLevel)
	if skill ~= SKILL_LEVEL then
		return true
	end

	player:updateClientExpDisplay()

	if newLevel > oldLevel then
		player:takeScreenshot(SCREENSHOT_TYPE_LEVELUP)
	end
	return true
end

updateClientOnAdvanceLevel:register()
```

Tres cosas que hay que copiar de este patrón, porque son el corazón del diseño:

1. **El constructor devuelve un objeto** y el callback se define **en un campo del objeto** con `function obj.onEvent(...)`. El C++ lee ese campo con `lua_getfield(L, -1, eventName)` (`getMetaEvent` en `luascript.cpp`).
2. **`:register()` es la frontera**: hasta que no se llama, el evento no existe para el motor. Eso permite que un archivo declare varias cosas y registre condicionalmente.
3. **Los callbacks se capturan por referencia** y se borran del espacio global (`lua_pushnil` + `lua_setfield`) para que un `require` posterior no los pise. El motor los guarda en una tabla en el `LUA_REGISTRYINDEX` indexada por `runningEventId`, lo que permite tener `onStepIn` definido por 50 archivos distintos sin colisión — **exactamente el problema que vas a tener en Node.**

### 2.4 Un archivo XML de registro típico y cómo se enlaza con su `.lua`

**`data/actions/actions.xml`** (literal, extracto):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<actions>
	<!-- Enchanting -->
	<action fromid="2146" toid="2147" script="others/enchanting.lua" />
	<action itemid="2342" script="others/enchanting.lua" />

	<!-- Market -->
	<action itemid="14405" function="market" />

	<!-- Quests -->
	<action itemid="1740" script="quests/quests.lua" />
	<action uniqueid="30015" script="quests/annihilator.lua" />

	<!-- Tools -->
	<action itemid="2120" script="tools/rope.lua" />
	<action itemid="2580" script="tools/fishing.lua" allowfaruse="1" />
	...
</actions>
```

Claves del enlace:

* `script="..."` es una ruta **relativa a `data/actions/scripts/`**.
* El atributo de identidad es **uno de** `itemid` (`id1;id2;...`), `fromid`/`toid` (rango), `actionid` (`aid1;aid2`), `fromaid`/`toaid`, `uniqueid` (`uid1;uid2`), `fromuid`/`touid`.
* `function="market"` registra una función **C++** en vez de un script: TFS tiene un registro de funciones nativas (`Action::loadFunction`), lo que permite tener lógica caliente en C++ y el resto en Lua. **Replícalo: un mapa `nombre → función JS`** para las acciones más frecuentes.
* Atributos extra por tipo: `allowfaruse`, `blockwalls`, `checkfloor`.

**`data/movements/movements.xml`** (literal, extracto):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<movements>
	<!-- Decaying tiles -->
	<movevent event="StepIn" itemid="293" script="decay.lua" />
	<movevent event="StepIn" itemid="416" script="tiles.lua" />
	<movevent event="StepOut" itemid="417" script="tiles.lua" />

	<!-- Traps -->
	<movevent event="StepIn" itemid="1510" script="trap.lua" />
	<movevent event="RemoveItem" itemid="2579" script="trap.lua" />

	<!-- Walkback when walking on quest chest -->
	<movevent event="StepIn" fromid="1746" toid="1749" script="walk_back.lua" />

	<!-- Create bread movements (ítem sobre ítem en el suelo) -->
	<movevent event="AddItem" tileitem="1" itemid="1786" script="dough.lua" />

	<!-- Campfires: función C++ en lugar de script -->
	<movevent event="StepIn" itemid="1423" function="onStepInField" />
	<movevent event="AddItem" itemid="1423" function="onAddField" />

	<!-- Equipamiento, con requisitos y vocaciones como hijos -->
	<movevent event="Equip" itemid="2195" slot="feet" function="onEquipItem" />
	<movevent event="Equip" itemid="7886" slot="feet" level="35" function="onEquipItem">
		<vocation name="Sorcerer" />
		<vocation name="Master Sorcerer" showInDescription="0" />
	</movevent>
	<movevent event="DeEquip" itemid="7886" slot="feet" function="onDeEquipItem" />
</movements>
```

Detalles que un diseñador de XML en Node debe soportar:

* **Rangos** (`fromid`/`toid`) que expanden a N registros. En `movements.xml` real hay decenas de `<movevent event="Equip" ...>` **con hijos `<vocation>`**: el XML es un árbol, no una lista plana de atributos.
* `tileitem="1"` cambia la semántica del evento (`MOVE_EVENT_ADD_ITEM` → `MOVE_EVENT_ADD_ITEM_ITEMTILE`), es decir: **atributos que mutan el tipo de evento**, no solo parámetros.
* `slot="feet"|"head"|"necklace"|"backpack"|"armor"|"right-hand"|"left-hand"|"hand"|"shield"|"legs"|"ring"|"ammo"` se mapea a máscaras `SLOTP_*`.
* La **precedencia de búsqueda** importa y está codificada en `MoveEvents::getEvent`: primero `uniqueid`, luego `actionid`, luego `itemid`. Replícala o tendrás bugs de "por qué mi tile no dispara".

**`data/talkactions/talkactions.xml`** (literal, extracto):

```xml
<talkactions>
	<!-- commands -->
	<talkaction words="/attr" separator=" " script="attributes.lua" />
	<talkaction words="/reload" separator=" " script="reload.lua" />
	<talkaction words="/B" separator=" " script="broadcast.lua" />

	<!-- player talkactions -->
	<talkaction words="!uptime" script="uptime.lua" />
	<talkaction words="!online;/online" script="online.lua" />
</talkactions>
```

`words="a;b"` registra **varios alias** que apuntan al mismo objeto (`TalkAction::configureEvent` hace `explodeString(wordsAttribute.as_string(), ";")`). El `separator` (por defecto `" "`) determina dónde acaba la palabra clave y empieza `param`.

**`data/monster/monsters.xml`** (literal, extracto) — patrón "índice + un archivo por entidad", el que querrás para definiciones grandes:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<monsters>
	<monster name="Rat" file="monsters/rat.xml" />
	<monster name="Demon" file="monsters/demon.xml" />
	<monster name="Dragon Lord" file="monsters/dragon_lord.xml" />
	...
</monsters>
```

y `data/monster/monsters/rat.xml` (literal, completo salvo recortes):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<monster name="Rat" nameDescription="a rat" race="blood" experience="5" speed="134" manacost="200" raceId="21">
	<health now="20" max="20" />
	<look type="21" corpse="5964" />
	<targetchange interval="4000" chance="0" />
	<flags>
		<flag summonable="1" />
		<flag attackable="1" />
		<flag hostile="1" />
		<flag runonhealth="5" />
	</flags>
	<bestiary class="Mammal" prowess="10" expertise="100" mastery="250" charmPoints="10" difficulty="trivial" occurrence="common" locations="Rat Locations..." />
	<attacks>
		<attack name="melee" interval="2000" min="0" max="-8" />
	</attacks>
	<defenses armor="1" defense="1" />
	<elements>
		<element earthPercent="20" />
		<element holyPercent="20" />
		<element icePercent="-10" />
	</elements>
	<voices interval="5000" chance="10">
		<voice sentence="Meep!" />
	</voices>
	<loot>
		<item name="gold coin" countmax="4" chance="100000" />
		<item id="2696" chance="39410" /><!-- cheese -->
	</loot>
</monster>
```

Observa que **`loot` mezcla `name` e `id`** en el mismo elemento: el cargador resuelve el nombre contra la tabla de ítems. Y `chance` va en **diezmilésimas** (100000 = 100%).

**`data/items/items.xml`** (literal, extracto) — el archivo "grande":

```xml
<?xml version="1.0" encoding="iso-8859-1"?>
<items>
	<item id="1" name="water" />
	<item id="293" name="grass">
		<attribute key="floorchange" value="down" />
	</item>
	<item fromid="108" toid="109" name="flowers" />
	<item id="2148" article="a" name="gold coin">
		<attribute key="weight" value="10" />
		<attribute key="worth" value="1" />
	</item>
	<item fromid="1423" toid="1425" article="a" name="campfire">
		<attribute key="field" value="fire">
			<attribute key="initdamage" value="20" />
			<attribute key="ticks" value="4000" />
			<attribute key="count" value="2" />
			<attribute key="damage" value="10" />
		</attribute>
	</item>
</items>
```

Notas: **codificación `iso-8859-1`** (no UTF‑8) — un detalle real que rompe parsers mal configurados; **atributos anidados** (`<attribute key="field">` contiene otros `<attribute>`); y el patrón `<attribute key="X" value="Y"/>` en lugar de atributos directos, que hace el esquema más extensible pero impide generar XSD estricto con tipos por atributo.

### 2.5 Cómo se expone la API del juego a Lua

El estilo es **híbrido y muy concreto**:

**(a) Tablas globales con funciones estáticas** — se registran con `registerTable(L, "Game")` + `registerMethod(L, "Game", "createItem", ...)`, y se invocan con `.`:

```lua
Game.createItem(itemId, count, position)
Game.createMonster(name, position, forced, master)
Game.createNpc(name, position)
Game.createTile(position)
Game.getPlayers()
Game.getTowns()
Game.getWorldType()
Game.reload(RELOAD_TYPE_ACTIONS)
Game.getExperienceStage(level)
```

**(b) Userdata con metatabla, métodos con `:`** — `registerClass(L, "Player", "Creature", ...)` establece **herencia** (`Player` hereda de `Creature`, `Container`/`Teleport`/`Podium` heredan de `Item`), lo que se ve en los scripts como métodos que existen tanto en un jugador como en un monstruo:

```lua
player:getPosition()
player:getLevel()
player:sendTextMessage(MESSAGE_INFO_DESCR, "texto")
player:addItem(2160, 1)
player:teleportTo(position, false)
creature:getHealth()
creature:say("hola", TALKTYPE_MONSTER_SAY)
creature:setStorageValue(key, value)
item:transform(newId)
item:getUniqueId()
item:moveTo(position)
container:addItem(item)
tile:getItemByType(ITEM_TYPE_DEPOT)
position:sendMagicEffect(CONST_ME_MAGIC_BLUE)
```

**(c) Constructores globales** — `Position(x, y, z)`, `Tile(pos)`, `Item(id)`, `Container(id)`, `Combat()`, `Condition()`, `Outfit()`, `MonsterType()`, `ModalWindow()`, `NetworkMessage()`, `Variant()`, y las clases de RevScriptSys (`Action`, `Spell`, `MoveEvent`, …):

```lua
if Tile(position):hasFlag(TILESTATE_PROTECTIONZONE) then ... end
local combat = Combat()
combat:setParameter(COMBAT_PARAM_TYPE, COMBAT_FIREDAMAGE)
combat:setArea(createCombatArea(AREA_CIRCLE3X3))
```

**(d) Funciones globales sueltas** — el legado, registrado con `lua_register(L, ...)` en `luascript.cpp`. En `master` sobrevive una lista corta y explícitamente marcada como "deprecated" en la cabecera del archivo:

```lua
doPlayerAddItem(...)          -- deprecated: usar player:addItem(...)
doAreaCombat(...)             -- deprecated
doTargetCombat(cid, target, type, min, max, effect[, origin[, blockArmor[, blockShield]]])
doChallengeCreature(...)
addEvent(callback, delay, ...)
stopEvent(eventid)
saveServer()
cleanMap()
debugPrint(...)
isInWar(...)
getWaypointPositionByName(name)
sendChannelMessage(...)
sendGuildChannelMessage(...)
isScriptsInterface(...)
getDepotId(uid)
getWorldUpTime()
getSubTypeName(subType)
createCombatArea(...)
```

> **Importante y matizable:** `doCreatureSay`, `doTeleportThing`, `doCreateItem`, `doSendMagicEffect`, `doPlayerSendTextMessage` son **la API de TFS 0.3/0.4** (protocolo 8.x). En `master` (1.6) **no** aparecen en el registro de funciones globales; su equivalente moderno es `creature:say(...)`, `creature:teleportTo(...)`, `Game.createItem(...)`, `position:sendMagicEffect(...)`, `player:sendTextMessage(...)`. Para un motor nuevo, **copia el estilo 1.x (orientado a objetos), no el 0.4 (funciones `doXxx`)**; si quieres compatibilidad con datapacks antiguos, implementa las `doXxx` como *shims* Lua que deleguen en los métodos — es lo que hacen los datapacks de transición.

**Los nombres de constantes son parte de la API.** `CONST_ME_*`, `MESSAGE_*`, `SKILL_*`, `TALKTYPE_*`, `ITEM_TYPE_*`, `TILESTATE_*`, `COMBAT_*`, `CONDITION_*`, `RETURNVALUE_*`, `RELOAD_TYPE_*`, `ACCOUNT_TYPE_*`, `SCREENSHOT_TYPE_*`, `WIELDINFO_*`, `AMMO_*`… El C++ las inyecta con `registerGlobalVariable`/`registerVariable`/`registerGlobalBoolean`. En Node: exporta un objeto constante por *namespace* (idealmente generado desde un único `enums.json` para que C++/Lua/TS no diverjan).

**El puente de userdata, versión Node.** En C++ el userdata es literalmente un `T**` (`pushUserdata` hace `lua_newuserdata(L, sizeof(T*))` y guarda el puntero), y la metatabla lleva un campo `'t'` con el tipo (`LuaData_Player`, `LuaData_Item`…) y un `'h'` con un hash, más `'p'` con el número de padres para la herencia. En wasmoon/fengari no tienes eso gratis: la forma pragmática es **una tabla Lua por entidad con un metatabla cuyo `__index` es una tabla de métodos que recibe `self`**, donde `self` lleva un `id` numérico y los métodos JS resuelven la entidad por ese `id` en el mundo. Es exactamente lo que hace TFS con `ScriptEnvironment::getThingByUID`, solo que con el mapa invertido.

### 2.6 Recarga en caliente (`/reload`) e implicaciones

El comando real está en [`data/talkactions/scripts/reload.lua`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/talkactions/scripts/reload.lua) y expone la política completa del motor:

```lua
local reloadTypes = {
	["all"] = RELOAD_TYPE_ALL,
	["action"] = RELOAD_TYPE_ACTIONS,      ["actions"] = RELOAD_TYPE_ACTIONS,
	["chat"] = RELOAD_TYPE_CHAT,           ["chatchannels"] = RELOAD_TYPE_CHAT,
	["config"] = RELOAD_TYPE_CONFIG,       ["configuration"] = RELOAD_TYPE_CONFIG,
	["creaturescript"] = RELOAD_TYPE_CREATURESCRIPTS,
	["events"] = RELOAD_TYPE_EVENTS,
	["global"] = RELOAD_TYPE_GLOBAL,
	["globalevent"] = RELOAD_TYPE_GLOBALEVENTS,
	["items"] = RELOAD_TYPE_ITEMS,
	["monster"] = RELOAD_TYPE_MONSTERS,    ["monsters"] = RELOAD_TYPE_MONSTERS,
	["mount"] = RELOAD_TYPE_MOUNTS,
	["move"] = RELOAD_TYPE_MOVEMENTS,      ["movements"] = RELOAD_TYPE_MOVEMENTS,
	["npc"] = RELOAD_TYPE_NPCS,
	["quest"] = RELOAD_TYPE_QUESTS,
	["spell"] = RELOAD_TYPE_SPELLS,
	["talk"] = RELOAD_TYPE_TALKACTIONS,
	["weapon"] = RELOAD_TYPE_WEAPONS,
	["scripts"] = RELOAD_TYPE_SCRIPTS,
	["libs"] = RELOAD_TYPE_GLOBAL
}

function onSay(player, words, param)
	if not player:getGroup():getAccess() then return true end
	if player:getAccountType() < ACCOUNT_TYPE_GOD then return false end
	logCommand(player, words, param)

	local reloadType = reloadTypes[param:lower()]
	if not reloadType then
		player:sendTextMessage(MESSAGE_INFO_DESCR, "Reload type not found.")
		return false
	end

	-- need to clear Event.data or we end up having duplicated events on /reload scripts
	if table.contains({RELOAD_TYPE_SCRIPTS, RELOAD_TYPE_ALL}, reloadType) then
		Event:clear()
		Game.clearQuests()
	end

	Game.reload(reloadType)
	if reloadType == RELOAD_TYPE_GLOBAL then
		-- we need to reload the scripts as well
		Game.reload(RELOAD_TYPE_SCRIPTS)
	end

	player:sendTextMessage(MESSAGE_INFO_DESCR, string.format("Reloaded %s.", param:lower()))
	return false
end
```

**Qué implica, y qué copiar:**

1. **La recarga es granular y enumerada**, no un "reinicia todo". Cada subsistema tiene su `RELOAD_TYPE_*` y su propia función de `clear(fromLua)`. Copia esa enumeración; es la diferencia entre un `/reload` usable y uno que tira el servidor.
2. **El problema real de la recarga es el estado duplicado.** El comentario del propio script lo dice: *"need to clear Event.data or we end up having duplicated events on /reload scripts"*. Y en `creatureevent.cpp` se ve el mecanismo de reutilización: al re‑registrar un evento con el mismo nombre, si el antiguo **no está cargado** (`!oldEvent->isLoaded()`) se reutiliza el objeto con `copyEvent`. Es decir: TFS **limpia primero y re-registra**, no acumula.
3. **Hay estado que NO se recarga de forma segura.** `/reload config` existe (`RELOAD_TYPE_CONFIG`) pero solo re‑lee `config.lua` en los módulos que no lo capturaron al arrancar; el C++ de `ConfigManager::load` tiene un bloque `if (!loaded) { ... }` que **explícitamente separa lo que solo se lee una vez** (IP, puertos, MySQL, `mapName`, `mapAuthor`, `marketOfferDuration`…). Es decir: **puertos y credenciales de BD no cambian con `/reload`.** El mapa tampoco: `Game.loadMap()` es otra operación.
4. **Los callbacks ya capturados por objetos vivos son un problema.** Si recargas los scripts mientras un jugador tiene un ítem equipado cuyo `onEquip` cambió, el objeto `MoveEvent` viejo puede seguir referenciado por el ítem. TFS ataca esto con `clearMap(itemIdMap/actionIdMap/uniqueIdMap/positionMap, fromLua)` + `reInitState`, y con el flag `fromLua` que distingue eventos nativos de los de script. **Regla de diseño: nunca recargues un subsistema sin desregistrar limpiamente sus entradas y re‑cablear las referencias que ya estaban vivas.**

**En Node, el equivalente sería:** un `ContentManager` con un mapa `reloadType → {clear(), load()}`; un **registro de eventos por clave** (`entidad:tipo:identidad`, p. ej. `movevent:StepIn:itemid:293`) donde registrar la misma clave **sobrescribe**; y un `ContentGeneration` incremental (un entero que sube en cada reload) estampado en cada callback, para que los objetos vivos puedan detectar que su callback pertenece a una generación antigua y desreferenciarlo.

---

## 3. XML en Node.js

### 3.1 Tabla comparativa (metadatos verificados)

| Paquete | Versión | Publicada | Licencia | Descargas/mes | Modelo | Nativo | Namespaces | XSD/DTD |
|---|---|---|---|---|---|---|---|---|
| [fast-xml-parser](https://www.npmjs.com/package/fast-xml-parser) | **5.11.2** | 2026‑09‑29 | MIT | **310.201.940** | árbol JS (no DOM) | No | Parcial (prefijos como nombres) | **Solo sintaxis**, no XSD |
| [libxml2-wasm](https://www.npmjs.com/package/libxml2-wasm) | **0.7.2** | 2026‑09‑07 | MIT | — | DOM (libxml2 real) | No (**WASM**) | **Sí** | **Sí** (XSD, XInclude/import experimental) |
| [xmllint-wasm](https://www.npmjs.com/package/xmllint-wasm) | **5.3.0** | 2026‑08‑05 | MIT | — | CLI xmllint en WASM | No | Sí | **Sí** (XSD/DTD/RelaxNG vía libxml2) |
| [libxmljs2](https://www.npmjs.com/package/libxmljs2) | **0.37.0** | 2025‑06‑01 | MIT | 2.234.480 | DOM | **Sí** (`node-gyp`) | Sí | **Sí** (`doc.validate(schemaDoc)`) — pero **NO LONGER MAINTAINED** |
| [libxmljs2-xsd](https://www.npmjs.com/package/libxmljs2-xsd) | 0.30.1 | 2022‑09‑21 | MIT | — | wrapper sobre libxmljs2 | Sí | Sí | Sí, pero **abandonado** (último push 2023‑09, [cdegalitt/libxmljs2-xsd](https://github.com/cdegalitt/libxmljs2-xsd)) |
| [sax](https://www.npmjs.com/package/sax) | **1.6.1** | 2026‑07‑24 | **BlueOak‑1.0.0** | — | SAX *streaming* | No | Sí (eventos) | No |
| [saxes](https://www.npmjs.com/package/saxes) | 6.0.0 | 2021‑11‑07 | ISC | — | SAX (sucesor de sax) | No | Sí | No |
| [xml2js](https://www.npmjs.com/package/xml2js) | **0.6.2** | 2023‑07‑26 | MIT | 167.057.457 | árbol JS | No | Parcial | No |
| [@xmldom/xmldom](https://www.npmjs.com/package/@xmldom/xmldom) | **0.9.12** | 2026‑08‑21 | MIT | — | DOM W3C | No | **Sí** | No |
| [@rgrove/parse-xml](https://www.npmjs.com/package/@rgrove/parse-xml) | **5.0.0** | 2026‑08‑30 | ISC | — | árbol JS | No | Parcial | No |
| [xmlbuilder2](https://www.npmjs.com/package/xmlbuilder2) | **4.0.3** | 2025‑12‑01 | MIT | — | builder/parser | No | Sí | No |

Estrellas y actividad (GitHub API): `fast-xml-parser` **3138★**, último push **2026‑09‑29** ([repo](https://github.com/NaturalIntelligence/fast-xml-parser)) — el más vivo con diferencia. `libxml2-wasm` **54★**, último push 2026‑09‑15 ([jameslan/libxml2-wasm](https://github.com/jameslan/libxml2-wasm)), licencia declarada "Other" en GitHub pero **MIT** en npm. `libxmljs2`: el repo canónico es [marudor/libxmljs2](https://github.com/marudor/libxmljs2) (9★, push 2026‑07‑08) y su README empieza literalmente con **"# NO LONGER MAINTAINED"**.

### 3.2 El estado de la validación XSD en Node (esto es lo importante)

**Ninguna librería de JS puro valida XSD.** El README de `fast-xml-parser` es explícito:

> * Validate XML data **syntactically**. Use [detailed-xml-validator](https://github.com/NaturalIntelligence/detailed-xml-validator/) to verify business rules.

Es decir, `XMLValidator` comprueba **buena formación** (etiquetas cerradas, entidades, etc.), no que el documento cumpla un esquema. Tampoco lo hace `xml2js`, `sax`, `saxes` ni `@xmldom/xmldom`.

Las opciones que **sí** validan contra XSD hoy:

1. **`libxml2-wasm`** — libxml2 compilado a WASM. Su README lista *"Parsing & Querying, **Validating**, Modifying, Serializing, **XInclude and XSD include/import (experimental)**"* y presume de la tabla de ventajas de WASM sobre el binding nativo ([README](https://github.com/jameslan/libxml2-wasm)):
   * *"C/C++ Toolchain at Runtime: Not required"*
   * *"Prebuilt Binaries: Universal for all"*
   * *"Prebuilt Binary Compatibility: Very Good"*
   
   Requiere Node ≥18 (ESM + top-level await) y **`dispose()` obligatorio** para no filtrar memoria. **Es la mejor opción moderna.**
2. **`xmllint-wasm`** — el binario `xmllint` real (libxml2) empaquetado en WASM. Es lo más parecido a "tener xmllint en Node" y soporta XSD/DTD/RelaxNG. Un proyecto reciente lo usa precisamente para benchmarkear validación XSD: [harshanacz/xml-val-benchmark](https://github.com/harshanacz/xml-val-benchmark) ("Benchmarking XML/XSD validation performance and schema caching between xmllint-wasm (libxml2) and xerces-wasm (Apache Xerces-C++)").
3. **`libxmljs2`** — `xmlDoc.validate(schemaDoc)` funciona, pero está **abandonado por su autor**, requiere `node-gyp`/cadena C++ (su README te manda a los requisitos de node-gyp) y en la práctica **no publica prebuilds universal**: dependes de que el entorno de build o el registry te den el binario para tu ABI de Node. Es exactamente el problema que WASM resuelve.
4. **`libxmljs2-xsd`** — wrapper que aporta el *reporting* de errores XSD bonito, pero encima de un paquete muerto y con último push en 2023.
5. **`xsd-schema-validator`** (no incluido en la tabla) — delega en **Java + Xerces**, es decir, una dependencia de runtime completamente ajena a Node.

**Vulnerabilidades:** no he encontrado advisories específicos de wasmoon ni de fengari en las fuentes consultadas (Snyk muestra páginas de ambas sin entradas destacadas: [wasmoon en Snyk](https://security.snyk.io/package/npm/wasmoon), [fengari en Snyk](https://security.snyk.io/package/npm/fengari)). El riesgo clásico de XML no es la librería sino la configuración: **XXE / expansión de entidades**. `fast-xml-parser` **soporta entidades y DOCTYPE** por diseño (*"XML Entities, HTML entities, and DOCTYPE entities are supported"*), así que si parseas XML de terceros, desactiva el procesado de entidades externas y pon límites. Para archivos de definición **propios y versionados en el repo**, XXE no es el vector.

### 3.3 Qué conviene para definiciones grandes (`items.xml`, `monsters.xml`)

`data/items/items.xml` de TFS tiene ~50.000 líneas y decenas de miles de `<item>`; `monsters.xml` es un índice de ~1.500 entradas y hay ~1.500 archivos de monstruo. El perfil de carga es: **se lee una vez al arrancar, en bloque, de un archivo local de confianza.**

**Recomendación: `fast-xml-parser` con `XMLParser` sobre el buffer completo.**
* Está diseñado exactamente para eso: su README declara *"Faster than any other pure JS implementation"* e *"It can handle big files (tested up to 100mb)"*.
* 310 M descargas/mes y push del día anterior a este informe: riesgo de abandono ≈ 0.
* Sin dependencias nativas ⇒ funciona en Windows y en cualquier contenedor sin `build-essential`.
* El resultado es un objeto JS que puedes recorrer directamente para construir tu modelo en memoria. Para `items.xml` querrás `isArray` para forzar que nodos repetidos (`<item>`, `<attribute>`) sean siempre arrays, y `preserveOrder` solo si necesitas orden (cuesta rendimiento).

**Ajustes concretos que necesitarás:**

```js
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,        // items.xml vive de sus atributos
  attributeNamePrefix: '',        // quieres `item.id`, no `item.@_id`
  isArray: (name) => ['item', 'attribute', 'monster', 'movevent', 'action', 'talkaction', 'event', 'flag', 'vocation'].includes(name),
  parseAttributeValue: true,      // id/itemid/count a number
  trimValues: true,
  // items.xml de TFS está en iso-8859-1: convierte el buffer antes de parsear
});
const model = parser.parse(fs.readFileSync('data/items/items.xml', 'latin1'));
```

(Alternativa: leer como `Buffer`, detectar la declaración `encoding="iso-8859-1"` del prólogo y decodificar con `TextDecoder('iso-8859-1')`. Es el detalle que más tiempo hace perder con `items.xml` real.)

**Cuándo NO usar fast-xml-parser:**

* Si necesitas **XPath**, **namespaces reales** o **XSD**: ahí `libxml2-wasm` es la respuesta, a cambio de una API con `dispose()` y un binario WASM.
* Si algún día parseas XML de red de tamaño desconocido: **sax/saxes** (streaming) o `@nodable/sax`, que el propio README de fast-xml-parser recomienda como 3‑4× más rápido que `sax`.

### 3.4 ¿Merece la pena validar con XSD/DTD las definiciones?

**Para `items.xml`/`monsters.xml`/`movements.xml`: no. Defensa razonada:**

1. **El esquema de esos archivos no es expresable de forma útil en XSD.** Ya lo has visto: `items.xml` usa `<attribute key="X" value="Y"/>` genérico y anidado, `movements.xml` tiene atributos que **mutan el tipo de evento** (`tileitem`), y `<movevent Equip>` mezcla atributos con hijos `<vocation>`. Un XSD para eso sería o enorme y laxo (todo `xs:string`), o rígido y en desacuerdo con la realidad del datapack. TFS **no incluye ningún XSD ni DTD** en el repositorio — y no es un olvido: es que no aporta.
2. **XSD te da "el documento es válido", no "el juego funcionará".** Los errores que de verdad rompen TFS son semánticos: `loot` referenciando un ítem que no existe, `countmax` sobre un ítem no apilable, un `spell` con `group` desconocido, `fromid` > `toid`, un `itemid` duplicado en `actions.xml`, un `RELOAD_TYPE_*` inexistente. Ninguno lo detecta un XSD; **todos** los detecta un validador propio.
3. **Coste/beneficio:** añadir `libxml2-wasm` para validar dos archivos que escribes tú mismo, en el arranque, es pagar 300 kB de WASM + una API con gestión manual de memoria para detectar fallos que detectarías antes escribiendo 150 líneas de validación semántica.

**Qué hacer en su lugar:**

* Un **parser + validador de dominio** en TypeScript con *tipos* y errores con número de línea: al recorrer el árbol, compara `fromid <= toid`, resuelve nombres de ítem contra el catálogo, comprueba que cada `script="..."` **existe en disco**, y que no hay claves duplicadas (`movement:StepIn:itemid:293`). Reporta **todos** los errores, no solo el primero.
* Un **esquema declarativo propio** (JSON Schema o Zod/TypeBox) para tu *modelo interno* ya parseado. Es donde de verdad quieres tipos: no en el XML de entrada, sino en el objeto que consume el motor.
* **Sí usa XSD cuando el XML no es tuyo**: importadores de mapas, integraciones con herramientas de terceros, formatos de cliente. Ahí `xmllint-wasm` es la opción pragmática (es xmllint de verdad, sin Java ni compilación).

---

## 4. Formato de configuración

### 4.1 El patrón `config.lua` de TFS

TFS no lee JSON ni YAML: **ejecuta un archivo Lua al arrancar** y extrae variables globales. El C++ es [`src/configmanager.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/configmanager.cpp):

```cpp
bool ConfigManager::load()
{
	lua_State* L = luaL_newstate();
	if (!L) { throw std::runtime_error("Failed to allocate memory"); }
	luaL_openlibs(L);

	if (string[CONFIG_FILE].empty()) { string[CONFIG_FILE] = "config.lua"; }

	if (luaL_dofile(L, string[CONFIG_FILE].data())) {
		std::cout << "[Error - ConfigManager::load] " << lua_tostring(L, -1) << std::endl;
		lua_close(L);
		return false;
	}

	// parse config
	worldType = getGlobalString(L, "worldType", "pvp");
	rateExp   = getGlobalNumber(L, "rateExp", 5);
	boolean[ALLOW_CHANGEOUTFIT] = getGlobalBoolean(L, "allowChangeOutfit", true);
	...
	lua_close(L);
	return true;
}
```

y los *getters* son genéricos, con valor por defecto y comprobación de tipo:

```cpp
std::string getGlobalString(lua_State* L, const char* identifier, const char* defaultValue)
{
	lua_getglobal(L, identifier);
	if (!lua_isstring(L, -1)) { lua_pop(L, 1); return defaultValue; }
	size_t len = lua_strlen(L, -1);
	std::string ret(lua_tostring(L, -1), len);
	lua_pop(L, 1);
	return ret;
}

bool getGlobalBoolean(lua_State* L, const char* identifier, const bool defaultValue) { ... }
```

El archivo real, `config.lua.dist` en la raíz del repo, es un **script Lua con comentarios y expresiones**:

```lua
-- Combat settings
-- NOTE: valid values for worldType are: "pvp", "no-pvp" and "pvp-enforced"
worldType = "pvp"
hotkeyAimbotEnabled = true
protectionLevel = 1
killsToRedSkull = 3
pzLocked = 60000
timeToDecreaseFrags = 24 * 60 * 60     -- ← aritmética, no el número 86400
whiteSkullTime = 15 * 60

-- Connection Config
-- NOTE: maxPlayers set to 0 means no limit
ip = "127.0.0.1"
gameProtocolPort = 7172
statusProtocolPort = 7171
maxPacketsPerSecond = 25

-- Startup
-- NOTE: defaultPriority only works on Windows and sets process
-- priority, valid values are: "normal", "above-normal", "high"
defaultPriority = "high"

-- Experience stages
-- NOTE: to use a flat experience multiplier, set experienceStages to nil
-- minlevel and multiplier are MANDATORY
-- maxlevel is OPTIONAL, but is considered infinite by default
experienceStages = {
	{ minlevel = 1, maxlevel = 8, multiplier = 7 },
	{ minlevel = 9, maxlevel = 20, multiplier = 6 },
	{ minlevel = 21, maxlevel = 50, multiplier = 5 },
	{ minlevel = 51, maxlevel = 100, multiplier = 4 },
	{ minlevel = 101, multiplier = 3 }
}
```

y su lectura de la tabla anidada, que es la parte interesante:

```cpp
ExperienceStages loadLuaStages(lua_State* L)
{
	ExperienceStages stages;
	lua_getglobal(L, "experienceStages");
	if (!lua_istable(L, -1)) { return {}; }

	lua_pushnil(L);
	while (lua_next(L, -2) != 0) {
		const auto tableIndex = lua_gettop(L);
		auto minLevel  = tfs::lua::getField<uint32_t>(L, tableIndex, "minlevel", 1);
		auto maxLevel  = tfs::lua::getField<uint32_t>(L, tableIndex, "maxlevel", std::numeric_limits<uint32_t>::max());
		auto multiplier = tfs::lua::getField<float>(L, tableIndex, "multiplier", 1);
		stages.emplace_back(minLevel, maxLevel, multiplier);
		lua_pop(L, 4);
	}
	lua_pop(L, 1);

	std::sort(stages.begin(), stages.end());
	return stages;
}
```

Obsérvese además que **la misma configuración tiene dos orígenes posibles y el Lua gana por defecto**: `loadXMLStages()` lee `data/XML/stages.xml` y si está vacío cae a `loadLuaStages(L)`, pero si el XML existe imprime *"[Warning - ConfigManager::load] XML stages are deprecated, consider moving to config.lua."* Ese es el patrón de migración que TFS aplicó: **de XML a Lua para la configuración.**

### 4.2 Ventajas de `config.lua` frente a JSON/YAML para un servidor de juego extensible

1. **Aritmética y expresiones.** `timeToDecreaseFrags = 24 * 60 * 60` es legible y no se desincroniza. En JSON escribes `86400` y nadie sabe de dónde sale. YAML no lo resuelve.
2. **Comentarios de verdad, multilínea, junto al valor.** JSON no tiene comentarios (y los "JSON con comentarios" siempre acaban siendo un dialecto roto). YAML los tiene, pero con reglas de indentación que son una fuente de bugs propia.
3. **Tipos ricos sin ambigüedad.** `nil` vs `false` vs `0` vs `"0"`. En YAML, `no`, `off`, `on` y `yes` se convierten silenciosamente en booleanos (el famoso "Norway problem"), y `version: 1.10` se convierte en el número `1.1`.
4. **Estructuras anidadas con nombre por campo, no por posición.** `{ minlevel = 1, maxlevel = 8, multiplier = 7 }` — auto‑documentado. Una lista de listas en JSON obliga a recordar que el índice 1 es `maxlevel`.
5. **Computación en tiempo de carga.** Puedes hacer `if os.getenv("DEV") then rateExp = 100 end`, derivar `rateLoot` de `rateExp`, o generar 200 entradas de tabla con un bucle. Eso es **código de configuración programática**, imposible en JSON/YAML declarativo (o posible solo con extensiones no estándar tipo *anchors*/*merge keys* de YAML, mucho más frágiles).
6. **Un lenguaje menos que mantener.** El servidor ya tiene un intérprete Lua cargado para los scripts. Usar Lua para la configuración significa **cero dependencias nuevas** y una sola sintaxis que el modder ya conoce. En Node tendrías que añadir un parser de YAML al *trust boundary* del arranque.
7. **Recarga en caliente coherente.** `/reload config` es re‑ejecutar el archivo. Con JSON es releerlo, pero **la lógica derivada (`rateLoot` depende de `rateExp`) tienes que programarla en JS** y mantenerla sincronizada con el archivo.

**El coste, que hay que asumir explícitamente:** `config.lua` es **código arbitrario ejecutado al arrancar**. Un `config.lua` malicioso puede borrar archivos o abrir sockets. En TFS eso es aceptable porque el datapack es de quien administra el servidor. En tu motor: trátalo como **código de confianza** (está en el repo del servidor) y no lo confundas con el sandbox de los mods.

### 4.3 Cómo se suele hacer *hot reload* de configuración

El patrón de TFS, ya visto en la sección 2.6:

```
/reload config  →  RELOAD_TYPE_CONFIG  →  Game.reload(RELOAD_TYPE_CONFIG)
                                            └─ ConfigManager::load() vuelve a leer config.lua
```

Con las dos restricciones que el propio `ConfigManager::load()` impone, y que hay que replicar:

1. **Una parte de la configuración solo se lee una vez.** El bloque `if (!loaded) { ... }` agrupa IP, `bindOnlyGlobalAddress`, `mapName`, `mapAuthor`, `houseRentPeriod`, MySQL (host/user/pass/db/sock/port) y los puertos de juego/status/HTTP. **Esos no cambian con `/reload`.** Tiene todo el sentido: cambiar el puerto de escucha en caliente requiere cerrar y reabrir el socket.
2. **Las variables de entorno tienen prioridad sobre el archivo** para credenciales:
   ```cpp
   string[MYSQL_HOST] = getEnv("MYSQL_HOST", getGlobalString(L, "mysqlHost", "127.0.0.1"));
   string[MYSQL_PASS] = getEnv("MYSQL_PASSWORD", getGlobalString(L, "mysqlPass", ""));
   integer[SQL_PORT]  = getEnv("MYSQL_PORT", getGlobalNumber(L, "mysqlPort", 3306));
   ```
   Es decir: el archivo es el *default*, el entorno es el *override* — el patrón correcto para contenedores/Docker. Cópialo: `getEnv("X", configValue)`.

**Diseño recomendado de hot reload en Node (con `config.lua`):**

1. Ejecuta `config.lua` **en un estado Lua propio y desechable** (`LuaFactory().createEngine()`), recoge las globales que te interesan con validación de tipo y **cierra el estado**. No lo ejecutes en el estado donde corren los scripts: así un `config.lua` que declare `os = ...` no contamina a los mods.
2. Separa la configuración en dos clases con contratos distintos:
   * **`static`**: puertos, `mapName`, credenciales de BD, rutas. Se lee al arrancar y **no se recarga**.
   * **`dynamic`**: rates, límites, flags de gameplay, tablas de stages. Se recarga con `/reload config`.
3. En la recarga, **aplica el nuevo valor y recalcula los derivados** (`rateLoot = f(rateExp)`) en una sola función `applyConfig(next)`. Nada de leer `config.rateExp` disperso por el código.
4. **Notifica el cambio.** Tras aplicar, recorre los suscriptores (subsistemas) para que actualicen sus cachés: igual que TFS recorre los `serverMap`/`timerMap` de los `GlobalEvent`. Un patrón sencillo: un `EventEmitter` con `config:changed` y un payload de *diff*.
5. **Valida antes de aplicar, y haz rollback si falla.** Con `config.lua` puedes tener un error de sintaxis en la línea 40: `luaL_dofile` devuelve `!= 0` y TFS **aborta el arranque** (`return false`). En recarga en caliente eso es inaceptable — debes **conservar la config anterior** y reportar el error al admin. Este es un punto donde mejorar el original, no copiarlo.

---

## 5. Arquitectura recomendada (síntesis)

Juntando todo:

```
game/
├── data/
│   ├── items/items.xml                 ← fast-xml-parser, una vez al arrancar
│   ├── monster/monsters.xml            ← índice
│   ├── monster/monsters/*.xml          ← definición por entidad
│   ├── actions/actions.xml             ← registro XML clásico (compatibilidad)
│   ├── movements/movements.xml
│   ├── talkactions/talkactions.xml
│   ├── creaturescripts/creaturescripts.xml
│   ├── spells/spells.xml
│   └── scripts/                        ← RevScriptSys: carga automática recursiva
│       ├── actions/*.lua               Action("x"):onUse(fn):register()
│       ├── movements/*.lua             MoveEvent("x"):type("StepIn"):itemId(293):onStepIn(fn):register()
│       ├── talkactions/*.lua           TalkAction("x"):words("/x"):onSay(fn):register()
│       ├── creaturescripts/*.lua       CreatureEvent("x"):type("advance"):onAdvance(fn):register()
│       ├── globalevents/*.lua          GlobalEvent("x"):type("startup"):onStartup(fn):register()
│       └── spells/*.lua                Spell("x"):words("exura"):onCastSpell(fn):register()
├── config.lua                          ← script Lua, evaluado en estado desechable
└── src/
    ├── lua/engine.ts                   ← wasmoon: factory + engine persistente
    ├── lua/api/                        ← Game.*, Position(), Tile(), userdata por id
    ├── lua/enums.json                  ← única fuente de verdad de constantes
    ├── content/xmlLoader.ts            ← fast-xml-parser + validador semántico
    ├── content/registry.ts             ← clave -> {generation, callback}; sobrescribe
    └── content/reload.ts               ← reloadType -> {clear, load}
```

Las cinco decisiones que de verdad determinan si esto sale bien:

1. **Un estado Lua, muchos registros.** No una VM por script.
2. **Clave de registro canónica que sobrescribe** (`movement:StepIn:itemid:293`) + **generación** para que el reload no deje callbacks zombis.
3. **Un solo `enums.json`** que genere constantes para Lua y tipos para TS. La deriva de constantes entre motor y scripts es el bug más caro de este tipo de proyecto.
4. **Validación semántica propia, no XSD.** Reporta todos los errores del datapack con archivo y línea al arrancar.
5. **Presupuesto de tiempo por callback**, medido en JS, con cuarentena del script infractor. Es la única protección real contra un `while true do end`.

---

## 6. Lo que NO he podido verificar (transparencia)

* **`onTradeRequest` / `onTradeAccept` como callbacks de RevScriptSys en TFS `master`.** Solo verifiqué `Player:onTradeCompleted(target, item, targetItem, isSuccess)` en el changelog de 1.4. Las variantes `onTradeRequest`/`onTradeAccept` existían en TFS 0.3/0.4 pero no las he confirmado en 1.x.
* **Nombres de constructor de RevScriptSys con `:register()` sobre `Party` y `MonsterType`**: están en la lista oficial de constructores soportados del changelog 1.4 y en `luascript.h`, pero no he leído un ejemplo completo de cada uno.
* **Benchmarks independientes de wasmoon vs fengari.** Solo dispongo del publicado por el autor de wasmoon en su propio README; no encontré una comparativa de terceros reproducible.
* **Advisories de seguridad formales (CVE/GHSA) de wasmoon y fengari.** Las páginas de Snyk existen, pero no extraje entradas concretas; no afirmo que estén libres de vulnerabilidades.
* **Descargas mensuales de `libxml2-wasm`, `xmllint-wasm` y `saxes`**: la API de descargas no las devolvió en las consultas realizadas.
* **`libxmljs2` y prebuilds para Windows**: su README (que empieza con "NO LONGER MAINTAINED") remite a los requisitos de `node-gyp` y **no** documenta prebuilds oficiales; no pude confirmar el estado del pipeline de binarios precompilados. Trátalo como "requiere toolchain C++".
* **Fechas exactas de los últimos commits de algunos repos** (`fengari` con `pushed_at` 2026‑01‑02 pero release npm de 2025‑12‑26): coherentes entre sí, pero el `updated_at` de GitHub refleja actividad de metadatos, no de código.

---

## 7. Fuentes

**Lua en Node.js**
- [wasmoon en GitHub (README y benchmark)](https://github.com/ceifa/wasmoon) · [wasmoon en npm](https://www.npmjs.com/package/wasmoon) · [Snyk](https://security.snyk.io/package/npm/wasmoon)
- [fengari en GitHub (README, limitaciones)](https://github.com/fengari-lua/fengari) · [fengari en npm](https://www.npmjs.com/package/fengari) · [Snyk](https://security.snyk.io/package/npm/fengari)
- [lua-in-js (deprecado, funcionalidad ausente)](https://github.com/teoxoy/lua-in-js) · [en npm](https://www.npmjs.com/package/lua-in-js)
- [node-lua (binding nativo, node-gyp, 2017)](https://github.com/medaeus245/node-lua) · [en npm](https://www.npmjs.com/package/node-lua)
- [wasmoon-lua5.1](https://github.com/X3ZvaWQ/wasmoon-lua5.1) · [lua-state](https://github.com/quaternion/node-lua-state)
- [thenumbernine/lua-ffi-wasm](https://github.com/thenumbernine/lua-ffi-wasm) · [Neovim: LuaJIT en WebAssembly (neovim#36327)](https://github.com/neovim/neovim/discussions/36327)
- [Descargas npm de wasmoon](https://api.npmjs.org/downloads/point/last-month/wasmoon) · [de fengari](https://api.npmjs.org/downloads/point/last-month/fengari)

**The Forgotten Server**
- [Repositorio otland/forgottenserver](https://github.com/otland/forgottenserver) · [release v1.6](https://github.com/otland/forgottenserver/releases/tag/v1.6) · [release v1.4 (RevScriptSys, event callbacks, lista completa de novedades)](https://github.com/otland/forgottenserver/releases/tag/v1.4)
- Código (firmas de callbacks y registro de la API Lua):
  [`src/creatureevent.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/creatureevent.cpp) ·
  [`src/movement.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/movement.cpp) ·
  [`src/actions.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/actions.cpp) ·
  [`src/talkaction.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/talkaction.cpp) ·
  [`src/globalevent.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/globalevent.cpp) ·
  [`src/spells.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/spells.cpp) ·
  [`src/luascript.h`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/luascript.h) ·
  [`src/configmanager.cpp`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/configmanager.cpp)
- Datapack (XML y Lua literales):
  [`config.lua.dist`](https://raw.githubusercontent.com/otland/forgottenserver/master/config.lua.dist) ·
  [`data/movements/movements.xml`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/movements/movements.xml) ·
  [`data/movements/scripts/tiles.lua`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/movements/scripts/tiles.lua) ·
  [`data/actions/actions.xml`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/actions/actions.xml) ·
  [`data/talkactions/talkactions.xml`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/talkactions/talkactions.xml) ·
  [`data/creaturescripts/creaturescripts.xml`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/creaturescripts/creaturescripts.xml) ·
  [`data/globalevents/globalevents.xml`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/globalevents/globalevents.xml) ·
  [`data/spells/spells.xml`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/spells/spells.xml) ·
  [`data/scripts/creaturescripts/player/update_client_on_advance_level.lua`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/scripts/creaturescripts/player/update_client_on_advance_level.lua) ·
  [`data/talkactions/scripts/reload.lua`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/talkactions/scripts/reload.lua) ·
  [`data/monster/monsters.xml`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/monster/monsters.xml) ·
  [`data/monster/monsters/rat.xml`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/monster/monsters/rat.xml) ·
  [`data/items/items.xml`](https://raw.githubusercontent.com/otland/forgottenserver/master/data/items/items.xml)
- [Stigmax — TFS Guide (documentación de funciones)](https://stigmax.gitbook.io/tfs-guide/function-documentation/docs-game)

**XML en Node.js**
- [fast-xml-parser (repo y README)](https://github.com/NaturalIntelligence/fast-xml-parser) · [en npm](https://www.npmjs.com/package/fast-xml-parser)
- [libxml2-wasm (README, tabla WASM vs binding nativo, XSD)](https://github.com/jameslan/libxml2-wasm) · [en npm](https://www.npmjs.com/package/libxml2-wasm)
- [xmllint-wasm en npm](https://www.npmjs.com/package/xmllint-wasm) · [benchmark XSD: xmllint-wasm vs xerces-wasm](https://github.com/harshanacz/xml-val-benchmark)
- [libxmljs2 (repo; README: "NO LONGER MAINTAINED")](https://github.com/marudor/libxmljs2) · [en npm](https://www.npmjs.com/package/libxmljs2) · [libxmljs2-xsd](https://github.com/cdegalitt/libxmljs2-xsd)
- [sax](https://www.npmjs.com/package/sax) · [xml2js](https://www.npmjs.com/package/xml2js) · [@xmldom/xmldom](https://www.npmjs.com/package/@xmldom/xmldom) · [saxes](https://www.npmjs.com/package/saxes) · [xmlbuilder2](https://www.npmjs.com/package/xmlbuilder2) · [@rgrove/parse-xml](https://www.npmjs.com/package/@rgrove/parse-xml)
