# Avillatoro

MMORPG 2D multijugador en el navegador, **estilo Tibia con sprites 2.5D**.
Deriva de [Mozilla BrowserQuest](https://github.com/mozilla/BrowserQuest) (MPL-2.0),
cuyo motor de tile, cliente Canvas y protocolo WebSocket se toman como base y se
modernizan para Node.js actual.

> Estado: **base técnica funcionando y verificada**. El objetivo jugable (plantas
> múltiples, inventario de contenedores, progresión, persistencia y renderer
> 2.5D) está planificado pero aún no implementado. Ver *Roadmap*.

---

## Cómo ejecutarlo

Requiere **Node.js 20 o superior** (probado en Node 24).

```bash
npm install
npm start
```

Y abre **http://localhost:8000/**. El mismo proceso sirve el cliente y el
WebSocket, así que no hay nada más que configurar: no hace falta paso de build,
ni servidor estático aparte, ni editar ningún JSON.

- `npm run dev` — igual, con recarga automática al cambiar el servidor.
- `npm start -- server/config_local.json` — usar un archivo de configuración
  alternativo (por ejemplo `server/config_debug.json`, con `debug_level: "debug"`).

### Configuración

`server/config.json` son los valores por defecto; `server/config_local.json` (no
versionado) los sobrescribe. Claves relevantes:

| Clave | Significado |
|---|---|
| `port` | Puerto único para HTTP + WebSocket |
| `debug_level` | `debug` \| `info` \| `warning` \| `error` |
| `nb_worlds` | Instancias de mundo en el mismo proceso |
| `nb_players_per_world` | Aforo por instancia |
| `map_filepath` | Mapa del servidor (`server/maps/world_server.json`) |
| `client_root` | Carpeta del cliente a servir. Si se omite, no se sirve cliente |
| `metrics_enabled` | Telemetría por memcached. Requiere el paquete `memcache` |

---

## Herramientas de desarrollo

Todas se ejecutan con el servidor levantado (salvo `diag-world` y `audit-globals`).

| Comando | Qué hace |
|---|---|
| `node tools/smoke-test.js` | **Prueba de humo end-to-end.** Abre dos conexiones WebSocket reales, completa el handshake de las dos y recorre el protocolo: centinela `go`, `HELLO`→`WELCOME`, movimiento entre jugadores, chat en ambos sentidos y `DESPAWN` al desconectar. Sale con código 1 si algo falla. Es la red de seguridad para todo lo que venga después. |
| `node tools/diag-world.js` | Arranca un mundo contra el mapa real y comprueba que quedó inicializado: mapa, rejilla de colisiones, zonas, áreas de mobs, cofres y entidades estáticas. |
| `node tools/diag-protocol.js` | Conecta un bot y **vuelca todos los frames** que recibe. Distingue los dos caminos de envío del servidor (directo y por cola), que fallan de formas muy distintas. |
| `node tools/audit-globals.js` | Detecta dependencias de globales implícitas en `server/js`. Ver *Deuda técnica*. |

---

## Arquitectura

```
server/js/       servidor de juego (Node, CommonJS)
  main.js          arranque, config, selección de mundo
  ws.js            WebSocket (paquete `ws`) + HTTP /status
  staticserver.js  sirve el cliente por HTTP
  worldserver.js   mundo: entidades, zonas, tick a 50 ups, colas de salida
  player.js        jugador: handshake, movimiento, combate, loot
  map.js           mapa: colisiones, zonas (grupos), checkpoints
  entity.js → character.js → player.js | mob.js
  item.js → chest.js
  area.js → mobarea.js | chestarea.js
  message.js       serialización del protocolo
  format.js        validación de mensajes entrantes
  logger.js        reemplazo del paquete `log`
client/js/       cliente (AMD/RequireJS, Canvas 2D, 3 capas de canvas)
shared/js/       gametypes.js: tipos y códigos de mensaje, compartido
tools/           pruebas y diagnósticos (arriba)
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

- Servidor estático integrado: un solo puerto sirve cliente y WebSocket.
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
