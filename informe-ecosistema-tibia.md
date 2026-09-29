# Herramientas y formatos del ecosistema Tibia / OpenTibia

Informe técnico orientado a decidir **qué herramientas construir** para un motor propio en Node.js y **qué formatos adoptar** (OTBM real vs. formato propio equivalente).

> Nota de método: los detalles binarios proceden de fuentes primarias (código fuente de RME, cabeceras del servidor, hilos técnicos de OTLand) y de librerías TypeScript ya existentes que implementan lectura/escritura. Las fechas y estados de mantenimiento provienen de la API pública de GitHub.

---

## 0. Resumen ejecutivo

| Pregunta | Respuesta corta |
|---|---|
| ¿Qué produce el editor de mapas? | `.otbm` (binario, árbol de nodos) + *sidecars* XML (`-spawn.xml`, `-house.xml`, `-zones.xml`) |
| ¿Qué produce el editor de items? | `.otb` (definiciones de servidor) y `.dat` + `.spr` (assets de cliente) |
| ¿RME es libre? | **Sí: GPL-3.0**. Reutilizar su *código* obliga a liberar tu proyecto bajo GPLv3. |
| ¿Object Builder es libre? | **Sí: MIT** (ActionScript/Haxe). Port JS reciente sin licencia declarada. |
| ¿Existe ya un parser OTBM/OTB/DAT/SPR en Node? | **Sí, varios** — ver §5. Es la mejor noticia del informe. |
| ¿Adoptar OTBM real? | **Sí, como formato de intercambio**. Te da gratis todo el contenido comunitario y RME/OtaRME como editores. Pero conviene un **formato interno propio** (JSON/binario plano) para el motor. |
| ¿Qué hay que construir realmente? | Un **importador OTBM→formato interno**, un **exportador interno→OTBM**, y una **capa de metadatos de items** (OTB + appearances). El editor gráfico es lo último. |

---

## 1. Editor de mapas: Remere's Map Editor (RME)

### 1.1 Repositorios y estado actual

Hay **tres linajes** vivos; conviene distinguirlos:

| Proyecto | Repo | Estado | Licencia | Notas |
|---|---|---|---|---|
| RME original (hampusborgos / hjnilsson) | [hampusborgos/rme](https://github.com/hampusborgos/rme) | Último push **2024-08-07**; último release **v3.7 (2020-12-27)**; 323★, 99 issues abiertas | **GPL-3.0** (cabeceras de fuente + `LICENSE.rtf`) | Soporte hasta ~10.98. Prácticamente congelado. |
| **Canary RME** (opentibiabr) | [opentibiabr/remeres-map-editor](https://github.com/opentibiabr/remeres-map-editor) | **Activo**: último push 2026-09-26, release **v4.0 (2026-06-12)**, 61★ | GPL-3.0 (fork) | **El fork recomendado hoy.** Soporta cliente 11+ vía assets/protobuf, Lua scripting, import/export de zonas, minimapa, render OpenGL moderno, backend SQLite de materials. |
| **OTA RME** (OTAcademy) | [OTAcademy/RME](https://github.com/OTAcademy/RME) | **Activo**: último push 2026-01-28, release **4.2.0 (2026-01-26)**, 65★ | GPL-3.0 (fork) | Aporta **motor de scripting Lua** (API `app`, `map`, `tile`, `item`, brushes, `Dialog`, `http`, `noise`), con sandbox de ficheros. Muy interesante para automatizar pipeline. |

Release v4.0 de Canary: [github.com/opentibiabr/remeres-map-editor/releases/tag/v4.0](https://github.com/opentibiabr/remeres-map-editor/releases/tag/v4.0) — binarios Windows/Ubuntu 24.04, requiere [Canary](https://github.com/opentibiabr/canary) y los [assets de cliente de dudantas](https://github.com/dudantas/tibia-client/releases).

Hilo de presentación de OTA RME 4.2.0 con la API Lua: [otland.net/threads/release-ota-rme-4-2-0-lua-scripting.303774](https://otland.net/threads/release-ota-rme-4-2-0-lua-scripting.303774/) · docs: [scripts/README.md](https://github.com/OTAcademy/RME/blob/master/scripts/README.md)

### 1.2 Qué produce: extensión y formato

- Extensión **`.otbm`** (*OpenTibia Binary Map*), y opcionalmente **`.otgz`** (archivo *tar+gzip* que contiene `world/map.otbm`, `world/houses.xml`, `world/spawns.xml` — ver `IOMapOTBM::saveMap` en [iomap_otbm.cpp](https://raw.githubusercontent.com/hampusborgos/rme/master/source/iomap_otbm.cpp)).
- El fichero empieza con un identificador de 4 bytes: **`"OTBM"`** o 4 bytes nulos (`0x00 0x00 0x00 0x00`). El propio RME expone la opción de configuración `SAVE_WITH_OTB_MAGIC_NUMBER` para elegir uno u otro.
- **El mapa NO contiene spawns, casas (metadatos) ni zonas**: el nodo `OTBM_MAP_DATA` guarda *nombres de fichero* de los sidecars XML (`OTBM_ATTR_EXT_SPAWN_FILE`, `OTBM_ATTR_EXT_HOUSE_FILE`). Es decir, un mapa es un conjunto de ficheros.

### 1.3 Qué necesita para funcionar (de dónde saca la lista de items)

RME necesita **tres fuentes de datos distintas** y las cruza:

1. **`items.otb`** — definiciones del servidor: id de servidor, id de cliente, flags, grupo, atributos. Se carga en `ItemDatabase::loadFromOtb` ([items.cpp](https://raw.githubusercontent.com/hampusborgos/rme/master/source/items.cpp)). Firma del fichero: **`"OTBI"`**.
2. **`Tibia.dat` y `Tibia.spr`** (o `Tibia.otfi` para perfiles modernos) — la *metadata de sprites* del cliente. Se cargan en `GraphicManager::loadSpriteMetadata` y `loadSpriteData` ([graphics.cpp](https://raw.githubusercontent.com/hampusborgos/rme/master/source/graphics.cpp)).
3. **`items.xml`** (opcional/parcial) — `ItemDatabase::loadFromGameXml` completa nombres, pesos, `floorchange`, `writeable`, etc. desde el XML del servidor.

El **puente** entre ambos mundos es el atributo `ITEM_ATTR_CLIENTID` del OTB:

```cpp
case ITEM_ATTR_CLIENTID:
    itemNode->getU16(item->clientID);
    item->sprite = g_gui.gfx.getSprite(item->clientID);   // ← enlaza con el .dat/.spr
```

Es decir: **OTBM guarda *server IDs*; el OTB traduce *server id → client id*; el `.dat` traduce *client id → lista de sprite ids*; el `.spr` traduce *sprite id → píxeles*.** Si falta cualquier eslabón, el editor no dibuja.

Detalle importante: para items *stackable / splash / fluid container*, el OTBM puede **no** guardar el subtype/count (según versión de OTBM), porque hay que consultar el OTB para saber si el item es apilable. Esto está documentado explícitamente en el README de [`@v0rt4c/otbm`](https://github.com/V0RT4C/ot-otbm):

> *"You need the corresponding .OTB file to be able to read and write them correctly. This is because the .OTBM file itself has no information of what kind of items it holds."*

**Consecuencia práctica para tu motor:** el `.otb` no es opcional, es parte del contrato de lectura del `.otbm`.

### 1.4 Cómo se define el "tileset" del editor

El tileset **no está en el OTBM ni en el OTB**: vive en XML propio del editor (*materials*).

- Fichero raíz `materials.xml` con nodos `<include file="...">`, `<metaitem>`, `<border>`, `<brush>` y `<tileset name="...">`.
- Cada `<tileset>` contiene **categorías**, y cada categoría una lista de **brushes** o items.
- Además hay un directorio `extensions/` con `<materialsextension name= author= description= client="8.60;9.86;10.98">` que declara para qué versiones de cliente aplica cada extensión de paleta.

Implementación de referencia: `Materials::loadMaterials`, `loadExtensions`, `unserializeTileset` en [materials.cpp](https://raw.githubusercontent.com/hampusborgos/rme/master/source/materials.cpp).

```cpp
} else if(childName == "include") {
    // carga recursiva de otro materials.xml
} else if(childName == "metaitem") {
    g_items.loadMetaItem(childNode);       // items "virtuales" sin sprite (p.ej. id 459 = "meta")
} else if(childName == "brush") {
    g_brushes.unserializeBrush(childNode, warnings);
} else if(childName == "tileset") {
    unserializeTileset(childNode, warnings);
}
```

De dónde salen las paletas: **se escriben a mano para cada versión de cliente** en `data/<version>/materials.xml` + `extensions/`. Las categorías típicas son `terrain`, `doodad`, `walls`, `items`, `raw`. RME, además, genera automáticamente un tileset **"Others"** que contiene *todo* item existente que no esté en ningún otro tileset (ver `Materials::createOtherTileset`), y un tileset **"NPCs"**.

Los *ground brushes* con auto-borde (`<border>`), *wall brushes* con detección de esquinas, *carpet/table/doodad* son lógica del editor, no del formato. **Esto es lo que hay que reimplementar si quieres un editor propio decente.**

### 1.5 Casas, spawns, waypoints y zonas

| Concepto | ¿Dónde vive? | Detalle |
|---|---|---|
| **Casa (geometría)** | Dentro del OTBM | Nodo `OTBM_HOUSETILE` (0x0E) en lugar de `OTBM_TILE`. Campos: `x_offset` (u8), `y_offset` (u8), **`house_id` (u32)**. |
| **Casa (metadatos)** | Sidecar `*-house.xml` | `<house name= houseid= entryx= entryy= entryz= rent= guildhall= townid= size=>`. Cargado por `IOMapOTBM::loadHouses`. |
| **Spawns** | Sidecar `*-spawn.xml` | `<spawn centerx= centery= centerz= radius=>` con hijos `<monster name= x= y= z= spawntime= direction=>` y `<npc ...>`. Las coordenadas de criatura son **relativas** al centro del spawn. |
| **Waypoints** | Dentro del OTBM | Nodos `OTBM_WAYPOINTS` (0x0F) → `OTBM_WAYPOINT` (0x10) con `name` (string), `x` (u16), `y` (u16), `z` (u8). Solo se escriben si `otbm_version >= 3`. |
| **Towns** | Dentro del OTBM | Nodo `OTBM_TOWNS` (0x0C) → `OTBM_TOWN` (0x0D): `town_id` (u32), `name`, posición del templo. |
| **Zonas (PZ, NoPvP, NoLogout, PvP)** | Dentro del OTBM | Flag de tile `OTBM_ATTR_TILE_FLAGS` (u32 *bitmask*). Ver §3.1. |
| **Zonas nombradas (zones.xml)** | Sidecar externo (convención del servidor) | No forma parte del estándar OTBM; Canary/RME v4 lo tratan como `*-zones.xml` import/export. |

Nota: en la práctica, el RME original escribe la geometría de casas en el OTBM, pero **el servidor cruza esa info con `houses.xml`** por `houseid`; sin el XML, la casa existe pero no tiene nombre, rent ni entry.

### 1.6 ¿Existe alternativa moderna o web?

**Sí, y es la noticia más relevante del informe.** Ver §4.

---

## 2. Editor de items: Object Builder

### 2.1 Qué es, de dónde se obtiene, mantenimiento

**Object Builder** es la herramienta estándar de la comunidad para editar los assets del cliente (`.dat` + `.spr`) y exportar/importar definiciones de items. Es una app **ActionScript / Adobe AIR** (Haxe/OpenFL), no multiplataforma nativa.

| Repo | Estado | Licencia |
|---|---|---|
| [ottools/ObjectBuilder](https://github.com/ottools/ObjectBuilder) | **El original y canónico.** 62★. Último push **2022-02-26**. 23 issues abiertas. | **MIT** |
| [punkice3407/ObjectBuilder](https://github.com/punkice3407/ObjectBuilder) | Fork con mejoras. 78★. Último push **2026-07-05**. | **MIT** |
| [AngelOfDeaths/ObjectBuilder](https://github.com/AngelOfDeaths/ObjectBuilder) | Fork antiguo (2017). 1★. | MIT |
| **rookgaard/ObjectBuilder** (port JS) | **2026-06-05.** 4★. Corre en navegador. | **Sin licencia declarada** ⚠️ |

Port a JavaScript, anunciado en OTLand: [otland.net/threads/js-port-of-objectbuilder.304690](https://otland.net/threads/js-port-of-objectbuilder.304690/) → demo en vivo [object-builder.opentibia.info](https://object-builder.opentibia.info/) · repo [rookgaard/ObjectBuilder](https://github.com/rookgaard/ObjectBuilder). Fue generado íntegramente con agentes de IA y **el propio autor advierte que no lo considera base sólida**; probado con versiones 7.7, 8.6, 9.0, 10.98 y 15.01.

Otros editores de assets modernos:
- **BaconBinary ObjectEditor** (C#/.NET), presentado en [otland.net/threads/303219](https://otland.net/threads/c-net-baconbinary-objecteditor-a-modern-high-performance-asset-editor.303219/).
- **spreditor.online** — editor de sprites vía web, MIT: [V0RT4C/spreditor.online](https://github.com/V0RT4C/spreditor.online).

### 2.2 Qué produce exactamente

Object Builder opera sobre el **par cliente+servidor**:

| Fichero | Contenido | Naturaleza |
|---|---|---|
| **`Tibia.spr`** | Los píxeles de todos los sprites, indexados por `sprite id`. | Asset de cliente |
| **`Tibia.dat`** | Por cada *thing* (item/outfit/effect/missile): flags de comportamiento + lista de `sprite id` que lo componen. | Metadata de cliente |
| **`items.otb`** | Por cada item: id de servidor, id de cliente, grupo, flags de juego y atributos. **Es la tabla de traducción server↔client que usa el servidor.** | Definiciones de servidor |
| `items.xml` | Nombres, pesos, daño, defensa, scripts asociados. Complementa al OTB. | Datos de servidor |

La relación OTB ↔ DAT/SPR es **por el `client id`**: el OTB guarda `ITEM_ATTR_CLIENTID`; el DAT tiene una entrada por ese mismo id con la lista de sprites. Un item nuevo existe "de verdad" cuando aparece en los **tres** sitios.

### 2.3 Cómo se define un item nuevo, de principio a fin

1. **Dibujar/importar sprites** (32×32 px PNG con alfa) en Object Builder → panel de sprites.
2. **Object Builder añade los sprites al `.spr`** (o los agrega al final del fichero) y **registra una entrada nueva en el `.dat`** con sus flags (`ground`, `stackable`, `container`, `light`, etc.) y la lista ordenada de `sprite id` (width × height × layers × patternX × patternY × patternZ × frames).
3. **Añadir la definición en el `.otb`** (o vía el editor de OTB del propio Object Builder): `server id` nuevo, `client id` = el del paso 2, flags (`FLAG_PICKUPABLE`, `FLAG_MOVEABLE`, `FLAG_STACKABLE`, `FLAG_UNPASSABLE`, …), grupo (`ITEM_GROUP_GROUND`, `CONTAINER`, …) y atributos (`weight`, `maxTextLen`, `rotateTo`, `speed`, `lightLevel/Color`…).
4. **Declarar el item en `items.xml`** del servidor (`<item id="XXXX" name="..." article="...">` + `<attribute key="..." value="..."/>` para peso, ataque, `floorchange`, `decayTo`, etc.).
5. **Añadirlo a la paleta del editor**: crear/editar `<tileset>`/`<brush>` en `materials.xml` (o extensiones). *Este paso se olvida siempre y es la causa nº1 de "mi item no aparece en RME".*
6. Recompilar/reiniciar servidor y cliente con los nuevos ficheros. El cliente **valida la firma** del `.dat`/`.spr`, así que si tocas los ficheros debes mantener coherencia de firma o usar un perfil `.otfi`.

Referencia de la comunidad para la actualización de DAT/SPR: [Criando Tibia Docs — Atualizar DAT/SPR](https://criando-tibia.gitbook.io/criando-tibia-docs/product-docs/downloads/images-and-media-1/map-editor/atualizar-dat-spr) y [RME 13.10 Canary](https://criando-tibia.gitbook.io/criando-tibia-docs/product-docs/downloads/images-and-media-1/map-editor/rme-13.10-canary).

---

## 3. Formatos binarios en detalle

### 3.0 Marco común de nodos (*OTB framing*)

OTBM y OTB comparten el mismo sistema de árbol binario, implementado en [`filehandle.h`](https://raw.githubusercontent.com/hampusborgos/rme/master/source/filehandle.h):

```cpp
enum NodeType {
    NODE_START  = 0xfe,
    NODE_END    = 0xff,
    ESCAPE_CHAR = 0xfd,
};
```

- `0xFE` inicia un nodo. Si el nodo anterior acaba de cerrarse (`0xFF`), es **hermano**; si no, es **hijo**.
- `0xFF` cierra el nodo más reciente.
- `0xFD` escapa el byte siguiente: si en los *payloads* aparece `0xFE`, `0xFF` o `0xFD` literal, se escribe `0xFD` + byte. **Al leer hay que desescapar; al escribir hay que escapar.** Este es el error nº1 de las implementaciones caseras.
- Todos los enteros son **little-endian**.

---

### 3.1 OTBM (mapa)

**Cabecera (16 bytes tras los 4 de identificador):**

```c
struct OTBM_root_header {
    uint32_t version;            // versión del formato OTBM (0..3 → MAP_OTBM_1..4)
    uint16_t width;              // ancho del mapa en tiles
    uint16_t height;             // alto del mapa en tiles
    uint32_t majorVersionItems;  // major version del items.otb usado
    uint32_t minorVersionItems;  // minor version del items.otb (≈ client version)
};
```

El editor avisa/falla si `majorVersionItems` no coincide con el OTB cargado.

**Tipos de nodo** (de [`iomap_otbm.h`](https://raw.githubusercontent.com/hampusborgos/rme/master/source/iomap_otbm.h)):

```c
OTBM_ROOTV1 = 1,  OTBM_MAP_DATA = 2,  OTBM_ITEM_DEF = 3,   OTBM_TILE_AREA = 4,
OTBM_TILE = 5,    OTBM_ITEM = 6,      OTBM_TILE_SQUARE = 7, OTBM_TILE_REF = 8,
OTBM_SPAWNS = 9,  OTBM_SPAWN_AREA = 10, OTBM_MONSTER = 11, OTBM_TOWNS = 12,
OTBM_TOWN = 13,   OTBM_HOUSETILE = 14,  OTBM_WAYPOINTS = 15, OTBM_WAYPOINT = 16
```

`OTBM_TILE_SQUARE`, `OTBM_TILE_REF`, `OTBM_SPAWNS`, `OTBM_SPAWN_AREA`, `OTBM_MONSTER`, `OTBM_ITEM_DEF` están **declarados pero no implementados** ("not implemented" en el comentario del propio RME). No los emitas.

**Jerarquía real:**

```
OTBM_ROOTV1
└── OTBM_MAP_DATA            (atributos: description, ext_spawn_file, ext_house_file)
    ├── OTBM_TILE_AREA       (base_x u16, base_y u16, base_z u8)
    │   ├── OTBM_TILE        (x_offset u8, y_offset u8, attrs…)
    │   │   └── OTBM_ITEM    (id u16, attrs…) ── recursivo (contenedores)
    │   └── OTBM_HOUSETILE   (x_offset u8, y_offset u8, house_id u32, attrs…)
    ├── OTBM_TOWNS
    │   └── OTBM_TOWN        (id u32, name, x u16, y u16, z u8)
    └── OTBM_WAYPOINTS
        └── OTBM_WAYPOINT    (name, x u16, y u16, z u8)
```

**Estructuras exactas:**

```c
struct OTBM_tile_area { uint8_t node_id; uint16_t base_x; uint16_t base_y; uint8_t base_z; };
struct OTBM_tile      { uint8_t x_offset; uint8_t y_offset; uint8_t[] attributes; uint8_t null_byte; };
struct OTBM_housetile { uint8_t x_offset; uint8_t y_offset; uint32_t house_id; uint8_t[] attributes; uint8_t null_byte; };
struct OTBM_town      { uint32_t town_id; std::string name; uint16_t temple_x; uint16_t temple_y; uint8_t temple_z; };
struct OTBM_waypoint  { std::string waypoint_name; uint16_t x; uint16_t y; uint8_t z; };
```

**Codificación de posición:** `TILE_AREA` agrupa un bloque de **256×256** en un solo `z`. Sus tiles usan offsets **relativos de 1 byte** (`x & 0xFF`, `y & 0xFF`). RME crea un `TILE_AREA` nuevo cuando `pos.x < local_x || pos.x >= local_x + 256 || pos.y < local_y || … || pos.z != local_z`. Esto ahorra ~50 % de tamaño.

**Cómo se codifican los items y sus atributos:**

Cada item es un nodo `OTBM_ITEM` cuyo **primer campo del payload es el `id` de servidor (u16)**. Le siguen una secuencia de **pares atributo/valor**, terminada implícitamente por el `0xFF` del nodo:

| Byte | Atributo | Payload |
|---|---|---|
| `0x01` | `DESCRIPTION` | string |
| `0x02` | `EXT_FILE` | string |
| `0x03` | `TILE_FLAGS` | **u32 bitmask** (solo en tiles) |
| `0x04` | `ACTION_ID` | **u16** |
| `0x05` | `UNIQUE_ID` | **u16** |
| `0x06` | `TEXT` | string (u16 longitud + ASCII/UTF-8) |
| `0x07` | `DESC` | string |
| `0x08` | `TELE_DEST` | **x u16, y u16, z u8** (5 bytes) |
| `0x09` | `ITEM` | **u16** — item *inline* dentro de un tile (camino compacto) |
| `0x0A` | `DEPOT_ID` | u16 |
| `0x0B` | `EXT_SPAWN_FILE` | string |
| `0x0C` | `RUNE_CHARGES` | u8 |
| `0x0D` | `EXT_HOUSE_FILE` | string |
| `0x0E` | `HOUSEDOORID` | u8 |
| `0x0F` | `COUNT` | u8 (subtype) |
| `0x10` | `DURATION` | u32 |
| `0x11` | `DECAYING_STATE` | u8 |
| `0x12` | `WRITTENDATE` | u32 |
| `0x13` | `WRITTENBY` | string |
| `0x14` | `SLEEPERGUID` | u32 |
| `0x15` | `SLEEPSTART` | u32 |
| `0x16` | `CHARGES` | u16 (cargas de runa) |
| `0x80` | `ATTRIBUTE_MAP` | mapa clave→valor extensible (solo OTBM ≥ 4) |

Fuente: `enum OTBM_ItemAttribute` en [iomap_otbm.h](https://raw.githubusercontent.com/hampusborgos/rme/master/source/iomap_otbm.h), confirmado en hilos de OTLand: [A comprehensive description of the OTBM format](https://otland.net/threads/a-comphrensive-description-of-the-otbm-format.258583/) y [wiki de RME](https://github.com/hampusborgos/rme/wiki/Documentation-of-the-.otbm-file-structure).

**Evolución por versión (crítico para compatibilidad):**

| Versión | Cambio |
|---|---|
| `MAP_OTBM_1` (=0) | El **count/subtype** de items stackable/splash/fluid se escribe como **u8 crudo inmediatamente después del id**, sin byte de atributo. |
| `MAP_OTBM_2` (=1) | El count pasa a ser el atributo `OTBM_ATTR_COUNT` (0x0F). A partir de 8.20 las cargas se escriben con `OTBM_ATTR_CHARGES` (0x16, u16). |
| `MAP_OTBM_3` (=2) | Se escriben waypoints. |
| `MAP_OTBM_4` (=3) | Los atributos de item se serializan como **`OTBM_ATTR_ATTRIBUTE_MAP` (0x80)** — un mapa extensible clave→valor, en lugar de los atributos clásicos. |

Fragmento de `Item::serializeItemAttributes_OTBM` que lo demuestra:

```cpp
if(maphandle.version.otbm >= MAP_OTBM_4) {
    if(attributes && !attributes->empty()) {
        stream.addU8(OTBM_ATTR_ATTRIBUTE_MAP);
        serializeAttributeMap(maphandle, stream);
    }
} else {
    // ruta clásica: CHARGES / ACTION_ID / UNIQUE_ID / TEXT / DESC
}
```

**Capas de suelo y orden de dibujado:**

- **El suelo NO es una capa separada**: es simplemente el *primer* item del tile, y tiene un camino optimizado. `serializeItemCompact_OTBM` escribe **`OTBM_ATTR_ITEM` (0x09) + u16 id** *inline*, sin abrir un sub-nodo. Esto reduce el tamaño ~50 %.
- El suelo se omite por completo si es un *meta item* o si ya existe en el tile un item con `ground_equivalent` igual (anti-duplicados de borde).
- El **orden de render** no está en el fichero: se deriva de los flags del item (`alwaysOnBottom` / `alwaysOnTopOrder` / `hasElevation`). El servidor mantiene dos vectores, `downItems` y `topItems`, separados por `getTopItemCount()`; el cliente reconstruye el *stackpos*. Como referencia, TFS usa `alwaysOnTopOrder` de 1..5 (border, items, creatures, …).

**Ejemplo real** (tile vacío id 100 en 0,0,7), del hilo de OTLand:

```
00 00 00 00                                     ← identificador (4 bytes nulos)
fe 00 02 00 00 00 00 08 00 08 03 00 00 00 39 00 00 00   ← versión, 2048×2048, OTB 3/57
    fe 02 <attrs: descripción, spawn, house>  ff
        fe 04 00 00 00 00 07                    ← TILE_AREA base (0,0,7)
            fe 05 00 00 09 64 00 ff             ← TILE dx=0 dy=0, ATTR_ITEM=0x09, id=0x0064=100
        ff
        fe 0c ff                                ← TOWNS (vacío)
        fe 0f ff                                ← WAYPOINTS (vacío)
    ff
ff
```

**Flags de tile (`OTBM_ATTR_TILE_FLAGS`, u32):** los que escribe el editor son el subconjunto de zona:

| Bit | Valor | Significado |
|---|---|---|
| 0 | `0x00000001` | `TILESTATE_PROTECTIONZONE` |
| 1 | `0x00000002` | *deprecated* |
| 2 | `0x00000004` | `TILESTATE_NOPVP` |
| 3 | `0x00000008` | `TILESTATE_NOLOGOUT` |
| 4 | `0x00000010` | `TILESTATE_PVPZONE` |
| 5 | `0x00000020` | `TILESTATE_REFRESH` |

⚠️ **Aviso importante:** el servidor (TFS/Canary, en [`src/tile.h`](https://raw.githubusercontent.com/otland/forgottenserver/master/src/tile.h)) **reutiliza el mismo campo `flags` en memoria con otra numeración** (`TILESTATE_FLOORCHANGE_DOWN = 1<<0`, `TILESTATE_PROTECTIONZONE = 1<<7`, etc.). Son **dos espacios de bits distintos**: los del OTBM son los de arriba; los del `tile.h` del servidor son bits internos calculados en runtime a partir de los items. No los mezcles.

**Spawns y casas no están en el OTBM.** Repetido a propósito porque es el fallo más común al portar mapas: si copias solo el `.otbm`, tendrás geometría y casas sin nombre, pero **cero spawns**.

---

### 3.2 OTB (item definitions)

**Identificador:** `"OTBI"` (4 bytes). Mismo *framing* de nodos (`0xFE`/`0xFF`/`0xFD`).

**Raíz:** el nodo raíz **no tiene tipo**; su payload empieza con:

```
[1]  type info           (se salta)
[4]  flags / unused      (se salta)
[1]  attr = ROOT_ATTR_VERSION (0x01)
[2]  datalen             (debe ser 4+4+4+128 = 140)
[4]  dwMajorVersion      (1, 2 o 3 → elige el parser)
[4]  dwMinorVersion      (≈ versión de cliente)
[4]  dwBuildNumber       (revisión)
[128] CSDVersion         (string de 128 bytes)
```

```c
struct VERSIONINFO {
    uint32_t dwMajorVersion;
    uint32_t dwMinorVersion;
    uint32_t dwBuildNumber;
    uint8_t  CSDVersion[128];
};
```

Validación que hace RME: `datalen != 4 + 4 + 4 + 1*128` → error *"Size of version header is invalid"*.

**Hijos de la raíz:** un nodo por item, en orden. **El `type` del nodo de item es el `ItemGroup_t`:**

```c
ITEM_GROUP_NONE = 0, GROUND, CONTAINER, WEAPON, AMMUNITION, ARMOR, RUNE,
TELEPORT, MAGICFIELD, WRITEABLE, KEY, SPLASH, FLUID, DOOR, DEPRECATED(=14), LAST
```

`ITEM_GROUP_DEPRECATED` se **salta**. Cada nodo de item tiene:

```
[1]  group (ItemGroup_t)
[4]  flags (u32 bitmask)
[ N ] pares atributo/valor hasta el 0xFF del nodo
```

**Flags (u32)** — de `enum itemflags_t` en [items.h](https://raw.githubusercontent.com/hampusborgos/rme/master/source/items.h):

| Bit | Flag | Nota |
|---|---|---|
| 0 | `FLAG_UNPASSABLE` | bloquea |
| 1 | `FLAG_BLOCK_MISSILES` | |
| 2 | `FLAG_BLOCK_PATHFINDER` | |
| 3 | `FLAG_HAS_ELEVATION` | |
| 4 | `FLAG_USEABLE` | |
| 5 | `FLAG_PICKUPABLE` | |
| 6 | `FLAG_MOVEABLE` | |
| 7 | `FLAG_STACKABLE` | |
| 8 | `FLAG_FLOORCHANGEDOWN` | |
| 9 | `FLAG_FLOORCHANGENORTH` | |
| 10 | `FLAG_FLOORCHANGEEAST` | |
| 11 | `FLAG_FLOORCHANGESOUTH` | |
| 12 | `FLAG_FLOORCHANGEWEST` | |
| 13 | `FLAG_ALWAYSONTOP` | ¡Ojo! RME lo interpreta como **alwaysOnBottom** (comentario literal en el código: *"Now this is confusing, just accept that the ALWAYSONTOP flag means it's always on bottom, got it?!"*) |
| 14 | `FLAG_READABLE` | |
| 15 | `FLAG_ROTABLE` | |
| 16 | `FLAG_HANGABLE` | |
| 17 | `FLAG_HOOK_EAST` | |
| 18 | `FLAG_HOOK_SOUTH` | |
| 19 | `FLAG_CANNOTDECAY` | |
| 20 | `FLAG_ALLOWDISTREAD` | |
| 21 | `FLAG_UNUSED` | |
| 22 | `FLAG_CLIENTCHARGES` | |
| 23 | `FLAG_IGNORE_LOOK` | |

**Atributos** — cada uno es `[1] attr_id` + `[2] datalen` + `[datalen] dato`:

| ID | Nombre | Tipo / tamaño |
|---|---|---|
| `0x10` | `ITEM_ATTR_SERVERID` | **u16** — obligatorio |
| `0x11` | `ITEM_ATTR_CLIENTID` | **u16** — el puente al `.dat`/`.spr` |
| `0x12` | `ITEM_ATTR_NAME` | string (≤128 en v1/v2) |
| `0x13` | `ITEM_ATTR_DESCR` | string (≤128) |
| `0x14` | `ITEM_ATTR_SPEED` | u16 |
| `0x15` | `ITEM_ATTR_SLOT` | u16 |
| `0x16` | `ITEM_ATTR_MAXITEMS` | u16 (volumen de contenedor) |
| `0x17` | `ITEM_ATTR_WEIGHT` | **double (8 bytes)** |
| `0x18` | `ITEM_ATTR_WEAPON` | u8 |
| `0x19` | `ITEM_ATTR_AMU` | u8 |
| `0x1A` | `ITEM_ATTR_ARMOR` | u16 |
| `0x1B` | `ITEM_ATTR_MAGLEVEL` | u16 |
| `0x1C` | `ITEM_ATTR_MAGFIELDTYPE` | u8 |
| `0x1D` | `ITEM_ATTR_WRITEABLE` | — |
| `0x1E` | `ITEM_ATTR_ROTATETO` | u16 |
| `0x1F` | `ITEM_ATTR_DECAY` | — |
| `0x20` | `ITEM_ATTR_SPRITEHASH` | — |
| `0x21` | `ITEM_ATTR_MINIMAPCOLOR` | u16 |
| `0x22`/`0x23` | `ITEM_ATTR_07` / `_08` | — |
| `0x24` | `ITEM_ATTR_LIGHT` | — |
| `0x25` | `ITEM_ATTR_DECAY2` | `decayBlock2` = u16 decayTo + u16 decayTime |
| `0x26` | `ITEM_ATTR_WEAPON2` | `weaponBlock2` = 5 × u8 (weaponType, amuType, shootType, attack, defence) |
| `0x27` | `ITEM_ATTR_AMU2` | `amuBlock2` = 3 × u8 |
| `0x28` | `ITEM_ATTR_ARMOR2` | `armorBlock2` = u16 armor + **double weight** + u16 slot_position |
| `0x29` | `ITEM_ATTR_WRITEABLE2` | `writeableBlock2` = u16 readOnlyId |
| `0x2A` | `ITEM_ATTR_LIGHT2` | `lightBlock2` = u16 lightLevel + u16 lightColor (4 bytes) |
| `0x2B` | `ITEM_ATTR_TOPORDER` | **u8** — orden de dibujado |
| `0x2C` | `ITEM_ATTR_WRITEABLE3` | `writeableBlock3` = u16 readOnlyId + u16 maxTextLen |

Todos los structs van bajo `#pragma pack(1)`. Los atributos desconocidos **se saltan usando `datalen`** — es la vía correcta de forward-compatibility.

**Soporte por versión de OTB en RME:**

| MajorVersion | Atributos que parsea RME |
|---|---|
| 1 | Amplio: serverid, clientid, name, descr, speed, maxitems, weight, rotateto, writeable3, light2, toporder |
| 2 | Reducido: serverid, clientid, speed, light2, toporder |
| 3 | Igual que 2 (pero interpreta `FLAG_CLIENTCHARGES` y `FLAG_IGNORE_LOOK`) |

Los OTB modernos de Canary son **major 3**. Como RME ignora el resto, si tu motor quiere los datos completos (peso, armor, slot, decay), **tienes que parsearlos tú desde `items.xml`** — que es justo lo que hace `ItemDatabase::loadFromGameXml`.

---

### 3.3 DAT / SPR (assets de cliente)

#### `.dat` — metadata de *things*

**Cabecera:**

```
[4] signature (u32)   ← identifica la versión de cliente exacta
[2] item_count        (u16)
[2] creature_count    (u16)   ← outfits
[2] effect_count      (u16)
[2] distance_count    (u16)   ← missiles
```

**Rango de IDs (¡no empiezan en 0!):**

| Rango | Tipo |
|---|---|
| `100 … 100+item_count-1` | items |
| siguiente bloque | outfits/looktypes |
| siguiente bloque | effects |
| siguiente bloque | missiles/distances |

RME usa `minID = 100` y `maxID = item_count + creature_count` (no carga effects/missiles). Ejemplo histórico 8.40: items 100–9204, outfits 9205–9530, effects 9531–9597, distances 9599–9640.

**Por cada thing:**

1. **Flags** — bytes sueltos terminados en `0xFF`. Cada flag puede llevar payload. Tabla (formato moderno, ≥ 10.10):

| Flag | Payload | Nota |
|---|---|---|
| `Ground` (0) | **u16 speed** | |
| `GroundBorder` | — | |
| `OnBottom` / `OnTop` | — | |
| `Container` | — | |
| `Stackable` | — | |
| `ForceUse` / `MultiUse` | — | están **intercambiados** en 7.4–7.5 |
| `Writable` / `WritableOnce` | **u16 maxLen** | |
| `FluidContainer` / `Splash` | — | |
| `NotWalkable` / `NotMoveable` / `BlockProjectile` / `NotPathable` | — | |
| `Pickupable` | — | |
| `Light` | **u16 intensity, u16 color** | |
| `FloorChange` | — | |
| `FullGround` | — | |
| `Elevation` | **u16 drawHeight** | |
| `Displacement` | **u16 offsetX, u16 offsetY** | en < 7.55 es fijo (8,8) |
| `MinimapColor` | **u16 color** | |
| `Rotatable` / `LyingCorpse` / `Hangable` / `HookSouth` / `HookEast` / `AnimateAlways` / `DontHide` / `Translucent` / `Look` / `Wrappable` / `Unwrappable` / `TopEffect` / `NoMoveAnimation` / `Chargeable` | — | |
| `Cloth` / `LensHelp` / `Usable` | **u16** (se salta) | |
| `Market` | **6 bytes + string + 4 bytes** | |
| `0xFF` | — | **fin de flags** |

⚠️ **Las numeraciones de flag cambian entre versiones** y RME las remapea en `loadSpriteMetadataFlags`:
- **7.4–7.5**: flags 1–15 desplazados +1; 16→Light; 17→FloorChange; 18→FullGround; 19→Elevation; 20→Displacement; 22→MinimapColor; 23→Rotateable; 25→Hangable; 26/27→Hook; 28→AnimateAlways. `MultiUse` y `ForceUse` intercambiados.
- **7.55–7.72**: flag 23 → FloorChange.
- **7.80–8.54**: flags ≥ 8 desplazados +1 para dejar sitio a `ItemCharges` en 8.
- **8.6–9.86**: sin cambios.
- **10.10+**: flags ≥ 16 desplazados +1 (menos el 16, que pasa a `NoMoveAnimation`).

2. **Grupos de frames** (solo ≥ 10.57 y solo para *creatures*): `[1] group_count`, y por grupo `[1] group_type` (se salta).
3. **Dimensiones**:

```
[1] width          (en tiles)
[1] height         (en tiles)
[1] exact_size     ← SOLO se lee si width>1 || height>1
[1] layers         (blend frames; 2 = patrón de outfit con template)
[1] pattern_x      (direcciones)
[1] pattern_y      (addons)
[1] pattern_z      (monturas/male-female; = 1 en ≤ 7.4)
[1] frames         (longitud de animación)
```

4. **Bloque de animación** (solo si `frames > 1` y ≥ 10.50):

```
[1]  async
[4]  loop_count   (i32)
[1]  start_frame  (i8)
[frames ×] { [4] min_duration, [4] max_duration }
```

5. **Lista de sprite ids**, con `n = width × height × layers × pattern_x × pattern_y × pattern_z × frames`:
   - **no extendido** (`is_extended == false`): cada id es **u16** → **máx. 65 535 sprites**.
   - **extendido** (`is_extended == true`, ≥ 9.6 o vía `.otfi`): cada id es **u32**.

La fórmula de indexado es la de `GameSprite::getIndex`:

```
index = (((((frame % frames) * pattern_z + pz) * pattern_y + py) * pattern_x + px)
         * layers + layer) * height + h) * width + w
```

**Firma → versión.** RME busca la `datSignature` en una tabla por versión (`ClientVersion::getDatFormatForSignature`). Si no la reconoce, no carga. Ejemplos (tabla de `ot-dat`):

```
7.10 → 3DFF4B2A   7.40 → 41BF619C   7.72 → 439D5A33
7.13 → 3FD4FB91   7.50 → 42F81973   8.60 → (posterior a esta tabla)
7.21 → 3FDF40C6   7.55 → 437B2B8F
7.24 → 404E1C14   7.60/7.70 → 439D5A33
```

También existen los **`.otfi`** (OpenTibia File Information, formato OTML): un fichero por perfil que declara `extended`, `transparency`, `frame-durations`, `frame-groups`, `metadata-file` (=`.dat`) y `sprites-file` (=`.spr`). Es lo que permite **desacoplar la firma** del formato real, y es lo que usan los clientes con assets custom. Implementación: `GraphicManager::loadOTFI`.

#### `.spr` — los píxeles

**Cabecera:**

```
[4] spr_signature (u32)
[4] total_pics (u32)   ← u16 si el formato NO es extendido
[total_pics ×] [4] offset (u32)   ← tabla de índices
```

**Acceso a un sprite** (fórmula de RME, `loadSpriteDump`):

```cpp
offset = (is_extended ? 4 : 2) + sprite_id * sizeof(uint32_t);   // posición en la tabla
fh.seek(offset); fh.getU32(to_seek);
fh.seek(to_seek + 3);                                            // +3 bytes de cabecera de sprite
fh.getU16(sprite_size);
// leer sprite_size bytes = datos RLE
```

**Datos del sprite (RLE):**

- **Tamaño de tile: 32×32 px.** (`rme::SpritePixels`). RME dibuja/reescala a 16×16 para los iconos de paleta, pero el asset es 32×32.
- **Formato de píxeles: RGBA** cuando `transparency = true` (**4 bytes/píxel**); si no, **RGB de 3 bytes** con máscara magenta `0xFF00FF` como "transparente".
- Longitud esperada de datos: `32 × 32 × (3 o 4)` = **3072 o 4096 bytes** descomprimidos.
- **Esquema RLE** (secuencia de *runs* sobre el buffer, en orden de escaneo fila por fila, de arriba-izquierda a abajo-derecha):

```
repetir hasta agotar 'size':
  [u16] transparent_count   → tantos píxeles transparentes (alpha=0)
  [u16] colored_count       → tantos píxeles opacos
      por cada uno: [R][G][B] ( + [A] si transparency )
```

Código exacto de descompresión (`GameSprite::NormalImage::getRGBAData`):

```cpp
uint8_t bpp = use_alpha ? 4 : 3;
while(read < size && write < pixels_data_size) {
    int transparent = dump[read] | dump[read+1] << 8;  read += 2;
    for(int i = 0; i < transparent && write < pixels_data_size; i++) {
        data[write+0]=0; data[write+1]=0; data[write+2]=0; data[write+3]=0;   // alpha 0
        write += 4;
    }
    int colored = dump[read] | dump[read+1] << 8;      read += 2;
    for(int i = 0; i < colored && write < pixels_data_size; i++) {
        data[write+0] = dump[read+0];   // R
        data[write+1] = dump[read+1];   // G
        data[write+2] = dump[read+2];   // B
        data[write+3] = use_alpha ? dump[read+3] : 0xFF;  // A
        write += 4;  read += bpp;
    }
}
```

Detalle que muerde: en el `.dat` histórico **no se distingue "transparente" de "negro"** — los píxeles transparentes se escriben como RGB `000000` y el cliente los trata como máscara. Por eso RME rellena con `0xFF00FF` en la ruta RGB (`getRGBData`) y con alfa 0 en la ruta RGBA.

Referencia canónica de la comunidad para DAT/SPR (formato 7.7–8.4x): [Tibia.dat Reader + .dat/.spr Structure](https://otland.net/threads/tibia-dat-reader-dat-spr-structure-and-spr-reading-code-link.25117/).

#### Cómo se relacionan DAT/SPR con el OTB

```
items.xml ──(nombre, peso, atributos extra)──┐
                                             ▼
items.otb ── server_id ──► client_id ────────┘
                              │
                              ▼
                         Tibia.dat ── thing[client_id] ──► [sprite_id, sprite_id, …]
                                                              │
                                                              ▼
                                                         Tibia.spr ── offset[sprite_id] ──► RLE ──► 32×32 RGBA
```

**Este grafo es, en la práctica, todo el pipeline de datos de tu motor.** Cada flecha es un fichero que hay que parsear.

---

### 3.4 Diferencia crítica: cliente moderno (12+ / 15.x) ya NO usa DAT/SPR

Desde Tibia 12, el cliente oficial **abandonó `.dat`/`.spr`** en favor de:

```
catalog-content.json              ← manifiesto de assets
appearances-<hash>.dat            ← definiciones de apariencia en PROTOBUF
sprites-<hash>.bmp.lzma           ← ~5000 hojas de sprites comprimidas con LZMA
```

Esto lo confirma el README de YATME ([knobik/yatme](https://github.com/knobik/yatme)) y el changelog de Canary RME v4.0 (*"support reading assets from client 11 or higher"*, *"sprite atlas rendering using sheet textures"*).

**Implicación para tu decisión:** si apuntas a contenido moderno, el pipeline `.dat`/`.spr` **no te sirve**; necesitas protobuf + LZMA + atlas de hojas. Si apuntas a 7.4–10.98 (lo más común en servidores "custom" y donde está el 90 % de los assets comunitarios libres), `.dat`/`.spr` sí es el camino.

---

### 3.5 Bibliotecas, documentación y proyectos para parsear estos formatos

Esta es la sección más accionable: **casi todo lo que necesitas ya existe en TypeScript/JavaScript con licencia MIT.**

#### JavaScript / TypeScript (directamente portables a Node.js)

| Proyecto | Formatos | Licencia | Estado | Notas |
|---|---|---|---|---|
| [**gesior/open-tibia-library**](https://github.com/gesior/open-tibia-library) · npm [`@gesior/open-tibia-library`](https://www.npmjs.com/package/@gesior/open-tibia-library) | **DAT + SPR + OTB** (lectura **y escritura**) | **MIT** | Activo (push 2026-09-15) | **La pieza clave.** TypeScript puro, sin dependencias nativas, funciona en Node y navegador, trabaja con `Uint8Array`. API `loadDat/loadSpr/loadOtb` + `saveDat/saveSpr/saveOtb`. Incluye test de *roundtrip* de DAT. |
| [**V0RT4C/ot-otbm**](https://github.com/V0RT4C/ot-otbm) · npm [`@v0rt4c/otbm`](https://www.npmjs.com/package/@v0rt4c/otbm) | **OTBM** (lectura **y escritura**) | **MIT** | 2024 | API DOM-like (`parent`, `children`, `firstChild`, `nextSibling`, `asRawObject()`). Sin dependencias. Rendimiento declarado: **65 MB en ~3,5 s** de parseo y ~1,8 s de escritura (M1). Soporta OTBM hasta v3. |
| [**Inconcessus/OTBM2JSON**](https://github.com/Inconcessus/OTBM2JSON) · npm `otbm2json` | OTBM ↔ JSON | **MIT** | 2019 (estable) | 58★. El *framework* original de modificación programática de OTBM. Útil como referencia de semántica JSON. |
| [**@paradoxlab/otbm**](https://www.npmjs.com/package/@paradoxlab/otbm) | OTBM | MIT | 2026-06 | Parser + writer TypeScript, con `@paradoxlab/utils` (lector/escritor binario compartido). |
| [**V0RT4C/ot-dat**](https://github.com/V0RT4C/ot-dat) | **DAT** | MIT | 2022, con tablas de flags y firmas 7.10–7.72 | Excelente **referencia de tablas**: `DAT_FLAGS_740_750`, `DAT_FLAGS_755_772`, `DAT_SIGNATURES`. Útil aunque uses la librería de gesior. |
| [**V0RT4C/ot-spr**](https://github.com/V0RT4C/ot-spr) | **SPR** | MIT | — | "Supported versions 3.0 → 10.56". |
| [**V0RT4C/Map-Editor**](https://github.com/V0RT4C/Map-Editor) | Map editor | GPL-3.0 | antiguo | Editor de mapas previo del mismo autor. |
| [edaegonis/OTMapGen](https://github.com/edaegonis/OTMapGen) · npm `otmapgen` | Generador de mapas OT | ISC | 2021 | Genera terreno procedural. |

#### Go

| Proyecto | Formatos | Licencia | Notas |
|---|---|---|---|
| [`badc0de.net/pkg/go-tibia/otb`](https://pkg.go.dev/badc0de.net/pkg/go-tibia@v0.0.9/otb) (repo [bitbucket.org/ivucica/go-tibia](https://bitbucket.org/ivucica/go-tibia)) | **OTB** + subpaquetes `otb/items` y **`otb/map` (OTBM)** | **GPL-2.0** | Documentación de API muy clara y estructura genérica de nodos (`NodeType()`, `ChildNode()`, `NextNode()`, `PropsBuffer()`), **explícitamente modelada sobre `fileloader.cpp` de OTServ**. Muy buena referencia conceptual del *framing*. |
| [levantocode/tibia-go-otbm-parser](https://pkg.go.dev/github.com/levantocode/tibia-go-otbm-parser/otbm) | OTBM | — | Alternativa moderna. |

#### C / C++ (fuente de verdad)

| Proyecto | Qué aporta |
|---|---|
| [hampusborgos/rme](https://github.com/hampusborgos/rme) → `source/iomap_otbm.cpp`, `source/filehandle.{h,cpp}`, `source/items.cpp`, `source/graphics.cpp`, `source/materials.cpp` | **La referencia definitiva** para OTBM y DAT/SPR. GPL-3.0: puedes *leerla* para portar la lógica, pero **copiar código contamina tu licencia**. |
| [otland/forgottenserver](https://github.com/otland/forgottenserver) → `src/fileloader.cpp`, `src/items.cpp`, `src/tile.h` | Lado servidor: OTB + OTBM + flags de tile en runtime. GPL-2.0. |
| [opentibiabr/canary](https://github.com/opentibiabr/canary) | Servidor moderno; parser OTBM con soporte de zonas y atributos extendidos. |
| [edubart/otclient](https://github.com/edubart/otclient) / [opentibiabr/otclient](https://github.com/opentibiabr/otclient) / [mehah/otclient](https://github.com/mehah/otclient) | Cliente: parseo de `.dat`/`.spr` en [`src/client/`](https://raw.githubusercontent.com/edubart/otclient/master/src/client/map.h) (`map.h`, `spritemanager`, `thingtype`). La versión de OTArchive compila con **Emscripten** → [OTArchive/otclient](https://github.com/OTArchive/otclient). |

#### Documentación

- [RME wiki — Documentation of the .otbm file structure](https://github.com/hampusborgos/rme/wiki/Documentation-of-the-.otbm-file-structure) (redirige al hilo de OTLand).
- [**A comprehensive description of the OTBM format**](https://otland.net/threads/a-comphrensive-description-of-the-otbm-format.258583/) — Forby, 2018. **La mejor documentación en prosa que existe**, con ejemplo hex comentado.
- [Tibia.dat Reader + .dat/.spr Structure](https://otland.net/threads/tibia-dat-reader-dat-spr-structure-and-spr-reading-code-link.25117/) — jo3bingham, 2009. Estructura DAT/SPR 7.7–8.4x.
- [DeepWiki: RME File I/O and Persistence](https://deepwiki.com/opentibiabr/remeres-map-editor/6.2-file-io-and-persistence) · [Canary World and Map Systems](https://deepwiki.com/opentibiabr/canary/4-world-and-map-systems).
- [Criando Tibia Docs](https://criando-tibia.gitbook.io/criando-tibia-docs/product-docs/downloads/images-and-media-1/map-editor/rme-13.10-canary) — guías prácticas de DAT/SPR y perfiles de RME.
- [OTLand — Creating your own Palette](https://otland.net/threads/creating-you-own-palette.247720/) · [Mapping with 100% custom sprites](https://otland.net/threads/mapping-with-100-custom-sprites.299715/).

**No hay "libro" formal.** La documentación del ecosistema son estos hilos + el código fuente. Cualquier implementación propia debería validarse por *roundtrip* contra RME (leer mapa, guardarlo, comparar bytes).

---

## 4. Alternativas modernas y libres

### 4.1 Editores de mapas

| Proyecto | Stack | Licencia | Estado | Veredicto |
|---|---|---|---|---|
| [**knobik/yatme**](https://github.com/knobik/yatme) — *Yet Another Tibia Map Editor* | **React 19 + PixiJS 8 + TypeScript + Vite** | **MIT** | Creado 2026-03, último push 2026-03-13, 12★, 0 issues | ⭐ **Lo más relevante para ti.** Editor de mapas **en navegador**, 100 % TypeScript, MIT. Carga/guarda OTBM con pipeline protobuf de Tibia 15.00+. 9 herramientas, sistema de brushes (ground con auto-bordes, walls con esquinas, carpet/table/doodad/raw), undo/redo, find/replace, borderize, pintado de zonas, casas, spawns, towns. **Reutilizable directamente.** Despliegue con Docker Compose. Hilo: [otland.net/threads/304133](https://otland.net/threads/yatme-browser-based-map-editor-for-tibia-15-00-open-source.304133/). |
| [opentibiabr/remeres-map-editor](https://github.com/opentibiabr/remeres-map-editor) (Canary RME) | C++23, wxWidgets, OpenGL | GPL-3.0 | **Activo** (v4.0, 2026-06) | La opción "de producción" para mapear en serio hoy. |
| [OTAcademy/RME](https://github.com/OTAcademy/RME) (OTA RME) | C++, wxWidgets + Lua | GPL-3.0 | **Activo** (4.2.0, 2026-01) | Mejor para automatizar vía Lua. |
| [dewral/DewralMapEditor](https://github.com/dewral/DewralMapEditor) (DME) | C++17, **Qt 6/QML + OpenGL instanced** | **AGPL-3.0** ⚠️ | Activo (2026-09) | Soporta 7.60–10.98 y perfiles custom. Rendimiento muy superior a RME en mapas grandes (**180 MB: 561 MB RAM y 5,1 % CPU vs 3 722 MB y 15,6 %**). Hilo: [otland.net/threads/305104](https://otland.net/threads/dme-tibia-map-editor.305104/). **AGPL es viral incluso para uso en red** — peligroso si piensas en SaaS. |
| *Tibia ImGui Map Editor* | C++ ImGui | — | POC (2026-01) | [hilo](https://otland.net/threads/new-map-editor-tibia-imgui-map-editor-proof-of-concept-feel-free-to-contribute.303735/) |
| *RME Redux* | — | — | 2026-02 | [hilo](https://otland.net/threads/remeres-map-editor-redux-introducing-rme-overhaul-project-because-someone-had-to-do-it.303938/) |
| *RME-Alpha-AI* | — | — | 2026-07 | Editor asistido por IA. [hilo](https://otland.net/threads/alpha-rme-alpha-ai-the-ai-powered-map-editor-for-opentibia.305091/) |
| *Tibia 7.7 Map Editor (.sec)* | **PyQt5** | — | pre-alpha | Lee los `.sec` originales de CipSoft. [hilo](https://otland.net/threads/tibia-7-7-map-editor-for-original-cipsoft-sec-files-pyqt5-pre-alpha.303850/) |

**Conclusión:** el nicho "editor de mapas libre, multiplataforma y mantenido" está **saturado en 2026**, y la respuesta a "¿existe alternativa web?" es **sí: YATME**. No tiene sentido escribir otro editor de mapas desde cero.

### 4.2 Editores de items / assets

| Proyecto | Stack | Licencia | Estado |
|---|---|---|---|
| [ottools/ObjectBuilder](https://github.com/ottools/ObjectBuilder) | ActionScript/AIR | **MIT** | Original, 2022 |
| [punkice3407/ObjectBuilder](https://github.com/punkice3407/ObjectBuilder) | ActionScript | **MIT** | Activo (2026-07) |
| [rookgaard/ObjectBuilder](https://github.com/rookgaard/ObjectBuilder) (JS) | JavaScript + jQuery | **sin licencia** ⚠️ | 2026-06 |
| [gesior/open-tibia-tools](https://github.com/gesior/open-tibia-tools) · npm `open-tibia-tools` | TypeScript, navegador | **MIT** | 2026-09 — generadores de imágenes de items/outfits + **editor de OTB** |
| [V0RT4C/spreditor.online](https://github.com/V0RT4C/spreditor.online) | Web | **MIT** | Editor de sprites online |
| BaconBinary ObjectEditor | C#/.NET | — | 2025-12 |

**Conclusión:** para items, la combinación ganadora es **`@gesior/open-tibia-library` (motor) + `open-tibia-tools` (UI)**. Ambos MIT y en TypeScript.

### 4.3 Generación de assets estilo Tibia

- **Sprites**: la fuente realista son los repositorios de assets comunitarios de cliente ([dudantas/tibia-client](https://github.com/dudantas/tibia-client/releases)), los *sprite packs* de OTLand, y editores como `spreditor.online`.
- **Generación procedural de mapas**: [OTMapGen](https://github.com/edaegonis/OTMapGen) (npm, ISC) y la funcionalidad *"Bitmap to Map terrain generator"* añadida en Canary RME v4.0.
- **Atlas de sprites**: el pipeline más útil que puedes copiar es el del proyecto de [lyloloq (Nakama+Go+Godot)](https://otland.net/threads/tibia-clone-with-nakama-go-godot-4-custom-binary-protocol-otbm-parser-full-sprite-pipeline.303962/): extrae **463 000 sprites** de un `.spr` RLE y los empaqueta en **114 hojas de 2048×2048** con índice JSON y carga perezosa. Ese es exactamente el pipeline que necesita un motor web.

### 4.4 Licencias — resumen crítico

| Proyecto | Licencia | ¿Puedo reutilizar código en un motor propietario o MIT? |
|---|---|---|
| RME (original y forks Canary/OTAcademy) | **GPL-3.0** | **NO.** Copiar código obliga a liberar todo el derivado bajo GPLv3. Puedes **leerlo para entender el formato** (los formatos no son copyrightables) y reimplementar desde cero. |
| DME (DewralMapEditor) | **AGPL-3.0** | **NO, y peor**: AGPL se activa incluso con uso en red (SaaS). |
| Object Builder (ottools, punkice3407) | **MIT** | **SÍ**, con atribución. |
| rookgaard/ObjectBuilder (JS) | Sin licencia | **NO** (por defecto, todos los derechos reservados). |
| `@gesior/open-tibia-library` | **MIT** | **SÍ** ⭐ |
| `@v0rt4c/otbm`, `ot-dat`, `ot-spr` | **MIT** | **SÍ** ⭐ |
| OTBM2JSON | **MIT** | **SÍ** |
| YATME | **MIT** | **SÍ** ⭐ — aunque el README dice "inspired by RME", es una reimplementación limpia en TS, no un derivado de código GPL. |
| go-tibia (ivucica) | GPL-2.0 | No para código, sí como referencia de diseño. |
| The Forgotten Server / Canary | GPL-2.0 | No para código. |
| OTClient | "Other" (NOASSERTION) | Verificar caso a caso; históricamente MIT con partes GPL. |

**Regla práctica:** los *formatos* (OTBM, OTB, DAT, SPR) son hechos técnicos y no están licenciados. Las *implementaciones* sí. **Porta a Node.js desde las librerías MIT, no desde el C++ de RME.**

---

## 5. Recomendaciones para tu motor en Node.js

### 5.1 ¿OTBM real o formato propio?

**Recomendación: ambos, con OTBM como frontera de importación/exportación.**

Adoptar OTBM real te da gratis:

1. **Todo el contenido comunitario**: mapas de mundos enteros, mapas custom, prefabs. Nada tuyo competirá con eso.
2. **Editores ya hechos y mantenidos**: RME, Canary RME, OTA RME, YATME. Si tu formato es propietario, necesitas escribir tu propio editor — que es el trabajo más caro de todo el proyecto (pintado de brushes, auto-bordes, undo/redo, render multi-planta…).
3. **Ecosistema de herramientas**: import/export de zonas, minimapa, generadores procedurales, scripts Lua.

Pero **no lo uses como formato de runtime**:

- El árbol de nodos con `0xFE`/`0xFF` y escapes es **lento de recorrer** para consultas por tile y **no admite escritura incremental** (guardar implica reescribir el árbol completo).
- `TILE_AREA` de 256×256 implica que consultar "¿qué hay en (x, y, z)?" requiere indexar o recorrer.
- La semántica de atributos cambia por versión de OTBM → ramas de compatibilidad por todos lados.
- Requiere el OTB *y* el `.dat` para interpretar los items correctamente.

**Arquitectura propuesta:**

```
┌──────────────────┐   import    ┌──────────────────────────┐
│ world.otbm       │ ──────────► │  Mundo interno            │
│ + items.otb      │             │  - chunk[z][cx][cy]       │
│ + Tibia.dat/.spr │             │  - tile: ground + items[] │
│ + *-spawn.xml    │ ◄────────── │  - entidades/spawns       │
│ + *-house.xml    │   export    │  - índice espacial        │
│ + *-zones.xml    │             └──────────────────────────┘
└──────────────────┘                     │
                                         │ runtime
                                         ▼
                              servidor autoritativo + cliente
```

- **Formato interno**: binario plano propio con chunks de 32×32 o 64×64 (no 256×256), índice directo, y un **formato de intercambio JSON/binario "world-src"** que sea *diff-friendly* (para control de versiones del mapa — algo que OTBM no permite).
- **Import/export OTBM**: usando `@v0rt4c/otbm` para el árbol de nodos y tu propia capa de traducción. Soporta OTBM v1–v3; para v4 necesitarás extender el manejo de `ATTRIBUTE_MAP` (0x80).
- **Metadatos de items**: un `items.json` generado *una vez* por un script de build a partir de `items.otb` + `items.xml`, no parseado en runtime. Consulta O(1) por `server_id` → `{clientId, flags, weight, …}`.

### 5.2 Qué construir, en orden de prioridad

| # | Herramienta | Por qué | Base reutilizable |
|---|---|---|---|
| **1** | **`otb2json`** — CLI que convierte `items.otb` + `items.xml` a un `items.json` normalizado | Es el cimiento de todo: sin esto no puedes interpretar un solo item de un mapa. Es pequeño y de alto valor. | [`@gesior/open-tibia-library`](https://github.com/gesior/open-tibia-library) (MIT) |
| **2** | **`otbm2internal` / `internal2otbm`** — importador/exportador bidireccional | Te da acceso a todo el contenido del mundo OT y te permite seguir usando RME/YATME como editores. Es **la inversión más rentable del proyecto**. | [`@v0rt4c/otbm`](https://github.com/V0RT4C/ot-otbm) (MIT) |
| **3** | **`spr→atlas`** — extractor RLE → PNG + atlas 2048×2048 + índice JSON, con carga perezosa | Convierte 100 MB de `.spr` en algo que un navegador puede consumir. Pipeline ya validado por la comunidad. | Implementación RLE de [`@gesior/open-tibia-library`](https://github.com/gesior/open-tibia-library) o [`ot-spr`](https://github.com/V0RT4C/ot-spr) |
| **4** | **Servidor autoritativo + protocolo binario** | El núcleo del juego. Define tu formato de mensajes (U8/U16/U32/I64/F64/String con prefijo de longitud/UUID/Position de 5 bytes) antes de escribir el cliente. | Referencia de diseño: [el proyecto Nakama+Go+Godot](https://otland.net/threads/tibia-clone-with-nakama-go-godot-4-custom-binary-protocol-otbm-parser-full-sprite-pipeline.303962/) |
| **5** | **Editor de mapas web** | Solo si YATME no te sirve. Es la pieza más cara. | [YATME](https://github.com/knobik/yatme) (MIT) — React 19 + PixiJS 8 |
| **6** | **Editor de items** | Solo si necesitas crear items nuevos. Para *usar* items existentes, el paso 1 basta. | [`open-tibia-tools`](https://github.com/gesior/open-tibia-tools) (MIT) |

### 5.3 Trampas conocidas (verificadas en las fuentes)

1. **Desescapar `0xFD`.** Si no lo haces, los mapas con ciertos bytes en strings (nombres de waypoint/town) se corrompen silenciosamente.
2. **El suelo es un item más, con camino compacto `OTBM_ATTR_ITEM` inline.** No busques una "capa de suelo" en el formato.
3. **Counts según versión.** En OTBM v1 el subtype va *crudo* tras el id; en v2+ es el atributo `0x0F`.
4. **Necesitas el OTB para leer counts de stackables/splash/fluids.** Documentado explícitamente por el autor de `@v0rt4c/otbm`.
5. **`OTBM_ATTR_ALWAYSONTOP` = "always on bottom".** Comentario literal en el código de RME. No confíes en el nombre.
6. **Los flags de tile del OTBM NO son los del `tile.h` del servidor.** Dos enums distintos.
7. **Spawns y metadata de casas viven en XML externo.** Copiar solo el `.otbm` te deja sin spawns.
8. **Las firmas de `.dat`/`.spr` bloquean la carga.** Usa un perfil `.otfi` si tocas los ficheros.
9. **`.dat`/`.spr` solo sirven hasta ~10.98.** Cliente 12+ usa protobuf + LZMA + atlas.
10. **`items.otb` v3 no expone peso/armor/slot/decay a RME.** Si tu motor los necesita, parsea `items.xml`.
11. **La numeración de flags del `.dat` cambia en 5 puntos de la historia** (7.4, 7.55, 7.8, 8.6, 10.10). Hay que remapear.
12. **Licencias:** RME y DME son GPL/AGPL → reimplementa, no copies. Usa las librerías MIT.

### 5.4 Decisión sugerida en una frase

> **Adopta OTBM + OTB + DAT/SPR como formatos de *interoperabilidad* (leyendo con las librerías MIT existentes), define un formato interno propio orientado a chunks y diff-friendly para el *runtime*, y no escribas ningún editor gráfico hasta haber agotado YATME y Canary RME.**

---

## Apéndice: índice de URLs citadas

**Editores de mapas**
- https://github.com/hampusborgos/rme
- https://github.com/opentibiabr/remeres-map-editor
- https://github.com/opentibiabr/remeres-map-editor/releases/tag/v4.0
- https://github.com/OTAcademy/RME
- https://github.com/OTAcademy/RME/blob/master/scripts/README.md
- https://github.com/knobik/yatme
- https://github.com/dewral/DewralMapEditor
- https://github.com/V0RT4C/Map-Editor
- https://github.com/OTArchive/otclient
- https://github.com/edubart/otclient
- https://github.com/opentibiabr/otclient
- https://github.com/dudantas/tibia-client/releases

**Editores de items / assets**
- https://github.com/ottools/ObjectBuilder
- https://github.com/punkice3407/ObjectBuilder
- https://github.com/AngelOfDeaths/ObjectBuilder
- https://github.com/rookgaard/ObjectBuilder
- https://object-builder.opentibia.info/
- https://github.com/gesior/open-tibia-library
- https://github.com/gesior/open-tibia-tools
- https://github.com/V0RT4C/ot-dat
- https://github.com/V0RT4C/ot-spr
- https://github.com/V0RT4C/spreditor.online
- https://github.com/V0RT4C/ot-otbm
- https://github.com/Inconcessus/OTBM2JSON
- https://github.com/edaegonis/OTMapGen

**Fuentes de formato (código)**
- https://raw.githubusercontent.com/hampusborgos/rme/master/source/iomap_otbm.cpp
- https://raw.githubusercontent.com/hampusborgos/rme/master/source/iomap_otbm.h
- https://raw.githubusercontent.com/hampusborgos/rme/master/source/filehandle.h
- https://raw.githubusercontent.com/hampusborgos/rme/master/source/items.h
- https://raw.githubusercontent.com/hampusborgos/rme/master/source/items.cpp
- https://raw.githubusercontent.com/hampusborgos/rme/master/source/graphics.cpp
- https://raw.githubusercontent.com/hampusborgos/rme/master/source/materials.cpp
- https://raw.githubusercontent.com/hampusborgos/rme/master/source/item.h
- https://raw.githubusercontent.com/otland/forgottenserver/master/src/tile.h
- https://raw.githubusercontent.com/edubart/otclient/master/src/client/map.h
- https://skalski.pro/files/files/pvpenfo.pl/source/tile.h

**Documentación y guías**
- https://github.com/hampusborgos/rme/wiki/Documentation-of-the-.otbm-file-structure
- https://otland.net/threads/a-comphrensive-description-of-the-otbm-format.258583/
- https://otland.net/threads/tibia-dat-reader-dat-spr-structure-and-spr-reading-code-link.25117/
- https://otland.net/threads/creating-you-own-palette.247720/
- https://otland.net/threads/mapping-with-100-custom-sprites.299715/
- https://otland.net/threads/release-ota-rme-4-2-0-lua-scripting.303774/
- https://otland.net/threads/js-port-of-objectbuilder.304690/
- https://otland.net/threads/yatme-browser-based-map-editor-for-tibia-15-00-open-source.304133/
- https://otland.net/threads/dme-tibia-map-editor.305104/
- https://otland.net/threads/new-map-editor-tibia-imgui-map-editor-proof-of-concept-feel-free-to-contribute.303735/
- https://otland.net/threads/remeres-map-editor-redux-introducing-rme-overhaul-project-because-someone-had-to-do-it.303938/
- https://otland.net/threads/alpha-rme-alpha-ai-the-ai-powered-map-editor-for-opentibia.305091/
- https://otland.net/threads/tibia-7-7-map-editor-for-original-cipsoft-sec-files-pyqt5-pre-alpha.303850/
- https://otland.net/threads/c-net-baconbinary-objecteditor-a-modern-high-performance-asset-editor.303219/
- https://otland.net/threads/tibia-clone-with-nakama-go-godot-4-custom-binary-protocol-otbm-parser-full-sprite-pipeline.303962/
- https://docs.otland.net/ots-guide/
- https://criando-tibia.gitbook.io/criando-tibia-docs/product-docs/downloads/images-and-media-1/map-editor/atualizar-dat-spr
- https://criando-tibia.gitbook.io/criando-tibia-docs/product-docs/downloads/images-and-media-1/map-editor/rme-13.10-canary
- https://deepwiki.com/opentibiabr/remeres-map-editor/6.2-file-io-and-persistence
- https://deepwiki.com/opentibiabr/canary/4-world-and-map-systems
- https://pkg.go.dev/badc0de.net/pkg/go-tibia@v0.0.9/otb

**Paquetes npm**
- https://www.npmjs.com/package/@v0rt4c/otbm
- https://www.npmjs.com/package/@gesior/open-tibia-library
- https://www.npmjs.com/package/open-tibia-tools
- https://www.npmjs.com/package/otbm2json
- https://www.npmjs.com/package/@paradoxlab/otbm
- https://www.npmjs.com/package/otmapgen
