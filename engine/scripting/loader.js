'use strict';

/**
 * Carga de los módulos de contenido.
 *
 * Un módulo de contenido es un archivo `.js` bajo `data/scripts/` o
 * `data/monsters/` que exporta una definición. Tres formas válidas:
 *
 *   1. Un objeto:
 *        module.exports = { type: 'action', ids: [1948], onUse(player) { ... } };
 *
 *   2. Un array, para varios registros en el mismo archivo:
 *        module.exports = [ { type: 'action', ... }, { type: 'monster', ... } ];
 *
 *   3. Una función, como escape para lo que no encaje:
 *        module.exports = ({ action, monster }) => { action({ ... }); };
 *
 * La forma 1 es la normal. La 3 existe porque un datapack acaba necesitando
 * generar definiciones en bucle, y es mejor darle una puerta que obligarle a
 * exportar un array construido a mano.
 *
 * Para desactivar un módulo basta con renombrarlo: sólo se carga lo que termina
 * en `.js`, así que `lever.js.off` queda ignorado sin borrar nada.
 */

const fs = require('fs');
const path = require('path');

/** Lista recursiva de módulos `.js`, en orden de ruta para que sea determinista. */
function listModules(dir) {
    if (!fs.existsSync(dir)) {
        return [];
    }

    const found = [];
    const walk = (current) => {
        fs.readdirSync(current, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach((entry) => {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                } else if (entry.name.endsWith('.js')) {
                    found.push(full);
                }
            });
    };
    walk(dir);

    return found;
}

/**
 * Convierte lo exportado por un módulo en una lista de definiciones.
 */
function normalizeExports(exported) {
    if (typeof exported === 'function') {
        const definitions = [];
        const add = (type) => (definition) => {
            definitions.push({ ...definition, type: type });
        };

        const returned = exported({
            action: add('action'),
            movement: add('movement'),
            talkAction: add('talkaction'),
            monster: add('monster')
        });

        // Si además devuelve definiciones, se suman: permite mezclar las dos
        // formas sin sorpresas.
        if (Array.isArray(returned)) {
            return definitions.concat(returned);
        }
        return definitions;
    }

    if (Array.isArray(exported)) {
        return exported;
    }

    if (exported && typeof exported === 'object') {
        return [exported];
    }

    return [];
}

/**
 * Carga en el registro todos los módulos de los directorios indicados.
 *
 * @param {Object} registry instancia de ScriptRegistry
 * @param {Object} options
 * @param {string[]} options.directories
 * @param {string} options.rootDir para calcular rutas relativas en los informes
 * @param {Object} options.logger
 * @param {string} [options.onError] 'abort' (por defecto) | 'skip'
 * @param {boolean} [options.verbose]
 * @returns {{files: number, definitions: number, byKind: Object}}
 */
function loadContent(registry, options) {
    const log = options.logger;
    const onError = options.onError === 'skip' ? 'skip' : 'abort';
    const byKind = { action: 0, movement: 0, talkaction: 0, monster: 0, npc: 0, event: 0 };

    let files = 0;
    let definitions = 0;

    options.directories.forEach((dir) => {
        listModules(dir).forEach((file) => {
            const relative = path.relative(options.rootDir, file).split(path.sep).join('/');

            try {
                // Se descarta la caché de require para que recargar contenido en
                // caliente funcione de verdad: sin esto, `require` devolvería el
                // módulo antiguo y la recarga sería una mentira.
                delete require.cache[require.resolve(file)];

                const exported = require(file);
                const list = normalizeExports(exported);

                if (list.length === 0) {
                    throw new Error('el modulo no exporta ninguna definicion');
                }

                list.forEach((definition) => {
                    const result = registry.register(definition, relative);
                    byKind[result.kind] += result.count;
                    definitions += result.count;
                });

                files += 1;
                if (options.verbose) {
                    log.debug('contenido cargado: ' + relative + ' (' + list.length + ' definicion/es)');
                }
            } catch (error) {
                if (onError === 'skip') {
                    log.error('modulo descartado (' + relative + '): ' + error.message);
                } else {
                    // El mensaje lleva la ruta porque, con cientos de módulos, un
                    // error sin ubicación no es accionable.
                    error.message = 'en ' + relative + ': ' + error.message;
                    throw error;
                }
            }
        });
    });

    return { files: files, definitions: definitions, byKind: byKind };
}

module.exports = { loadContent, listModules, normalizeExports };
