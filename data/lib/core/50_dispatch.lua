--[[
    Puente entre el motor y los handlers de los scripts.

    El motor no sabe qué forma tiene un `player` en Lua ni quiere saberlo. Cuando
    ocurre un evento, el motor:
      1. busca la función registrada,
      2. pasa los identificadores crudos a estas funciones,
      3. y éstas construyen los objetos y llaman al handler del script.

    Toda la traducción vive en un solo sitio, en Lua. Si mañana cambia cómo se
    representa un jugador, se cambia aquí y ningún script se entera.
--]]

__engine_dispatch = {}

--[[
    Una acción de item: el `onUse` de TFS.

    Firma del handler: (player, item, fromPosition, target, toPosition, isHotkey)
--]]
function __engine_dispatch.action(handler, playerId, itemId, fromX, fromY, fromZ,
                                  targetId, toX, toY, toZ, isHotkey)
    local player = Player(playerId)
    local item = Item(itemId)

    -- targetId = 0 significa "usado sin objetivo" (en el suelo), y ahí el
    -- handler debe recibir nil, no un Item fantasma.
    local target = nil
    if targetId and targetId ~= 0 then
        target = Item(targetId)
    end

    local fromPosition = Position(fromX, fromY, fromZ)
    local toPosition = Position(toX, toY, toZ)

    return handler(player, item, fromPosition, target, toPosition, isHotkey == 1)
end

--[[
    Un movimiento: el `onStepIn` / `onStepOut` / `onEquip` de TFS.

    Firma del handler: (creature, item, position, fromPosition)
--]]
function __engine_dispatch.movement(handler, creatureId, itemId, x, y, z, fromX, fromY, fromZ)
    local creature = Player(creatureId)
    local item = Item(itemId)
    local position = Position(x, y, z)
    local fromPosition = Position(fromX, fromY, fromZ)

    return handler(creature, item, position, fromPosition)
end

--[[
    Un comando de chat: el `onSay` de TFS.

    El script recibe (player, words, param), donde `param` es lo que va después
    del comando. Es lo que permite escribir "/pos" y "/add 3031" con el mismo
    mecanismo.
--]]
function __engine_dispatch.talkaction(handler, playerId, words, matchedWords)
    local player = Player(playerId)
    local param = string.sub(words, #matchedWords + 1)
    param = string.gsub(param, "^%s+", "")

    return handler(player, words, param)
end
