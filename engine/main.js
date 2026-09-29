#!/usr/bin/env node
'use strict';

/**
 * Punto de entrada del motor.
 *
 * De momento arranca, carga todo el contenido y sale. La capa de red llega en la
 * siguiente fase (ver ARQUITECTURA.md); hasta entonces este comando sirve como
 * comprobación de que el datapack carga entero.
 *
 * Uso:
 *   node engine/main.js                       # arranca y resume
 *   node engine/main.js --config otra.js      # otra configuración
 *   LOG_LEVEL=debug node engine/main.js       # con detalle de carga
 */

const path = require('path');
const { createEngine } = require('./core/engine');

function parseArgs(argv) {
    const args = { configFile: 'config.js', reload: false };
    for (let i = 2; i < argv.length; i += 1) {
        if (argv[i] === '--config' && argv[i + 1]) {
            args.configFile = argv[i + 1];
            i += 1;
        } else if (argv[i] === '--reload') {
            args.reload = true;
        }
    }
    return args;
}

function main() {
    const args = parseArgs(process.argv);
    const engine = createEngine({
        rootDir: path.resolve(__dirname, '..'),
        configFile: args.configFile,
        logLevel: process.env.LOG_LEVEL || 'info'
    });

    // Comprobación de que la recarga en caliente funciona de verdad: si el
    // cargador no descartase la caché de `require`, esto devolvería las mismas
    // definiciones y la recarga sería una mentira.
    if (args.reload) {
        const before = engine.stats.contentDefinitions;
        engine.reloadContent();
        const after = engine.stats.contentDefinitions;
        console.log('\n  recarga: ' + before + ' definiciones antes, ' + after + ' despues');
    }

    const s = engine.stats;
    console.log('');
    console.log('  Datapack cargado');
    console.log('  ----------------');
    console.log('  items definidos ......... ' + s.items);
    console.log('  vocaciones .............. ' + s.vocations);
    console.log('  modulos de contenido .... ' + s.contentFiles);
    console.log('  definiciones ............ ' + s.contentDefinitions);
    console.log('    acciones .............. ' + s.byKind.action);
    console.log('    movimientos ........... ' + s.byKind.movement);
    console.log('    comandos .............. ' + s.byKind.talkaction);
    console.log('    monstruos ............. ' + s.byKind.monster);
    console.log('  acciones registradas .... ' + s.actions + ' items');
    console.log('  movimientos registrados . ' + s.movements + ' items');
    console.log('  comandos registrados .... ' + s.talkActions);
    console.log('  tipos de monstruo ....... ' + s.monsterTypes);
    console.log('');

    engine.shutdown();
}

main();
