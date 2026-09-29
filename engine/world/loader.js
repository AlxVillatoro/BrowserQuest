'use strict';

/**
 * Carga y VALIDACIÓN del formato de mapa interno.
 *
 * El formato es JSON, y es deliberadamente sencillo y legible:
 *
 *   - Se puede revisar en un diff. Un formato binario obliga a tener la
 *     herramienta delante para saber qué cambió.
 *   - Sólo se declaran las EXCEPCIONES al suelo por defecto de cada planta. Un
 *     mapa de 2048×2048 no enumera ocho millones de celdas de hierba.
 *   - El importador/exportador de OTBM se conectará aquí: OTBM como frontera,
 *     este formato en tiempo de ejecución. Es la estrategia de ARQUITECTURA.md.
 *
 * Sobre la validación: deliberadamente NO se valida con XSD. El esquema real de
 * estos archivos no es expresable de forma útil, y un XSD diría "documento
 * válido" sin decir "el juego funcionará". Los fallos que de verdad ocurren son
 * semánticos —un item que no existe, un spawn de un monstruo que no está
 * definido, una coordenada fuera del mapa— y se detectan aquí.
 *
 * La validación **acumula todos los errores** en vez de abortar en el primero.
 * Corregir un mapa de mil tiles de uno en uno, recompilando entre cada uno, es
 * exactamente el tipo de fricción que hace que nadie valide nada.
 */

const fs = require('fs');
const { GameMap } = require('./map');
const { Item } = require('./item');
const { Position } = require('./position');
const { TILE_FLAGS } = require('./tile');

const FORMAT = 'avillatoro-map';
const SUPPORTED_VERSIONS = [1];

/** Mapa de nombre de bandera a bit, derivado de la tabla del motor. */
const FLAG_NAMES = {
    protectionZone: TILE_FLAGS.PROTECTION_ZONE,
    noPvp: TILE_FLAGS.NO_PVP,
    noLogout: TILE_FLAGS.NO_LOGOUT,
    pvpZone: TILE_FLAGS.PVP_ZONE,
    house: TILE_FLAGS.HOUSE
};

class ValidationReport {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    error(message, where) {
        this.errors.push({ message: message, where: where || null });
    }

    warning(message, where) {
        this.warnings.push({ message: message, where: where || null });
    }

    get ok() {
        return this.errors.length === 0;
    }

    format() {
        const lines = [];
        this.errors.forEach((e) => {
            lines.push('  ERROR   ' + (e.where ? e.where + ': ' : '') + e.message);
        });
        this.warnings.forEach((w) => {
            lines.push('  AVISO   ' + (w.where ? w.where + ': ' : '') + w.message);
        });
        return lines.join('\n');
    }
}

function where(x, y, z) {
    return '(' + x + ',' + y + ',' + z + ')';
}

/**
 * Convierte la entrada `items` de un tile en instancias de Item.
 *
 * Acepta un número suelto (el caso común) o un objeto con cantidad y atributos.
 */
function buildItem(entry, itemTypes, report, location) {
    const descriptor = (typeof entry === 'object' && entry !== null) ? entry : { id: entry };
    const typeId = Number(descriptor.id);

    if (Number.isNaN(typeId)) {
        report.error('item con id no numerico: ' + JSON.stringify(entry), location);
        return null;
    }

    const definition = itemTypes.get(typeId);
    if (!definition) {
        // Éste es el error semántico más común al escribir un mapa a mano.
        report.error('no existe ningun item con id ' + typeId +
            '. Revisa data/items/items.xml', location);
        return null;
    }

    return new Item(definition, {
        count: descriptor.count === undefined ? 1 : Number(descriptor.count),
        attributes: descriptor.attributes || {}
    });
}

/**
 * Carga un mapa desde un archivo JSON.
 *
 * @param {string} filepath
 * @param {Object} options
 * @param {Map<number, Object>} options.itemTypes definiciones de items.xml
 * @param {Map<string, Object>} [options.monsterTypes] para validar los spawns
 * @param {Object} [options.logger]
 * @returns {{map: GameMap|null, report: ValidationReport}}
 */
function loadMap(filepath, options) {
    const report = new ValidationReport();

    if (!fs.existsSync(filepath)) {
        report.error('no se encontro el archivo de mapa');
        return { map: null, report: report };
    }

    let data;
    try {
        data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch (error) {
        report.error('el mapa no es JSON valido: ' + error.message);
        return { map: null, report: report };
    }

    return buildMap(data, options);
}

/**
 * Construye y valida un mapa ya deserializado.
 *
 * Está separado de `loadMap` para poder validar un objeto en memoria sin pasar
 * por disco: es lo que permite comprobar que la validación informa de TODOS los
 * errores a la vez, que es justo lo que no se puede ver leyendo un archivo.
 */
function buildMap(data, options) {
    const opts = options || {};
    const itemTypes = opts.itemTypes || new Map();
    const monsterTypes = opts.monsterTypes || new Map();
    const report = new ValidationReport();

    // --- Cabecera ---------------------------------------------------------
    if (data.format !== FORMAT) {
        report.error('formato inesperado: ' + JSON.stringify(data.format) +
            '. Se esperaba "' + FORMAT + '"');
    }
    if (SUPPORTED_VERSIONS.indexOf(data.version) === -1) {
        report.error('version de formato no soportada: ' + JSON.stringify(data.version) +
            '. Soportadas: ' + SUPPORTED_VERSIONS.join(', '));
    }
    if (!report.ok) {
        return { map: null, report: report };
    }

    const map = new GameMap({
        name: data.name,
        width: Number(data.width),
        height: Number(data.height),
        floors: Number(data.floors),
        logger: opts.logger
    });

    if (!(map.width > 0) || !(map.height > 0) || !(map.floors > 0)) {
        report.error('el mapa necesita width, height y floors mayores que cero');
        return { map: null, report: report };
    }

    // --- Suelo por defecto por planta -------------------------------------
    const groundByZ = data.defaultGround || {};
    Object.keys(groundByZ).forEach((zKey) => {
        const z = Number(zKey);
        const definition = itemTypes.get(Number(groundByZ[zKey]));

        if (!definition) {
            report.error('el suelo por defecto de la planta ' + z +
                ' apunta al item ' + groundByZ[zKey] + ', que no existe');
            return;
        }
        map.setDefaultGround(z, new Item(definition, { count: 1 }));
    });

    if (data.fallbackGround !== undefined) {
        const definition = itemTypes.get(Number(data.fallbackGround));
        if (!definition) {
            report.error('fallbackGround apunta al item ' + data.fallbackGround + ', que no existe');
        } else {
            map.setFallbackGround(new Item(definition, { count: 1 }));
        }
    } else if (map.defaultGround.size === 0) {
        report.warning('el mapa no declara ningun suelo por defecto: ' +
            'las celdas sin tile explicito no seran transitables');
    }

    // --- Tiles -------------------------------------------------------------
    const tiles = data.tiles || [];

    tiles.forEach((entry, index) => {
        const x = Number(entry.x);
        const y = Number(entry.y);
        const z = Number(entry.z);
        const location = where(x, y, z);

        if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
            report.error('tile #' + index + ' sin coordenadas validas');
            return;
        }
        if (!map.inBounds(x, y, z)) {
            report.error('tile fuera del mapa (el mapa es ' +
                map.width + 'x' + map.height + 'x' + map.floors + ')', location);
            return;
        }

        const tile = map.getOrCreateTile(x, y, z);

        if (entry.ground !== undefined) {
            const ground = buildItem(entry.ground, itemTypes, report, location);
            if (ground) {
                tile.setGround(ground);
            }
        }

        (entry.items || []).forEach((itemEntry) => {
            const item = buildItem(itemEntry, itemTypes, report, location);
            if (item) {
                tile.addItem(item);
            }
        });

        (entry.flags || []).forEach((flagName) => {
            const bit = FLAG_NAMES[flagName];
            if (bit === undefined) {
                report.error('bandera de tile desconocida: "' + flagName +
                    '". Validas: ' + Object.keys(FLAG_NAMES).join(', '), location);
                return;
            }
            tile.setFlag(bit, true);
        });

        if (entry.houseId !== undefined) {
            tile.houseId = Number(entry.houseId);
        }
    });

    // --- Waypoints --------------------------------------------------------
    const waypoints = data.waypoints || {};
    Object.keys(waypoints).forEach((name) => {
        const position = Position.from(waypoints[name]);
        if (!map.inBounds(position.x, position.y, position.z)) {
            report.error('el waypoint "' + name + '" cae fuera del mapa', position.toString());
            return;
        }
        map.setWaypoint(name, position);
    });

    // --- Spawns -----------------------------------------------------------
    (data.spawns || []).forEach((entry, index) => {
        const location = where(entry.x, entry.y, entry.z);

        if (!map.inBounds(Number(entry.x), Number(entry.y), Number(entry.z))) {
            report.error('spawn #' + index + ' fuera del mapa', location);
            return;
        }
        if (!entry.monster) {
            report.error('spawn #' + index + ' sin monstruo', location);
            return;
        }
        if (monsterTypes.size > 0 && !monsterTypes.has(entry.monster)) {
            // Error semántico típico: el monstruo se llama distinto o no existe.
            report.error('el spawn apunta al monstruo "' + entry.monster +
                '", que no esta definido en data/monsters/', location);
            return;
        }

        map.addSpawn({
            x: Number(entry.x),
            y: Number(entry.y),
            z: Number(entry.z),
            monster: entry.monster,
            interval: entry.interval === undefined ? 60000 : Number(entry.interval),
            radius: entry.radius === undefined ? 1 : Number(entry.radius)
        });
    });

    // --- Comprobaciones de coherencia -------------------------------------
    // Un mapa sin ninguna celda transitable es casi siempre un error de
    // configuracion del suelo, no un mapa de solo paredes.
    let walkableProbes = 0;
    for (let x = 0; x < map.width && walkableProbes === 0; x += 1) {
        for (let y = 0; y < map.height && walkableProbes === 0; y += 1) {
            if (map.isWalkable(x, y, 0)) {
                walkableProbes += 1;
            }
        }
    }
    if (walkableProbes === 0 && map.width > 0 && map.height > 0) {
        report.warning('en la planta 0 no hay ninguna celda transitable');
    }

    return { map: map, report: report };
}

module.exports = { loadMap, buildMap, ValidationReport, FORMAT, SUPPORTED_VERSIONS, FLAG_NAMES };
