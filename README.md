# Avillatoro

MMORPG 2D multijugador en el navegador, **estilo Tibia con sprites 2.5D**.
Deriva de [Mozilla BrowserQuest](https://github.com/mozilla/BrowserQuest) (MPL-2.0),
cuyo motor de tile, cliente Canvas y protocolo WebSocket se toman como base y se
modernizan para Node.js actual.

> Estado: **dos piezas funcionando y verificadas.** El **motor nuevo**
> (`engine/` + `data/`) carga un datapack extensible por **módulos JavaScript** y definiciones XML, con despacho
> de eventos probado. El **servidor heredado** (`server/`) sigue sirviendo el
> cliente jugable mientras se migra al nuevo. Las decisiones de diseño, con la
> evidencia que las respalda, están en [ARQUITECTURA.md](ARQUITECTURA.md).

---

## Cómo ejecutarlo

Requiere **Node.js 20 o superior** (probado en Node 24).

```bash
npm install

npm run engine    # arranca el motor nuevo y resume el datapack cargado
npm test          # verifica el motor entero (36 comprobaciones)

npm start         # arranca el servidor heredado, que sirve el juego jugable
```

Para jugar, `npm start` y abre **http://localhost:8000/**. El mismo proceso sirve
el cliente y el WebSocket, así que no hace falta paso de build, ni servidor
estático aparte.

- `npm run engine:reload` — arranca el motor y comprueba la recarga en caliente.
- `npm start -- server/config_local.json` — configuración alternativa del servidor
  heredado (por ejemplo `server/config_debug.json`, con `debug_level: "debug"`).
- `LOG_LEVEL=debug npm run engine` — con detalle de qué módulo de contenido carga.

### Configuración

Son **dos configuraciones distintas**, una por motor:

- **`config.js`** — el motor nuevo. Es un módulo que exporta un objeto, así que
  admite cálculos y condicionales por entorno. Ver [ARQUITECTURA.md](ARQUITECTURA.md).
- **`server/config.json`** — el servidor heredado. Claves relevantes:

| Clave | Significado |
|---|---|
| `port` | Puerto único para HTTP + WebSocket |
| `debug_level` | `debug` \| `info` \| `warning` \| `error` |
| `nb_worlds` | Instancias de mundo en el mismo proceso |
| `nb_players_per_world` | Aforo por instancia |
| `map_filepath` | Mapa del servidor (`server/maps/world_server.json`) |
| `client_root` | Carpeta del cliente a servir. Si se omite, no se sirve cliente |
| `shared_root` | Carpeta del código compartido, montada en `/shared`. Necesaria: el cliente la pide con una ruta relativa que sale de su árbol |
| `metrics_enabled` | Telemetría por memcached. Requiere el paquete `memcache` |

---

## Herramientas de desarrollo

Todas se ejecutan con el servidor levantado (salvo `diag-world` y `audit-globals`).

| Comando | Qué hace |
|---|---|
| `node tools/smoke-test.js` | **Prueba de humo end-to-end.** Abre dos conexiones WebSocket reales, completa el handshake de las dos y recorre el protocolo: centinela `go`, `HELLO`→`WELCOME`, movimiento entre jugadores, chat en ambos sentidos y `DESPAWN` al desconectar. Sale con código 1 si algo falla. Es la red de seguridad para todo lo que venga después. |
| `node tools/check-client.js` | **Verifica que el cliente puede cargar todo lo que pide.** Recorre las dependencias de `define`/`require`/`importScripts` de `client/js` y pide cada destino por HTTP, además de comprobar que cada sprite tiene sus PNG en las tres escalas. Va por HTTP a propósito: el fallo que motivó esta herramienta era que un archivo existía en disco pero el servidor no lo exponía, y eso no se ve desde el sistema de archivos. |
| `node tools/diag-world.js` | Arranca un mundo contra el mapa real y comprueba que quedó inicializado: mapa, rejilla de colisiones, zonas, áreas de mobs, cofres y entidades estáticas. |
| `node tools/diag-protocol.js` | Conecta un bot y **vuelca todos los frames** que recibe. Distingue los dos caminos de envío del servidor (directo y por cola), que fallan de formas muy distintas. |
| `node tools/audit-globals.js` | Detecta dependencias de globales implícitas en `server/js`. Ver *Deuda técnica*. |
| `node tools/test-engine.js` | **Prueba del motor (45 comprobaciones).** Arranca el datapack entero y verifica el contrato completo: `config.js` con sus estructuras anidadas, `items.xml`, `vocations.xml`, la carga de módulos de contenido, las **firmas exactas** de cada tipo de evento, el **despacho** (un handler mueve a un jugador y crea items de verdad), el mapa cargado, la recarga en caliente y el aislamiento del estado. |
| `node tools/net-test.js` | **Prueba de red de extremo a extremo (25 comprobaciones).** La única del proyecto que **abre un socket de verdad**: motor + servidor WebSocket + cliente real. Comprueba que los mensajes viajen agrupados (859 en un solo marco), que caminar por la red mueva al jugador de verdad en el servidor, que la autoridad cruce la red intacta y que la basura por el socket no tumbe la conexión. Usa el puerto 0: una prueba que falla porque el 8080 estaba ocupado no dice nada del código. |
| `node tools/test-protocol.js` | **Prueba del protocolo, la vista y las sesiones (57 comprobaciones).** Que el cliente **no pueda saber nada que el motor no le haya mandado**: qué tiles recibe y cuáles no (la superficie no recibe el subsuelo), que se envíen tres plantas y no ocho, que el diff mande solo lo que cambia, y sobre todo que **ningún mensaje del cliente cambie el mundo**: se prueban los 18 opcodes con datos de teletransporte. Se ejecuta sin abrir un socket, con el transporte inyectado. |
| `node tools/test-combat.js` | **Prueba de combate e IA (65 comprobaciones).** La **fórmula cúbica de experiencia** con sus valores de referencia (nivel 8 = 4.200, nivel 100 = 15.694.800, nivel 200 = 129.389.800), armadura, resistencias e inmunidades elementales, el orden de los eventos de muerte, botín y subida de nivel, búsqueda de caminos con su tope de nodos, e IA: ver, perseguir, atacar y **rodear obstáculos**. Usa azar con semilla, porque una prueba sobre probabilidades con `Math.random` es una moneda al aire. |
| `node tools/test-simulation.js` | **Prueba de la simulación (53 comprobaciones).** Planificador de eventos (orden, desempate, cancelación, presupuesto), criaturas, movimiento con el **coste de paso real** y sus cooldowns, movimiento bloqueado, esquinas, teletransporte, **spawns y reaparición** tras la muerte, y la limpieza de tiles materializados. Usa un reloj inyectado: una prueba de cooldowns con `Date.now()` real es una carrera contra el reloj. |
| `node tools/test-world.js` | **Prueba de la capa de mundo (50 comprobaciones).** Verifica el coste de paso con la **fórmula real de Tibia** y su cuantización a 50 ms, el apilado por tile (*stackpos*), las reglas de paso incluida la que impide **cortar esquinas en diagonal**, la visibilidad entre plantas (la superficie no ve el subsuelo) y que el validador de mapas informe de **todos** los errores con su coordenada, no del primero. |

---

## Arquitectura

El proyecto tiene **dos motores** ahora mismo, y es deliberado:

- **`engine/` + `data/`** — el motor nuevo, con la arquitectura de un servidor de
  Tibia: el motor carga el datapack y es dueño del estado del mundo, el contenido
  son **módulos JavaScript** y las definiciones declarativas son XML, y la
  separación entre motor y contenido es estricta.
- **`server/`** — el servidor heredado de BrowserQuest, modernizado y con pruebas.
  Sigue sirviendo el cliente jugable y se irá absorbiendo por el nuevo.

El plan de migración y la justificación de cada decisión están en
[ARQUITECTURA.md](ARQUITECTURA.md).

```
config.js        configuración del motor (un módulo que exporta un objeto)
engine/          MOTOR NUEVO
  core/            arranque, carga de config, logger, planificador de eventos
  scripting/       registro de contenido, cargador, envoltorios y API Game
  data/            lectura de items.xml y data/XML/*.xml
  net/             LO QUE EL CLIENTE VE
    protocol.js      opcodes, nombres y descripción de tiles y criaturas
    view.js          qué ve cada jugador y qué hay que avisarle
    session.js       una conexión: traduce peticiones en acciones del mundo
  world/           el mundo
    world.js         estado vivo, movimiento y bucle de simulación
    creature.js      criaturas: jugadores y monstruos
    combat.js        ataques, daño, muerte, botín y experiencia
    experience.js    la fórmula cúbica de niveles (verificada)
    ai.js            la cabeza de los monstruos: ver, perseguir, atacar
    pathfinding.js   búsqueda de caminos sobre la rejilla de tiles
    spawner.js       aparición y reaparición de monstruos
    position.js      la coordenada canónica
    item.js          instancia de item, con sus banderas
    tile.js          el tile y su apilado (stackpos)
    map.js           el mapa por chunks, con plantas y visibilidad
    stepcost.js      duración del paso (la fórmula real de Tibia)
    loader.js        carga y VALIDACIÓN del formato de mapa
data/            DATAPACK (lo que toca un administrador de servidor)
  items/           items.xml, con las banderas que hacen funcionar el apilado
  XML/             vocaciones, outfits, grupos...
  scripts/         contenido programado (acciones, movimientos, comandos)
  monsters/        monstruos, como módulos JavaScript
  world/           mapas en el formato interno (JSON, legible en un diff)
client/js/       cliente (AMD/RequireJS, Canvas 2D, 3 capas de canvas)
shared/js/       gametypes.js, compartido con el servidor heredado
server/js/       servidor heredado de BrowserQuest
  ws.js            WebSocket (paquete `ws`) + HTTP /status
  staticserver.js  sirve el cliente por HTTP
  worldserver.js   mundo: entidades, zonas, tick a 50 ups, colas de salida
  map.js           mapa: colisiones, zonas (grupos), checkpoints
  message.js       serialización del protocolo
  format.js        validación de mensajes entrantes
tools/           pruebas, diagnósticos y banco de pruebas
```

### Protocolo

JSON sobre WebSocket. Cada mensaje es un **array** cuyo primer elemento es el
código de tipo (`shared/js/gametypes.js`). El servidor acumula la cola de cada
jugador y la envía **agrupada en un único frame por tick**: un array de arrays.
El cliente lo desempaqueta en `receiveActionBatch`.

Dos excepciones al JSON: el servidor manda los literales `go` y `timeout` como
texto crudo (`connection.sendUTF8`) durante el handshake y al expirar la sesión.

### Zonas (interest management)

El mapa se divide en zonas de **28×12 tiles** (`zoneWidth`/`zoneHeight`). El
servidor sólo difunde a la zona propia y a las 8 adyacentes
(`worldserver.pushToAdjacentGroups`), más las conectadas por puertas. Esto
significa que **dos jugadores en zonas no adyacentes no se ven entre sí**, y es
por diseño, no un fallo.

Un detalle que sorprende y conviene tener presente: **el servidor no recalcula la
zona al mover al jugador**. `worldserver.move_callback` sólo reacciona a los
atacantes; la pertenencia a zona se actualiza cuando el cliente envía `ZONE`
(mensaje 21) al cruzar un borde, que es lo que hace `client/js/game.js`.

---

## Cambios respecto a BrowserQuest

El original es de 2012 y asumía Node 0.4. Esto es lo que se ha modernizado y
corregido, todo verificado con las pruebas de `tools/`.

### Arranque

- **`websocket-server` (miksago) estaba despublicado de npm desde 2014**, así que
  en una instalación limpia el servidor no arrancaba con *ninguna* versión de
  Node. Se elimina toda la maquinaria de drafts hixie-75/76/hybi-08 (ningún
  navegador actual los usa) y se sustituye por el paquete **`ws`**, conservando
  la misma superficie pública que consumen `main.js` y `worldserver.js`.
- **`path.exists` fue eliminado de Node**, y el `uncaughtException` de `main.js`
  se tragaba el `TypeError`: el servidor arrancaba, escuchaba y quedaba
  completamente inerte sin ningún error visible. Ahora se lee el archivo
  directamente, informando de la causa real.
- Se eliminan `bison` (codec alternativo, desactivado), `sanitizer` (sustituido
  por un escapado propio) y `memcache` (carga diferida, sólo con métricas).
- El logger propio sustituye al paquete `log`, cuya API actual es incompatible.
- Las rutas de configuración y de mapa se resuelven contra la raíz del proyecto,
  así que `node server/js/main.js` funciona desde cualquier directorio.
- El cliente deduce el host del WebSocket de su propio origen, lo que elimina el
  paso de build obligatorio (`config_build.json` está en `.gitignore` y no
  existe en un clon limpio: el cliente no arrancaba sin generarlo).

### Bugs de corrección (presentes también en `mozilla/BrowserQuest` master)

- **`shared/js/gametypes.js` usaba `_.indexOf` sin importar underscore.** En Node
  devolvía `undefined`, y el `try/catch` de `properties.js` se lo tragaba en
  silencio: `armorLevel`/`weaponLevel` quedaban `undefined`, el daño y los HP se
  volvían `NaN` y `JSON.stringify(NaN)` enviaba `null`, con lo que el jugador no
  podía dañar a nadie y el cliente lo daba por muerto. Ahora usa `indexOf` nativo,
  que funciona igual en el navegador y en Node.
- **`server/js/chest.js` usaba `_.size` sin importar underscore**, así que abrir
  un cofre lanzaba `ReferenceError` y el contenido nunca aparecía.
- **`server/js/map.js` tenía una coma faltante** tras `require('./lib/class')`. El
  ASI convertía el resto de la declaración en globales implícitas (`fs`, `_`,
  `Utils`, `Checkpoint`), y ese `_` accidental era *lo único* que hacía funcionar
  `gametypes.js`; `Utils` era *lo único* que hacía funcionar `mob.js` y
  `mobarea.js`. Es decir: el orden de `require` era load-bearing y añadir la coma
  "obvia" rompía el juego entero sin ningún error. Corregido en todos los
  consumidores, con `tools/audit-globals.js` como red de seguridad.
- El `formatChecker` de `player.js` y `Metrics` se apoyaban en globales creadas
  por asignaciones sin `var`; ahora se importan explícitamente.
- `main.js` hacía `new Player(...)` confiando en una global que sólo existía si el
  orden de `require` la había creado antes.

### Añadido

- Servidor estático integrado con **varias raíces montadas**: un solo puerto sirve
  cliente y WebSocket, y `shared/` se expone en `/shared` porque el cliente pide
  el módulo compartido con una ruta relativa que sale de su propio árbol
  (`'../../shared/js/gametypes'` en `client/js/game.js`). Sin ese montaje el
  navegador recibía un 404 y el cliente moría con `Types is not defined`.
- `logger.js` con niveles y marcas de tiempo.
- Traza de depuración de pertenencia a zona (sólo para jugadores): un jugador que
  no quede registrado en su zona no recibe ni emite ningún broadcast, y es un
  fallo que no produce ningún error.
- Las cuatro herramientas de `tools/`.

### Deuda técnica conocida

- **Globales implícitas por diseño heredado**: `lib/class.js` crea la global
  `Class` y `shared/js/gametypes.js` la global `Types` mediante asignaciones sin
  `var`. Funcionan, están documentadas y `tools/audit-globals.js` vigila que no
  aparezcan nuevas. Eliminarlas exige migrar `Class.extend`/`_super` a clases ES.
- **Sin persistencia**: todo el estado vive en memoria y se pierde al reiniciar.
- **Sin autenticación**: cualquiera puede enviar `HELLO` con el nombre, la
  armadura y el arma que quiera, y sin límite de frecuencia.
- **Combate sin validación**: el cliente decide cuándo hay golpe (`HIT`/`HURT`);
  el servidor calcula el daño pero no comprueba distancia, cadencia ni que el
  objetivo siga vivo.
- **Movimiento cliente-autoritativo**: el cliente traza su ruta y avisa sólo del
  destino final; el servidor no corrige ni hace rollback de la posición.
- Bucles sin cota en `worldserver.findPositionNextTo` y
  `area._getRandomPositionInsideArea`.
- `POPULATION` envía `null` como total de jugadores cuando las métricas están
  desactivadas (cosmético; el cliente lo tolera).

---

## Roadmap

1. **Base técnica** — *hecho*: servidor en Node moderno, cliente servido, pruebas
   end-to-end y de diagnóstico en verde.
2. **Plantas múltiples (Z)**: eje Z en el mapa, en el protocolo y en las zonas
   (`"z-gx-gy"`), escaleras y visibilidad entre plantas.
3. **Inventario tipo Tibia**: contenedores anidados, slots de equipamiento,
   pilas con cantidad, arrastrar y soltar. Exige mensajes nuevos **y** añadirlos a
   `server/js/format.js`, que rechaza y cierra la conexión ante cualquier mensaje
   no declarado.
4. **Progresión**: niveles, experiencia, HP/maná, skills y vocaciones.
5. **Persistencia**: `node:sqlite` o JSON por personaje. `player.name` es hoy el
   único identificador estable.
6. **Renderer 2.5D**: altura por sprite, sombra proyectada, orden por profundidad
   y pase de iluminación. El orden de dibujo está centralizado en un único punto
   (`game.forEachVisibleEntityByDepth`), lo cual es muy favorable; los dos frenos
   son la cámara encajada a bloques de 28×12 y `transition.js`, que cuantiza el
   movimiento a píxeles enteros.

---

## Licencia y créditos

Código bajo **MPL 2.0**; contenido (arte y sonido) bajo **CC-BY-SA 3.0**.
Ver [LICENSE](LICENSE).

BrowserQuest fue creado por [Little Workshop](http://www.littleworkshop.fr):
Franck Lecollinet ([@whatthefranck](https://twitter.com/whatthefranck)) y
Guillaume Lecollinet ([@glecollinet](https://twitter.com/glecollinet)).

Los sprites y las mecánicas de **Tibia** son propiedad de CipSoft y **no** se
reutilizan aquí; las mecánicas de juego no son objeto de copyright.
