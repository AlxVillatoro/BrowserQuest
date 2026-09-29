# Arquitectura de Avillatoro

Documento de decisiones. Cada decisión relevante lleva **la evidencia que la
respalda** (una medición propia, una fuente primaria, o ambas), porque las
decisiones sin evidencia son las que hay que volver a tomar dentro de seis meses.

Referencias estudiadas:

- [Mateuzkl/forgottenserver-downgrade-1.8-8.60](https://github.com/Mateuzkl/forgottenserver-downgrade-1.8-8.60) — TFS 1.8 (C++23, Lua 5.5, MariaDB) con el protocolo rebajado a 8.60. Es el modelo a seguir.
- [informe-mmorpg-tibia-2.5d.md](informe-mmorpg-tibia-2.5d.md) — mecánicas reales de Tibia leídas del código de The Forgotten Server y OTClient.
- [informe-ecosistema-tibia.md](informe-ecosistema-tibia.md) — herramientas, formatos binarios y licencias del ecosistema.

---

## 1. Separación de responsabilidades

El modelo es el de cualquier servidor de Tibia: **tres mundos separados unidos por
un contrato de datos**.

```
   HERRAMIENTAS                 MOTOR (autoritativo)              CLIENTE
┌──────────────────┐        ┌─────────────────────────┐     ┌──────────────────┐
│ editor de items  │──.otb─▶│  items.xml + items.otb  │     │  Tibia.dat       │
│ editor de mapas  │──.otbm▶│  data/XML/*.xml         │     │  Tibia.spr       │
│ (MIT, web)       │        │  data/scripts/*.lua     │     │  (assets propios)│
└──────────────────┘        │  data/monsters/*.lua    │     └──────────────────┘
                            │  data/world/*.otbm      │             ▲
                            │  estado del mundo (RAM) │             │
                            │  persistencia           │             │
                            └───────────┬─────────────┘             │
                                        │  PROTOCOLO                  │
                                        └─────────────────────────────┘
```

**El motor es el árbitro.** Mantiene el mundo, simula el tiempo y valida cada
acción.

**El cliente es un terminal de dibujo con assets locales.** No lee `items.xml`,
no conoce fórmulas de daño, no sabe del mapa más de lo que el servidor le manda
tile a tile. Su mundo es literalmente la unión de los paquetes que ha recibido.
Lo único que comparte con el motor es el **ClientID**: el índice con el que
resuelve el sprite en su propio `.dat`/`.spr`. Cuando esa correspondencia se
desalinea, el síntoma clásico es ver columnas o cadáveres donde debería haber un
árbol.

**Las herramientas sólo producen archivos.** No hablan con el motor.

### La frontera, en una frase

> El `.otb` es el contrato de identificadores; el XML es la capa semántica
> exclusiva del motor; el mapa es el mundo; y el protocolo es el único canal por
> el que el cliente se entera de que el mundo existe.

---

## 2. Estructura de directorios

```
config.lua            configuración del motor (se ejecuta como Lua)
engine/               MOTOR
  main.js               arranque
  core/
    engine.js           orden de carga
    config.js           carga de config.lua
    logger.js
  lua/
    runtime.js          host de Lua (fengari)
    api.js              primitivas que cruzan la frontera
  data/
    xml.js              items.xml, data/XML/*.xml
  world/
    world.js            estado del mundo
data/                 CONTENIDO (el "datapack")
  items/items.xml       definiciones semánticas de items
  XML/vocations.xml     definiciones del motor
  lib/core/*.lua        librería Lua: la API cómoda
  scripts/              contenido programado (acciones, movimientos, comandos)
  monsters/             monstruos, en Lua
  world/                mapas
client/               CLIENTE (assets y render)
tools/                herramientas y pruebas
```

`data/` se corresponde con el `data/` de TFS y es lo que un administrador de
servidor toca. `engine/` es el motor y no se toca para añadir contenido: si hace
falta tocar el motor para añadir un hechizo, la arquitectura está mal.

### Estado actual

| Pieza | Estado |
|---|---|
| `config.lua` + carga | hecho y probado |
| `items.xml` + `data/XML/*.xml` | hecho y probado |
| Runtime de Lua + API primitiva | hecho y probado |
| Librería Lua (`data/lib/`) | hecho y probado |
| Registro y despacho de eventos | hecho y probado |
| Monstruos en Lua | hecho y probado |
| Mapas, tiles, movimiento | pendiente |
| Protocolo y red | pendiente |
| Persistencia | pendiente |
| Importadores OTBM/OTB/DAT/SPR | pendiente |

---

## 3. Decisiones de diseño

### 3.1 La configuración es Lua, no JSON

`config.lua` se **ejecuta**, y sus asignaciones de primer nivel se convierten en
claves de configuración. Las claves se extraen del propio archivo, así que añadir
una opción no obliga a tocar el motor.

Lo que esto habilita y un JSON no puede dar sin inventar un dialecto:

```lua
experienceStages = {
    { minlevel = 1,   maxlevel = 50,  multiplier = 100 },
    { minlevel = 51,  maxlevel = 100, multiplier = 50 },
}
```

Es el patrón de TFS y la razón de que su `config.lua.dist` tenga 23 KB de opciones
legibles.

### 3.2 XML para lo declarativo, Lua para lo que lleva lógica

| Va en XML | Va en Lua |
|---|---|
| Vocaciones, outfits, grupos, mounts, quests | Monstruos, hechizos, acciones, movimientos, comandos |
| Tablas de multiplicadores y fórmulas | Cualquier cosa con condicionales, estado o azar |

Un monstruo acaba necesitando ataques condicionales, invocaciones, gritos con
probabilidad y loot con rangos. Forzar eso a XML produce dialectos imposibles de
mantener. **En TFS moderno los monstruos son Lua, no XML**, y aquí se copia esa
decisión a propósito.

### 3.3 El runtime de Lua: fengari, y por qué

Se compararon los dos runtimes viables en Node. El resultado fue **contra la
intuición**: el WASM no gana.

| | wasmoon (Lua 5.4/WASM) | fengari (Lua 5.3/JS) |
|---|---|---|
| Arranque de la VM | 168 ms | **69 ms** |
| Despacho con reentrada en JS | 13.123 eventos/s | **19.666 eventos/s** |
| Despacho con lógica pura | 13.699 eventos/s | **36.765 eventos/s** |
| Compilación nativa | no | no |

**Por qué.** El coste dominante no es ejecutar Lua, es **cruzar la frontera**, y
wasmoon cruza JS↔WASM en cada llamada. "WASM será más rápido" sólo se cumpliría
con Lua puro y CPU-intensivo (un pathfinding escrito en Lua, por ejemplo), no
despachando eventos cortos, que es el caso real. Esa comparación se midió con
ambos runtimes en la misma corrida y el mismo trabajo; las cifras de la tabla
anterior salen de corridas distintas y no son comparables entre sí.

Ninguno de los dos necesita compilador de C++ en Windows, que era un requisito.
El banco de pruebas queda en `tools/bench-lua.js` para poder repetir la medición
(compara los dos runtimes si `wasmoon` está instalado).

### 3.4 La API de Lua usa identificadores, y el azúcar vive en Lua

Ésta es la decisión con más impacto en el rendimiento, y se tomó midiendo tres
alternativas:

| Forma | Coste relativo | Sintaxis |
|---|---|---|
| Identificadores desnudos | 1,00x (suelo, muy estable) | `Engine.getPlayerName(id)` |
| **Shim orientado a objetos en Lua** | **2,0x – 4,0x** | **`player:getName()`** |
| Userdata de JavaScript (`pushjs`) | 3,9x – 18,8x | `player:getName()` |

Las tres miden el mismo trabajo: dos llamadas a la API y una operación de cadena.

**Sobre la precisión de estos números.** El *orden* es robusto y se ha
reproducido en todas las corridas: identificadores < shim < userdata. Las
*magnitudes* no lo son: el shim se movió entre 2,0x y 4,0x, y el userdata entre
3,9x y 18,8x según la corrida. La causa es que las variantes con metatabla
generan mucha basura para el recolector, y el recolector decide cuándo. Lo que sí
es estable es la conclusión cualitativa: **el shim es entre 1,3x y 4,7x más
rápido que el userdata**, y por eso se eligió. El banco queda en
`tools/bench-lua.js` para poder repetirlo, y sus cifras deben leerse como rangos,
no como constantes.

**Conclusión.** La frontera sólo cruza enteros y cadenas. La comodidad
(`player:getPosition()`) se construye **en Lua**, en `data/lib/`, con una
metatabla sobre el identificador. Se obtiene la sintaxis de TFS por menos de la
mitad de lo que costaría envolver las entidades como userdata, y encima el azúcar
queda como código Lua que cualquiera puede leer y extender.

Además, `Player` sólo guarda el identificador y pregunta al motor en cada
método. Eso garantiza que un script **no pueda quedarse con una copia obsoleta**
del estado del mundo, que es la clase de fallo más difícil de depurar en un
servidor de juego.

### 3.5 El orden de carga está fijado

```
1. config.lua        el resto de rutas sale de aquí
2. XML               items.xml y data/XML/*.xml rellenan los tipos
3. API primitiva     se publica `Engine` antes de que nadie la use
4. data/lib/         la librería construye Game, Player, Action sobre Engine
5. envoltorios       se resuelven y referencian para poder despachar
6. contenido         data/scripts/ y data/monsters/, que ya pueden usar todo
```

Invertir 3 y 4, o 4 y 6, produce errores de `nil value` que parecen del script y
son del orden de arranque. Es el fallo clásico al montar un datapack, así que el
orden está fijado en el código y no se deja al azar.

### 3.6 Los formatos: interoperabilidad sí, runtime no

**Decisión: adoptar OTBM/OTB/DAT/SPR como frontera de importación y exportación,
y usar un formato interno propio en tiempo de ejecución.**

A favor de los formatos de Tibia: dan gratis todo el contenido de la comunidad y
editores ya mantenidos.

En contra para el runtime, y son razones técnicas concretas:

- El árbol de nodos `0xFE`/`0xFF` es lento de recorrer.
- No admite escritura incremental.
- `TILE_AREA` agrupa bloques de 256×256, lo que impide consultar un tile en O(1).
- La semántica cambia entre las cuatro versiones de OTBM.
- Interpretar un mapa exige además el `.otb` (el OTBM no guarda el `count` de los
  items apilables) y, para las herramientas, el `.dat`/`.spr`.

**El `.otb` no es opcional.** Está documentado por el propio autor del parser de
OTBM: sin él no se puede leer correctamente un mapa.

### 3.7 Las licencias son una trampa, y ya está resuelta

| Proyecto | Licencia | ¿Se puede reutilizar? |
|---|---|---|
| Remere's Map Editor (original, Canary, OTAcademy) | **GPL-3.0** | El código no |
| DewralMapEditor | **AGPL-3.0** | No (viral incluso en SaaS) |
| [knobik/yatme](https://github.com/knobik/yatme) — editor de mapas OTBM completo en navegador | **MIT** | **Sí** |
| [@gesior/open-tibia-library](https://github.com/gesior/open-tibia-library) — DAT + SPR + OTB, lectura y escritura | **MIT** | **Sí** |
| [@v0rt4c/otbm](https://github.com/V0RT4C/ot-otbm) — OTBM, lectura y escritura | **MIT** | **Sí** |
| [punkice3407/ObjectBuilder](https://github.com/punkice3407/ObjectBuilder) | **MIT** | Sí |

Los **formatos** no son objeto de copyright; las **implementaciones** sí. Por eso
la regla es: se lee el código de RME para entender el formato, y se implementa
desde las librerías MIT. Ninguna de las dos librerías clave tiene dependencias
nativas, y ambas funcionan en Node y en el navegador (verificado en npm:
`@gesior/open-tibia-library` 0.2.1 MIT, `@v0rt4c/otbm` 0.2.0 MIT).

Consecuencia práctica: **hay que escribir mucho menos de lo que parecía.** El
editor de mapas y el de items no se escriben desde cero hasta haber agotado las
herramientas MIT existentes.

### 3.8 Advertencia sobre `.dat`/`.spr`

Desde Tibia 12 el cliente oficial abandonó `.dat`/`.spr` en favor de protobuf
(`appearances-*.dat`) y atlas de sprites comprimidos con LZMA. Ese pipeline sólo
cubre hasta ~10.98, que es donde está la inmensa mayoría de los assets de la
comunidad. Es una decisión de alcance, no un detalle: si algún día se quiere
contenido moderno, esta parte hay que sustituirla.

---

## 4. El modelo de extensibilidad

Se reproduce el patrón RevScript de The Forgotten Server, que es el que la
comunidad ya conoce. Un script real del motor, íntegro:

```lua
local action = Action()

function action.onUse(player, item, fromPosition, target, toPosition, isHotkey)
    local destination = player:getPosition()
    destination:moveUpstairs()

    if not player:teleportTo(destination) then
        player:sendTextMessage("No puedes subir aqui.")
        return true
    end

    player:sendTextMessage("Subes a " .. tostring(destination) .. ".")
    return true
end

action:id(1948)
action:register()
```

Objetos de registro disponibles: `Action` (`onUse`), `MoveEvent` (`onStepIn`,
`onStepOut`, `onEquip`, `onDeEquip`), `TalkAction` (`onSay`, con coincidencia por
prefijo para que `/item 3031` active `/item`) y `Game.createMonsterType` para
monstruos.

Mantener este patrón no es nostalgia: significa que quien ya sabe escribir
datapacks sabe escribir para este motor desde el primer minuto.

---

## 5. Plan por fases

**Fase 1 — Base técnica.** *Hecho.* Servidor heredado modernizado, cliente
servido, pruebas end-to-end y de diagnóstico en verde.

**Fase 2 — Capa de datos y scripting.** *Hecho.* `config.lua`, definiciones XML,
runtime de Lua, API primitiva, librería Lua, registro y despacho de eventos,
monstruos en Lua. Verificado por `tools/test-engine.js`.

**Fase 3 — Mundo.** Formato interno de mapa (chunks), tiles y apilado
(*stackpos*), movimiento por tiles con coste de paso, plantas múltiples (Z). El
importador de OTBM entra aquí.

**Fase 4 — Red y protocolo.** Servidor autoritativo. Aquí es donde el cliente
pasa a ser un terminal: hoy el cliente heredado es **cliente-autoritativo para el
movimiento**, y eso hay que invertirlo.

**Fase 5 — Persistencia.** Cuentas, personajes, inventario, storages.

**Fase 6 — Herramientas.** Importador/exportador OTBM, `otb2json`,
`spr`→atlas. Sólo lo que no cubran las herramientas MIT.

**Fase 7 — Render 2.5D.** Orden por diagonales, offset por planta, altura de
sprite y sombra proyectada. Ver la sección de 2.5D del informe de mecánicas.

---

## 6. Riesgos conocidos

| Riesgo | Estado |
|---|---|
| El servidor heredado (`server/`) y el motor nuevo conviven | **Abierto.** El cliente sigue conectado al heredado; hay que migrarlo y retirar `server/` |
| El cliente heredado es autoritativo en el movimiento | **Abierto.** Es lo contrario de la arquitectura objetivo |
| Sin persistencia: todo se pierde al reiniciar | **Abierto** |
| `.dat`/`.spr` sólo cubre hasta ~10.98 | Aceptado como alcance |
| Lua 5.3 no es Lua 5.1: los scripts de la era 8.60 usan `unpack`, `setfenv`, etc. | **Abierto.** Hará falta una capa de compatibilidad si se quieren traer datapacks antiguos |
| El motor no tiene sandbox de scripts | **Abierto.** Un script puede llamar a `os.exit`. Irrelevante mientras los scripts sean de confianza; bloqueante si algún día no lo son |
