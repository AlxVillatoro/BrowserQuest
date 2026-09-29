'use strict';

/**
 * Planificador de eventos temporizados.
 *
 * Todo lo que ocurre "dentro de un rato" en el servidor pasa por aquí: terminar un
 * paso, reaparecer un monstruo tras morir, regenerar salud, cerrar una puerta,
 * expirar un efecto. Sin un planificador central, cada sistema acabaría con su
 * propio `setTimeout`, y entonces no habría forma de pausar el mundo, ni de
 * acelerarlo en las pruebas, ni de saber cuántos temporizadores hay vivos.
 *
 * La estructura es un **montículo binario** ordenado por (momento, secuencia):
 *
 *   - Por momento, para sacar siempre el evento más próximo en O(log n).
 *   - Y por secuencia como desempate, para que dos eventos programados para el
 *     mismo milisegundo se ejecuten en el orden en que se programaron. Sin ese
 *     desempate, dos eventos simultáneos podrían invertirse entre ejecuciones y
 *     producir un fallo que aparece una de cada cien veces.
 *
 * Un array ordenado también serviría, pero insertar en él es O(n) y con miles de
 * monstruos regenerando a la vez eso se nota.
 */

class Scheduler {
    constructor(options) {
        const opts = options || {};

        /** Reloj inyectable, para poder avanzar el tiempo en las pruebas. */
        this.now = opts.now || (() => Date.now());

        this.heap = [];
        this.sequence = 0;
        this.log = opts.logger || null;

        /** Contadores para poder ver la carga del servidor sin instrumentarlo. */
        this.stats = { scheduled: 0, executed: 0, cancelled: 0 };
    }

    /**
     * Programa una tarea.
     *
     * @param {number} delayMs
     * @param {Function} callback
     * @param {string} [label] para los diagnósticos
     * @returns {Object} handle, para poder cancelarla
     */
    schedule(delayMs, callback, label) {
        const event = {
            at: this.now() + Math.max(0, delayMs),
            sequence: this.sequence++,
            callback: callback,
            label: label || null,
            cancelled: false,
            executed: false
        };

        this._push(event);
        this.stats.scheduled += 1;
        return event;
    }

    /** Cancela un evento. Es perezoso: se descarta al llegar a su momento. */
    cancel(event) {
        if (event && !event.executed && !event.cancelled) {
            event.cancelled = true;
            this.stats.cancelled += 1;
            return true;
        }
        return false;
    }

    /**
     * Ejecuta todo lo que ya venció.
     *
     * Los eventos pueden programar otros eventos, y esos se tendrán en cuenta en
     * esta misma pasada si ya vencieron. Es lo que permite encadenar pasos sin
     * esperar al siguiente tick.
     *
     * @param {number} [budgetMs] límite de tiempo para no bloquear el bucle. Si se
     *        agota, el resto se deja para el tick siguiente.
     * @returns {{executed: number, remaining: number, budgetExhausted: boolean}}
     */
    tick(budgetMs) {
        const now = this.now();
        const budget = budgetMs === undefined ? 20 : budgetMs;
        const startedAt = Date.now();

        let executed = 0;

        while (this.heap.length > 0) {
            const next = this.heap[0];
            if (next.at > now) {
                break;
            }

            this._pop();

            if (next.cancelled) {
                continue;
            }

            next.executed = true;
            executed += 1;
            this.stats.executed += 1;

            try {
                next.callback(now);
            } catch (error) {
                // Un evento que falla no debe arrastrar a los demás: se registra
                // con su etiqueta y se sigue. Si un sistema revienta, los otros
                // siguen funcionando, que es lo que se quiere en un servidor vivo.
                if (this.log) {
                    this.log.error('evento programado fallo' +
                        (next.label ? ' [' + next.label + ']' : '') + ':\n' +
                        (error && error.stack ? error.stack : error));
                }
            }

            if (Date.now() - startedAt >= budget) {
                return {
                    executed: executed,
                    remaining: this.heap.length,
                    budgetExhausted: true
                };
            }
        }

        return { executed: executed, remaining: this.heap.length, budgetExhausted: false };
    }

    get size() {
        return this.heap.length;
    }

    clear() {
        this.heap.length = 0;
    }

    // -----------------------------------------------------------------------
    // Montículo binario
    // -----------------------------------------------------------------------

    _less(a, b) {
        if (a.at !== b.at) {
            return a.at < b.at;
        }
        return a.sequence < b.sequence;
    }

    _push(event) {
        this.heap.push(event);

        let index = this.heap.length - 1;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (this._less(this.heap[index], this.heap[parent])) {
                const swap = this.heap[parent];
                this.heap[parent] = this.heap[index];
                this.heap[index] = swap;
                index = parent;
            } else {
                break;
            }
        }
    }

    _pop() {
        const top = this.heap[0];
        const last = this.heap.pop();

        if (this.heap.length > 0) {
            this.heap[0] = last;

            let index = 0;
            for (;;) {
                const left = index * 2 + 1;
                const right = left + 1;
                let smallest = index;

                if (left < this.heap.length && this._less(this.heap[left], this.heap[smallest])) {
                    smallest = left;
                }
                if (right < this.heap.length && this._less(this.heap[right], this.heap[smallest])) {
                    smallest = right;
                }
                if (smallest === index) {
                    break;
                }

                const swap = this.heap[index];
                this.heap[index] = this.heap[smallest];
                this.heap[smallest] = swap;
                index = smallest;
            }
        }

        return top;
    }
}

module.exports = { Scheduler };
