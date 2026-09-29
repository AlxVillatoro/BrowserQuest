--[[
    Comandos de chat: /pos y /item.

    El handler recibe (player, words, param), donde `param` es lo que va después
    del comando. Es el mismo mecanismo que usa TFS, y es lo que permite que
    "/pos" y "/item 3031" convivan sin casos especiales.
--]]

local posCommand = TalkAction("/pos")

function posCommand.onSay(player, words, param)
	local position = player:getPosition()
	local health, maxHealth = player:getHealth()

	player:sendTextMessage(string.format(
		"Posicion: %s  Vida: %d/%d  Nivel: %d  Vocacion: %s",
		tostring(position), health, maxHealth, player:getLevel(), tostring(player:getVocation())))

	return true
end

posCommand:register()


local itemCommand = TalkAction("/item")

function itemCommand.onSay(player, words, param)
	local itemId = tonumber(param)

	if itemId == nil then
		player:sendTextMessage("Uso: /item <id>")
		return true
	end

	local name = Game.getItemName(itemId)
	if name == nil then
		player:sendTextMessage("No existe ningun item con id " .. tostring(itemId))
		return true
	end

	Game.createItem(itemId, 1)
	player:sendTextMessage("Creado: " .. name)
	return true
end

itemCommand:register()
