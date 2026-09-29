/**
 * El mapa que se está editando.
 *
 * Trabaja sobre el JSON TAL Y COMO viaja por el API, no sobre las clases del motor.
 * Es deliberado: el editor es una herramienta del datapack y no debe cargar el motor
 * entero —con sus monstruos, sus temporizadores y su base de datos— para poder pintar
 * un muro. Lo único que comparte con el motor es el FORMATO, que es el contrato.
 *
 * ADEMÁS SIRVE DE ADAPTADOR para `drawlist.js`, que es el módulo del CLIENTE. Ese
 * módulo espera un mundo con `floors()`, `getTile()` y `creatures`, y da igual que
 * detrás haya un cliente conectado o un archivo abierto. Que el mismo código de
 * dibujo sirva para los dos es la prueba de que la separación está bien hecha: si el
 * editor necesitara su propio renderer, acabarían discrepando y un mapa se vería bien
 * en el editor y mal en el juego.
 */

/** El separador de claves, igual que en el cliente. */
function key(x, y, z) {
    return x + ',' + y + ',' + z;
}

export class EditorMap {
    /**
     * @param {Object} raw el JSON del mapa, tal y como lo devuelve el API
     * @param {Map<number, Object>} itemTypes definiciones de items.xml, por id
     */
    constructor(raw, itemTypes) {
        this.raw = raw;
        this.itemTypes = itemTypes || new Map();

        this.name = raw.name;
        this.width = raw.width;
        this.height = raw.height;
        this.floors = raw.floors;

        this.defaultGround = raw.defaultGround || {};
        this.fallbackGround = raw.fallbackGround === undefined ? 0 : raw.fallbackGround;

        /** Los tiles explícitos, por clave. */
        this.tiles = new Map();

        (raw.tiles || []).forEach((tile) => {
            this.tiles.set(key(tile.x, tile.y, tile.z), {
                x: tile.x,
                y: tile.y,
                z: tile.z,
                ground: tile.ground === undefined ? null : tile.ground,
                items: (tile.items || []).map((item) => ({ ...item })),
                flags: (tile.flags || []).slice()
            });
        });

        /** Las claves que se han tocado desde el último guardado. */
        this.dirty = new Set();

        /** Lo que el cliente espera: aquí no hay criaturas. */
        this.creatures = new Map();
    }

    // -----------------------------------------------------------------------
    // Consulta
    // -----------------------------------------------------------------------

    inBounds(x, y, z) {
        return x >= 0 && y >= 0 && z >= 0 &&
            x < this.width && y < this.height && z < this.floors;
    }

    /** El suelo por defecto de una planta. */
    defaultGroundFor(z) {
        if (this.defaultGround[z] !== undefined) {
            return this.defaultGround[z];
        }
        return this.fallbackGround;
    }

    /** El tile explícito, o null si sólo hay suelo por defecto. */
    tileAt(x, y, z) {
        return this.tiles.get(key(x, y, z)) || null;
    }

    /** El suelo que se ve en una celda: el explícito o el de su planta. */
    groundAt(x, y, z) {
        const tile = this.tileAt(x, y, z);
        if (tile && tile.ground !== null) {
            return tile.ground;
        }
        return this.defaultGroundFor(z);
    }

    definitionOf(typeId) {
        return this.itemTypes.get(Number(typeId)) || null;
    }

    isAlwaysOnTop(typeId) {
        const definition = this.definitionOf(typeId);
        if (!definition || !definition.attributes) {
            return false;
        }
        const raw = definition.attributes.alwaysOnTop;
        return raw === true || raw === 1 || raw === '1' || raw === 'true';
    }

    // -----------------------------------------------------------------------
    // La interfaz que necesita `drawlist.js`
    // -----------------------------------------------------------------------

    now() {
        return 0;
    }

    creaturePosition(creature) {
        return { x: creature.x, y: creature.y, moving: false };
    }

    /** Las plantas que tienen algo que dibujar. */
    floors() {
        const found = new Set();

        // Sólo se dibujan las plantas que TIENEN TILES EXPLÍCITOS. Dibujar una planta
        // entera de suelo por defecto sería pintar 4096 celdas idénticas, y además
        // escondería lo que se está editando debajo del suelo de arriba.
        this.tiles.forEach((tile) => {
            if (!this.isVoid(tile)) {
                found.add(tile.z);
            }
        });

        return Array.from(found).sort((a, b) => b - a);
    }

    /** Un tile sin suelo propio, sin items y sin banderas no aporta nada al dibujo. */
    isVoid(tile) {
        return tile.ground === null && tile.items.length === 0 && tile.flags.length === 0;
    }

    /**
     * Un tile, en el formato que espera el orden de dibujo.
     *
     * Devuelve `null` para las celdas que NO tienen nada explícito, y eso es lo que
     * hace que el editor sea manejable: el suelo por defecto lo pinta el editor como
     * un fondo de un solo rectángulo, y la lista de dibujo sólo lleva lo que alguien
     * puso. Dibujar las 4096 celdas de suelo por defecto de una planta sería pintar
     * lo mismo 4096 veces y además taparía lo que se está editando.
     *
     * `downCount` se CALCULA aquí a partir de la bandera `alwaysOnTop` de cada item.
     * Es la misma regla que aplica el motor al colocar un item en un tile, y tiene que
     * ser la misma: si el editor dibujara las mesas por debajo de los muñecos y el
     * juego por encima, el mapa se vería distinto en cada sitio.
     */
    getTile(x, y, z) {
        const tile = this.tileAt(x, y, z);
        if (!tile || this.isVoid(tile)) {
            return null;
        }

        const ground = tile.ground !== null ? tile.ground : this.defaultGroundFor(z);

        const down = [];
        const top = [];

        tile.items.forEach((item) => {
            const definition = this.definitionOf(item.id);
            const entry = {
                id: item.id,
                count: item.count === undefined ? 1 : item.count,
                instanceId: 0,
                name: definition ? definition.name : 'item ' + item.id
            };

            if (this.isAlwaysOnTop(item.id)) {
                top.push(entry);
            } else {
                down.push(entry);
            }
        });

        return {
            x: x, y: y, z: z,
            ground: ground,
            items: down.concat(top),
            downCount: down.length,
            flags: tile.flags,
            /** El suelo se pintó a mano, no es el de la planta. */
            ownGround: tile.ground !== null
        };
    }

    // -----------------------------------------------------------------------
    // Edición
    // -----------------------------------------------------------------------

    /** Un tile que se pueda modificar, creándolo si no existe. */
    editableTile(x, y, z) {
        const k = key(x, y, z);
        let tile = this.tiles.get(k);

        if (!tile) {
            tile = { x: x, y: y, z: z, ground: null, items: [], flags: [] };
            this.tiles.set(k, tile);
        }

        return tile;
    }

    markDirty(x, y, z) {
        this.dirty.add(key(x, y, z));
    }

    /** Pone un item como único contenido de un tile. */
    paintItem(x, y, z, typeId, count) {
        const tile = this.editableTile(x, y, z);
        tile.items = [{ id: Number(typeId) }];
        if (count !== undefined && count !== 1) {
            tile.items[0].count = Number(count);
        }
        this.markDirty(x, y, z);
    }

    /** Añade un item al tile, sin quitar los que hubiera. */
    addItem(x, y, z, typeId) {
        const tile = this.editableTile(x, y, z);
        tile.items.push({ id: Number(typeId) });
        this.markDirty(x, y, z);
    }

    /** Quita el último item del tile. */
    popItem(x, y, z) {
        const tile = this.tileAt(x, y, z);
        if (!tile || tile.items.length === 0) {
            return false;
        }
        tile.items.pop();
        this.markDirty(x, y, z);
        return true;
    }

    /** Pinta un suelo distinto al de la planta. */
    paintGround(x, y, z, typeId) {
        const tile = this.editableTile(x, y, z);
        tile.ground = Number(typeId);
        this.markDirty(x, y, z);
    }

    /** Pone una bandera. */
    toggleFlag(x, y, z, flagName) {
        const tile = this.editableTile(x, y, z);
        const index = tile.flags.indexOf(flagName);

        if (index === -1) {
            tile.flags.push(flagName);
        } else {
            tile.flags.splice(index, 1);
        }

        this.markDirty(x, y, z);
    }

    /**
     * Borra el tile: vuelve a ser suelo por defecto.
     *
     * Se marca como sucio aunque el tile desaparezca, porque el API necesita recibir
     * una edición VACÍA para saber que hay que borrarlo. Si no se marcara, borrar no
     * se guardaría nunca.
     */
    erase(x, y, z) {
        this.tiles.delete(key(x, y, z));
        this.markDirty(x, y, z);
    }

    /**
     * Lo que hay que mandar al servidor.
     *
     * Se mandan LAS CLAVES TOCADAS, no el mapa entero: el servidor ya tiene el mapa y
     * sólo necesita saber qué celdas cambian. Mandar los 28 tiles de un mapa pequeño
     * da igual, pero mandar los de uno de 2048x2048 en cada trazo no.
     */
    edits() {
        const edits = [];

        this.dirty.forEach((k) => {
            const parts = k.split(',');
            const x = Number(parts[0]);
            const y = Number(parts[1]);
            const z = Number(parts[2]);

            const tile = this.tiles.get(k);

            // Un tile que ya no existe es un BORRADO, y se representa con una edición
            // sin suelo, sin items y sin banderas.
            if (!tile || this.isVoid(tile)) {
                edits.push({ x: x, y: y, z: z });
                return;
            }

            const edit = { x: x, y: y, z: z };

            if (tile.ground !== null) {
                edit.ground = tile.ground;
            }
            if (tile.items.length > 0) {
                edit.items = tile.items.map((item) => ({ ...item }));
            }
            if (tile.flags.length > 0) {
                edit.flags = tile.flags.slice();
            }

            edits.push(edit);
        });

        return edits;
    }

    clearDirty() {
        this.dirty.clear();
    }

    stats() {
        let withItems = 0;
        let withFlags = 0;

        this.tiles.forEach((tile) => {
            if (tile.items.length > 0) {
                withItems += 1;
            }
            if (tile.flags.length > 0) {
                withFlags += 1;
            }
        });

        return {
            explicitTiles: this.tiles.size,
            withItems: withItems,
            withFlags: withFlags,
            pending: this.dirty.size,
            cellsIfMaterialized: this.width * this.height * this.floors
        };
    }
}

export { key };
