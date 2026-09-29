'use strict';

/**
 * Evento de criatura: al matar.
 *
 * Los eventos de criatura son el mecanismo de TFS para reaccionar a lo que le pasa
 * a un jugador o a un monstruo: `onKill`, `onDeath`, `onAdvance`. Se declaran con
 * `type: 'event'` y el nombre del callback lo decide el tipo, igual que en los
 * movimientos.
 *
 * Una nota sobre el orden, que importa al escribir estos handlers: `onKill` y
 * `onDeath` se avisan ANTES de que el monstruo salga del mundo, así que aquí se
 * puede leer su nombre y su posición. Es lo que permite escribir misiones y logros
 * sin haber tenido que guardar esos datos por adelantado.
 */
module.exports = {
    type: 'event',
    event: 'kill',

    /**
     * @param {Player} player el que dio el golpe de gracia
     * @param {Monster} monster la criatura muerta
     */
    onKill(player, monster) {
        // Un monstruo puede morir por una trampa, sin que nadie lo mate.
        if (!player || !monster) {
            return false;
        }

        const name = monster.getName();
        player.sendTextMessage('Has matado a ' + name + '.');

        const experience = monster.getExperience();
        if (experience > 0) {
            player.sendTextMessage('Has ganado ' + experience + ' de experiencia.');
        }

        return true;
    }
};
