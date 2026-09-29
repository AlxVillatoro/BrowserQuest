'use strict';

/**
 * Arranque del servidor de juego.
 *
 * Cambios respecto al original (que asumía Node 0.4 y `log` como global
 * implícita):
 *   - `Player` se importa de verdad. El original hacía `new Player(...)`
 *     confiando en una global que nunca existía (main.js:43).
 *   - El logger se instala explícitamente antes de arrancar, así que un
 *     `debug_level` desconocido ya no deja `log` en undefined.
 *   - Las rutas de config y de mapa se resuelven contra la raíz del proyecto,
 *     así que `node server/js/main.js` funciona desde cualquier directorio.
 *   - El servidor HTTP sirve también el cliente, así que todo corre en un
 *     solo puerto.
 */

const fs = require('fs');
const path = require('path');

const Metrics = require('./metrics');
const Logger = require('./logger');

/** <raíz del proyecto>, calculada desde server/js/. */
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Resuelve una ruta de configuración relativa contra la raíz del proyecto,
 * aceptando también rutas relativas al directorio de trabajo actual.
 */
function resolveProjectPath(filepath) {
    if (!filepath || path.isAbsolute(filepath)) {
        return filepath;
    }
    const fromCwd = path.resolve(filepath);
    if (fs.existsSync(fromCwd)) {
        return fromCwd;
    }
    return path.resolve(PROJECT_ROOT, filepath);
}


function main(config) {
    const ws = require('./ws');
    const WorldServer = require('./worldserver');
    const Player = require('./player');
    const _ = require('underscore');

    const mapFilepath = resolveProjectPath(config.map_filepath);
    const clientRoot = config.client_root ? resolveProjectPath(config.client_root) : null;
    const sharedRoot = config.shared_root ? resolveProjectPath(config.shared_root) : null;

    const server = new ws.WebsocketServer(config.port, clientRoot, sharedRoot);
    const metrics = config.metrics_enabled ? new Metrics(config) : null;
    const worlds = [];
    let lastTotalPlayers = 0;

    const checkPopulationInterval = setInterval(function () {
        if (metrics && metrics.isReady) {
            metrics.getTotalPlayers(function (totalPlayers) {
                if (totalPlayers !== lastTotalPlayers) {
                    lastTotalPlayers = totalPlayers;
                    _.each(worlds, function (world) {
                        world.updatePopulation(totalPlayers);
                    });
                }
            });
        }
    }, 1000);

    log.info('Starting BrowserQuest game server...');
    log.info('Mapa: ' + mapFilepath);

    server.onConnect(function (connection) {
        let world; // el mundo en el que aparecerá el jugador

        const connect = function () {
            if (world) {
                world.connect_callback(new Player(connection, world));
            }
        };

        if (metrics) {
            metrics.getOpenWorldCount(function (open_world_count) {
                // elegir el mundo menos poblado entre los abiertos
                world = _.min(_.first(worlds, open_world_count), function (w) {
                    return w.playerCount;
                });
                connect();
            });
        } else {
            // llenar cada mundo secuencialmente hasta agotarlos
            world = _.detect(worlds, function (w) {
                return w.playerCount < config.nb_players_per_world;
            });
            if (world) {
                world.updatePopulation();
            }
            connect();
        }
    });

    server.onError(function () {
        log.error(Array.prototype.join.call(arguments, ', '));
    });

    const onPopulationChange = function () {
        if (!metrics) {
            return;
        }
        metrics.updatePlayerCounters(worlds, function (totalPlayers) {
            _.each(worlds, function (world) {
                world.updatePopulation(totalPlayers);
            });
        });
        metrics.updateWorldDistribution(getWorldDistribution(worlds));
    };

    _.each(_.range(config.nb_worlds), function (i) {
        const world = new WorldServer('world' + (i + 1), config.nb_players_per_world, server);
        world.run(mapFilepath);
        worlds.push(world);

        if (metrics) {
            world.onPlayerAdded(onPopulationChange);
            world.onPlayerRemoved(onPopulationChange);
        }
    });

    server.onRequestStatus(function () {
        return JSON.stringify(getWorldDistribution(worlds));
    });

    if (metrics) {
        metrics.ready(function () {
            onPopulationChange(); // inicializar contadores en 0 al arrancar
        });
    }

    process.on('uncaughtException', function (e) {
        log.error('uncaughtException: ' + (e && e.stack ? e.stack : e));
    });

    const shutdown = function (signal) {
        log.info('Recibido ' + signal + ', cerrando...');
        clearInterval(checkPopulationInterval);
        process.exit(0);
    };
    process.on('SIGINT', function () { shutdown('SIGINT'); });
    process.on('SIGTERM', function () { shutdown('SIGTERM'); });
}

function getWorldDistribution(worlds) {
    return worlds.map(function (world) {
        return world.playerCount;
    });
}

function getConfigFile(filepath, callback) {
    fs.readFile(filepath, 'utf8', function (err, json_string) {
        if (err) {
            callback(null);
        } else {
            try {
                callback(JSON.parse(json_string));
            } catch (e) {
                console.error('Configuración inválida en ' + filepath + ': ' + e.message);
                callback(null);
            }
        }
    });
}

const defaultConfigPath = path.join(__dirname, '..', 'config.json');
let customConfigPath = path.join(__dirname, '..', 'config_local.json');

process.argv.forEach(function (val, index) {
    if (index === 2) {
        customConfigPath = path.resolve(val);
    }
});

getConfigFile(defaultConfigPath, function (defaultConfig) {
    getConfigFile(customConfigPath, function (localConfig) {
        const config = localConfig || defaultConfig;

        if (!config) {
            console.error('Server cannot start without any configuration file.');
            process.exit(1);
        }

        Logger.install(config.debug_level);
        main(config);
    });
});
