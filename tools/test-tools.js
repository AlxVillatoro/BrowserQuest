'use strict';

/**
 * Prueba de las herramientas: el escritor de mapas, la edición de `items.xml` y el
 * API del editor.
 *
 * TODO SE HACE SOBRE COPIAS. Las pruebas trabajan en un directorio temporal con su
 * propio `items.xml` y su propio mapa, nunca sobre `data/`. Una prueba que escribiera
 * en el datapack de verdad estaría modificando el proyecto cada vez que se ejecuta, y
 * entonces un fallo de la prueba se convierte en un mapa roto y el fallo real queda
 * escondido detrás del daño que hizo la propia prueba.
 *
 * Uso:  node tools/test-tools.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ItemsFile = require('../editor/lib/itemsfile');
const MapWriter = require('../engine/world/writer');
const MapLoader = require('../engine/world/loader');
const Xml = require('../engine/data/xml');
const { createToolsServer, applyEdits, flagsFromNames, safeMapName } = require('../editor/server');
const { loadMap } = require('../engine/world/loader');

const ROOT = path.resolve(__dirname, '..');

let failures = 0;

function ok(label, detail) {
    console.log('  \u001b[32mPASS\u001b[0m  ' + label + (detail ? '  \u001b[90m' + detail + '\u001b[0m' : ''));
}
function fail(label, detail) {
    failures += 1;
    console.log('  \u001b[31mFAIL\u001b[0m  ' + label + (detail ? '  ' + detail : ''));
}
function check(label, condition, detail) {
    if (condition) { ok(label, detail); } else { fail(label, detail); }
}
function section(title) {
    console.log('\n' + title);
}

/** Un directorio de trabajo desechable con copias de lo que se va a editar. */
function makeWorkspace() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avillatoro-tools-'));

    fs.mkdirSync(path.join(dir, 'world'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'items'), { recursive: true });

    fs.copyFileSync(
        path.join(ROOT, 'data', 'world', 'sample.map.json'),
        path.join(dir, 'world', 'prueba.map.json'));

    fs.copyFileSync(
        path.join(ROOT, 'data', 'items', 'items.xml'),
        path.join(dir, 'items', 'items.xml'));

    return {
        dir: dir,
        mapsDir: path.join(dir, 'world'),
        itemsFile: path.join(dir, 'items', 'items.xml'),
        mapFile: path.join(dir, 'world', 'prueba.map.json'),
        remove() {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}

async function api(port, method, route, body) {
    const response = await fetch('http://127.0.0.1:' + port + route, {
        method: method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    let payload = null;
    try {
        payload = JSON.parse(text);
    } catch (error) {
        payload = { raw: text };
    }

    return { status: response.status, body: payload };
}

async function main() {
    console.log('Prueba de las herramientas (' + ROOT + ')');

    const workspace = makeWorkspace();
    const itemTypes = Xml.loadItems(workspace.itemsFile);

    // =======================================================================
    section('1. El escritor: ida y vuelta y almacenamiento disperso');
    // =======================================================================

    {
        const original = loadMap(workspace.mapFile, {
            itemTypes: itemTypes,
            monsterTypes: new Map([['Rat', {}]])
        });

        check('el mapa de partida carga', original.report.ok,
            original.map.stats().size + ', ' + original.map.stats().explicitTiles + ' tiles explicitos');

        const roundTrip = MapWriter.verifyRoundTrip(original.map, MapLoader.buildMap, {
            itemTypes: itemTypes,
            monsterTypes: new Map([['Rat', {}]])
        });

        check('cargar, escribir y volver a cargar da el mismo mapa',
            roundTrip.ok,
            roundTrip.ok ? 'sin diferencias' : roundTrip.problems.join('; '));

        const text = MapWriter.writeMap(original.map, { itemTypes: itemTypes });
        const data = JSON.parse(text);

        // LO IMPORTANTE DEL ESCRITOR: que no materialice el mapa. Si volcara todos los
        // tiles, el archivo pasaria de 2 KB a 67 millones de celdas en la primera
        // edicion, y el almacenamiento disperso del motor se perderia al guardar.
        check('no se escriben los tiles que son suelo por defecto',
            data.tiles.length === original.map.stats().explicitTiles,
            data.tiles.length + ' tiles escritos de ' +
            original.map.stats().cellsIfMaterialized.toLocaleString('es-ES') + ' celdas posibles');

        check('y el archivo sigue siendo pequeno',
            text.length < 8000,
            text.length + ' bytes frente a los ' +
            original.map.stats().cellsIfMaterialized.toLocaleString('es-ES') +
            ' que ocuparia materializado');

        // Los valores por defecto se omiten: un item con cantidad 1 no lleva `count`.
        const oneItem = data.tiles.find((tile) => tile.items && tile.items.length === 1);
        check('los valores por defecto se omiten al escribir',
            oneItem && oneItem.items[0].count === undefined,
            'un item de cantidad 1 se escribe solo con su id: ' +
            JSON.stringify(oneItem.items[0]));

        // Y una cantidad distinta SI se escribe, que es lo que hace que omitir sea
        // seguro.
        const stacked = data.tiles.find((tile) =>
            tile.items && tile.items.some((item) => item.count !== undefined));
        check('pero una cantidad distinta de 1 si se escribe',
            stacked !== undefined,
            stacked ? JSON.stringify(stacked.items) : 'no se encontro ninguno');

        check('las banderas se escriben por nombre',
            data.tiles.some((tile) => tile.flags && tile.flags.indexOf('protectionZone') !== -1),
            'para que el archivo se pueda leer sin saber numeros de bit');

        check('las claves de documentacion se conservan si se piden',
            MapWriter.writeMap(original.map, {
                itemTypes: itemTypes,
                extraKeys: { _comment: ['no borrar'] }
            }).indexOf('no borrar') !== -1,
            'si no, abrir un mapa en el editor borraria sus comentarios sin avisar');
    }

    {
        // Un mapa con un suelo distinto al de su planta tiene que conservarlo.
        const loaded = loadMap(workspace.mapFile, { itemTypes: itemTypes });
        const charco = loaded.map.getTile(20, 20, 7);

        check('el mapa de ejemplo tiene un suelo distinto al de su planta',
            charco && charco.ground && charco.ground.typeId === 105,
            'un charco con groundSpeed 300');

        const data = JSON.parse(MapWriter.writeMap(loaded.map, { itemTypes: itemTypes }));
        const written = data.tiles.find((tile) => tile.x === 20 && tile.y === 20);

        check('y el escritor lo escribe en vez de darlo por defecto',
            written && written.ground === 105,
            'omitirlo lo perderia al guardar');
    }

    // =======================================================================
    section('2. Edicion quirurgica de items.xml');
    // =======================================================================

    {
        const xml = fs.readFileSync(workspace.itemsFile, 'utf8');
        const items = ItemsFile.readItems(xml);

        // El tope es el numero de bloques <item> que habia cuando se escribio la prueba.
        // Un `<item>` nuevo en el datapack no es un fallo del lector, asi que el numero
        // exacto solo servia para poner la prueba en rojo cada vez que se anadia un objeto.
        // Lo que hay que seguir cazando es lo contrario, que el lector se deje bloques por
        // el camino, y eso se comprueba abajo con un item concreto y con el rango.
        check('se leen todos los items del archivo',
            items.length >= 14,
            items.length + ' bloques <item>, ' + itemTypes.size + ' tipos resueltos');

        const rata = items.find((item) => item.id === 111);
        check('y se leen sus atributos',
            rata && rata.name === 'stone wall' && rata.attributes.blocksSolid === 1,
            JSON.stringify(rata.attributes));

        const range = items.find((item) => item.isRange === true);
        check('los items por rango se reconocen como tales',
            range && range.fromid === 1950 && range.toid === 1954,
            'fromid ' + range.fromid + ' a toid ' + range.toid);

        // --- Anadir ---
        const added = ItemsFile.saveItem(xml, {
            id: 9001,
            name: 'objeto de prueba',
            article: 'un',
            attributes: { pickupable: 1, weight: 25 }
        });

        check('se anade un item nuevo', added.action === 'added');

        const afterAdd = fs.writeFileSync(workspace.itemsFile + '.probe', added.xml, 'utf8');
        const reread = Xml.loadItems(workspace.itemsFile + '.probe');

        check('y el archivo resultante se puede leer',
            reread.get(9001) !== undefined &&
            reread.get(9001).name === 'objeto de prueba' &&
            reread.get(9001).attributes.weight === 25,
            'el motor lo veria como "' + reread.get(9001).name + '"');
        fs.unlinkSync(workspace.itemsFile + '.probe');

        // --- Sustituir ---
        const replaced = ItemsFile.saveItem(added.xml, {
            id: 9001,
            name: 'objeto cambiado',
            attributes: { pickupable: 1 }
        });

        check('se sustituye un item que ya existe', replaced.action === 'replaced');

        const afterReplace = ItemsFile.readItems(replaced.xml);
        check('y no se duplica',
            afterReplace.filter((item) => item.id === 9001).length === 1 &&
            afterReplace.length === items.length + 1,
            afterReplace.length + ' items, uno de ellos el cambiado');

        fs.writeFileSync(workspace.itemsFile + '.probe', replaced.xml, 'utf8');
        check('y el archivo sigue siendo valido tras sustituir',
            Xml.loadItems(workspace.itemsFile + '.probe').get(9001).name === 'objeto cambiado');
        fs.unlinkSync(workspace.itemsFile + '.probe');

        // --- Borrar ---
        const deleted = ItemsFile.deleteItem(replaced.xml, 9001);
        check('se borra un item', deleted.action === 'deleted');

        const afterDelete = ItemsFile.readItems(deleted.xml);
        check('y el archivo vuelve a tener los de antes',
            afterDelete.length === items.length &&
            afterDelete.find((item) => item.id === 9001) === undefined,
            afterDelete.length + ' items');

        check('borrar algo que no existe no rompe nada',
            ItemsFile.deleteItem(xml, 999999).action === 'notFound');

        // --- LO IMPORTANTE: que no se pierda el resto del archivo ---
        // Se buscan cadenas que existan DE VERDAD en el archivo. La primera version de
        // esta comprobacion buscaba una frase que cruzaba un salto de linea, y por eso
        // fallaba aunque los comentarios estuvieran intactos.
        check('los comentarios del archivo sobreviven a una edicion',
            added.xml.indexOf('FLAG_ALWAYSONTOP') !== -1 &&
            added.xml.indexOf('binarias viven en') !== -1 &&
            added.xml.indexOf('conviene no confundir') !== -1,
            'por eso se edita el texto en vez de reescribir el archivo entero');

        check('y el orden de los items no cambia',
            ItemsFile.readItems(added.xml).slice(0, 3).map((item) => item.id).join(',') ===
            items.slice(0, 3).map((item) => item.id).join(','),
            'un archivo reordenado entero llena el control de versiones de ruido');
    }

    // =======================================================================
    section('3. Aplicar ediciones a un mapa');
    // =======================================================================

    {
        const loaded = loadMap(workspace.mapFile, { itemTypes: itemTypes });
        const before = loaded.map.stats().explicitTiles;

        // Pintar un muro donde no habia nada.
        const applied = applyEdits(loaded.map, [
            { x: 50, y: 50, z: 7, items: [{ id: 111 }] }
        ], itemTypes);

        check('se puede pintar un item en una celda vacia',
            applied.changed === 1 && applied.problems.length === 0 &&
            loaded.map.getTile(50, 50, 7) !== null,
            loaded.map.getTile(50, 50, 7).downItems.length + ' item(s) en (50,50)');

        check('y el mapa tiene un tile mas',
            loaded.map.stats().explicitTiles === before + 1);

        // Una edicion dice COMO DEBE QUEDAR el tile, no que hay que anadir. Aplicarla
        // dos veces tiene que dar lo mismo.
        applyEdits(loaded.map, [{ x: 50, y: 50, z: 7, items: [{ id: 111 }] }], itemTypes);
        check('aplicar la misma edicion dos veces no acumula',
            loaded.map.getTile(50, 50, 7).downItems.length === 1,
            'la edicion describe el estado final, no un incremento');

        // Borrar: una edicion sin nada devuelve el tile a suelo por defecto.
        const erased = applyEdits(loaded.map, [{ x: 50, y: 50, z: 7 }], itemTypes);
        check('una edicion vacia borra el tile',
            erased.changed === 1 && loaded.map.getTile(50, 50, 7) === null &&
            loaded.map.stats().explicitTiles === before,
            'y vuelve a ser suelo por defecto, no un agujero');

        // Un suelo distinto al de la planta se puede pintar.
        applyEdits(loaded.map, [{ x: 51, y: 50, z: 7, ground: 105 }], itemTypes);
        check('se puede pintar otro suelo',
            loaded.map.getTile(51, 50, 7).ground.typeId === 105);

        // --- Lo que tiene que rechazar ---
        const badItem = applyEdits(loaded.map, [
            { x: 52, y: 50, z: 7, items: [{ id: 999999 }] }
        ], itemTypes);
        check('se rechaza un item que no existe',
            badItem.problems.length > 0 && /999999/.test(badItem.problems[0]),
            badItem.problems[0]);

        const badFlag = applyEdits(loaded.map, [
            { x: 52, y: 50, z: 7, flags: ['banderaInventada'] }
        ], itemTypes);
        check('se rechaza una bandera que no existe',
            badFlag.problems.length > 0 && /banderaInventada/.test(badFlag.problems[0]),
            badFlag.problems[0]);

        const outOfBounds = applyEdits(loaded.map, [
            { x: 9999, y: 9999, z: 7, items: [{ id: 111 }] }
        ], itemTypes);
        check('se rechaza una edicion fuera del mapa',
            outOfBounds.problems.length > 0 && /fuera del mapa/.test(outOfBounds.problems[0]),
            outOfBounds.problems[0]);

        const badGround = applyEdits(loaded.map, [
            { x: 52, y: 50, z: 7, ground: 99999 }
        ], itemTypes);
        check('se rechaza un suelo que no existe',
            badGround.problems.length > 0,
            badGround.problems[0]);

        check('las banderas se traducen de nombre a bits',
            flagsFromNames(['protectionZone', 'noPvp']).bits === 3 &&
            flagsFromNames(['protectionZone', 'noPvp']).unknown.length === 0,
            'protectionZone es el bit 1 y noPvp el 2');

        check('una bandera desconocida se señala en vez de ignorarse',
            flagsFromNames(['protectionZone']).unknown.indexOf('noExiste') === -1 &&
            flagsFromNames(['noExiste']).unknown.length === 1,
            'ignorarla dejaria un mapa que parece correcto y no lo esta');
    }

    // =======================================================================
    section('4. El API del editor');
    // =======================================================================

    const tools = createToolsServer({
        port: 0,
        mapsDir: workspace.mapsDir,
        itemsFile: workspace.itemsFile,
        logger: { info() {}, warning() {}, error() {} }
    });

    const port = await tools.ready;

    check('el servidor de herramientas escucha', port > 0, 'puerto ' + port);

    {
        const status = await api(port, 'GET', '/api/status');
        check('el estado informa de items y mapas',
            status.status === 200 && status.body.items > 0 && status.body.maps === 1,
            status.body.items + ' items, ' + status.body.maps + ' mapa(s)');

        const maps = await api(port, 'GET', '/api/maps');
        check('se listan los mapas',
            maps.status === 200 && maps.body.maps.length === 1 &&
            maps.body.maps[0].name === 'prueba' &&
            maps.body.maps[0].width === 64,
            JSON.stringify(maps.body.maps[0]));

        const map = await api(port, 'GET', '/api/map?name=prueba');
        check('se lee un mapa entero',
            map.status === 200 && map.body.raw.tiles.length > 0 &&
            map.body.stats.explicitTiles > 0,
            map.body.stats.size + ', ' + map.body.stats.explicitTiles + ' tiles explicitos');

        const missing = await api(port, 'GET', '/api/map?name=noExiste');
        check('un mapa que no existe da 404', missing.status === 404);

        const badName = await api(port, 'GET', '/api/map?name=../../server/config');
        check('un nombre de mapa con barras se rechaza',
            badName.status === 400,
            'sin esto se podria leer cualquier archivo del proyecto');

        check('el nombre de mapa se valida con una lista blanca',
            safeMapName('prueba') === 'prueba' &&
            safeMapName('../secreto') === null &&
            safeMapName('con espacio') === null,
            'solo letras, numeros, guion y guion bajo');

        const items = await api(port, 'GET', '/api/items');
        check('se leen los items',
            items.status === 200 && items.body.items.length > 0 &&
            items.body.attributeKeys.length > 0,
            items.body.items.length + ' items y ' +
            items.body.attributeKeys.length + ' claves de atributo conocidas');
    }

    {
        // --- Guardar una edicion de verdad ---
        const before = JSON.parse(fs.readFileSync(workspace.mapFile, 'utf8'));

        const edit = await api(port, 'POST', '/api/map', {
            name: 'prueba',
            edits: [{ x: 55, y: 55, z: 7, items: [{ id: 111 }] }]
        });

        check('el API aplica y guarda una edicion',
            edit.status === 200 && edit.body.ok === true && edit.body.changed === 1,
            edit.body.stats ? edit.body.stats.explicitTiles + ' tiles explicitos' : '');

        const after = JSON.parse(fs.readFileSync(workspace.mapFile, 'utf8'));
        const written = after.tiles.find((tile) => tile.x === 55 && tile.y === 55);

        check('y el archivo del mapa ha cambiado de verdad',
            written !== undefined && written.items[0].id === 111,
            'la edicion esta en el disco');

        check('el mapa guardado se puede volver a cargar',
            loadMap(workspace.mapFile, { itemTypes: itemTypes }).report.ok,
            'la ida y vuelta se comprueba ANTES de escribir: un fallo del escritor ' +
            'no puede llegar a sobrescribir el mapa bueno');

        check('y conserva los comentarios del original',
            after._comment !== undefined,
            'las claves que empiezan por _ se conservan');

        check('el archivo no ha crecido de forma desmedida',
            fs.statSync(workspace.mapFile).size < 12000,
            fs.statSync(workspace.mapFile).size + ' bytes');

        // --- Lo que tiene que rechazar ---
        const badEdit = await api(port, 'POST', '/api/map', {
            name: 'prueba',
            edits: [{ x: 56, y: 56, z: 7, items: [{ id: 999999 }] }]
        });
        check('un item inexistente se rechaza con 422', badEdit.status === 422,
            badEdit.body.problems ? badEdit.body.problems[0] : '');

        const afterBad = JSON.parse(fs.readFileSync(workspace.mapFile, 'utf8'));
        check('y el mapa NO se ha tocado',
            afterBad.tiles.find((tile) => tile.x === 56 && tile.y === 56) === undefined,
            'un rechazo no puede dejar el archivo a medias');

        const dryRun = await api(port, 'POST', '/api/map', {
            name: 'prueba',
            dryRun: true,
            edits: [{ x: 57, y: 57, z: 7, items: [{ id: 111 }] }]
        });
        check('se puede simular un guardado sin escribir',
            dryRun.status === 200 && dryRun.body.dryRun === true,
            'util para comprobar antes de tocar el archivo');

        const afterDry = JSON.parse(fs.readFileSync(workspace.mapFile, 'utf8'));
        check('y la simulacion no escribe nada',
            afterDry.tiles.find((tile) => tile.x === 57 && tile.y === 57) === undefined);
    }

    {
        // --- Items por el API ---
        const saved = await api(port, 'POST', '/api/items', {
            item: { id: 9100, name: 'cosa del api', attributes: { pickupable: 1 } }
        });

        check('el API guarda un item',
            saved.status === 200 && saved.body.action === 'added',
            'accion: ' + saved.body.action);

        check('y el archivo de items sigue siendo valido',
            Xml.loadItems(workspace.itemsFile).get(9100) !== undefined,
            'el motor veria "' + Xml.loadItems(workspace.itemsFile).get(9100).name + '"');

        const updated = await api(port, 'POST', '/api/items', {
            item: { id: 9100, name: 'cosa cambiada', attributes: {} }
        });
        check('y lo sustituye en vez de duplicarlo',
            updated.body.action === 'replaced' &&
            ItemsFile.readItems(fs.readFileSync(workspace.itemsFile, 'utf8'))
                .filter((item) => item.id === 9100).length === 1);

        // Un item sin id ni fromid no se puede guardar.
        const noId = await api(port, 'POST', '/api/items', { item: { name: 'sin id' } });
        check('un item sin id se rechaza', noId.status === 400, noId.body.error);

        check('y el archivo de items no se ha tocado',
            ItemsFile.readItems(fs.readFileSync(workspace.itemsFile, 'utf8'))
                .find((item) => item.name === 'sin id') === undefined);
    }

    // =======================================================================
    section('5. Los archivos servidos');
    // =======================================================================

    {
        const page = await fetch('http://127.0.0.1:' + port + '/');
        check('se sirve la pagina del editor',
            page.status === 200 &&
            String(page.headers.get('content-type')).indexOf('text/html') === 0,
            page.status + ' ' + page.headers.get('content-type'));

        const camera = await fetch('http://127.0.0.1:' + port + '/avillatoro/js/camera.js');
        check('y los modulos del CLIENTE, que el editor reutiliza',
            camera.status === 200 &&
            String(camera.headers.get('content-type')).indexOf('javascript') !== -1,
            camera.status + ' ' + camera.headers.get('content-type') + ': misma camara y ' +
            'mismo orden de dibujo que el juego, porque si fueran distintos un mapa se ' +
            'veria bien en el editor y mal en el juego');

        const protocol = await fetch('http://127.0.0.1:' + port + '/shared/js/protocol.mjs');
        check('y el protocolo compartido', protocol.status === 200);

        const escape = await fetch(
            'http://127.0.0.1:' + port + '/../server/config.json');
        check('no se puede salir del montaje',
            escape.status === 403 || escape.status === 404,
            'estado ' + escape.status + ': es el fallo clasico de un servidor de archivos');
    }

    await tools.close();
    workspace.remove();

    // =======================================================================
    console.log('');
    if (failures === 0) {
        console.log('\u001b[32mTodo OK\u001b[0m — las herramientas leen, editan y guardan sin romper nada.');
        process.exit(0);
    }
    console.log('\u001b[31m' + failures + ' comprobacion(es) fallaron\u001b[0m');
    process.exit(1);
}

main().catch((error) => {
    console.error('\u001b[31mLa prueba fallo con una excepcion:\u001b[0m');
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
