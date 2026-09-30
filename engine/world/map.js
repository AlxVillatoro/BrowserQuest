'use strict';

/**
 * Map: el mundo en memoria.
 *
 * SOBRE EL NOMBRE DE LA CLASE: se llama `GameMap` y no `Map` a propósito. Llamarla
 * `Map` parecía natural —es lo que hace The Forgotten Server en C++— pero en
 * JavaScript **ensombrece el `Map` nativo**, y como esta clase necesita `Map` para
 * sus propias colecciones, `new Map()` dentro de ella se llamaba a sí misma hasta
 * desbordar la pila con un `RangeError` que no dice nada del problema real.
 *
 * Se deja escrito porque es un error que se vuelve a cometer: el nombre natural
 * de esta clase es justo el de una global que necesita.
 *
 * Almacenamiento por **chunks** de 32×32 por planta, y —esto es lo importante—
 * **sólo se guardan los tiles que el mapa menciona explícitamente**. Los demás se
 * resuelven contra el suelo por defecto de su planta.
 *
 * La razón es de escala: un mapa de 2048×2048 con 16 plantas son 67 millones de
 * tiles. Materializarlos todos cuesta gigabytes para representar un desierto de
 * suelo repetido. Guardando sólo las excepciones, un mapa así ocupa lo que ocupan
 * sus paredes, objetos y casas, y la consulta sigue siendo O(1) porque va a un
 * array indexado dentro del chunk.
 *
 * Es exactamente el motivo por el que ARQUITECTURA.md decide no usar OTBM en
 * tiempo de ejecución: su `TILE_AREA` de 256×256 obliga a recorrer, y aquí se
 * salta directo.
 */

const { Tile, TILE_FLAGS, MAX_STACKPOS } = require('./tile');
const { Item } = require('./item');
const { Position, DIRECTIONS, directionFrom } = require('./position');

const CHUNK_SIZE = 32;
const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE;

/** La última planta de superficie. De la 0 a la 7 se ve todo; de la 8 abajo, no. */
const SURFACE_MAX_Z = 7;

/** Plantas de diferencia que se ven en el subsuelo. */
const UNDERGROUND_VISIBLE_FLOORS = 2;

class GameMap {
    constructor(options) {
        const opts = options || {};

        this.name = opts.name || 'unnamed';
        this.width = opts.width || 0;
        this.height = opts.height || 0;
        this.floors = opts.floors || 1;

        /** clave de chunk -> array de CHUNK_AREA posiciones (o null). */
        this.chunks = new Map();

        /** Suelo por defecto de cada planta. */
        this.defaultGround = new Map();
        /** Suelo de respaldo, si una planta no declara el suyo. */
        this.fallbackGround = null;

        this.waypoints = new Map();
        this.spawns = [];

        /** Dónde van los NPC. Posiciones, no criaturas: esto es un archivo, no la partida. */
        this.npcPlacements = [];
        this.towns = [];

        this.explicitTiles = 0;
        this.log = opts.logger || null;
    }

    // -----------------------------------------------------------------------
    // Límites y direccionamiento
    // -----------------------------------------------------------------------

    inBounds(x, y, z) {
        return x >= 0 && y >= 0 && z >= 0 &&
            x < this.width && y < this.height && z < this.floors;
    }

    _chunkKey(cx, cy, z) {
        return cx + '_' + cy + '_' + z;
    }

    _getChunk(cx, cy, z) {
        return this.chunks.get(this._chunkKey(cx, cy, z)) || null;
    }

    _getOrCreateChunk(cx, cy, z) {
        const key = this._chunkKey(cx, cy, z);
        let chunk = this.chunks.get(key);
        if (!chunk) {
            chunk = new Array(CHUNK_AREA).fill(null);
            this.chunks.set(key, chunk);
        }
        return chunk;
    }

    /**
     * El tile almacenado, o null si esa celda no tiene nada explícito.
     *
     * Devolver null NO significa "no hay nada": significa "aquí sólo hay suelo por
     * defecto". Para saber si se puede caminar hay que usar `isWalkable`, no esto.
     */
    getTile(x, y, z) {
        if (!this.inBounds(x, y, z)) {
            return null;
        }
        const chunk = this._getChunk(
            Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), z);

        if (!chunk) {
            return null;
        }
        return chunk[(y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE)] || null;
    }

    /** El tile almacenado, creándolo si hace falta. */
    getOrCreateTile(x, y, z) {
        if (!this.inBounds(x, y, z)) {
            return null;
        }
        const chunk = this._getOrCreateChunk(
            Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), z);

        const index = (y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE);
        if (!chunk[index]) {
            chunk[index] = new Tile(x, y, z);

            // Si la celda no declara suelo, hereda el de su planta. Así el loader
            // no tiene que repetir el suelo en cada tile que menciona.
            const ground = this.groundFor(z);
            if (ground) {
                chunk[index].setGround(this._copyGround(ground, x, y, z));
            }

            this.explicitTiles += 1;
        }
        return chunk[index];
    }

    /**
     * El suelo de una celda, venga de un tile explícito o del suelo por defecto.
     *
     * Se devuelve una copia por celda en vez del mismo objeto compartido: un item
     * guarda su posición, y compartir la instancia haría que todos los tiles del
     * mapa dijeran estar en la misma coordenada.
     */
    _copyGround(ground, x, y, z) {
        const copy = new Item(ground.definition, {
            count: 1,
            attributes: { ...ground.attributes }
        });
        copy.position = { x: x, y: y, z: z };
        return copy;
    }

    /**
     * El suelo de una celda, venga de un tile explícito o del suelo por defecto.
     *
     * Fuera del mapa devuelve `null`, y esa comprobación no es un detalle: sin
     * ella, preguntar por una celda que no existe devolvía el suelo por defecto de
     * esa planta, así que mirar más allá del borde del mundo describía "ves
     * hierba" donde no hay nada. Apareció probando el comando de mirar con la
     * coordenada (999,999).
     *
     * En el caso del suelo por defecto se devuelve el objeto compartido de la
     * planta. Su `position` no es significativa: quien pregunta ya sabe en qué
     * celda está. Clonarlo en cada consulta costaría una asignación por celda y
     * por frame sin dar nada a cambio.
     */
    /**
     * El suelo por defecto de una planta.
     *
     * EL `fallbackGround` NO SE APLICA POR ENCIMA DE LA SUPERFICIE, y esa restriccion es la
     * que faltaba. En el modelo de Tibia la superficie (z=7) es lo mas alto del mundo: por
     * encima no hay suelo, hay aire. Aplicarlo a todas las plantas creaba plantas FANTASMA de
     * hierba en z=0..6, y como el cliente dibuja las plantas de mas arriba DESPUES -estan mas
     * cerca de la vista y tapan lo que hay debajo, que es lo correcto-, esas plantas
     * inventadas tapaban al jugador y a los monstruos.
     *
     * El sintoma era un mundo entero de hierba sin una sola criatura, y con "plantas 7/6/5"
     * en el diagnostico: tres plantas donde solo hay una.
     *
     * Un mapa que quiera suelo por encima de la superficie -islas flotantes, torres- lo
     * declara en `defaultGround`, que sigue mandando sobre esto.
     */
    groundFor(z) {
        const declared = this.defaultGround.get(z);

        if (declared) {
            return declared;
        }

        return z >= SURFACE_MAX_Z ? this.fallbackGround : null;
    }

    getGround(x, y, z) {
        if (!this.inBounds(x, y, z)) {
            return null;
        }

        const tile = this.getTile(x, y, z);
        if (tile && tile.ground) {
            return tile.ground;
        }
        const fallback = this.groundFor(z);
        return fallback || null;
    }

    /** Declara el suelo por defecto de una planta. */
    setDefaultGround(z, item) {
        this.defaultGround.set(z, item);
        return this;
    }

    setFallbackGround(item) {
        this.fallbackGround = item;
        return this;
    }

    // -----------------------------------------------------------------------
    // Reglas de paso
    // -----------------------------------------------------------------------

    /**
     * ¿Se puede caminar por esta celda, por lo que respecta al terreno?
     */
    isWalkable(x, y, z) {
        if (!this.inBounds(x, y, z)) {
            return false;
        }

        const tile = this.getTile(x, y, z);
        if (tile) {
            return tile.isWalkable();
        }

        // Sin tile explícito: manda el suelo por defecto de la planta.
        const ground = this.getGround(x, y, z);
        return !!ground && !ground.blocksSolid;
    }

    /**
     * ¿Puede una criatura dar este paso?
     *
     * Se comprueban tres cosas, y las tres importan:
     *
     *  1. El destino tiene que ser adyacente y estar en la MISMA planta. Cambiar de
     *     planta no es caminar: en Tibia las escaleras son teleports disfrazados.
     *  2. En diagonal, no se puede cortar la esquina: si los dos tiles ortogonales
     *     que rodean el vértice están bloqueados, el paso no es válido. Sin esta
     *     regla se atraviesan las esquinas de las paredes, que es el fallo de
     *     movimiento más visible que existe.
     *  3. El destino no puede tener una criatura bloqueante, salvo que quien
     *     pregunte pueda empujarla.
     *
     * @param {Position|Object} from
     * @param {Position|Object} to
     * @param {Object} [options]
     * @param {boolean} [options.ignoreCreatures]
     * @param {boolean} [options.canPushCreatures]
     * @returns {{allowed: boolean, reason: string|null}}
     */
    canWalk(from, to, options) {
        const settings = options || {};

        if (to.z !== from.z) {
            return { allowed: false, reason: 'floorChange' };
        }
        if (!this.inBounds(to.x, to.y, to.z)) {
            return { allowed: false, reason: 'outOfBounds' };
        }
        if (Math.abs(to.x - from.x) > 1 || Math.abs(to.y - from.y) > 1) {
            return { allowed: false, reason: 'notAdjacent' };
        }
        if (to.x === from.x && to.y === from.y) {
            return { allowed: false, reason: 'noMovement' };
        }

        if (!this.isWalkable(to.x, to.y, to.z)) {
            return { allowed: false, reason: 'blocked' };
        }

        const direction = directionFrom(from, to);
        if (direction && DIRECTIONS[direction].diagonal) {
            // Las dos ortogonales que forman la esquina.
            const freeA = this.isWalkable(to.x, from.y, from.z);
            const freeB = this.isWalkable(from.x, to.y, from.z);

            if (!freeA && !freeB) {
                return { allowed: false, reason: 'cornerCut' };
            }
        }

        if (!settings.ignoreCreatures) {
            const tile = this.getTile(to.x, to.y, to.z);
            if (tile && tile.creatures.length > 0 && !settings.canPushCreatures) {
                return { allowed: false, reason: 'creature' };
            }
        }

        return { allowed: true, reason: null };
    }

    /** Versión corta de `canWalk` para cuando sólo interesa el sí o el no. */
    canWalkBoolean(from, to, options) {
        return this.canWalk(from, to, options).allowed;
    }

    // -----------------------------------------------------------------------
    // Visibilidad entre plantas
    // -----------------------------------------------------------------------

    /**
     * ¿Se ve desde una planta a otra?
     *
     * La regla de Tibia, verificada en `creature.cpp::canSee`:
     *
     *   - Plantas 0..7 (superficie): se ve TODA la superficie y NADA del subsuelo.
     *     Por eso desde la calle no se ve lo que pasa en una mazmorra.
     *   - Plantas 8..15 (subsuelo): se ve dos plantas arriba y dos abajo. Es lo que
     *     permite ver el piso de arriba desde un sótano y al revés.
     */
    canSee(fromZ, toZ) {
        if (fromZ <= SURFACE_MAX_Z) {
            return toZ <= SURFACE_MAX_Z;
        }
        return Math.abs(fromZ - toZ) <= UNDERGROUND_VISIBLE_FLOORS;
    }

    /**
     * Desplazamiento en XY de una planta respecto a la cámara.
     *
     * ESTE DESPLAZAMIENTO ES LA SENSACIÓN DE PROFUNDIDAD del 2.5D: es lo que hace
     * que al bajar una planta el mundo se desplace y se vea "por debajo" del piso
     * superior. En The Forgotten Server lo calcula `Map::getOffsetZ`.
     *
     * PENDIENTE: la tabla de desplazamientos exacta no se ha verificado contra el
     * código de TFS, así que aquí se devuelve cero en vez de inventar números. Es
     * el punto que hay que rellenar al construir el renderer, leyendo
     * `map.cpp::getOffsetZ`. Devolver ceros es inofensivo; devolver valores
     * inventados daría un 2.5D que se ve mal y sería difícil de diagnosticar.
     */
    getFloorOffset(z, cameraZ) {
        return { x: 0, y: 0 };
    }

    // -----------------------------------------------------------------------
    // Recorrido e información
    // -----------------------------------------------------------------------

    /**
     * Quita un tile del mapa, devolviéndolo al estado disperso.
     *
     * Es lo que hace falta para BORRAR: al quitar un muro desde un editor, el tile
     * tiene que volver a ser suelo por defecto y no un tile vacío. La diferencia
     * importa: un tile vacío es una celda que existe y no tiene suelo, o sea un
     * agujero por el que no se puede caminar; suelo por defecto es una celda normal.
     *
     * @returns {boolean} si había algo que quitar
     */
    removeTile(x, y, z) {
        if (!this.inBounds(x, y, z)) {
            return false;
        }

        const chunkKey = this._chunkKey(
            Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE), z);
        const chunk = this.chunks.get(chunkKey);
        if (!chunk) {
            return false;
        }

        const index = (y % CHUNK_SIZE) * CHUNK_SIZE + (x % CHUNK_SIZE);
        if (!chunk[index]) {
            return false;
        }

        // Un tile con criaturas no se puede quitar sin dejarlas en el aire.
        if (chunk[index].creatures.length > 0) {
            return false;
        }

        chunk[index] = null;
        this.explicitTiles -= 1;

        // Si el chunk se queda sin nada vivo se elimina entero, para que la tabla de
        // chunks tampoco crezca.
        if (chunk.every((entry) => entry === null)) {
            this.chunks.delete(chunkKey);
        }

        return true;
    }

    /**
     * Devuelve al estado disperso los tiles que quedaron vacíos.
     *
     * Es necesario porque crear una criatura materializa su tile: un jugador que
     * recorre medio mapa deja cientos de tiles detrás, vacíos e idénticos al suelo
     * por defecto. Sin esta limpieza el consumo crecería con el TIEMPO DE JUEGO en
     * vez de con el CONTENIDO del mundo, que es justo lo que el almacenamiento
     * disperso venía a evitar.
     *
     * Un tile sólo se descarta si no le queda nada propio: ni criaturas, ni items,
     * ni banderas, ni casa, y su suelo es el de por defecto de su planta. Cualquier
     * cosa que lo distinga lo mantiene vivo.
     *
     * @returns {number} cuántos tiles se descartaron
     */
    compact() {
        let removed = 0;

        this.chunks.forEach((chunk, key) => {
            let alive = 0;

            for (let index = 0; index < chunk.length; index += 1) {
                const tile = chunk[index];
                if (!tile) {
                    continue;
                }

                if (tile.creatures.length > 0 ||
                    tile.downItems.length > 0 ||
                    tile.topItems.length > 0 ||
                    tile.flags !== 0 ||
                    tile.houseId !== 0) {
                    alive += 1;
                    continue;
                }

                const defaultGround = this.groundFor(tile.z);
                if (defaultGround && tile.ground &&
                    tile.ground.typeId === defaultGround.typeId) {
                    chunk[index] = null;
                    this.explicitTiles -= 1;
                    removed += 1;
                } else {
                    alive += 1;
                }
            }

            // Un chunk sin nada vivo se elimina entero, para que la tabla de
            // chunks tampoco crezca.
            if (alive === 0) {
                this.chunks.delete(key);
            }
        });

        return removed;
    }

    /** Recorre sólo los tiles explícitos. Los demás son suelo por defecto. */
    forEachTile(callback) {
        this.chunks.forEach((chunk) => {
            for (let index = 0; index < chunk.length; index += 1) {
                const tile = chunk[index];
                if (tile) {
                    callback(tile, tile.z);
                }
            }
        });
    }

    getWaypoint(name) {
        return this.waypoints.get(name) || null;
    }

    setWaypoint(name, position) {
        this.waypoints.set(name, Position.from(position));
        return this;
    }

    addSpawn(spawn) {
        this.spawns.push(spawn);
        return this;
    }

    /**
     * Coloca un NPC en el mapa.
     *
     * Se guardan como LISTA y no como criaturas vivas: el mapa es un archivo, y los NPC
     * son criaturas. El motor las crea al arrancar a partir de estas posiciones, igual que
     * hace con los spawns de monstruos. Guardar aquí la criatura haría que el mapa no se
     * pudiera guardar sin arrastrar el estado de la partida.
     */
    addNpc(placement) {
        this.npcPlacements.push(placement);
        return this;
    }

    /** Dónde está colocado un NPC, para poder moverlo o quitarlo. */
    getNpc(name) {
        return this.npcPlacements.find((entry) => entry.name === name) || null;
    }

    stats() {
        return {
            name: this.name,
            size: this.width + 'x' + this.height + 'x' + this.floors,
            chunks: this.chunks.size,
            explicitTiles: this.explicitTiles,
            // Cuántas celdas habría que materializar para guardar el mapa entero.
            // La diferencia con explicitTiles es el ahorro del almacenamiento
            // disperso, y conviene tenerlo a la vista.
            cellsIfMaterialized: this.width * this.height * this.floors,
            waypoints: this.waypoints.size,
            spawns: this.spawns.length,
            npcs: this.npcPlacements.length
        };
    }
}

module.exports = {
    GameMap,
    CHUNK_SIZE,
    SURFACE_MAX_Z,
    UNDERGROUND_VISIBLE_FLOORS,
    TILE_FLAGS,
    MAX_STACKPOS,
    Position
};
