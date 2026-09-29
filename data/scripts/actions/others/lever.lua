--[[
    Palanca que sube al jugador una planta.

    Versión reducida de data/scripts/actions/others/teleport.lua de The Forgotten
    Server, para poder comparar el patrón con el original. Lo que se conserva:

      - `local action = Action()` y el callback en `action.onUse`.
      - `action:id(...)` para declarar los items, y `action:register()` al final.
      - La firma completa del handler: (player, item, fromPosition, target,
        toPosition, isHotkey).

    Lo que aquí es aritmética es exactamente lo que en Tibia es subir de planta:
    las escaleras no son geometría, son un desplazamiento de la coordenada Z.
--]]

local action = Action()

function action.onUse(player, item, fromPosition, target, toPosition, isHotkey)
	local destination = player:getPosition()
	destination:moveUpstairs()

	if not player:teleportTo(destination) then
		player:sendTextMessage("No puedes subir aqui.")
		return true
	end

	player:sendTextMessage("Subes a " .. tostring(destination) .. ".")
	return true
end

action:id(1948)
action:register()
