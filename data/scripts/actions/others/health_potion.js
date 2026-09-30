'use strict';

/**
 * Poción de salud: dice cómo estás, y por qué no puede curarte.
 *
 * `data/items/items.xml`, en el bloque de las pociones, deja escrito que a estas les
 * falta "su módulo en `data/scripts/actions`, que es otro ámbito". Este es ese módulo, y
 * lo primero que hay que dejar claro es lo que NO puede hacer:
 *
 * NO CURA, Y NO ES UN DESCUIDO. `engine/world/creature.js` tiene un `heal(amount)`, pero
 * ningún envoltorio de los que se le pasan a un módulo lo expone —están todos en
 * `engine/scripting/entities.js`—: el contenido puede LEER la salud (`getHealth`,
 * `getMaxHealth`) y no puede escribirla. Escribir aquí `player.heal(125)` no daría una
 * poción que cura, daría una excepción en mitad del uso, que es peor que no curar. Es
 * exactamente el mismo caso que el NPC sanador, y se resuelve igual: mira
 * `data/npc/ciudad/sanador.js`, que ya tomó esta decisión y la explicó.
 *
 * Y lo que sí hay es un dato que el jugador NO tiene: el cliente dibuja una barra de
 * vida, no un número. Esta poción da el número y el porcentaje, que es lo único honesto
 * que se puede hacer con lo que hay. De dónde vuelve la salud de verdad son dos sitios y
 * los dos están en `engine/world/combat.js`: el templo al morir y subir de nivel. NO HAY
 * REGENERACIÓN POR TIEMPO, así que prometer "espera y se te pasa" sería mentira.
 *
 * TAMPOCO SE GASTA, y por eso el módulo no la borra ni la resta de ningún sitio. El
 * envoltorio del jugador sabe soltar (`dropItem`) y no sabe consumir: no existe una
 * llamada para gastar un objeto desde el contenido.
 *
 * UN AVISO SOBRE CUÁNDO SE EJECUTA ESTO, que conviene tener presente antes de buscar el
 * fallo en otro sitio: `registry.dispatchAction` no tiene hoy NINGUNA llamada en el
 * servidor. Los enganches que `engine/core/engine.js` conecta al mundo son los de
 * `stepin` y `stepout`, y nada más; `engine/net/session.js` maneja caminar, hablar,
 * mirar, recoger, soltar, atacar y girar, y ningún paquete de "usar objeto". Así que este
 * `onUse` se alcanza por la API del motor (`engine.dispatchAction`) y por las pruebas, no
 * jugando. Es una carencia del motor, y se escribe aquí para que nadie la busque en este
 * archivo.
 *
 * La firma es la de The Forgotten Server y tiene SEIS argumentos:
 *
 *     onUse(player, item, fromPosition, target, toPosition, isHotkey)
 *
 * Se reciben todos aunque hoy no se usen todos: recortar la firma es romper el contrato,
 * y el día que el motor mande el objetivo o el modo atajo, este módulo ya los tiene.
 */

module.exports = {
    type: 'action',

    ids: [2413],   // health potion

    onUse(player, item, fromPosition, target, toPosition, isHotkey) {
        // El máximo se protege ANTES de dividir, y no es paranoia: el envoltorio de un
        // jugador que ya no está devuelve 0 en vez de lanzar, y un 0 en el divisor saca
        // un "NaN%" por la pantalla, que es un mensaje que no se puede leer.
        const salud = player.getHealth();
        const maxima = player.getMaxHealth() || 1;
        const porcentaje = Math.round(salud * 100 / maxima);

        player.sendTextMessage('La pocion no te cura: aqui nadie sabe devolver vida desde ' +
            'el contenido. Estas a ' + salud + ' de ' + maxima + ' (' + porcentaje + '%).');

        // El consejo cambia con el estado, porque el mismo texto para los tres casos no
        // diría nada. Y el que está entero es el único al que hay que decirle que la
        // guarde.
        if (porcentaje >= 90) {
            player.sendTextMessage('Entero. Guardala para cuando no lo estes.');
        } else if (porcentaje > 0) {
            player.sendTextMessage('Devolverte la salud entera solo lo hace el templo, ' +
                'cuando caes, y subir de nivel. Andando no se te pasa.');
        } else {
            player.sendTextMessage('Estas muerto, y una pocion no discute eso.');
        }

        return true;
    }
};
