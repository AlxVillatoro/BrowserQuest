--[[
    Player: la criatura controlada por un jugador.

    Nótese que NO guarda estado propio: sólo el identificador. Cada `getName()`
    o `getPosition()` pregunta al motor. Eso es lo que garantiza que un script no
    pueda quedarse con una copia obsoleta del estado del mundo, que es la clase
    de fallo más difícil de depurar en un servidor de juego.
--]]

Player = {}
Player.__index = Player

-- Caché débil por identificador: dos peticiones del mismo jugador devuelven el
-- mismo objeto Lua (para poder compararlos con ==), pero no se retienen para
-- siempre. Sin el modo débil esto sería una fuga de memoria por jugador.
local instances = setmetatable({}, { __mode = "v" })

function Player.new(id)
    local existing = instances[id]
    if existing then
        return existing
    end
    local self = setmetatable({ id = id }, Player)
    instances[id] = self
    return self
end

setmetatable(Player, {
    __call = function(_, id)
        return Player.new(id)
    end
})

function Player:__tostring()
    return "Player(" .. tostring(self.id) .. ")"
end

function Player:getId()
    return self.id
end

function Player:getName()
    return Engine.getPlayerName(self.id)
end

function Player:getPosition()
    local x, y, z = Engine.getPlayerPosition(self.id)
    return Position(x, y, z)
end

-- Devuelve dos valores, como en TFS: `local hp, maxHp = player:getHealth()`.
function Player:getHealth()
    local current, maximum = Engine.getPlayerHealth(self.id)
    return current, maximum
end

function Player:getLevel()
    return Engine.getPlayerLevel(self.id)
end

function Player:getVocation()
    return Engine.getPlayerVocation(self.id)
end

function Player:sendTextMessage(text)
    Engine.sendTextMessage(self.id, tostring(text))
end

function Player:teleportTo(position)
    if type(position) ~= "table" then
        return false
    end
    return Engine.teleportPlayer(self.id, position.x, position.y, position.z)
end
