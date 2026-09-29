'use strict';

/**
 * Registro de contenido y despacho de eventos.
 *
 * El contenido se declara con módulos que exportan una definición. Ésa es toda
 * la API que hay que aprender para añadir algo al juego:
 *
 *   action      -> un item que hace algo al usarlo
 *   movement    -> algo que ocurre al pisar, salir, equipar o soltar
 *   talkaction  -> un comando de chat
 *   monster     -> un tipo de monstruo
 *
 * No hay paso de registro que se pueda olvidar: si el módulo existe y exporta una
 * definición válida, queda registrado al arrancar. En la etapa anterior, con Lua,
 * había que llamar a `:register()` al final de cada script, y olvidarlo era un
 * fallo silencioso: el script se cargaba sin error y no hacía nada.
 *
 * Los handlers se invocan de forma DIRECTA, sin puente. Ésa es la ganancia
 * concreta frente a la versión con Lua, donde cada llamada cruzaba una frontera
 * y costaba entre 2x y 18x según cómo se pasaran las entidades.
 */

const { EntityFactory } = require('./entities');

/** El nombre del callback de un movimiento lo decide su tipo de evento. */
const MOVEMENT_CALLBACKS = {
    stepin: 'onStepIn',
    stepout: 'onStepOut',
    equip: 'onEquip',
    deequip: 'onDeEquip',
    additem: 'onAddItem',
    removeitem: 'onRemoveItem'
};

const KINDS = ['action', 'movement', 'talkaction', 'monster'];

/** Canales de chat, para el cuarto argumento de `onSay`. */
const TALKTYPE_SAY = 1;
const TALKTYPE_WHISPER = 2;
const TALKTYPE_YELL = 3;

/** Normaliza `ids`, que puede ser un número suelto o un array. */
function toIdList(value) {
    if (value === undefined || value === null) {
        return [];
    }
    const list = Array.isArray(value) ? value : [value];
    return list.map(Number).filter((n) => !Number.isNaN(n));
}

class ScriptRegistry {
    constructor(options) {
        this.world = options.world;
        this.log = options.logger;
        this.entities = new EntityFactory(this.world);

        this.actions = new Map();       // itemId      -> { handler, script }
        this.movements = new Map();     // "evento:id" -> { handler, script }
        this.talkActions = [];          // { words, handler, script }
        this.registeredScripts = new Set();

        // Los tipos de monstruo son contenido, y el mundo es su dueño: el
        // registro escribe directamente en él en vez de mantener una segunda
        // copia que se pueda desincronizar.
        this.monsterTypes = this.world.monsterTypes;
    }

    // -----------------------------------------------------------------------
    // Registro
    // -----------------------------------------------------------------------

    /**
     * Registra una definición exportada por un módulo de contenido.
     *
     * @param {Object} definition
     * @param {string} script ruta relativa, sólo para diagnósticos
     * @returns {{kind: string, count: number}}
     */
    register(definition, script) {
        if (!definition || typeof definition !== 'object') {
            throw new Error('el modulo no exporta un objeto de definicion');
        }

        switch (definition.type) {
            case 'action':
                return this._registerAction(definition, script);
            case 'movement':
                return this._registerMovement(definition, script);
            case 'talkaction':
                return this._registerTalkAction(definition, script);
            case 'monster':
                return this._registerMonster(definition, script);
            default:
                throw new Error("tipo de definicion desconocido: " + JSON.stringify(definition.type) +
                    '. Se esperaba uno de: ' + KINDS.join(', '));
        }
    }

    _registerAction(definition, script) {
        const ids = toIdList(definition.ids);
        if (ids.length === 0) {
            throw new Error("una accion necesita 'ids' (numero o array de numeros)");
        }
        if (typeof definition.onUse !== 'function') {
            throw new Error("una accion necesita 'onUse'");
        }

        ids.forEach((id) => {
            const existing = this.actions.get(id);
            if (existing) {
                this.log.warning('accion duplicada para el item ' + id + ': ' +
                    existing.script + ' y ' + script);
            }
            this.actions.set(id, { handler: definition.onUse, script: script });
        });

        this.registeredScripts.add(script);
        return { kind: 'action', count: ids.length };
    }

    _registerMovement(definition, script) {
        const event = String(definition.event || 'stepin').toLowerCase();
        const callbackName = MOVEMENT_CALLBACKS[event];

        if (!callbackName) {
            throw new Error("tipo de movimiento desconocido: '" + definition.event +
                "'. Validos: " + Object.keys(MOVEMENT_CALLBACKS).join(', '));
        }
        if (typeof definition[callbackName] !== 'function') {
            throw new Error("un movimiento de tipo '" + event + "' necesita '" + callbackName + "'");
        }

        const ids = toIdList(definition.ids);
        if (ids.length === 0) {
            throw new Error("un movimiento necesita 'ids'");
        }

        ids.forEach((id) => {
            this.movements.set(event + ':' + id, { handler: definition[callbackName], script: script });
        });

        this.registeredScripts.add(script);
        return { kind: 'movement', count: ids.length };
    }

    _registerTalkAction(definition, script) {
        if (typeof definition.words !== 'string' || definition.words === '') {
            throw new Error("una talkaction necesita 'words', por ejemplo words: '/pos'");
        }
        if (typeof definition.onSay !== 'function') {
            throw new Error("una talkaction necesita 'onSay'");
        }

        const words = definition.words.toLowerCase();
        const existing = this.talkActions.find((t) => t.words === words);
        if (existing) {
            this.log.warning('talkaction duplicada "' + words + '": ' +
                existing.script + ' y ' + script);
        }

        this.talkActions.push({ words: words, handler: definition.onSay, script: script });
        this.registeredScripts.add(script);
        return { kind: 'talkaction', count: 1 };
    }

    _registerMonster(definition, script) {
        if (typeof definition.name !== 'string' || definition.name === '') {
            throw new Error("un monstruo necesita 'name'");
        }
        if (this.monsterTypes.has(definition.name)) {
            this.log.warning('tipo de monstruo duplicado: ' + definition.name);
        }

        // El nombre y el origen se copian a la definición: son lo que hace falta
        // para poder decir de dónde salió un monstruo cuando algo no cuadra.
        const stored = { ...definition, script: script };
        delete stored.type;

        this.monsterTypes.set(definition.name, stored);
        this.registeredScripts.add(script);
        return { kind: 'monster', count: 1 };
    }

    // -----------------------------------------------------------------------
    // Despacho
    // -----------------------------------------------------------------------

    /**
     * Invoca un handler aislando los fallos: un script roto no debe tumbar el
     * tick del mundo. El error se registra con su ruta, que es lo que permite
     * encontrar el culpable entre cientos de módulos.
     */
    _invoke(entry, handlerName, args) {
        let result;
        try {
            result = entry.handler.apply(null, args);
        } catch (error) {
            this.log.error('error en ' + handlerName + ' de ' + entry.script + ':\n' +
                (error && error.stack ? error.stack : error));
            return { handled: false, error: error, script: entry.script };
        }

        // El tick del mundo es síncrono. Un handler `async` devolvería una
        // promesa que nadie espera, y el efecto llegaría tarde o nunca: es un
        // fallo silencioso, así que se avisa en voz alta.
        if (result && typeof result.then === 'function') {
            this.log.warning(handlerName + ' de ' + entry.script + ' devolvio una promesa. ' +
                'El tick del mundo es sincrono y no la espera: el handler debe ser sincrono.');
        }

        return { handled: result === true, result: result, script: entry.script };
    }

    /**
     * Acción de item: el `onUse` de TFS.
     * Firma del handler: (player, item, fromPosition, target, toPosition, isHotkey)
     */
    dispatchAction(itemId, context) {
        const entry = this.actions.get(Number(itemId));
        if (!entry) {
            return { handled: false };
        }

        const c = context || {};
        return this._invoke(entry, 'onUse', [
            this.entities.player(c.playerId || 0),
            // Igual que en los movimientos: el tipo se declara siempre, y el uid
            // sólo si el motor conoce la instancia concreta.
            this.entities.item(c.itemUid || 0, itemId),
            this.entities.position(c.fromX || 0, c.fromY || 0, c.fromZ || 0),
            c.targetId ? this.entities.item(c.targetUid || 0, c.targetId) : null,
            this.entities.position(c.toX || 0, c.toY || 0, c.toZ || 0),
            c.isHotkey === true
        ]);
    }

    /**
     * Movimiento: el `onStepIn` / `onStepOut` / `onEquip` de TFS.
     *
     * IMPORTANTE: la firma NO es la misma para todos los tipos de evento. En TFS
     * está verificado en el código que son distintas, y pasar los argumentos
     * equivocados produce un handler que recibe basura sin dar ningún error:
     *
     *   stepin / stepout  (creature, item, position, fromPosition)
     *   equip / deequip   (player, item, slot, isCheck)
     *   additem/removeitem(moveitem, tileitem, position)
     *
     * TODO: la búsqueda en TFS tiene precedencia uniqueid -> actionid -> itemid.
     * Aquí sólo se resuelve por itemid, porque todavía no hay action ids en el
     * mapa. Cuando los haya, esta es la función que debe implementar la cascada.
     */
    dispatchMovement(event, itemId, context) {
        const normalized = String(event).toLowerCase();
        const entry = this.movements.get(normalized + ':' + Number(itemId));
        if (!entry) {
            return { handled: false };
        }

        const c = context || {};
        const creature = this.entities.player(c.creatureId || 0);

        // El evento se registra por TIPO de item, pero el handler debe recibir la
        // INSTANCIA que hay en el tile. El motor conoce las dos, así que se pasan
        // las dos: el uid si existe, y siempre el tipo (que es lo que permite que
        // getName() funcione aunque no haya instancia).
        const item = this.entities.item(c.itemUid || 0, itemId);

        let args;
        switch (normalized) {
            case 'equip':
            case 'deequip':
                args = [creature, item, c.slot || 0, c.isCheck === true];
                break;

            case 'additem':
            case 'removeitem':
                args = [
                    item,
                    this.entities.item(c.tileItemId || 0),
                    this.entities.position(c.x || 0, c.y || 0, c.z || 0)
                ];
                break;

            default:
                args = [
                    creature,
                    item,
                    this.entities.position(c.x || 0, c.y || 0, c.z || 0),
                    this.entities.position(c.fromX || 0, c.fromY || 0, c.fromZ || 0)
                ];
        }

        return this._invoke(entry, MOVEMENT_CALLBACKS[normalized], args);
    }

    /**
     * Comando de chat: el `onSay` de TFS.
     * Firma del handler: (player, words, param, type)
     *
     * `type` es el canal por el que se dijo (hablar, susurrar, gritar): un script
     * puede querer tratarlos distinto, y omitirlo sería recortar la API real.
     *
     * La coincidencia es por prefijo, que es lo que permite que "/item 3031"
     * active la talkaction registrada como "/item". Se exige que lo que sigue
     * sea un espacio, para que "/itemx" no active "/item".
     */
    dispatchTalkAction(words, context) {
        const lower = String(words).toLowerCase();

        const matches = this.talkActions.filter((t) =>
            lower === t.words || lower.startsWith(t.words + ' '));

        if (matches.length === 0) {
            return { handled: false };
        }

        // Si varias casan, gana la más específica: "/item" antes que "/i".
        matches.sort((a, b) => b.words.length - a.words.length);
        const entry = matches[0];

        const c = context || {};
        const param = String(words).slice(entry.words.length).replace(/^\s+/, '');

        return this._invoke(entry, 'onSay', [
            this.entities.player(c.playerId || 0),
            words,
            param,
            c.type === undefined ? TALKTYPE_SAY : c.type
        ]);
    }

    // -----------------------------------------------------------------------
    // Informe
    // -----------------------------------------------------------------------

    stats() {
        return {
            registeredScripts: this.registeredScripts.size,
            actions: this.actions.size,
            movements: this.movements.size,
            talkActions: this.talkActions.length,
            monsterTypes: this.monsterTypes.size
        };
    }
}

module.exports = { ScriptRegistry, MOVEMENT_CALLBACKS, KINDS, TALKTYPE_SAY, TALKTYPE_WHISPER, TALKTYPE_YELL };
