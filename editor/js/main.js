/**
 * El editor: ata las dos herramientas.
 *
 * Dos pestañas que no comparten nada salvo el cliente del API: el mapa y los objetos
 * son cosas distintas, se editan de formas distintas y mezclarlas en una sola pantalla
 * haría que ninguna de las dos estuviera cómoda.
 *
 * Lo único que las une es que LAS DOS ESCRIBEN EN EL DATAPACK, y por eso las dos
 * enseñan siempre qué han guardado y qué queda pendiente. Un editor que no dice si ha
 * guardado es un editor en el que no se puede confiar.
 */

import { ApiClient } from './apiclient.js';
import { EditorMap } from './editormap.js';
import { MapCanvas } from './mapcanvas.js';
import { ItemsView } from './itemsview.js';

const api = new ApiClient();

/** El estado del mapa que se está editando. */
const state = {
    map: null,
    canvas: null,
    tool: 'paint',
    selectedType: 111,
    selectedGround: null,
    selectedFlag: 'protectionZone'
};

// ---------------------------------------------------------------------------
// Pestañas
// ---------------------------------------------------------------------------

function showTab(name) {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.tab === name);
    });
    document.querySelectorAll('.panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === 'panel-' + name);
    });
}

// ---------------------------------------------------------------------------
// El mapa
// ---------------------------------------------------------------------------

async function loadMapList() {
    const result = await api.listMaps();
    const select = document.getElementById('map-select');

    select.innerHTML = '';

    if (result.error) {
        setMapStatus('no se pudo listar los mapas: ' + result.error, true);
        return;
    }

    result.maps.forEach((map) => {
        const option = document.createElement('option');
        option.value = map.name;
        option.textContent = map.name + '  (' + map.width + 'x' + map.height +
            'x' + map.floors + ', ' + map.tiles + ' tiles)';
        select.appendChild(option);
    });
}

async function openMap(name) {
    setMapStatus('abriendo ' + name + '...');

    const [mapResult, itemsResult] = await Promise.all([
        api.getMap(name),
        api.getItems()
    ]);

    if (mapResult.error) {
        setMapStatus('no se pudo abrir: ' + mapResult.error +
            (mapResult.problems ? ' — ' + mapResult.problems.join('; ') : ''), true);
        return;
    }

    // Los tipos de objeto hacen falta para saber qué item va por encima de las
    // criaturas y para dibujarlos. Se cargan del mismo sitio que el motor.
    const itemTypes = new Map();
    itemsResult.items.forEach((item) => {
        const attributes = item.attributes || {};
        if (item.isRange) {
            for (let id = item.fromid; id <= item.toid; id += 1) {
                itemTypes.set(id, { id: id, name: item.name, attributes: attributes });
            }
        } else {
            itemTypes.set(item.id, { id: item.id, name: item.name, attributes: attributes });
        }
    });

    state.map = new EditorMap(mapResult.raw, itemTypes);
    state.canvas.setMap(state.map);

    const spawn = (mapResult.raw.waypoints && mapResult.raw.waypoints.temple)
        ? mapResult.raw.waypoints.temple
        : [Math.floor(mapResult.raw.width / 2), Math.floor(mapResult.raw.height / 2), 7];

    state.canvas.setFloor(spawn[2]);
    state.canvas.centerOn(spawn[0], spawn[1]);

    document.getElementById('floor-select').value = String(spawn[2]);

    buildPalette(itemTypes);
    refreshMapStatus();
    setMapStatus('abierto ' + name);
}

/** La paleta: los objetos que se pueden pintar y los suelos. */
function buildPalette(itemTypes) {
    const palette = document.getElementById('palette');
    palette.innerHTML = '';

    const grounds = [];
    const objects = [];

    itemTypes.forEach((definition) => {
        const attributes = definition.attributes || {};
        if (attributes.isGround === 1 || attributes.isGround === true) {
            grounds.push(definition);
        } else {
            objects.push(definition);
        }
    });

    const group = (title, list, onPick, isGround) => {
        const heading = document.createElement('div');
        heading.className = 'palette-title';
        heading.textContent = title;
        palette.appendChild(heading);

        list.forEach((definition) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'palette-item';
            button.innerHTML = '<span class="swatch" data-type="' + definition.id +
                '"></span><span>' + definition.name + '</span>' +
                '<em>' + definition.id + '</em>';

            button.addEventListener('click', () => {
                onPick(definition.id);
                palette.querySelectorAll('.palette-item').forEach((other) => {
                    other.classList.remove('selected');
                });
                button.classList.add('selected');
            });

            palette.appendChild(button);
        });
    };

    group('Suelos', grounds, (id) => {
        state.tool = 'ground';
        state.selectedGround = id;
        setMapStatus('pincel de suelo: ' + itemTypes.get(id).name);
    }, true);

    group('Objetos', objects, (id) => {
        state.tool = 'paint';
        state.selectedType = id;
        setMapStatus('pincel: ' + itemTypes.get(id).name);
    }, false);

    // El primer objeto queda seleccionado por defecto, para poder pintar ya.
    const first = palette.querySelector('.palette-item');
    if (first) {
        first.classList.add('selected');
    }
}

function refreshMapStatus() {
    if (!state.map) {
        return;
    }
    const stats = state.map.stats();
    document.getElementById('map-stats').textContent =
        stats.explicitTiles + ' tiles explícitos (' + stats.withItems + ' con objetos, ' +
        stats.withFlags + ' con banderas) de ' +
        stats.cellsIfMaterialized.toLocaleString('es-ES') + ' celdas' +
        (stats.pending > 0 ? '  |  ' + stats.pending + ' sin guardar' : '  |  todo guardado');
}

function setMapStatus(text, isError) {
    const element = document.getElementById('map-status');
    element.textContent = text;
    element.className = isError ? 'error' : '';
}

async function saveMap() {
    if (!state.map) {
        return;
    }

    const edits = state.map.edits();

    if (edits.length === 0) {
        setMapStatus('no hay nada que guardar');
        return;
    }

    setMapStatus('guardando ' + edits.length + ' celda(s)...');

    const result = await api.saveMap(state.map.name, edits);

    if (result.error) {
        // El servidor comprueba la ida y vuelta ANTES de escribir, así que un rechazo
        // significa que el archivo está intacto. Decirlo tranquiliza y es verdad.
        setMapStatus('no se guardó: ' + result.error +
            (result.problems && result.problems.length
                ? ' — ' + result.problems.slice(0, 3).join('; ') : '') +
            '  (el archivo no se ha tocado)', true);
        return;
    }

    state.map.clearDirty();
    refreshMapStatus();
    setMapStatus('guardado: ' + result.changed + ' celda(s), ' +
        result.bytes + ' bytes en el archivo');
}

// ---------------------------------------------------------------------------
// Interacción con el lienzo
// ---------------------------------------------------------------------------

function applyTool(cell, event) {
    if (!state.map) {
        return;
    }

    const additive = event.shiftKey;
    const { x, y } = cell;
    const z = state.canvas.z;

    if (state.tool === 'erase') {
        state.map.erase(x, y, z);
        return;
    }

    if (state.tool === 'ground') {
        state.map.paintGround(x, y, z, state.selectedGround);
        return;
    }

    if (state.tool === 'flag') {
        state.map.toggleFlag(x, y, z, state.selectedFlag);
        return;
    }

    // Pintar: con Mayúsculas se AÑADE al montón en vez de sustituirlo, que es lo que
    // hace falta para poner una moneda encima de una mesa.
    if (additive) {
        state.map.addItem(x, y, z, state.selectedType);
    } else {
        state.map.paintItem(x, y, z, state.selectedType);
    }
}

function describeCell(cell) {
    if (!state.map) {
        return '';
    }

    const tile = state.map.tileAt(cell.x, cell.y, cell.z);
    const ground = state.map.definitionOf(state.map.groundAt(cell.x, cell.y, cell.z));

    const parts = [cell.x + ',' + cell.y + ',' + cell.z];
    parts.push(ground ? ground.name : 'sin suelo');

    if (tile) {
        if (tile.items.length > 0) {
            parts.push(tile.items.map((item) => {
                const definition = state.map.definitionOf(item.id);
                return definition ? definition.name : item.id;
            }).join(' + '));
        }
        if (tile.flags.length > 0) {
            parts.push('[' + tile.flags.join(',') + ']');
        }
    }

    return parts.join('  |  ');
}

function wireCanvas(canvasElement) {
    let painting = false;

    canvasElement.addEventListener('contextmenu', (event) => event.preventDefault());

    canvasElement.addEventListener('mousedown', (event) => {
        const cell = state.canvas.cellAt(event.clientX, event.clientY);

        // El botón central y el derecho con espacio arrastran la vista; el izquierdo
        // pinta y el derecho borra. Es la distribución de cualquier editor de mapas y
        // no hay razón para inventar otra.
        if (event.button === 1 || (event.button === 2 && event.altKey)) {
            state.canvas.dragging = { x: event.clientX, y: event.clientY,
                cx: state.canvas.camera.centerX, cy: state.canvas.camera.centerY };
            return;
        }

        painting = true;

        if (event.button === 2) {
            state.map.erase(cell.x, cell.y, cell.z);
            refreshMapStatus();
            return;
        }

        applyTool(cell, event);
        refreshMapStatus();
    });

    canvasElement.addEventListener('mousemove', (event) => {
        const cell = state.canvas.cellAt(event.clientX, event.clientY);
        state.canvas.hover = cell;

        if (state.canvas.dragging) {
            const dx = (event.clientX - state.canvas.dragging.x) / 32;
            const dy = (event.clientY - state.canvas.dragging.y) / 32;
            state.canvas.camera.setCenter(
                state.canvas.dragging.cx - dx,
                state.canvas.dragging.cy - dy,
                state.canvas.z);
            return;
        }

        if (painting) {
            applyTool(cell, event);
            refreshMapStatus();
        }
    });

    window.addEventListener('mouseup', () => {
        painting = false;
        state.canvas.dragging = null;
    });

    canvasElement.addEventListener('mouseleave', () => {
        state.canvas.hover = null;
        painting = false;
    });

    canvasElement.addEventListener('wheel', (event) => {
        event.preventDefault();
        const step = event.deltaY > 0 ? 1 : -1;
        const z = Math.max(0, Math.min(state.map ? state.map.floors - 1 : 15,
            state.canvas.z + step));
        state.canvas.setFloor(z);
        document.getElementById('floor-select').value = String(z);
    }, { passive: false });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function loop() {
    if (state.canvas) {
        state.canvas.draw(state.canvas.hover ? describeCell(state.canvas.hover) : null);
    }
    requestAnimationFrame(loop);
}

async function boot() {
    document.querySelectorAll('.tab').forEach((tab) => {
        tab.addEventListener('click', () => showTab(tab.dataset.tab));
    });

    const status = await api.status();

    if (status.error) {
        document.getElementById('global-status').textContent =
            'no se pudo hablar con el servidor: ' + status.error;
        document.getElementById('global-status').className = 'error';
        return;
    }

    document.getElementById('global-status').textContent =
        status.items + ' objetos, ' + status.maps + ' mapas — ' + status.root;

    // --- Mapa ---
    const canvasElement = document.getElementById('map-canvas');
    state.canvas = new MapCanvas({ canvas: canvasElement });
    wireCanvas(canvasElement);

    await loadMapList();

    document.getElementById('map-select').addEventListener('change', (event) => {
        openMap(event.target.value);
    });

    document.getElementById('btn-reload').addEventListener('click', () => {
        const name = document.getElementById('map-select').value;
        if (state.map && state.map.dirty.size > 0 &&
            !window.confirm('Hay ' + state.map.dirty.size + ' celda(s) sin guardar. ' +
                '¿Recargar y perderlas?')) {
            return;
        }
        openMap(name);
    });

    document.getElementById('btn-save').addEventListener('click', saveMap);
    document.getElementById('btn-erase').addEventListener('click', (event) => {
        state.tool = 'erase';
        document.querySelectorAll('.tool').forEach((tool) => tool.classList.remove('active'));
        event.target.classList.add('active');
        setMapStatus('goma de borrar: el botón derecho del ratón también borra');
    });
    document.getElementById('btn-flag').addEventListener('click', (event) => {
        state.tool = 'flag';
        state.selectedFlag = document.getElementById('flag-select').value;
        document.querySelectorAll('.tool').forEach((tool) => tool.classList.remove('active'));
        event.target.classList.add('active');
        setMapStatus('bandera: ' + state.selectedFlag);
    });

    document.getElementById('flag-select').addEventListener('change', (event) => {
        state.selectedFlag = event.target.value;
    });

    document.getElementById('floor-select').addEventListener('change', (event) => {
        state.canvas.setFloor(Number(event.target.value));
    });

    window.addEventListener('resize', () => state.canvas.resize());

    // La lista de plantas se llena con las que tiene el mapa abierto.
    const floorSelect = document.getElementById('floor-select');
    floorSelect.innerHTML = '';
    for (let z = 0; z < 16; z += 1) {
        const option = document.createElement('option');
        option.value = String(z);
        option.textContent = 'planta ' + z + (z <= 7 ? ' (superficie)' : ' (subsuelo)');
        floorSelect.appendChild(option);
    }

    // --- Objetos ---
    const itemsView = new ItemsView({
        api: api,
        list: document.getElementById('item-list'),
        form: document.getElementById('item-form'),
        status: document.getElementById('items-status'),
        onSaved: () => {
            // La paleta del mapa depende de los objetos, así que al guardar uno hay que
            // recargarla. Si no, un objeto nuevo no se podría pintar hasta recargar la
            // página, y parecería que no se ha guardado.
            if (state.map) {
                openMap(state.map.name);
            }
        }
    });

    document.getElementById('item-filter').addEventListener('input', () => {
        itemsView._renderList();
    });

    await itemsView.load();

    showTab('map');
    openMap(document.getElementById('map-select').value);
    loop();
}

boot();
