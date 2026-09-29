/**
 * El editor de objetos: la lista de `items.xml` y el formulario de uno.
 *
 * El formulario no sabe escribir XML. Pide el objeto entero al servidor y el servidor
 * edita el archivo, porque el formato tiene detalles —comentarios que hay que
 * conservar, el orden de los bloques, la diferencia entre `id` y `fromid`/`toid`— que
 * no tienen por qué estar duplicados en el navegador. Aquí sólo se recogen los datos.
 */

/** Los atributos que se ofrecen como casilla, con su tipo. */
const COMMON_ATTRIBUTES = [
    { key: 'isGround', type: 'flag', hint: 'es el suelo del tile' },
    { key: 'groundSpeed', type: 'number', hint: 'lo que cuesta caminar por él' },
    { key: 'blocksSolid', type: 'flag', hint: 'impide caminar' },
    { key: 'blocksProjectile', type: 'flag', hint: 'impide el paso de flechas' },
    { key: 'blocksPathfind', type: 'flag', hint: 'el cálculo de rutas lo rodea' },
    { key: 'alwaysOnTop', type: 'flag', hint: 'se dibuja encima de las criaturas' },
    { key: 'pickupable', type: 'flag', hint: 'se puede recoger' },
    { key: 'stackable', type: 'flag', hint: 'se apila' },
    { key: 'useable', type: 'flag', hint: 'tiene un onUse' },
    { key: 'container', type: 'flag', hint: 'puede contener cosas' },
    { key: 'weight', type: 'number', hint: 'peso en centésimas' },
    { key: 'attack', type: 'number', hint: 'ataque si es un arma' },
    { key: 'defense', type: 'number', hint: 'defensa si es un arma' },
    { key: 'armor', type: 'number', hint: 'armadura si es una armadura' },
    { key: 'weaponType', type: 'text', hint: 'sword, axe, club, distance...' },
    { key: 'slotType', type: 'text', hint: 'hand, ring, neck, ammo...' }
];

export class ItemsView {
    constructor(options) {
        const opts = options || {};

        this.api = opts.api;
        this.listElement = opts.list;
        this.formElement = opts.form;
        this.statusElement = opts.status;

        this.items = [];
        this.selected = null;
        this.onSaved = opts.onSaved || (() => {});
    }

    async load() {
        const response = await this.api.getItems();
        this.items = response.items;
        this.attributeKeys = response.attributeKeys;

        this._renderList();
        this._renderForm(null);
        return this.items.length;
    }

    _renderList() {
        const filter = (document.getElementById('item-filter').value || '').toLowerCase();

        const visible = this.items.filter((item) =>
            !filter ||
            String(item.id) === filter ||
            String(item.fromid) === filter ||
            (item.name || '').toLowerCase().indexOf(filter) !== -1);

        this.listElement.innerHTML = '';

        visible.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'item-row' + (this.selected === item ? ' selected' : '');

            const id = item.isRange
                ? item.fromid + '-' + item.toid
                : String(item.id);

            row.innerHTML = '<span class="item-id">' + id + '</span>' +
                '<span class="item-name">' + (item.name || '') + '</span>' +
                '<span class="item-attrs">' + Object.keys(item.attributes).length + '</span>';

            row.addEventListener('click', () => {
                this.selected = item;
                this._renderList();
                this._renderForm(item);
            });

            this.listElement.appendChild(row);
        });

        this._setStatus(visible.length + ' de ' + this.items.length + ' objetos');
    }

    /** El formulario de un objeto. Con `null` se prepara uno nuevo. */
    _renderForm(item) {
        const form = this.formElement;
        form.innerHTML = '';

        const isNew = item === null;
        const isRange = item && item.isRange;

        const field = (label, id, value, type) => {
            const wrapper = document.createElement('label');
            wrapper.className = 'field';
            wrapper.innerHTML = '<span>' + label + '</span>' +
                '<input id="' + id + '" type="' + (type || 'text') + '" value="' +
                String(value === undefined || value === null ? '' : value) + '">';
            form.appendChild(wrapper);
            return wrapper.querySelector('input');
        };

        if (isRange) {
            field('Desde', 'f-fromid', item.fromid, 'number');
            field('Hasta', 'f-toid', item.toid, 'number');
        } else {
            const idInput = field('Id', 'f-id', item ? item.id : '', 'number');
            // Un objeto NUEVO necesita un id; uno que ya existe no debe cambiarlo,
            // porque los mapas lo referencian por número y cambiarlo los rompería
            // todos en silencio.
            if (!isNew) {
                idInput.disabled = true;
            }
        }

        field('Nombre', 'f-name', item ? item.name : '');
        field('Artículo', 'f-article', item ? item.article : '');
        field('Plural', 'f-plural', item ? item.plural : '');

        const attributesBox = document.createElement('div');
        attributesBox.className = 'attributes';
        attributesBox.innerHTML = '<div class="section-title">Propiedades</div>';
        form.appendChild(attributesBox);

        const known = item ? (item.attributes || {}) : {};

        COMMON_ATTRIBUTES.forEach((attribute) => {
            const value = known[attribute.key];
            const row = document.createElement('label');
            row.className = 'attribute-row';
            row.title = attribute.hint;

            if (attribute.type === 'flag') {
                const checked = value === 1 || value === true || value === '1';
                row.innerHTML = '<input type="checkbox" id="a-' + attribute.key + '"' +
                    (checked ? ' checked' : '') + '>' +
                    '<span>' + attribute.key + '</span>' +
                    '<em>' + attribute.hint + '</em>';
            } else {
                row.innerHTML = '<input type="' +
                    (attribute.type === 'number' ? 'number' : 'text') +
                    '" id="a-' + attribute.key + '" value="' +
                    (value === undefined ? '' : String(value)) + '">' +
                    '<span>' + attribute.key + '</span>' +
                    '<em>' + attribute.hint + '</em>';
            }

            attributesBox.appendChild(row);
        });

        // Los atributos que el objeto tiene y no están en la lista conocida. Se
        // muestran para que no se pierdan al guardar: si no aparecieran, guardar un
        // objeto desde el editor le borraría las propiedades que este formulario no
        // conoce.
        const extras = Object.keys(known).filter((key) =>
            !COMMON_ATTRIBUTES.some((attribute) => attribute.key === key));

        if (extras.length > 0) {
            const box = document.createElement('div');
            box.innerHTML = '<div class="section-title">Otras propiedades ' +
                '(se conservan tal cual)</div>';
            extras.forEach((key) => {
                const row = document.createElement('div');
                row.className = 'attribute-row readonly';
                row.innerHTML = '<span>' + key + '</span><em>' + known[key] + '</em>';
                box.appendChild(row);
            });
            form.appendChild(box);
        }

        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.innerHTML =
            '<button type="button" id="f-save">' +
            (isNew ? 'Crear objeto' : 'Guardar cambios') + '</button>' +
            (isNew ? '' : '<button type="button" id="f-delete" class="danger">Borrar</button>') +
            '<button type="button" id="f-new" class="plain">Nuevo</button>';
        form.appendChild(actions);

        document.getElementById('f-save').addEventListener('click', () => this._save(item));
        document.getElementById('f-new').addEventListener('click', () => {
            this.selected = null;
            this._renderList();
            this._renderForm(null);
        });

        if (!isNew) {
            document.getElementById('f-delete').addEventListener('click', () => this._delete(item));
        }
    }

    /** Recoge lo que hay en el formulario. */
    _collect(item) {
        const value = (id) => {
            const element = document.getElementById(id);
            return element ? element.value.trim() : '';
        };

        const attributes = {};

        // Se conservan los atributos desconocidos que ya tenía.
        if (item && item.attributes) {
            Object.keys(item.attributes).forEach((key) => {
                if (!COMMON_ATTRIBUTES.some((attribute) => attribute.key === key)) {
                    attributes[key] = item.attributes[key];
                }
            });
        }

        COMMON_ATTRIBUTES.forEach((attribute) => {
            const element = document.getElementById('a-' + attribute.key);
            if (!element) {
                return;
            }

            if (attribute.type === 'flag') {
                if (element.checked) {
                    attributes[attribute.key] = 1;
                }
                return;
            }

            const raw = element.value.trim();
            if (raw === '') {
                return;
            }
            attributes[attribute.key] = attribute.type === 'number' ? Number(raw) : raw;
        });

        const result = {
            name: value('f-name'),
            article: value('f-article') || undefined,
            plural: value('f-plural') || undefined,
            attributes: attributes
        };

        if (item && item.isRange) {
            result.fromid = Number(value('f-fromid'));
            result.toid = Number(value('f-toid'));
        } else {
            result.id = Number(value('f-id'));
        }

        return result;
    }

    async _save(item) {
        const payload = this._collect(item);

        if (!payload.name) {
            this._setStatus('el objeto necesita un nombre', true);
            return;
        }
        if (!payload.id && !payload.fromid) {
            this._setStatus('el objeto necesita un id', true);
            return;
        }

        this._setStatus('guardando...');

        const result = await this.api.saveItem(payload);

        if (result.error) {
            this._setStatus('no se guardo: ' + result.error, true);
            return;
        }

        this.selected = null;
        await this.load();
        this.onSaved();
        this._setStatus('guardado (' + result.action + '): ' + payload.name);
    }

    async _delete(item) {
        // Se avisa de lo que va a pasar de verdad. Un objeto borrado que aparece en un
        // mapa deja el mapa invalido, y el fallo salta al arrancar el motor.
        const confirmed = window.confirm(
            '¿Borrar el objeto "' + item.name + '" (id ' + item.id + ')?\n\n' +
            'Si algun mapa lo usa, ese mapa dejara de cargar. No se comprueba solo.');

        if (!confirmed) {
            return;
        }

        const result = await this.api.deleteItem(item.id);
        this.selected = null;
        await this.load();
        this.onSaved();
        this._setStatus(result.error ? result.error : 'borrado: ' + item.name, !!result.error);
    }

    _setStatus(text, isError) {
        if (!this.statusElement) {
            return;
        }
        this.statusElement.textContent = text;
        this.statusElement.className = isError ? 'error' : '';
    }
}

export { COMMON_ATTRIBUTES };
