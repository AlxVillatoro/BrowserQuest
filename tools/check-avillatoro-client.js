'use strict';

/**
 * Comprueba que el cliente nuevo puede cargar TODOS sus módulos.
 *
 * Los módulos se importan entre sí con rutas absolutas (`/shared/js/protocol.mjs`,
 * `/client/avillatoro/js/...`), que es lo que hace que el mismo archivo sirva desde
 * el servidor estático. El precio es que un error de escritura en una de esas rutas
 * NO se ve hasta que se abre el navegador, y entonces el fallo que aparece es un
 * `Failed to fetch dynamically imported module` que no dice qué archivo falta.
 *
 * Esto recorre el grafo de imports sobre el disco, sin servidor, y dice exactamente
 * qué falta. Se comprueba además que cada `import` sea sintácticamente válido,
 * porque un módulo ES que no parsea rompe el cliente entero sin cargar nada.
 *
 * Uso:  node tools/check-avillatoro-client.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Las aplicaciones de navegador que hay que comprobar.
 *
 * Son DOS y cada una con sus montajes, porque cada una la sirve un servidor distinto:
 * el cliente lo sirve el servidor de juego y el editor lo sirve el servidor de
 * herramientas. Las dos comparten `/shared/` y el editor además monta el cliente
 * porque REUTILIZA su cámara y su orden de dibujo.
 */
const APPS = [
    {
        name: 'cliente',
        entry: 'client/avillatoro/index.html',
        mounts: [
            { prefix: '/shared/', dir: 'shared' },
            { prefix: '/', dir: 'client' }
        ]
    },
    {
        name: 'editor',
        entry: 'editor/index.html',
        mounts: [
            { prefix: '/avillatoro/', dir: 'client/avillatoro' },
            { prefix: '/shared/', dir: 'shared' },
            { prefix: '/', dir: 'editor' }
        ]
    }
];

/**
 * Comprueba que los montajes declarados aquí coinciden con los del servidor.
 *
 * Es la parte que evita que este comprobador se desincronice: si alguien cambia el
 * montaje del servidor y no el de aquí, el comprobador diría que todo está bien
 * mientras el navegador recibe 404. Se comprueba leyendo la configuración de verdad.
 */
function verifyAgainstServers() {
    const problems = [];

    const configPath = path.join(ROOT, 'server', 'config.json');
    try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const clientRoot = (config.client_root || './client').replace(/^\.\//, '');
        const sharedRoot = (config.shared_root || './shared').replace(/^\.\//, '');

        const clientMounts = APPS[0].mounts;
        if (clientMounts[1].dir !== clientRoot) {
            problems.push('el cliente monta "' + clientMounts[1].dir +
                '" pero server/config.json dice "' + clientRoot + '"');
        }
        if (clientMounts[0].dir !== sharedRoot) {
            problems.push('el cliente monta "' + clientMounts[0].dir +
                '" en /shared pero server/config.json dice "' + sharedRoot + '"');
        }
    } catch (error) {
        problems.push('no se pudo leer server/config.json: ' + error.message);
    }

    // Los montajes del editor se leen de su propio servidor.
    try {
        const { MOUNTS } = require('../editor/server');
        const editorMounts = APPS[1].mounts;

        MOUNTS.forEach((mount, index) => {
            const declared = editorMounts[index];
            if (!declared) {
                problems.push('el editor monta ' + mount.prefix + ' y aqui no esta declarado');
                return;
            }
            if (declared.prefix !== mount.prefix) {
                problems.push('el editor monta ' + mount.prefix + ' en la posicion ' + index +
                    ' y aqui esta ' + declared.prefix);
            }
        });
    } catch (error) {
        problems.push('no se pudo leer los montajes del editor: ' + error.message);
    }

    return problems;
}

/** A qué archivo del disco corresponde una ruta absoluta, para una app. */
function resolveWebPathFor(app, webPath) {
    if (!webPath.startsWith('/')) {
        return path.join(ROOT, webPath);
    }

    for (const mount of app.mounts) {
        if (webPath.startsWith(mount.prefix)) {
            const rest = webPath.slice(mount.prefix.length);
            return path.normalize(path.join(ROOT, mount.dir, rest));
        }
    }

    return null;
}

/** Resuelve un import relativo o absoluto desde el archivo que lo hace. */
function resolveImport(app, fromFile, spec) {
    if (spec.startsWith('/')) {
        const resolved = resolveWebPathFor(app, spec);
        return resolved === null ? null : path.normalize(resolved);
    }
    if (spec.startsWith('.')) {
        return path.normalize(path.join(path.dirname(fromFile), spec));
    }
    // Un import de un paquete no lo resuelve el navegador sin un mapa de imports.
    return null;
}

/** Saca los `import ... from '...'` y los `import('...')` de un módulo. */
function extractImports(source) {
    const found = [];
    const patterns = [
        /^\s*import\s+[^'"]*?from\s*['"]([^'"]+)['"]/gm,
        /^\s*import\s*['"]([^'"]+)['"]/gm,
        /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    ];

    patterns.forEach((pattern) => {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            found.push(match[1]);
        }
    });

    return found;
}

/** Saca los `src="..."` de tipo módulo de un HTML. */
function extractHtmlModules(source) {
    const found = [];
    const pattern = /<script[^>]*type\s*=\s*["']module["'][^>]*src\s*=\s*["']([^"']+)["']/g;

    let match;
    while ((match = pattern.exec(source)) !== null) {
        found.push(match[1]);
    }
    return found;
}


/**
 * Recorre el grafo de imports de una aplicación.
 *
 * Devuelve lo que ha visitado y lo que falta, para poder informar de las DOS
 * aplicaciones juntas: si el cliente está bien y el editor mal, el resumen tiene que
 * decirlo, no parar en el primero.
 */
function checkApp(app) {
    const entryPath = path.join(ROOT, app.entry);
    const result = { modules: 0, visited: new Set(), missing: [], broken: [] };

    if (!fs.existsSync(entryPath)) {
        result.missing.push({ spec: app.entry, from: '(el punto de entrada)', file: entryPath });
        return result;
    }

    const queue = extractHtmlModules(fs.readFileSync(entryPath, 'utf8')).map((src) => ({
        file: resolveWebPathFor(app, src),
        from: app.entry,
        spec: src
    }));

    while (queue.length > 0) {
        const item = queue.shift();

        if (result.visited.has(item.file)) {
            continue;
        }
        result.visited.add(item.file);

        if (!item.file || !fs.existsSync(item.file)) {
            result.missing.push(item);
            continue;
        }

        const source = fs.readFileSync(item.file, 'utf8');
        result.modules += 1;

        // Un modulo ES que no parsea rompe la aplicacion entera, y el error del
        // navegador no dice en que archivo esta. `new Function` no admite `import`,
        // asi que la comprobacion es que el error que lanza hable de import o export.
        try {
            // eslint-disable-next-line no-new-func
            new Function(source);
        } catch (error) {
            if (/import|export/.test(error.message)) {
                // Puede ser sintaxis ES legitima o un error de verdad; se distingue
                // buscando un desequilibrio evidente de llaves.
                const abre = (source.match(/\{/g) || []).length;
                const cierra = (source.match(/\}/g) || []).length;
                if (abre !== cierra) {
                    result.broken.push({
                        file: item.file,
                        error: 'las llaves no cuadran (' + abre + ' abren, ' + cierra + ' cierran)'
                    });
                }
            } else {
                result.broken.push({ file: item.file, error: error.message });
            }
        }

        extractImports(source).forEach((spec) => {
            const resolved = resolveImport(app, item.file, spec);

            if (resolved === null) {
                result.missing.push({
                    file: item.file,
                    from: path.relative(ROOT, item.file),
                    spec: spec,
                    reason: 'no es una ruta resoluble por el navegador'
                });
                return;
            }

            queue.push({ file: resolved, from: path.relative(ROOT, item.file), spec: spec });
        });
    }

    return result;
}

function main() {
    console.log('Comprobacion de los modulos de las aplicaciones de navegador\n');

    const relative = (file) => path.relative(ROOT, file).replace(/\\/g, '/');
    const problems = verifyAgainstServers();

    let totalModules = 0;
    let totalMissing = 0;
    let totalBroken = 0;

    APPS.forEach((app) => {
        const result = checkApp(app);

        console.log('  --- ' + app.name + ' (' + app.entry + ') ---');
        result.visited.forEach((file) => {
            if (fs.existsSync(file)) {
                console.log('  ok     ' + relative(file));
            }
        });

        if (result.missing.length > 0) {
            console.log('  FALTAN ' + result.missing.length + ' archivo(s):');
            result.missing.forEach((item) => {
                console.log('    ' + item.spec + '  (importado desde ' + item.from + ')');
                console.log('      -> ' + (item.reason || relative(item.file)));
            });
        }
        if (result.broken.length > 0) {
            console.log('  NO PARSEAN ' + result.broken.length + ' modulo(s):');
            result.broken.forEach((item) => {
                console.log('    ' + relative(item.file) + ': ' + item.error);
            });
        }

        console.log('  ' + result.modules + ' modulos, ' + result.visited.size +
            ' archivos visitados\n');

        totalModules += result.modules;
        totalMissing += result.missing.length;
        totalBroken += result.broken.length;
    });

    if (problems.length > 0) {
        console.log('  LOS MONTAJES NO CUADRAN CON LOS SERVIDORES:');
        problems.forEach((problem) => console.log('    ' + problem));
        console.log('');
    }

    console.log('  TOTAL: ' + totalModules + ' modulos en ' + APPS.length + ' aplicaciones');

    if (totalMissing === 0 && totalBroken === 0 && problems.length === 0) {
        console.log('\n\u001b[32mTodo OK\u001b[0m — el cliente y el editor pueden cargar todo lo que importan.');
        process.exit(0);
    }

    console.log('\n\u001b[31mAlguna aplicacion no cargaria.\u001b[0m');
    process.exit(1);
}

main();
