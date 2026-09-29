--[[
    Portal: avisa al pisarlo.

    El callback lo elige el tipo de evento, igual que en TFS: `type("stepin")`
    hace que el motor busque `moveevent.onStepIn`. Así un mismo archivo puede
    declarar varios tipos sin nombres inventados.
--]]

local moveevent = MoveEvent()

function moveevent.onStepIn(creature, item, position, fromPosition)
	if creature == nil then
		return false
	end

	creature:sendTextMessage("Un portal te absorbe.")
	return true
end

moveevent:type("stepin")
moveevent:id(1387)
moveevent:register()
