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
 *   node engine/main.js --config otra.lua     # otra configuración
 *   LOG_LEVEL=debug node engine/main.js       # con detalle de carga
 */

const path = require('path');
const { createEngine } = require('./core/engine');

function parseArgs(argv) {
    const args = { configFile: 'config.lua' };
    for (let i = 2; i < argv.length; i += 1) {
        if (argv[i] === '--config' && argv[i + 1]) {
            args.configFile = argv[i + 1];
            i += 1;
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

    const s = engine.stats;
    console.log('');
    console.log('  Datapack cargado');
    console.log('  ----------------');
    console.log('  items definidos ......... ' + s.items);
    console.log('  vocaciones .............. ' + s.vocations);
    console.log('  archivos de data/lib .... ' + s.libFiles);
    console.log('  scripts de contenido .... ' + s.scriptFiles);
    console.log('  monstruos ............... ' + s.monsterFiles);
    console.log('  acciones registradas .... ' + s.actions);
    console.log('  movimientos registrados . ' + s.movements);
    console.log('  talkactions registradas . ' + s.talkActions);
    console.log('  tipos de monstruo ....... ' + s.monsterTypes);
    console.log('');

    engine.shutdown();
}

main();
