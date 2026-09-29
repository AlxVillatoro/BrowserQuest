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
config.js             configuración del motor (un módulo que exporta un objeto)
engine/               MOTOR
  main.js               arranque
  core/
    engine.js           orden de carga
    config.js           carga de config.js
    logger.js
  scripting/
    registry.js         registro de contenido y despacho de eventos
    loader.js           carga de los módulos de data/
    entities.js         envoltorios Player / Item / Position
    game.js             la API `Game` y su instalación como global
  data/
    xml.js              items.xml, data/XML/*.xml
  world/
    world.js            estado vivo: jugadores, items en el suelo
    position.js         la coordenada canónica
    item.js             instancia de item, con sus banderas
    tile.js             el tile y su apilado (stackpos)
    map.js              el mapa por chunks, con plantas y visibilidad
    stepcost.js         duración del paso (la fórmula real de Tibia)
    loader.js           carga y validación del formato de mapa
data/                 CONTENIDO (el "datapack")
  items/items.xml       definiciones semánticas de items, con sus banderas
  XML/vocations.xml     definiciones del motor
  scripts/              contenido programado (acciones, movimientos, comandos)
  monsters/             monstruos, en JavaScript
  world/                mapas (formato interno, legible en un diff)
client/               CLIENTE (assets y render)
tools/                herramientas y pruebas
```

`data/` se corresponde con el `data/` de TFS y es lo que un administrador de
servidor toca. `engine/` es el motor y no se toca para añadir contenido: si hace
falta tocar el motor para añadir un hechizo, la arquitectura está mal.

### Estado actual

| Pieza | Estado |
|---|---|
| `config.js` + carga | hecho y probado |
| `items.xml` + `data/XML/*.xml` | hecho y probado |
| Registro y despacho de eventos | hecho y probado |
| Envoltorios de entidad y API `Game` | hecho y probado |
| Monstruos como módulos | hecho y probado |
| Recarga en caliente | hecho y probado |
| Mapa por chunks, con plantas | hecho y probado |
| Tiles y apilado (*stackpos*) | hecho y probado |
| Coste de paso (fórmula real de Tibia) | hecho y probado |
| Reglas de paso y esquinas | hecho y probado |
| Visibilidad entre plantas | hecho y probado |
| Validación de mapas | hecho y probado |
| Criaturas (jugadores y monstruos) | hecho y probado |
| Movimiento por tiles, con cooldown | hecho y probado |
| Planificador de eventos temporizados | hecho y probado |
| Spawns y reaparición | hecho y probado |
| Limpieza de tiles materializados | hecho y probado |
| Combate (daño, armadura, elementos) | hecho, con la fórmula de daño pendiente de verificar |
| Experiencia y subida de nivel | hecho y probado |
| Botín y eventos de criatura | hecho y probado |
| Búsqueda de caminos | hecho y probado |
| IA de monstruos: ver, perseguir, atacar | hecho y probado |
| Protocolo y vista (qué ve el cliente) | hecho y probado |
| Sesiones y autoridad del servidor | hecho y probado |
| Servidor WebSocket, con agrupado por tick | hecho y probado por red |
| Cliente que consuma el protocolo nuevo | pendiente |
| Hechizos de área, invocación, huida | pendiente |
| Frases de los monstruos (`voices`) | pendiente (los datos ya se cargan) |
| Persistencia | pendiente |
| Importadores OTBM/OTB/DAT/SPR | pendiente |

---

## 3. Decisiones de diseño

### 3.1 La expansión es JavaScript

**Decisión del responsable del proyecto**, y la razón práctica que la respalda es
fuerte: elimina una dependencia, elimina un lenguaje del proyecto y **elimina la
frontera que dominaba el coste**.

En la etapa anterior el motor ejecutaba Lua (fengari) y cada evento cruzaba
JS↔Lua. Esa frontera era el cuello de botella real, no la velocidad del
intérprete, y obligaba a diseñar la API con identificadores en vez de objetos para
no pagar entre 2x y 18,8x por llamada. Con el contenido en JavaScript **no hay
frontera**: un handler es una función y una entidad es un objeto.

**Lo que se conservó de aquella investigación**, porque sigue siendo cierto y
ahorra tener que repetirla:

- Los dos runtimes de Lua viables en Node eran `wasmoon` (Lua 5.4 en WASM) y
  `fengari` (Lua 5.3 en JavaScript), ninguno con compilación nativa. Se midió que
  **fengari despacha 1,5x más eventos por segundo que wasmoon**, porque el coste
  está en cruzar la frontera y wasmoon cruza JS↔WASM. "WASM será más rápido" sólo
  se cumple con Lua puro y CPU-intensivo, no con eventos cortos.
- Los bindings nativos de Lua para Node están muertos: `node-lua` sin tocar desde
  2017 sobre `node-gyp`, `luajit` despublicado de npm en 2017, y LuaJIT en WASM
  no existe (necesita `mmap` con `PROT_EXEC`; WASM es AOT sin W^X). Si algún día
  se quisiera volver a Lua, el camino es `wasmoon`, no un binding nativo.
- **Ninguna de las dos librerías ofrece sandbox real**: un `while true do end`
  bloquea el bucle de eventos y nada limita la memoria. Eso también es cierto del
  JavaScript, así que no se pierde nada por este lado (ver §6).

**Lo que se gana además**: un módulo de contenido es un módulo de Node, así que
tiene a mano todo el ecosistema (`npm`), las herramientas de depuración del
lenguaje, los tipos y las pruebas. Con Lua, cada utilidad había que escribirla
otra vez.

### 3.2 La configuración es un módulo, no un formato

`config.js` exporta un objeto, y ese objeto **es** la configuración: no hay
formato que parsear ni lista de claves que mantener sincronizada.

Frente a JSON, y con el mismo argumento que usaba TFS para su `config.lua`, admite
lo que un formato de datos no puede:

```js
const ENTORNO = process.env.NODE_ENV || 'development';

module.exports = {
    maxPlayers: ENTORNO === 'production' ? 500 : 50,
    experienceStages: [
        { minlevel: 1,   maxlevel: 50,  multiplier: 100 },
        { minlevel: 151, maxlevel: 0,   multiplier: 10 }   // 0 = sin tope
    ]
};
```

Cálculos, condicionales por entorno y estructuras con campos con nombre. La
última etapa de experiencia no tiene tope, y un JSON obligaría a inventar un
número centinela y documentarlo.

**Dos reglas que sí conviene respetar**, tomadas del análisis de TFS:

- **Nada de efectos secundarios al cargarse.** Abrir puertos o conectar a la base
  de datos en el archivo de configuración convierte la configuración en un
  programa, y entonces no se puede cargar para inspeccionarla.
- **Configuración estática y dinámica son distintas.** Puertos, nombre del mapa y
  credenciales se leen una vez y **no se recargan**; rates, límites y etapas sí.
  Confundirlas lleva a esperar que un `/reload` cambie el puerto, que no lo hará.

TFS además aplica `getEnv("MYSQL_HOST", valorDelArchivo)`: el archivo da el valor
por defecto y el entorno puede sobrescribirlo, que es el patrón cómodo para
contenedores. Merece la pena copiarlo cuando haya base de datos.

### 3.3 XML para lo declarativo, código para lo que lleva lógica

| Va en XML | Va en código |
|---|---|
| Vocaciones, outfits, grupos, mounts, quests | Monstruos, hechizos, acciones, movimientos, comandos |
| Tablas de multiplicadores y fórmulas | Cualquier cosa con condicionales, estado o azar |

Un monstruo acaba necesitando ataques condicionales, invocaciones, gritos con
probabilidad y loot con rangos. Forzar eso a XML produce dialectos imposibles de
mantener. **En TFS moderno los monstruos son código, no XML**, y aquí se copia esa
decisión a propósito.

Dos detalles prácticos del formato, verificados en el ecosistema:

- **`items.xml` de TFS está en `iso-8859-1`, no en UTF-8.** Leerlo como UTF-8
  destroza los nombres con acentos. Hay que declarar la codificación al leer.
- **Validar con XSD no merece la pena aquí.** El esquema real de TFS no es
  expresable de forma útil (el `<attribute key="X" value="Y"/>` es genérico y
  anidable), y XSD daría "documento válido", no "el juego funcionará". Los fallos
  reales son semánticos: loot que apunta a un item inexistente, `fromid > toid`,
  un `script` que no existe, un itemid duplicado. Lo que hace falta es un
  **validador de dominio propio** que informe de todos los errores con archivo y
  línea.

### 3.4 Las firmas de los handlers son las de TFS

Se copian literalmente, y están verificadas en el código de The Forgotten Server,
no deducidas:

```
onUse(player, item, fromPosition, target, toPosition, isHotkey)      6 args
onSay(player, words, param, type)                                    4 args
onStepIn / onStepOut(creature, item, position, fromPosition)         4 args
onEquip / onDeEquip(player, item, slot, isCheck)                     4 args
onAddItem / onRemoveItem(moveitem, tileitem, position)               3 args
```

**La firma cambia según el tipo de evento, y eso es una trampa real**: pasar los
argumentos de `stepin` a un handler de `equip` produce un handler que recibe
basura sin dar ningún error. Por eso el despacho construye los argumentos según el
tipo, en vez de tener una sola lista.

Se copian por una razón práctica: quien ya sabe escribir un datapack reconoce el
patrón, y una firma inventada obliga a aprender de cero. Además, `onSay` conserva
el cuarto argumento `type` (el canal de chat) en vez de recortarlo.

Un aviso para cuando se traigan datapacks antiguos: `doCreatureSay`,
`doTeleportThing` y compañía son la API de **TFS 0.3/0.4**, no la de las versiones
modernas, donde la API es orientada a objetos (`player:getPosition()`). Traducir un
datapack antiguo es traducir esas llamadas, no sólo el lenguaje.

### 3.5 Los envoltorios aíslan el estado del mundo

Los handlers **no reciben los objetos del mundo**, sino envoltorios alrededor de un
identificador: `Player`, `Item`, `Position`. No es cosmético. Si un script
recibiera el objeto real, podría mutarlo sin pasar por ninguna regla —ponerse
999999 de vida, teletransportarse fuera del mapa, vaciar el inventario de otro—.

Con un envoltorio, todo lo que hace un script pasa por la API y ahí se puede
validar. Y `getPosition()` devuelve una **copia**: mutarla no mueve a nadie hasta
llamar a `teleportTo`. Sin eso, un script que consulta una posición para calcular
algo movería al jugador sin querer.

En Lua esto costaba entre 2x y 4x. En JavaScript es una clase normal y no cuesta
nada extra. Ésa es la ganancia concreta, medida, de haber dejado Lua.

**La única global del proyecto** es `Game`, la superficie de scripting, y es
deliberada: es lo que hace TFS, permite que un módulo de contenido no importe
nada, y el motor guarda y restaura el valor anterior al cerrarse. Todo lo demás
evita globales a propósito — basta ver `tools/audit-globals.js` y el fallo que
motivó ese script.

### 3.6 El orden de carga está fijado

```
1. config.js         el resto de rutas y opciones sale de aquí
2. Definiciones XML  items.xml y data/XML/*.xml rellenan los tipos
3. Mundo             el estado, que es de quien son los tipos cargados
4. Registro          acciones, movimientos, comandos y monstruos
5. Game              se instala ANTES de cargar contenido, porque un módulo
                     puede usarlo ya al cargarse
6. Contenido         data/scripts/ y data/monsters/, que ya pueden usar todo
```

Invertir 3 y 6, o 5 y 6, produce errores que parecen del script y son del orden de
arranque. Es el fallo clásico al montar un datapack, así que el orden está fijado
en el código y no se deja al azar. Nótese que **el mapa se carga después del
contenido**, y es el mismo orden que sigue TFS: validar los spawns exige tener ya
los tipos de monstruo registrados.

### 3.7 El mundo: almacenamiento disperso, apilado y coste de paso

**Almacenamiento.** El mapa se guarda por chunks de 32×32 por planta, y **sólo se
almacenan los tiles que el mapa menciona**. El resto se resuelve contra el suelo
por defecto de su planta.

La razón es de escala: un mapa de 2048×2048 con 16 plantas son 67 millones de
celdas. Materializarlas cuesta gigabytes para representar un desierto de suelo
repetido. En el mapa de ejemplo la diferencia es medible: **28 tiles explícitos
frente a 65.536 celdas posibles, un 0,04%**. Y la consulta sigue siendo O(1)
porque va a un array indexado dentro del chunk.

Es también la razón concreta por la que OTBM no se usa en tiempo de ejecución: su
`TILE_AREA` de 256×256 obliga a recorrer para llegar a un tile.

**Apilado.** El orden es el del servidor de Tibia: suelo → items de abajo →
criaturas → items de arriba. El cliente dibuja en ese orden y resuelve el
solapamiento **sin ningún z-buffer**, que es el truco central del 2.5D de Tibia.

Dos detalles que se copian a propósito:

- El suelo es un item **aparte**, no "el primero de la pila": hay exactamente uno,
  siempre abajo del todo, y las reglas de paso dependen de él de forma distinta.
- Hay un tope de **10 posiciones** direccionables, y no es una limitación del motor
  sino del protocolo: el índice viaja en un byte, así que lo que quede por encima
  es inalcanzable para el jugador.

También se evita heredar una trampa documentada: en Tibia la bandera
`FLAG_ALWAYSONTOP` significa en realidad "siempre en la banda de abajo" —el código
de Remere's Map Editor lo comenta rindiéndose—, así que aquí se usan dos nombres
distintos y explícitos.

**Coste de paso.** Se implementa la fórmula real, no una aproximación:

```
calculatedStepSpeed = floor(857.36 * ln(speed / 2 + 261.29) - 4795.01 + 0.5)
duration            = floor(1000 * groundSpeed / calculatedStepSpeed)
stepDuration        = ceil(duration / 50) * 50
```

Verificado: con `speed = 220` da **550 ms**, que es el valor de la implementación
de referencia. La cuantización final a 50 ms es lo que produce los **umbrales de
velocidad** que nota cualquier jugador: medido, **todas las velocidades de 216 a
236 dan exactamente los mismos 550 ms**, y con 215 se salta a 600. Ignorar esa
cuantización haría que el movimiento se sintiera continuo y ajeno al original.

**La regla de las esquinas.** En diagonal, si los dos tiles ortogonales que forman
el vértice están bloqueados, el paso no es válido. Sin esta regla se atraviesan
las paredes en diagonal, que es el fallo de movimiento más visible que existe. Hay
que distinguirla del caso de moverse *hacia* un muro, que falla por otro motivo (el
destino), y confundir los dos hace que la prueba mida lo que no cree medir.

**Una lección de nombres.** La clase del mapa se llama `GameMap` y no `Map`. El
nombre natural era `Map` —es el que usa TFS en C++— pero en JavaScript
**ensombrece el `Map` nativo**, y como la clase necesita `Map` para sus propias
colecciones, `new Map()` dentro de ella se llamaba a sí misma hasta desbordar la
pila con un `RangeError` que no dice nada del problema real. Queda escrito porque
es un error que se vuelve a cometer: el nombre natural de esa clase es justo el de
una global que necesita.

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

Un módulo de contenido es un archivo `.js` que exporta una definición. **No hay
función de registro que llamar**, así que no hay forma de olvidarla — que era un
fallo silencioso en la etapa con Lua: el script se cargaba sin error y no hacía
nada.

```js
// data/scripts/actions/others/lever.js

module.exports = {
    type: 'action',
    ids: [1948],

    // Firma de TFS, verificada en su código:
    // (player, item, fromPosition, target, toPosition, isHotkey)
    onUse(player, item, fromPosition, target, toPosition, isHotkey) {
        const destination = player.getPosition();   // devuelve una COPIA
        destination.moveUpstairs();

        if (!player.teleportTo(destination)) {
            player.sendTextMessage('No puedes subir aqui.');
            return true;
        }

        player.sendTextMessage('Subes a ' + destination + '.');
        return true;
    }
};
```

Tres formas de exportar, por orden de frecuencia:

| Forma | Cuándo usarla |
|---|---|
| Un objeto con `type` | Lo normal |
| Un array de objetos | Varios registros en el mismo archivo |
| Una función que recibe `{ action, movement, talkAction, monster }` | Generar definiciones en bucle o derivarlas de datos |

Tipos disponibles: `action` (`onUse`), `movement` (`event` más el handler
correspondiente), `talkaction` (`words` y `onSay`) y `monster`.

Para **desactivar** un módulo basta con renombrarlo: sólo se carga lo que termina
en `.js`, así que `lever.js.off` queda ignorado sin borrar nada.

La **recarga en caliente** (`engine.reloadContent()` o `Game.reload()`) funciona de
verdad porque el cargador descarta la caché de `require` antes de cada módulo. Sin
eso devolvería el módulo antiguo y la recarga sería una mentira. El vaciado previo
del registro es igual de importante: sin él, cada recarga duplicaría todos los
eventos, que es el fallo que el propio TFS documenta en su script de recarga.

Y una salvaguarda que evita un fallo difícil de ver: **el tick del mundo es
síncrono**, así que un handler `async` devolvería una promesa que nadie espera y su
efecto llegaría tarde o nunca. El motor lo detecta y lo avisa en voz alta en vez de
aceptarlo en silencio.

---

## 5. Plan por fases

**Fase 1 — Base técnica.** *Hecho.* Servidor heredado modernizado, cliente
servido, pruebas end-to-end y de diagnóstico en verde.

**Fase 2 — Capa de datos y scripting.** *Hecho.* `config.js`, definiciones XML,
registro y despacho de eventos, envoltorios de entidad, API `Game`, monstruos como
módulos y recarga en caliente. Verificado por `tools/test-engine.js`.

**Fase 3 — Mundo.** *Hecha.* Formato interno de mapa por chunks con plantas y
almacenamiento disperso, tiles con apilado (*stackpos*), coste de paso con la
fórmula real de Tibia, reglas de paso incluidas las esquinas, visibilidad entre
plantas, validador de mapas, criaturas, movimiento con cooldown, planificador de
eventos, spawns con reaparición y limpieza de los tiles que el tránsito materializa.
El importador de OTBM sigue pendiente.

**Fase 4 — Combate e IA.** *Hecha, con una salvedad.* Daño con armadura y
resistencias elementales, muerte, botín, experiencia con la fórmula cúbica
verificada, subida de nivel, eventos de criatura (`onKill`, `onDeath`,
`onAdvance`), búsqueda de caminos y monstruos que ven, persiguen, atacan y vuelven
a casa.

La salvedad, dicha en voz alta: **la fórmula de daño no está verificada** contra el
código de The Forgotten Server. El SISTEMA sí es fiel —intervalos, probabilidades,
alcances, resistencias e inmunidades se leen de las definiciones reales de los
monstruos—, pero la fórmula está aislada en `DEFAULT_FORMULAS` y el motor la acepta
inyectada, así que sustituirla es cambiar un objeto. Se prefirió dejarla señalada
antes que inventar números y presentarlos como los de Tibia.

Lo que falta de esta fase: hechizos de área, invocación, huida con poca salud y las
frases de los monstruos. Los datos ya se cargan; falta la capa que los usa.

**Fase 5 — Protocolo.** *Hecha la parte que decide, pendiente el transporte.* El
protocolo, el gestor de vista y las sesiones están hechos y probados. Lo que hace
real la separación de responsabilidades es que **el cliente no calcula qué ve**: el
motor decide el área visible, las plantas que se envían y qué cambia en cada tick,
y el cliente sólo dibuja lo que llega. Un cliente modificado no puede ver más,
porque lo que no llega no existe para él.

Tres decisiones que costaron un error cada una:

- **Visibilidad de juego y de dibujo no son lo mismo.** La regla de Tibia («la
  superficie ve toda la superficie y nada del subsuelo; el subsuelo ve dos plantas
  arriba y dos abajo») decide a quién puedes ver. Enviar ocho plantas de superficie
  porque la regla las permite sería ocho veces el tráfico para dibujar una. Hay dos
  rangos, y los tiles usan la intersección para que un jugador en la calle no
  reciba el plano de la mazmorra.
- **La duración del paso viaja en el mensaje de movimiento.** El cliente interpola
  durante exactamente el tiempo que el motor calculó con la fórmula real. Si la
  eligiera el cliente, el muñeco iría a un ritmo distinto del que el motor
  considera real y el desfase se vería en cada paso.
- **El transporte está inyectado**, así que todo el protocolo se prueba sin abrir
  un socket. El servidor WebSocket es un adaptador encima, y esa es la siguiente
  pieza.

**Fase 6 — Cliente.** Reescribir el cliente heredado para que consuma este
protocolo. Hoy el cliente de BrowserQuest es **cliente-autoritativo para el
movimiento**, que es justo lo contrario de lo que hace el motor nuevo.

**Fase 7 — Persistencia.** Cuentas, personajes, inventario, storages. El grafo del
mundo es circular (criatura → tile → criaturas) a propósito, así que habrá que
serializar campo a campo y no volcar el estado.

**Fase 8 — Herramientas.** Importador/exportador OTBM, `otb2json`, `spr`→atlas.
Sólo lo que no cubran las herramientas MIT.

**Fase 9 — Render 2.5D.** Orden por diagonales, offset por planta, altura de
sprite y sombra proyectada. Ver la sección de 2.5D del informe de mecánicas.

---

## 6. Riesgos conocidos

| Riesgo | Estado |
|---|---|
| El servidor heredado (`server/`) y el motor nuevo conviven | **Abierto.** El cliente sigue conectado al heredado; hay que migrarlo y retirar `server/` |
| El cliente heredado es autoritativo en el movimiento | **Abierto.** Es lo contrario de la arquitectura objetivo |
| Sin persistencia: todo se pierde al reiniciar | **Abierto** |
| `.dat`/`.spr` sólo cubre hasta ~10.98 | Aceptado como alcance |
| **Sin sandbox: el contenido es código de Node** | **Abierto y es el precio de la decisión.** Un módulo de `data/` puede leer archivos, abrir sockets o matar el proceso. Con Lua el riesgo era comparable pero el alcance menor. Es aceptable mientras el contenido sea del propio servidor; deja de serlo si algún día se aceptan datapacks de terceros, y entonces la respuesta son `worker_threads` con `resourceLimits`, no un sandbox dentro del mismo proceso |
| El tick del mundo es síncrono; un handler puede bloquearlo | **Abierto.** Ni Lua ni JS permiten interrumpir código en ejecución de forma limpia. La mitigación realista es medir el tiempo por handler y poner en cuarentena el que se pase |

