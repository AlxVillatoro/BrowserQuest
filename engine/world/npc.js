'use strict';

/**
 * Los NPC: criaturas que hablan.
 *
 * Son la otra pata del contenido, junto a los monstruos. Un monstruo existe para que le
 * pegues; un NPC existe para que le hables, y eso necesita dos cosas que un monstruo no
 * tiene: **memoria de con quién está hablando** y **palabras clave**.
 *
 * EL FOCO ES LO PRIMERO QUE HAY QUE ENTENDER. Un NPC no responde a todo el que habla: en
 * cuanto alguien le saluda, se centra en ESA persona y sólo le atiende a ella hasta que
 * se despide o pasa un rato sin decir nada. Sin foco, un NPC en una plaza con cinco
 * jugadores contestaría a los cinco a la vez y la conversación sería un galimatías.
 *
 * Y LAS PALABRAS CLAVE SE MIRAN EN ORDEN, GANANDO LA PRIMERA. Es el modelo de TFS y
 * tiene una consecuencia que hay que respetar al escribir el contenido: si pones una
 * palabra clave general antes que una concreta, la general se come a la concreta. Por eso
 * el orden de la lista es significativo y no una lista sin más.
 */

const { Creature, DIRECTION } = require('./creature');
const { normalizeOutfit } = require('./outfit');

/** Cuánto tiempo sigue un NPC pendiente de alguien sin que le diga nada. */
const FOCUS_TIMEOUT_MS = 60000;

/** A qué distancia oye un NPC. */
const HEARING_RADIUS = 4;

/**
 * Parte una frase en palabras.
 *
 * Se quitan los signos para que `hola!` y `hola` sean lo mismo, y se pasa a minúsculas
 * porque nadie escribe los comandos dos veces igual. Es lo que hace que un NPC no parezca
 * tonto por una coma.
 */
function tokenize(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
}

/** ¿Aparece alguna de estas palabras en la frase? */
function matchesWords(keywordWords, words) {
    return keywordWords.some((word) => {
        const clean = String(word).toLowerCase();
        // Una palabra clave de varias palabras ("buenos dias") se busca como frase.
        return clean.indexOf(' ') !== -1
            ? words.join(' ').indexOf(clean) !== -1
            : words.indexOf(clean) !== -1;
    });
}

class Npc extends Creature {
    /**
     * @param {Object} options
     * @param {Object} options.definition lo cargado de `data/npc/npcs.xml`
     */
    constructor(options) {
        const opts = options || {};

        super({
            name: opts.name,
            position: opts.position,
            speed: opts.speed === undefined ? 100 : opts.speed,
            maxHealth: opts.maxHealth === undefined ? 100 : opts.maxHealth,
            direction: DIRECTION.SOUTH
        });

        this.definition = opts.definition || {};
        this.outfit = normalizeOutfit(this.definition.outfit || {});

        /** Dónde apareció, que es el centro de su paseo. */
        this.home = { ...this.position };

        this.walkInterval = this.definition.walkInterval || 0;
        this.walkRadius = this.definition.walkRadius || 0;
        this.nextWalkAt = 0;

        /**
         * Con quién está hablando, y hasta cuándo.
         *
         * Se guarda el JUGADOR y no su identificador porque hace falta comprobar que
         * siga existiendo: si se desconecta a mitad de una conversación, el foco apunta a
         * alguien que ya no está.
         */
        this.focus = null;
        this.focusUntil = 0;

        /** Las palabras clave, EN ORDEN. Gana la primera que casa. */
        this.keywords = [];

        /** Qué decir cuando no casa ninguna y hay foco. */
        this.defaultHandler = null;

        /** Cuántas veces ha hablado, para las pruebas y los diagnósticos. */
        this.saidCount = 0;
    }

    get kind() {
        return 'npc';
    }

    isNpc() {
        return true;
    }

    // -----------------------------------------------------------------------
    // El diálogo
    // -----------------------------------------------------------------------

    /**
     * Declara una palabra clave.
     *
     * @param {Array<string>} words con que casa
     * @param {Function} handler `(npc, player, words) => void`
     * @param {Object} [options]
     * @param {boolean} [options.greeting] también funciona SIN foco, y lo establece
     * @param {boolean} [options.farewell] suelta el foco después de responder
     */
    addKeyword(words, handler, options) {
        const opts = options || {};

        this.keywords.push({
            words: Array.isArray(words) ? words : [words],
            handler: handler,
            greeting: opts.greeting === true,
            farewell: opts.farewell === true
        });

        return this;
    }

    /** Qué decir cuando no casa ninguna palabra clave. */
    setDefault(handler) {
        this.defaultHandler = handler;
        return this;
    }

    setFocus(player, now) {
        this.focus = player;
        this.focusUntil = (now === undefined ? Date.now() : now) + FOCUS_TIMEOUT_MS;
        return this;
    }

    clearFocus() {
        this.focus = null;
        this.focusUntil = 0;
        return this;
    }

    /** ¿Está pendiente de este jugador ahora mismo? */
    isFocusedOn(player, now) {
        if (!this.focus || this.focus !== player) {
            return false;
        }
        if ((now === undefined ? Date.now() : now) > this.focusUntil) {
            // Se le pasó el tiempo. Se suelta aquí y no con un temporizador: así no hay
            // nada que cancelar si el jugador se va, y el estado no puede quedar a medias.
            this.clearFocus();
            return false;
        }
        return true;
    }

    /**
     * Alguien ha hablado cerca.
     *
     * @returns {{heard: boolean, replied: boolean, reason?: string}}
     */
    hear(speaker, text, now) {
        const at = now === undefined ? Date.now() : now;

        // Un NPC sólo oye de cerca. Sin esto respondería desde el otro lado del mapa, que
        // es el mismo problema que tendría un jugador que oye a todos.
        const distance = Math.max(
            Math.abs(this.position.x - speaker.position.x),
            Math.abs(this.position.y - speaker.position.y));

        if (this.position.z !== speaker.position.z || distance > HEARING_RADIUS) {
            return { heard: false, replied: false, reason: 'tooFar' };
        }

        const words = tokenize(text);
        const focused = this.isFocusedOn(speaker, at);

        /*
         * SIN FOCO SÓLO SE RESPONDE A LOS SALUDOS.
         *
         * Es lo que hace que un NPC en una plaza concurrida sea usable: si contestara a
         * cualquier frase, cinco jugadores hablando a la vez le harían responder a todos
         * y la conversación no sería de nadie.
         */
        const keyword = this.keywords.find((entry) =>
            (focused || entry.greeting) && matchesWords(entry.words, words));

        if (keyword) {
            if (keyword.greeting && !focused) {
                this.setFocus(speaker, at);
            } else if (focused) {
                // Cada intervención renueva el plazo: mientras hablen, no se despista.
                this.focusUntil = at + FOCUS_TIMEOUT_MS;
            }

            /*
             * AL CONTENIDO SE LE PASA UN ENVOLTORIO, no la criatura.
             *
             * El foco se sigue guardando con la criatura de verdad —es la identidad, y dos
             * envoltorios distintos del mismo jugador no serían iguales—, pero lo que llega
             * al módulo de diálogo es el envoltorio, igual que en las acciones y los
             * comandos. Sin esto, un NPC podría mover jugadores por el mapa o cambiarles la
             * vida a mano, y la única razón por la que las demás formas de contenido no
             * pueden es que a ellas sí se les pasa el envoltorio.
             */
            keyword.handler(this, this._wrap(speaker), words);

            if (keyword.farewell) {
                this.clearFocus();
            }

            return { heard: true, replied: true, keyword: keyword.words[0] };
        }

        // Con foco y sin palabra clave, se dice algo. Callarse haría pensar que el NPC se
        // ha roto, y es lo que distingue "no te he entendido" de "no te estoy escuchando".
        if (focused && this.defaultHandler) {
            this.focusUntil = at + FOCUS_TIMEOUT_MS;
            this.defaultHandler(this, this._wrap(speaker), words);
            return { heard: true, replied: true, keyword: 'default' };
        }

        return { heard: true, replied: false, reason: focused ? 'noKeyword' : 'notFocused' };
    }

    /**
     * El envoltorio de contenido de una criatura.
     *
     * Lo instala el mundo al crear el NPC. Si no estuviera —por ejemplo en una prueba que
     * construye un NPC a mano— se devuelve la criatura tal cual, para que el diálogo
     * funcione igual aunque sea sin la protección.
     */
    _wrap(creature) {
        return this.wrapSpeaker ? this.wrapSpeaker(creature) : creature;
    }

    /**
     * El NPC dice algo.
     *
     * SE AVISA EN EL MOMENTO, no se guarda para luego. Es lo que hace que una respuesta de
     * tres frases salga en orden y no las tres de golpe al final: el mundo engancha
     * `onSayLine` a la difusión del habla, así que cada frase sale cuando se dice.
     *
     * Y el NPC puede decir varias cosas en una respuesta —una para saludar y otra para
     * responder— sin que quien escribe el contenido tenga que juntarlas en una cadena.
     */
    say(text) {
        const line = String(text);

        this.saidCount += 1;
        this.lastSaid = line;

        if (this.onSayLine) {
            this.onSayLine(line);
        }

        return line;
    }

    // -----------------------------------------------------------------------
    // El paseo
    // -----------------------------------------------------------------------

    /**
     * Decide si da un paso.
     *
     * NO PASEA MIENTRAS HABLA. Un NPC que se aleja a mitad de una conversación es
     * exactamente igual de molesto que una persona que se va andando mientras le hablas, y
     * además obligaría a perseguirlo para seguir la conversación.
     *
     * @returns {{walked: boolean, direction?: number, reason?: string}}
     */
    think(now, random) {
        const at = now === undefined ? Date.now() : now;

        if (this.focus && this.isFocusedOn(this.focus, at)) {
            return { walked: false, reason: 'talking' };
        }
        if (this.walkInterval <= 0 || this.walkRadius <= 0) {
            return { walked: false, reason: 'stationary' };
        }
        if (at < this.nextWalkAt) {
            return { walked: false, reason: 'waiting' };
        }

        this.nextWalkAt = at + this.walkInterval;

        // Los pasos se eligen al azar, y el azar es inyectable para que las pruebas sean
        // reproducibles: un NPC que pasea con `Math.random` hace que cualquier prueba
        // sobre su posición sea una moneda al aire.
        const roll = (random || Math.random)();
        const direction = Math.floor(roll * 4) % 4;

        return { walked: true, direction: direction };
    }

    /** ¿Sigue estando dentro de su radio? */
    isWithinHome() {
        return Math.max(
            Math.abs(this.position.x - this.home.x),
            Math.abs(this.position.y - this.home.y)) <= this.walkRadius;
    }
}

/** Crea un NPC a partir de su definición. */
function createNpc(definition, position) {
    return new Npc({
        name: definition.name,
        position: position,
        definition: definition,
        speed: definition.speed,
        maxHealth: definition.maxHealth
    });
}

module.exports = {
    Npc,
    createNpc,
    tokenize,
    matchesWords,
    FOCUS_TIMEOUT_MS,
    HEARING_RADIUS
};
