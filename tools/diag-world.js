'use strict';

/**
 * Diagnóstico del arranque de un WorldServer, sin red.
 *
 * Instancia un mundo contra el mapa real y comprueba que quedó completamente
 * inicializado: mapa cargado, rejilla de colisiones, zonas (grupos), áreas de
 * mobs y cofres, y entidades estáticas.
 *
 * Sirve para distinguir un fallo de carga (asíncrono) de un fallo de lógica:
 * si `groups` queda vacío, ningún jugador recibirá jamás un `entity.group`, y
 * por tanto no habrá ningún broadcast entre jugadores — un síntoma que desde
 * fuera parece "el servidor no difunde" pero es en realidad "el mundo no
 * terminó de inicializarse".
 *
 * Uso:  node tools/diag-world.js [ruta-al-mapa]
 */

const path = require('path');

global.log = require('../server/js/logger').createLogger(process.env.LOG_LEVEL || 'info');

const WorldServer = require('../server/js/worldserver');

const mapPath = process.argv[2] || path.resolve(__dirname, '..', 'server', 'maps', 'world_server.json');

/** Servidor de transporte falso: aquí sólo nos interesa el estado del mundo. */
const fakeServer = {
    onConnect() {},
    onError() {},
    onRequestStatus() {},
    broadcast() {},
    forEachConnection() {},
    addConnection() {},
    removeConnection() {},
    getConnection() {
        return null;
    }
};

const world = new WorldServer('diag', 200, fakeServer);

console.log('Mapa: ' + mapPath + '\n');
world.run(mapPath);

setTimeout(() => {
    const map = world.map;

    const checks = [
        ['mapa instanciado', !!map],
        ['mapa cargado (isLoaded)', !!(map && map.isLoaded)],
        ['dimensiones', !!(map && map.width && map.height), map ? map.width + 'x' + map.height : '-'],
        ['rejilla de colisiones', !!(map && map.grid), map && map.grid ? map.grid.length + ' filas' : '-'],
        ['zonas inicializadas (zoneGroupsReady)', world.zoneGroupsReady === true],
        ['número de grupos', Object.keys(world.groups).length > 0, Object.keys(world.groups).length + ' grupos'],
        ['grupos esperados (groupWidth*groupHeight)',
            !!(map && Object.keys(world.groups).length === map.groupWidth * map.groupHeight),
            map ? map.groupWidth + 'x' + map.groupHeight + ' = ' + (map.groupWidth * map.groupHeight) : '-'],
        ['áreas de mobs', world.mobAreas.length > 0, world.mobAreas.length + ' áreas'],
        ['mobs instanciados', Object.keys(world.mobs).length > 0, Object.keys(world.mobs).length + ' mobs'],
        ['áreas de cofres', world.chestAreas.length > 0, world.chestAreas.length + ' áreas'],
        ['entidades estáticas', world.entities && Object.keys(world.entities).length > 0,
            world.entities ? Object.keys(world.entities).length + ' entidades' : '-'],
        ['bucle de tick activo', !!world.interval]
    ];

    let failed = 0;
    console.log('Comprobaciones:');
    checks.forEach(([label, pass, detail]) => {
        if (!pass) {
            failed += 1;
        }
        const mark = pass ? '\u001b[32mOK  \u001b[0m' : '\u001b[31mFALLO\u001b[0m';
        console.log('  ' + mark + '  ' + label + (detail ? '  \u001b[90m' + detail + '\u001b[0m' : ''));
    });

    // Muestra de ids de grupo, para ver el formato real.
    const sample = Object.keys(world.groups).slice(0, 5);
    console.log('\n  \u001b[90mmuestra de grupos: ' + sample.join(', ') + '\u001b[0m');

    clearInterval(world.interval);
    console.log('');
    process.exit(failed > 0 ? 1 : 0);
}, 1500);
