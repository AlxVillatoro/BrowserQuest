--[[
    Position: una coordenada del mundo.

    Este archivo y los que le siguen son la capa que convierte la API primitiva
    del motor (identificadores sueltos) en la API cómoda que espera quien escribe
    un datapack.

    Está en Lua a propósito. Medido, envolver las entidades como userdata de
    JavaScript cuesta entre 3,9x y 5,1x el coste de pasar un entero; construir el
    azúcar aquí cuesta entre 2,0x y 3,8x. Además, al ser código Lua normal, se
    puede leer, depurar y extender sin tocar el motor ni recompilar nada.
--]]

Position = {}
Position.__index = Position

function Position.new(x, y, z)
    return setmetatable({ x = x or 0, y = y or 0, z = z or 0 }, Position)
end

-- Permite escribirlo como en TFS: Position(x, y, z) en vez de Position.new(...).
setmetatable(Position, {
    __call = function(_, x, y, z)
        return Position.new(x, y, z)
    end
})

function Position:__tostring()
    return string.format("(%d, %d, %d)", self.x, self.y, self.z)
end

function Position:copy()
    return Position.new(self.x, self.y, self.z)
end

function Position:isZero()
    return self.x == 0 and self.y == 0 and self.z == 0
end

function Position:equals(other)
    return other ~= nil
        and self.x == other.x
        and self.y == other.y
        and self.z == other.z
end

-- Las escaleras, en Tibia, no son geometría: son desplazamientos de la
-- coordenada Z. Por eso subir y bajar es aritmética y no una consulta al mapa.
function Position:moveUpstairs()
    self.z = self.z + 1
end

function Position:moveDownstairs()
    self.z = self.z - 1
end
