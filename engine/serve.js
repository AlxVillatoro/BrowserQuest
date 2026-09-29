'use strict';

/**
 * Arranque del servidor de juego completo: motor + red.
 *
 * Uso:  node engine/serve.js [--config ruta] [--port 8080] [--quiet]
 */

const path = require('path');

const { createEngine } = require('./core/engine');
const { createNetworkServer } = require('./net/server');

function parseArgs(argv) {
    const args = { config: null, port: null, quiet: false, verbose: false };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--config') {
            args.config = argv[index + 1];
            index += 1;
        } else if (arg === '--port') {
            args.port = Number(argv[index + 1]);
            index += 1;
        } else if (arg === '--quiet') {
            args.quiet = true;
        } else if (arg === '--verbose') {
            args.verbose = true;
        }
    }

    return args;
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    const rootDir = path.resolve(__dirname, '..');

    const engine = createEngine({
        rootDir: rootDir,
        configFile: args.config || undefined,
        logLevel: args.verbose ? 'debug' : 'info'
    });

    const port = args.port === null ? engine.config.enginePort : args.port;

    const network = createNetworkServer({
        engine: engine,
        port: port,
        logger: engine.log,
        verbose: args.verbose
    });

    // El motor arranca DESPUES de la red, para que el primer tick ya encuentre las
    // conexiones registradas y no se pierda el mapa inicial de nadie que entrara en
    // ese hueco.
    engine.start();

    const realPort = network.port();

    if (!args.quiet) {
        console.log('');
        console.log('  Servidor de juego escuchando en ws://localhost:' + realPort);
        console.log('  El cliente debe conectarse aqui y mandar [15] para entrar.');
        console.log('');
    }

    engine.log.info('escuchando en el puerto ' + realPort);
    engine.log.info('jugadores: ' + engine.sessions.size);

    let stopping = false;

    const shutdown = (signal) => {
        if (stopping) {
            return;
        }
        stopping = true;

        engine.log.info('cerrando por ' + signal + '...');
        network.close().then(() => {
            engine.shutdown();
            process.exit(0);
        });

        // Si algo se atasca, no quedarse colgado: se sale igual.
        setTimeout(() => process.exit(0), 2000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (require.main === module) {
    main();
}

module.exports = { main, parseArgs };
