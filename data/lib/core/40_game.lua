--[[
    Game: la API pública que ven los scripts.

    Todo lo que hay aquí son envoltorios finos sobre `Engine`, la tabla primitiva
    que publica el motor. La separación importa:

      - `Engine` es la frontera. Sólo números y cadenas. Es fea y es rápida.
      - `Game` es la cara bonita. Es lo que usa un script.

    Si algún día hace falta rendimiento en un camino muy caliente, se puede
    llamar a `Engine` directamente sin dejar de ser correcto.
--]]

Game = {}

--- Crea un tipo de monstruo. Devuelve el objeto de registro:
---     local mType = Game.createMonsterType("Rat")
---     mType:register(monster)
function Game.createMonsterType(name)
    return MonsterType(name)
end

--- Tiempo de juego transcurrido, en segundos.
function Game.getWorldTime()
    return Engine.getWorldTime()
end

--- Escribe en el log del servidor, no en el chat de nadie.
function Game.log(...)
    local parts = {}
    for _, value in ipairs({ ... }) do
        table.insert(parts, tostring(value))
    end
    Engine.log(table.concat(parts, " "))
end

--- Nombre del TIPO de item a partir de su id. `Game.getItemName(3031)`.
function Game.getItemName(itemId)
    return Engine.getItemName(itemId)
end

--- Atributo declarado en items.xml, o nil. `Game.getItemAttribute(2400, "attack")`.
function Game.getItemAttribute(itemId, key)
    return Engine.getItemAttribute(itemId, key)
end

--- Crea una instancia de item en el mundo y devuelve su objeto Item.
function Game.createItem(itemId, count)
    local uid = Engine.createItem(itemId, count or 1)
    if not uid or uid == 0 then
        return nil
    end
    return Item(uid)
end
