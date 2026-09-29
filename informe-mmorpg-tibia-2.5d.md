# Informe técnico: cómo construir un MMORPG 2D estilo **Tibia** con sprites 2.5D

> Documento de investigación técnica. Combina mecánicas reales de Tibia (verificadas en el código fuente de los emuladores open-source **The Forgotten Server** y **OTClient**, que son reimplementaciones del protocolo y del cliente) con técnicas modernas de renderizado 2.5D y un catálogo de arte libre.
>
> **Nota de método:** donde el dato proviene de código fuente real, se cita el archivo. Donde proviene de la wiki/documentación, se cita el enlace. Donde es convención de la comunidad o práctica recomendada (no una constante del juego), se marca explícitamente como tal.

---

## Índice

1. [Tibia: mecánicas núcleo](#1-tibia-mecánicas-núcleo)
   - [1.1 Movimiento](#11-sistema-de-movimiento)
   - [1.2 Plantas / niveles Z](#12-sistema-de-plantas--niveles-z-multi-floor)
   - [1.3 Cámara y perspectiva](#13-perspectiva-de-cámara-ángulo-y-tamaño-de-tile)
   - [1.4 Combate](#14-combate)
   - [1.5 Inventario](#15-inventario)
   - [1.6 Progresión](#16-progresión)
   - [1.7 Mundo: tiles, paredes, luz](#17-mundo-tiles-paredes-apilables-use-with-luz)
   - [1.8 **Stackpos**: el sistema de apilado por tile](#18-stackpos--orden-de-apilado-por-tile-el-corazón-del-modelo-de-datos)
2. [Técnicas modernas de sprites 2.5D](#2-técnicas-modernas-de-sprites-25d)
3. [Ejemplos y arte de referencia](#3-ejemplos-y-arte-de-referencia)
4. [Recursos de arte libres](#4-recursos-de-arte-libres-cc0cc-by)
5. [Apéndice: plan de implementación recomendado](#5-apéndice-plan-de-implementación-recomendado)

---

## 1. Tibia: mecánicas núcleo

### 1.1 Sistema de movimiento

**Es una rejilla cuadrada con 8 direcciones, step-based (discreto), no fluido.**

El cliente de Tibia **no** es un motor de física continua: no hay velocidad en píxeles/segundo. El personaje *salta* de tile en tile; la animación de caminar es puramente visual (el cliente interpola el sprite entre la posición vieja y la nueva, pero el estado autoritativo del servidor es "estoy en el tile (x,y,z)").

Direcciones (enum del cliente, [OTClient `src/client/const.h`](https://github.com/opentibiabr/otclient/blob/main/src/client/const.h)):

```
North = 0, East, South, West, NorthEast, SouthEast, SouthWest, NorthWest, InvalidDirection
```

Es decir: **4 cardinales + 4 diagonales**. El protocolo permite caminar en diagonal.

#### Fórmula exacta del cooldown de paso

Esta es la parte más importante y la que casi todas las descripciones online hacen mal. Verificada en [`forgottenserver/src/creature.cpp`](https://github.com/otland/forgottenserver/blob/master/src/creature.cpp):

```cpp
double Creature::speedA = 857.36;
double Creature::speedB = 261.29;
double Creature::speedC = -4795.01;

int64_t Creature::getStepDuration() const
{
    uint32_t calculatedStepSpeed;
    uint32_t groundSpeed;

    int32_t stepSpeed = getStepSpeed();
    if (stepSpeed > -Creature::speedB) {
        calculatedStepSpeed =
            floor((Creature::speedA * log((stepSpeed / 2) + Creature::speedB) + Creature::speedC) + 0.5);
        if (calculatedStepSpeed == 0) calculatedStepSpeed = 1;
    } else {
        calculatedStepSpeed = 1;
    }

    Item* ground = tile->getGround();
    if (ground) {
        groundSpeed = Item::items[ground->getID()].speed;
        if (groundSpeed == 0) groundSpeed = 150;
    } else {
        groundSpeed = 150;
    }

    double duration = std::floor(1000 * groundSpeed / calculatedStepSpeed);
    int64_t stepDuration = std::ceil(duration / 50) * 50;   // ← cuantizado a 50 ms

    const Monster* monster = getMonster();
    if (monster && monster->isTargetNearby() && !monster->isFleeing() && !monster->getMaster()) {
        stepDuration *= 2;   // los monstruos en melee se mueven a la mitad de velocidad
    }

    return stepDuration;
}
```

Y el coste extra por dirección ([`creature.cpp`](https://github.com/otland/forgottenserver/blob/master/src/creature.cpp)):

```cpp
// Al completar un movimiento (onCreatureMove):
lastStepCost = 1;
if (oldPos.z != newPos.z) {
    lastStepCost = 2;                                        // cambio de piso ⇒ x2
} else if (newPos.getDistanceX(oldPos) >= 1 && newPos.getDistanceY(oldPos) >= 1) {
    lastStepCost = 3;                                        // diagonal ⇒ x3
}

// Y en el cálculo de duración según dirección:
int64_t Creature::getStepDuration(Direction dir) const {
    int64_t stepDuration = getStepDuration();
    if ((dir & DIRECTION_DIAGONAL_MASK) != 0) stepDuration *= 3;   // diagonal ⇒ x3
    return stepDuration;
}
```

**Lectura práctica:**

| Concepto | Valor |
|---|---|
| Tick del servidor ("server beat") | **50 ms** ([TibiaQA](https://www.tibiaqa.com/37185/what-is-the-maximum-steps-per-second-a-character-can-do)) |
| Duración de paso | múltiplo de 50 ms, mínimo 50 ms |
| `groundSpeed` por defecto | 150 |
| Modificador diagonal | ×3 en duración (⇒ ×1/3 de velocidad en tiles/s) |
| Modificador cambio de piso | ×2 |
| Piso "highway" (cómodo) | `groundSpeed` bajo (p. ej. 100) ⇒ más rápido |
| Piso "difícil" (arena, hierba alta) | `groundSpeed` alto ⇒ más lento |
| Velocidad máxima observada | 1 paso / 50 ms = **20 pasos/s** (solo con GM speed) |
| Velocidad "humana" práctica | ~1 paso / 100 ms = **10 pasos/s** de techo realista |

**Ejemplo numérico resuelto.** Para un jugador con `speed = 220` (stat visible en el cliente):

```
calculatedStepSpeed = floor(857.36·ln(220/2 + 261.29) − 4795.01 + 0.5)
                     = floor(857.36·ln(371.29) − 4795.01 + 0.5)
                     = floor(857.36·5.91699 − 4795.01 + 0.5)
                     = floor(5073.0 − 4795.01 + 0.5) = 278

duration    = floor(1000 · 150 / 278) = 539
stepDuration = ceil(539 / 50) · 50 = ceil(10.78)·50 = 11·50 = 550 ms
```

⇒ **~1.82 tiles/s en cardinal**. En diagonal: `×3` ⇒ 1650 ms ⇒ **~0.61 tiles/s**. La diagonal es *mucho* más lenta pero sigue ahorrando distancia euclídea (√2 ≈ 1.414 tiles recorridos), así que en trayectos largos compensa; en trayectos cortos no.

#### El stat `speed` y los "breakpoints"

- La fórmula clásica del stat de velocidad es `speed = 2·level + 2` (modificada por equipo, monturas, condiciones `haste`/`paralyze`). Ver [Tibia Fandom: Speed](https://tibia.fandom.com/wiki/Speed) y [Speed Breakpoints](https://tibia.fandom.com/wiki/Speed_Breakpoints).
- Debido a la **cuantización a 50 ms**, el stat `speed` tiene *breakpoints*: por debajo de cierto valor no ganás nada, de golpe saltás 50 ms. Esto se percibe in-game como "escalones" de velocidad. Es exactamente lo que produce la curva logarítmica + el `ceil(x/50)*50`.
- La velocidad **no** correlaciona linealmente con tiles/min: cada tipo de suelo tiene su propia "fricción" (`groundSpeed`). Ver [TibiaQA: convertir speed points a sqm/min](https://www.tibiaqa.com/24503/how-to-convert-speed-points-to-sqm-min).

#### Reglas de bloqueo de la diagonal

Convención de la comunidad (no hay una constante en el código de TFS que lo exprese; se implementa en el pathfinding y en el cliente): **no podés atravesar una esquina** entre dos tiles que bloquean. Si los dos tiles ortogonales adyacentes a tu movimiento diagonal están bloqueados, el paso falla con `RETURNVALUE_NOTENOUGHROOM` / `NOTPOSSIBLE`. Hay hilos clásicos en OTLand sobre esto (p. ej. ["Cant use item if creature on top"](https://otland.net/threads/cant-use-item-if-creature-on-top.271474/), y tutoriales de ajuste de caminata diagonal como [este de TibiaKing](https://tibiaking.com/topic/84300-tutorial-ajustando-andar-diagonal/)).

#### Auto-walk y pathfinding

El servidor guarda una `std::list<Direction> listWalkDir` y va desapilando una dirección por tick (`Creature::getNextStep`). El cliente envía la lista completa de direcciones (`Game::playerAutoWalk`). El pathfinding es **A\*** sobre la rejilla con `FindPathParams` (`fullPathSearch`, `clearSight`, `maxSearchDist`, `minTargetDist`, `maxTargetDist`) — ver [`game.h`](https://github.com/otland/forgottenserver/blob/master/src/game.h) y `FrozenPathingConditionCall` en `creature.cpp`.

**Implicación para tu clon:** si querés que se *sienta* como Tibia, el cliente debe poder predecir y encolar pasos localmente (el clásico "smart walk" que combina Norte+Oeste en NorOeste). Ver `walking.lua` de OTClientV8, citado en [este hilo de OTLand](https://otland.net/threads/tfs-1-5-8-60-walk-delay.289889/), que tiene exactamente esa lógica:

```lua
if (smartWalkDir == North and d == West) or (smartWalkDir == West and d == North) then
    smartWalkDir = NorthWest
```

---

### 1.2 Sistema de plantas / niveles Z (multi-floor)

**16 plantas, `z = 0..15`**, con `z = 7` como "nivel del mar" / superficie y `z = 8..15` como subsuelo.

#### Regla de visibilidad entre plantas

Verificada en [`creature.cpp`](https://github.com/otland/forgottenserver/blob/master/src/creature.cpp), función `Creature::canSee(myPos, pos, viewRangeX, viewRangeY)`:

```cpp
if (myPos.z <= 7) {
    // estamos en superficie o por encima (7 -> 0)
    if (pos.z > 7) return false;                // no ves el subsuelo desde arriba
} else if (myPos.z >= 8) {
    // estamos bajo tierra (8 -> 15)
    if (pos.z < 8) return false;                // no ves la superficie desde abajo
    if (myPos.getDistanceZ(pos) > 2) return false;  // ves ±2 plantas
}

// Y el truco clave: un desplazamiento vertical según la diferencia de planta
int32_t offsetz = myPos.getOffsetZ(pos);
return (pos.getX() >= myPos.getX() - viewRangeX + offsetz) &&
       (pos.getX() <= myPos.getX() + viewRangeX + offsetz) &&
       (pos.getY() >= myPos.getY() - viewRangeY + offsetz) &&
       (pos.getY() <= myPos.getY() + viewRangeY + offsetz);
```

Dos cosas importantísimas aquí:

1. **`viewRangeZ` = 2**: en el subsuelo ves ±2 plantas (`z-2` … `z+2`). Arriba de todo (`z <= 7`) ves *toda* la superficie (puedes mirar hacia abajo hasta z=7) y **nada** del subsuelo.
2. **`offsetz`**: la ventana de visión está *desplazada* según la diferencia de planta. Esto es lo que en el cliente se ve como que los pisos inferiores se dibujan corridos hacia arriba/derecha. El término `offsetz` desplaza el rectángulo visible en el plano XY.

En el **cliente** ([OTClient `src/client/mapview.cpp`](https://github.com/opentibiabr/otclient/blob/main/src/client/mapview.cpp)) hay dos funciones que deciden qué plantas se dibujan:

```cpp
uint8_t MapView::calcFirstVisibleFloor(bool checkLimitsFloorsView) const
{
    uint8_t z = g_gameConfig.getMapSeaFloor();          // = 7
    ...
    uint8_t firstFloor = 0;
    if (m_posInfo.camera.z > g_gameConfig.getMapSeaFloor())
        firstFloor = std::max<uint8_t>(
            m_posInfo.camera.z - g_gameConfig.getMapAwareUndergroundFloorRange(),  // normalmente 2
            g_gameConfig.getMapUndergroundFloorRange());
    // ... y luego, en un bucle 3x3 alrededor de la cámara, sube de piso
    // mientras los tiles "limitsFloorsView" (paredes, techos) lo permitan
}

uint8_t MapView::calcLastVisibleFloor() const
{
    uint8_t z = g_gameConfig.getMapSeaFloor();          // = 7
    if (m_posInfo.camera.isValid()) {
        if (m_posInfo.camera.z > g_gameConfig.getMapSeaFloor())
            z = m_posInfo.camera.z + g_gameConfig.getMapAwareUndergroundFloorRange();  // +2
        else
            z = g_gameConfig.getMapSeaFloor();
    }
    ...
}
```

**Resumen operativo:**

| Situación | Plantas dibujadas |
|---|---|
| Jugador en superficie (z ≤ 7) | desde `z = 0` hasta `z = 7` (toda la pila de superficie) |
| Jugador bajo tierra (z ≥ 8) | `z−2` hasta `z+2` (5 plantas) |
| Techo/pared que corta la vista | `calcFirstVisibleFloor` sube hasta la primera planta **no cubierta** por geometría por encima |

**El efecto de "ver el piso de arriba"**: el bucle 3×3 en `calcFirstVisibleFloor` recorre los 9 tiles alrededor de la cámara y, para cada uno, sube en vertical comprobando `tile->limitsFloorsView(...)` en la posición **física** (`upperPos`) y en la posición **geométricamente cubierta** (`coveredPos`). Si un tile de arriba tiene un techo/pared, deja de dibujarse esa planta y las superiores. Es un *occlusion culling* vertical.

#### Renderizado de las plantas: el desplazamiento por piso

En OTClient, `drawFloor()` itera:

```cpp
for (int_fast8_t z = m_floorMax; z >= m_floorMin; --z) {
    ...
    tile->draw(m_posInfo, transformPositionTo2D(tile->getPosition()), tileFlags);
    ...
    // Y para el piso inmediatamente inferior a la cámara, un velo negro:
    if (m_shadowFloorIntensity > 0 && z == cameraPosition.z + 1) {
        g_drawPool.setOpacity(m_shadowFloorIntensity, true);
        g_drawPool.addFilledRect(m_rectDimension, Color::black);
    }
}
```

Tres trucos de render que definen el look Tibia:

1. **Se dibuja de la planta más baja a la más alta** (de `floorMax` abajo hasta `floorMin`), lo que hace que las plantas altas tapen a las bajas. Dentro de cada planta, los tiles se ordenan **por diagonales** (de "arriba-derecha" a "abajo-izquierda"), no simplemente por filas:

   ```cpp
   const uint32_t numDiagonals = m_drawDimension.width() + m_drawDimension.height() - 1;
   for (uint_fast32_t diagonal = start; diagonal < end; ++diagonal) {
       const auto advance = (diagonal >= m_drawDimension.height())
                            ? diagonal - m_drawDimension.height() : 0;
       for (int iy = diagonal - advance, ix = advance; iy >= 0 && ix < m_drawDimension.width(); --iy, ++ix) {
           auto tilePos = m_posInfo.camera.translated(ix - m_virtualCenterOffset.x,
                                                      iy - m_virtualCenterOffset.y);
           ...
       }
   }
   ```

   Este orden diagonal garantiza que un objeto alto (una pared) se dibuje **antes** que el tile que tiene detrás-y-abajo, resolviendo el solapamiento sin Z-buffer. **Esto es el corazón del "2.5D" de Tibia.**

2. **Opacidad variable por planta**: hay un sistema de *fade* (`m_floorFading`, `FadeType::FADE_IN` / `FADE_OUT`) que atenúa la planta del jugador cuando cambia de piso, y modos de vista (`Otc::FloorViewMode`): `NORMAL`, `FADE`, `LOCKED`, `ALWAYS`, `ALWAYS_WITH_TRANSPARENCY`. En `ALWAYS_WITH_TRANSPARENCY`, los pisos intermedios se dibujan al 16 % de opacidad dentro de un radio, y al 70 % fuera:

   ```cpp
   if (alwaysTransparent) {
       const bool inRange = tile->getPosition().isInRange(_camera,
           g_gameConfig.getTileTransparentFloorViewRange(), ...);
       g_drawPool.setOpacity(inRange ? .16 : .7);
   }
   ```

3. **Un velo negro** con `m_shadowFloorIntensity` sobre la planta `camera.z + 1` para sugerir profundidad.

#### Escaleras, rampas y agujeros

En el mapa no hay lógica especial: las escaleras son **items con flags** `TILESTATE_FLOORCHANGE_*`. En [`tile.h`](https://github.com/otland/forgottenserver/blob/master/src/tile.h):

```cpp
TILESTATE_FLOORCHANGE_DOWN       = 1 << 0,
TILESTATE_FLOORCHANGE_NORTH      = 1 << 1,
TILESTATE_FLOORCHANGE_SOUTH      = 1 << 2,
TILESTATE_FLOORCHANGE_EAST       = 1 << 3,
TILESTATE_FLOORCHANGE_WEST       = 1 << 4,
TILESTATE_FLOORCHANGE_SOUTH_ALT  = 1 << 5,   // escaleras "anchas" que ocupan 2 tiles
TILESTATE_FLOORCHANGE_EAST_ALT   = 1 << 6,
```

Y `Tile::queryDestination()` ([`tile.cpp`](https://github.com/otland/forgottenserver/blob/master/src/tile.cpp)) calcula la posición de destino:

```cpp
if (hasFlag(TILESTATE_FLOORCHANGE_DOWN)) {
    uint8_t dz = tilePos.z + 1;
    // comprueba primero el tile "sur" del piso de abajo; si es FLOORCHANGE_SOUTH_ALT,
    // el destino es dy -= 2 (escalera ancha)
    // si no, comprueba el tile "este"; si es FLOORCHANGE_EAST_ALT, dx -= 2
    // si no, baja al tile directamente debajo y aplica los flags N/S/E/W del tile destino
} else if (hasFlag(TILESTATE_FLOORCHANGE)) {
    uint8_t dz = tilePos.z - 1;
    if (hasFlag(TILESTATE_FLOORCHANGE_NORTH)) --dy;
    if (hasFlag(TILESTATE_FLOORCHANGE_SOUTH)) ++dy;
    if (hasFlag(TILESTATE_FLOORCHANGE_EAST))  ++dx;
    if (hasFlag(TILESTATE_FLOORCHANGE_WEST))  --dx;
    if (hasFlag(TILESTATE_FLOORCHANGE_SOUTH_ALT)) dy += 2;
    if (hasFlag(TILESTATE_FLOORCHANGE_EAST_ALT))  dx += 2;
    destTile = g_game.map.getTile(dx, dy, dz);
}
```

Y crucialmente:

```cpp
if (!destTile) { destTile = this; }
else { flags |= FLAG_NOLIMIT; }   // bajar una escalera ignora bloqueos
```

**Traducción:** una escalera es un item; su "magia" es un conjunto de flags de dirección que el motor usa para desplazarte en Z y ajustar X/Y. No hay geometría 3D, no hay pendientes. **Las escaleras son teleports disfrazados con desplazamiento controlado.**

---

### 1.3 Perspectiva de cámara: ángulo y tamaño de tile

**Tibia NO es isométrico. Es una proyección oblicua / top-down puro con "altura" simulada por desplazamiento vertical de sprite.**

Prueba: en [`mapview.cpp`](https://github.com/opentibiabr/otclient/blob/main/src/client/mapview.cpp), la conversión de coordenadas de tile a pantalla es una multiplicación directa:

```cpp
const Point& globalCoord = Point(camera.x - m_drawDimension.width()  / 2,
                                -(camera.y - m_drawDimension.height() / 2)) * m_tileSize;
...
const uint16_t tileSize = g_gameConfig.getSpriteSize() * m_pool->getScaleFactor();
```

No hay matriz de rotación de 45°, no hay escala 2:1 en Y (que es la firma del isométrico). Es **`screen = tile * tileSize`**, con el eje Y invertido y offsets. Y en `move()`:

```cpp
tmp = m_moveOffset.x / g_gameConfig.getSpriteSize();
if (tmp != 0) { m_customCameraPosition.x += tmp; m_moveOffset.x %= g_gameConfig.getSpriteSize(); }
```

**Números concretos:**

| Propiedad | Valor |
|---|---|
| Tile base | **32 × 32 px** (`BLOCK_SIZE = 32` en [`const.h`](https://github.com/opentibiabr/otclient/blob/main/src/client/const.h): `enum { BLOCK_SIZE = 32 };`) |
| Tamaño de sprite | configurable vía `g_gameConfig.getSpriteSize()`; históricamente 32, subido a **64×64** en clientes modernos (11+) para outfits y objetos detallados |
| Viewport por defecto | `setVisibleDimension(Size(15, 11))` — **15 tiles de ancho × 11 de alto** |
| Dimensión de dibujo | `visibleDimension + 3` (margen de 3 tiles para evitar popping) |
| Ángulo de cámara | **0°** (ortogonal puro, sin inclinación ni rotación) |
| Proyección de paredes | una pared es un sprite de 32×32 (o más alto, ej. 32×64) dibujado con **offset vertical negativo** respecto a la base del tile; el cliente lo apila con las mismas reglas de stackpos |
| Centro virtual | `m_virtualCenterOffset = (drawDimension / 2 - Size(1)).toPoint()` |

**Cómo se ve la "altura":** no hay altura real. Una pared de 32×64 px simplemente se dibuja 32 px *más arriba* que el suelo del tile, y se dibuja **después** del suelo. El `Displacement` / `Elevation` son atributos de item del `.dat` (`ThingAttrDisplacement = 24`, `ThingAttrElevation = 25` en `const.h`) que desplazan el sprite respecto al ancla del tile. Eso es todo el "3D".

**Recomendación práctica para tu clon:** mantené esta proyección. Es la razón por la que Tibia se puede renderizar con `TileMapLayer` de Godot 2D a 60 fps en hardware de 2005, y es lo que hace que los sprites de 32×32 "encajen". El 2.5D viene del **orden de dibujo + desplazamiento vertical + sombras**, no de una cámara 3D.

---

### 1.4 Combate

#### Auto-attack y cooldown de ataque

En [`player.cpp`](https://github.com/otland/forgottenserver/blob/master/src/player.cpp):

```cpp
uint32_t Player::getAttackSpeed() const
{
    const Item* weapon = getWeapon(true);
    if (!weapon || weapon->getAttackSpeed() == 0) {
        return vocation->getAttackSpeed();    // por defecto, por vocación
    }
    return weapon->getAttackSpeed();          // el arma puede override
}

void Player::doAttacking(uint32_t)
{
    if (lastAttack == 0) lastAttack = OTSYS_TIME() - getAttackSpeed() - 1;
    if (hasCondition(CONDITION_PACIFIED)) return;

    if ((OTSYS_TIME() - lastAttack) >= getAttackSpeed()) {
        bool result = false;
        Item* tool = getWeapon();
        const Weapon* weapon = g_weapons->getWeapon(tool);
        uint32_t delay = getAttackSpeed();

        if (weapon) {
            if (!weapon->interruptSwing()) {
                result = weapon->useWeapon(this, tool, attackedCreature);
            } else if (!classicSpeed && !canDoAction()) {
                delay = getNextActionTime();     // el swing espera a la acción en curso
            } else {
                result = weapon->useWeapon(this, tool, attackedCreature);
            }
        } else {
            result = Weapon::useFist(this, attackedCreature);   // puños
        }

        SchedulerTask* task = createSchedulerTask(std::max<uint32_t>(SCHEDULER_MINTICKS, delay), ...);
        ...
        if (result) lastAttack = OTSYS_TIME();
    }
}
```

**Puntos clave:**
- El auto-attack es un **bucle de scheduler**: cada `attackSpeed` ms se intenta un swing. No hay "attack speed en %".
- El ataque se **interrumpe** si el target sale de rango/visión (`canAttackCreature` exige `creaturePos.z == getPosition().z` y `canSee()` — **no se puede atacar a otra planta**, ni siquiera adyacente en Z).
- El daño depende del `fightMode` (`FIGHTMODE_ATTACK` / `BALANCED` / `DEFENSE`), que modifica el *factor de defensa*:

```cpp
float Player::getAttackFactor() const {
    switch (fightMode) {
        case FIGHTMODE_ATTACK:   return 1.0f;
        case FIGHTMODE_BALANCED: return 1.2f;
        case FIGHTMODE_DEFENSE:  return 2.0f;
    }
}

float Player::getDefenseFactor() const {
    switch (fightMode) {
        case FIGHTMODE_ATTACK:   return (OTSYS_TIME() - lastAttack) < getAttackSpeed() ? 0.5f : 1.0f;
        case FIGHTMODE_BALANCED: return (OTSYS_TIME() - lastAttack) < getAttackSpeed() ? 0.75f : 1.0f;
        case FIGHTMODE_DEFENSE:  return 1.0f;
    }
}
```

O sea: en modo *offensive*, justo después de atacar tu defensa se reduce a la mitad. En *defensive*, nunca.

#### Defensa, armadura y bloqueo

```cpp
int32_t Player::getDefense() const {
    int32_t defenseSkill = getSkillLevel(SKILL_FIST);
    int32_t defenseValue = 7;
    getShieldAndWeapon(shield, weapon);
    if (weapon) { defenseValue = weapon->getDefense() + weapon->getExtraDefense();
                  defenseSkill = getWeaponSkill(weapon); }
    if (shield) { defenseValue = weapon ? shield->getDefense() + weapon->getExtraDefense()
                                        : shield->getDefense();
                  defenseSkill = getSkillLevel(SKILL_SHIELD); }
    if (defenseSkill == 0) { /* ATTACK/BALANCED ⇒ 1, DEFENSE ⇒ 2 */ }
    return (defenseSkill / 4. + 2.23) * defenseValue * 0.15 * getDefenseFactor() * vocation->defenseMultiplier;
}
```

Y en `Creature::blockHit` ([`creature.cpp`](https://github.com/otland/forgottenserver/blob/master/src/creature.cpp)):

```cpp
if (blockCount > 0) { --blockCount; hasDefense = true; }     // solo 2 bloques por segundo
if (checkDefense && hasDefense && canUseDefense) {
    int32_t defense = getDefense();
    damage -= uniform_random(defense / 2, defense);
    if (damage <= 0) { damage = 0; blockType = BLOCK_DEFENSE; checkArmor = false; }
}
if (checkArmor) {
    int32_t armor = getArmor();
    if (armor > 3)      damage -= uniform_random(armor / 2, armor - (armor % 2 + 1));
    else if (armor > 0) --damage;
    if (damage <= 0) { damage = 0; blockType = BLOCK_ARMOR; }
}
```

`blockCount` se regenera en `onThink`: `blockTicks += interval; if (blockTicks >= 1000) blockCount = min(blockCount+1, 2)`. ⇒ **máximo 2 bloqueos por segundo, independientemente de cuántos enemigos te peguen.** Este es un detalle de diseño muy elegante y muy "Tibia": te permite tankear hordas de monstruos débiles.

#### Cooldowns de hechizos: los *cooldown groups*

Tibia no tiene un cooldown global único. Tiene **grupos de cooldown independientes**. Los grupos (definidos en los datos de hechizos de TFS, `data/spells/spells.xml`) son:

| Grupo | Uso típico | Cooldown típico |
|---|---|---|
| `attack` | hechizos de daño ofensivo (exori, exori vis, …) | 2 s |
| `healing` | **exura**, exura gran, exura vita | 1 s (exura) / 2 s (knight, curas grandes) |
| `support` | utani hur, utamo vita, buffs | variable |
| `special` | hechizos de área / ultimate | variable |

`exura` (la cura básica, "Healing") es del grupo `healing` con **~1 segundo de cooldown**; las curas de caballero / curas grandes usan **2 segundos**. Hay confirmación en [TibiaQA sobre el cooldown de 2 s del caballero](https://www.tibiaqa.com/39913/knights-second-cooldown-paralysis-removal-optimal-mitigate-vulnerability) y la lista oficial en [tibia.com/library — Spells](https://www.tibia.com/library/?subtopic=spells).

**Por qué importa:** podés castear `exura` y un ataque de daño en el mismo instante porque son grupos distintos. Esto define el *rotación* de combate entera (curarte entre swings no cuesta DPS). Un clon que use un cooldown global va a sentirse completamente distinto.

En TFS el mecanismo es `ConditionExhaustion` con `CONDITIONID_SPELLGROUP_*`; en `player.cpp` se ve la infraestructura:

```cpp
bool canDoAction() const;
uint32_t getNextActionTime() const;   // usado para retrasar el swing
```

#### Target, battle list y battle field

- El jugador tiene `attackedCreature` y `followCreature` (target + follow separados). `setAttackedCreature` valida con `canAttackCreature`, y si `chaseMode` está activo hace `setFollowCreature`.
- La **battle list** es el panel lateral con los ~10 monstruos/jugadores más cercanos. El protocolo la envía por separado (`sendCreatureList`), con `knownCreature` IDs de 32 bits.
- El **modo de chase** (`DontChase` / `ChaseOpponent`) viene del enum `ChaseModes` de OTClient.
- El cliente dibuja una barra de vida y el nombre sobre el sprite (`drawCreatureInformation`).

#### PvP, skulls y muerte

`Player::onAttackedCreature` en [`player.cpp`](https://github.com/otland/forgottenserver/blob/master/src/player.cpp) implementa la lógica de skulls:

```cpp
if (targetPlayer && !isPartner(targetPlayer) && !isGuildMate(targetPlayer)) {
    if (!pzLocked && g_game.getWorldType() == WORLD_TYPE_PVP_ENFORCED) {
        pzLocked = true;
    }
    targetPlayer->addInFightTicks();

    if (getSkull() == SKULL_NONE && getSkullClient(targetPlayer) == SKULL_YELLOW) {
        addAttacked(targetPlayer);
        targetPlayer->sendCreatureSkull(this);
    } else if (!targetPlayer->hasAttacked(this)) {
        if (!pzLocked) pzLocked = true;
        if (!Combat::isInPvpZone(this, targetPlayer) && !isInWar(targetPlayer)) {
            addAttacked(targetPlayer);
            if (targetPlayer->getSkull() == SKULL_NONE && getSkull() == SKULL_NONE) {
                setSkull(SKULL_WHITE);      // atacaste primero ⇒ calavera blanca
            }
            if (getSkull() == SKULL_NONE) targetPlayer->sendCreatureSkull(this);
        }
    }
}
```

Y las muertes injustificadas:

```cpp
void Player::addUnjustifiedDead(const Player* attacked)
{
    if (hasFlag(PlayerFlag_NotGainInFight) || attacked == this ||
        g_game.getWorldType() == WORLD_TYPE_PVP_ENFORCED) return;

    sendTextMessage(MESSAGE_EVENT_ADVANCE,
        "Warning! The murder of " + attacked->getName() + " was not justified.");

    skullTicks += getNumber(ConfigManager::FRAG_TIME);

    if (getSkull() != SKULL_BLACK) {
        if (getNumber(ConfigManager::KILLS_TO_BLACK) != 0 &&
            skullTicks > (getNumber(ConfigManager::KILLS_TO_BLACK) - 1) *
                         static_cast<int64_t>(getNumber(ConfigManager::FRAG_TIME))) {
            setSkull(SKULL_BLACK);
        } else if (getSkull() != SKULL_RED && getNumber(ConfigManager::KILLS_TO_RED) != 0 &&
                   skullTicks > (getNumber(ConfigManager::KILLS_TO_RED) - 1) *
                                static_cast<int64_t>(getNumber(ConfigManager::FRAG_TIME))) {
            setSkull(SKULL_RED);
        }
    }
}
```

Skulls (enum `Skulls_t`): `NONE=0`, `YELLOW=1` (te atacaron), `GREEN=2` (party), `WHITE=3` (atacaste), `RED=4` (PK), `BLACK=5` (PK grave), `ORANGE=6`.

**Tipos de mundo** (`WorldType_t`): `NO_PVP = 1`, `PVP = 2`, `PVP_ENFORCED = 3` (hardcore, sin skulls, muerte = pérdida total).

**Pérdida por muerte:** el `Player::death()` aplica:
- Pérdida de **experiencia** (porcentaje según nivel y si tenés blessings).
- Pérdida de **skills** (si `skillLoss` está activo y no estás en zona PvP).
- **Pérdida de items**: se caen al suelo dentro de una corpse. Un **Amulet of Loss** (`ITEM_AMULETOFLOSS = 2173` en `const.h`) se consume al morir y evita la pérdida de items.
- **Blessings** (`enum Blessings` en OTClient `const.h`): `BlessingAdventurer`, `BlessingTwistOfFate`, `BlessingWisdomOfSolitude`, `BlessingSparkOfPhoenix`, `BlessingFireOfSuns`, `BlessingSpiritualShielding`, `BlessingEmbraceOfTibia`, `BlessingHeartOfMountain`, `BlessingBloodOfMountain`. Cada una reduce un porcentaje de la pérdida de exp/skills.

En OTClient hay un `enum DeathType { DeathRegular = 0, DeathBlessed = 1 }` que el servidor envía al cliente para que sepa si mostrar la animación de muerte "bendecida" o no.

#### Campos de batalla (magic fields)

Los "fields" (fuego, veneno, energía) son **items** con `ItemTypes_t::ITEM_TYPE_MAGICFIELD` y un `CombatType_t`. Están en el enum `item_t` de [`const.h`](https://github.com/otland/forgottenserver/blob/master/src/const.h):

```cpp
ITEM_FIREFIELD_PVP_FULL = 1487,
ITEM_FIREFIELD_PVP_MEDIUM = 1488,
ITEM_FIREFIELD_PVP_SMALL = 1489,
ITEM_FIREFIELD_PERSISTENT_FULL = 1492,
...
ITEM_POISONFIELD_PVP = 1490,
ITEM_ENERGYFIELD_PVP = 1491,
ITEM_MAGICWALL = 1497,
ITEM_WILDGROWTH = 1499,
```

Se resuelven con `Tile::getFieldItem()`:

```cpp
MagicField* Tile::getFieldItem() const
{
    if (!hasFlag(TILESTATE_MAGICFIELD)) return nullptr;
    if (ground && ground->getMagicField()) return ground->getMagicField();
    if (const TileItemVector* items = getItemList()) {
        for (auto it = items->rbegin(), end = items->rend(); it != end; ++it) {
            if ((*it)->getMagicField()) return (*it)->getTeleport(); // (nótese: getMagicField())
        }
    }
    return nullptr;
}
```

Y las **condiciones** se eliminan al salir del field correspondiente (`Creature::onTickCondition`):

```cpp
switch (type) {
    case CONDITION_FIRE:   bRemove = (field->getCombatType() != COMBAT_FIREDAMAGE);   break;
    case CONDITION_ENERGY: bRemove = (field->getCombatType() != COMBAT_ENERGYDAMAGE); break;
    case CONDITION_POISON: bRemove = (field->getCombatType() != COMBAT_EARTHDAMAGE);  break;
    ...
}
```

**Modelo a copiar:** un field = item + condition + timing. Cuando entrás al tile, se te aplica una `Condition` periódica; cuando salís, se chequea si la condición corresponde al field actual y se remueve si no.

#### IA de monstruos

`Creature::getPathSearchParams` define el comportamiento de follow:

```cpp
void Creature::getPathSearchParams(const Creature*, FindPathParams& fpp) const
{
    fpp.fullPathSearch = !hasFollowPath;
    fpp.clearSight = true;
    fpp.maxSearchDist = Map::maxViewportX + Map::maxViewportY;
    fpp.minTargetDist = 1;
    fpp.maxTargetDist = 1;      // los monstruos quieren estar a distancia 1
}
```

Y en `getStepDuration`:

```cpp
if (monster && monster->isTargetNearby() && !monster->isFleeing() && !monster->getMaster()) {
    stepDuration *= 2;   // ralentiza al monstruo cuando está pegado a su target
}
```

Este `×2` es el famoso "los bichos se frenan cuando te alcanzan": evita que te sigan a velocidad completa y te permite huir. **Es un detalle pequeño con un impacto enorme en el *feel* del juego.**

Los summons se despawnan a `> 2` plantas o `> 30` tiles:

```cpp
if (newPos.getDistanceZ(pos) > 2 ||
    std::max(newPos.getDistanceX(pos), newPos.getDistanceY(pos)) > 30) {
    despawnList.push_front(summon);
}
```

---

### 1.5 Inventario

#### Slots de equipamiento

`enum SlotPositionBits` y `enum InventorySlot`:

| Bit (servidor, `items.h`) | Slot (cliente, `const.h`) | Valor |
|---|---|---|
| `SLOTP_HEAD = 1 << 0` | `InventorySlotHead` | 1 |
| `SLOTP_NECKLACE = 1 << 1` | `InventorySlotNecklace` | 2 |
| `SLOTP_BACKPACK = 1 << 2` | `InventorySlotBackpack` | 3 |
| `SLOTP_ARMOR = 1 << 3` | `InventorySlotArmor` | 4 |
| `SLOTP_RIGHT = 1 << 4` | `InventorySlotRight` | 5 |
| `SLOTP_LEFT = 1 << 5` | `InventorySlotLeft` | 6 |
| `SLOTP_LEGS = 1 << 6` | `InventorySlotLegs` | 7 |
| `SLOTP_FEET = 1 << 7` | `InventorySlotFeet` | 8 |
| `SLOTP_RING = 1 << 8` | `InventorySlotRing` | 9 |
| `SLOTP_AMMO = 1 << 9` | `InventorySlotAmmo` | 10 |
| `SLOTP_DEPOT = 1 << 10` | `InventorySlotPurse` | 11 (versiones nuevas) |
| `SLOTP_TWO_HAND = 1 << 11` | `InventorySlotExt1..4` | 12..15 |
| `SLOTP_HAND = SLOTP_LEFT \| SLOTP_RIGHT` | `LastInventorySlot` | — |

Nota: `SLOTP_HAND` es una **máscara**, no un slot. Los items `TWO_HAND` ocupan ambos. Esto permite implementar armas de dos manos con una sola comprobación de bits.

#### Contenedores anidados

- Un `Container` tiene `capacity` (`maxItems`, por defecto `8`, definido en `ItemType::maxItems = 8` — **el clásico "8 slots por mochila"**).
- Los contenedores se pueden anidar. La profundidad la define el protocolo; el cliente abre contenedores con un `cid` (container id) de 4 bits (`if (cid > 0xF) return;` en `Player::addContainer`), es decir **máximo 16 contenedores abiertos simultáneamente**, pero el anidamiento en los datos es recursivo.
- El formato de mapa OTBM admite items anidados **indefinidamente**:

```
0xFE <OTBM_TILE_AREA>
    0xFE <OTBM_TILE>
        0xFE <OTBM_ITEM>            ← la mochila
             0xFE <OTBM_ITEM> 0xFF  ← la moneda dentro
        0xFF
    0xFF
0xFF
```

Ver [descripción completa del formato OTBM en OTLand](https://otland.net/threads/a-comphrensive-description-of-the-otbm-format.258583/).

- El daño real en producción: hay un hilo sobre un crash de TFS 1.7 con **contenedores anidados en casas** ([OTLand](https://otland.net/threads/server-crash-on-startup-nested-containers-in-houses-tibia-13-10-tfs-1-7.304753/)). Es un caso borde conocido: **limitá la profundidad a ~8-10 niveles** y serializá con cuidado.

#### Peso y capacidad

- Cada `ItemType` tiene `weight` en **onzas (oz)** — `uint32_t weight = 0;` en `items.h`.
- El peso del inventario se recalcula recursivamente:

```cpp
void Player::updateInventoryWeight()
{
    if (hasFlag(PlayerFlag_HasInfiniteCapacity)) return;
    inventoryWeight = 0;
    for (int i = CONST_SLOT_FIRST; i <= CONST_SLOT_LAST; ++i) {
        const Item* item = inventory[i];
        if (item) inventoryWeight += item->getWeight();   // recursivo en contenedores
    }
    if (StoreInbox* storeInbox = getStoreInbox()) inventoryWeight += storeInbox->getWeight();
}
```

- La **capacity** (lo que podés cargar) depende de nivel y vocación. En TFS es configurable por vocación; la fórmula clásica de Tibia es `capacity = 10 · level · vocationMultiplier` (con `GameTotalCapacity` / `GameDoubleFreeCapacity` como *features* de protocolo en OTClient `const.h`, lo que indica que la fórmula cambió históricamente). **Verificá contra tu versión objetivo.**

#### Items apilables vs. charges

```cpp
bool hasSubType() const { return (isFluidContainer() || isSplash() || stackable || charges != 0); }
```

- **Stackable** (monedas, runas, flechas): `count` hasta `ITEM_STACK_SIZE = 100` (`const.h`: `inline constexpr uint8_t ITEM_STACK_SIZE = 100;`).
- **Charges** (varitas, runas con usos): `charges` en `ItemType`, y `OTBM_ATTR_RUNE_CHARGES = 12` / `OTBM_ATTR_CHARGES = 22` en el mapa.
- **Fluid containers** (frascos): el "subtype" es el color/tipo de líquido — un enum completo (`FluidTypes_t`, `ClientFluidTypes_t`, y mapas de conversión `clientToServerFluidMap` / `reverseFluidMap` en `const.h`). **Es un caso especial molesto; en tu clon podés colapsarlo a "subtype = id de líquido".**

---

### 1.6 Progresión

#### Niveles y experiencia

- La tabla oficial está en [tibia.com/library — Experience Table](https://www.tibia.com/library/?subtopic=experiencetable).
- La fórmula clásica (aproximación de la comunidad, ver [Tibia Fandom: Experience Table](https://tibia.fandom.com/wiki/Experience_Table) y [Formulae](https://tibia.fandom.com/wiki/Formulae)) es un polinomio cúbico del tipo:

  ```
  expParaNivel(L) = (50/3)·L³ − 100·L² + (850/3)·L − 200
  ```

  con hitos conocidos: nivel 8 = 4.200 exp, nivel 9 = 6.400, nivel 10 = 9.100, nivel 100 = 15.892.400. **La progresión es cúbica, no exponencial** — esto es importante: una curva cúbica permite que el contenido de bajo nivel siga siendo relevante y que los niveles altos tarden *mucho* pero no infinito.

- En TFS la experiencia está en `uint64_t` (`Player::gainExperience(uint64_t, ...)`), y `addExperience` aplica modificadores de stamina y rate.

#### Skills

Enum de skills (`Otc::Skill` en [`const.h`](https://github.com/opentibiabr/otclient/blob/main/src/client/const.h)):

```cpp
Fist = 0, Club, Sword, Axe, Distance, Shielding, Fishing,
// skills modernos:
CriticalChance, CriticalDamage, LifeLeechChance, LifeLeechAmount,
ManaLeechChance, ManaLeechAmount, Fatal, Dodge, Momentum, Transcendence,
LastSkill
```

Los 7 clásicos son **Fist, Club, Sword, Axe, Distance, Shielding, Fishing**. Magic Level es un stat aparte (no un `Skill`), junto a Health/Mana/Soul/Stamina (`enum Otc::Statistic`).

**Progresión por "intentos" (tries), no por experiencia.** Verificado en [`player.cpp`](https://github.com/otland/forgottenserver/blob/master/src/player.cpp):

```cpp
void Player::addSkillAdvance(skills_t skill, uint64_t count)
{
    uint64_t currReqTries = vocation->getReqSkillTries(skill, skills[skill].level);
    uint64_t nextReqTries = vocation->getReqSkillTries(skill, skills[skill].level + 1);
    if (currReqTries >= nextReqTries) return;   // skill al máximo

    tfs::events::player::onGainSkillTries(this, skill, count);
    if (count == 0) return;

    bool sendUpdateSkills = false;
    while ((skills[skill].tries + count) >= nextReqTries) {
        count -= nextReqTries - skills[skill].tries;
        skills[skill].level++;
        skills[skill].tries = 0;
        skills[skill].percent = 0;
        sendTextMessage(MESSAGE_EVENT_ADVANCE,
            fmt::format("You advanced to {:s} level {:d}.", getSkillName(skill), skills[skill].level));
        g_creatureEvents->playerAdvance(this, skill, (skills[skill].level - 1), skills[skill].level);
        sendUpdateSkills = true;
        currReqTries = nextReqTries;
        nextReqTries = vocation->getReqSkillTries(skill, skills[skill].level + 1);
        if (currReqTries >= nextReqTries) { count = 0; break; }
    }

    skills[skill].tries += count;

    uint32_t newPercent;
    if (nextReqTries > currReqTries) {
        newPercent = Player::getBasisPointLevel(skills[skill].tries, nextReqTries);
    } else {
        newPercent = 0;
    }

    if (skills[skill].percent != newPercent) {
        skills[skill].percent = newPercent;
        sendUpdateSkills = true;
    }
    if (sendUpdateSkills) sendSkills();
}
```

**El modelo:**
- `tries` es un contador acumulativo (uint64).
- `getReqSkillTries(skill, level)` devuelve los **tries totales acumulados** necesarios para estar en `level`.
- El porcentaje mostrado es `getBasisPointLevel(tries, nextReqTries)` = basis points (0..10000) entre `currReqTries` y `nextReqTries`.
- Se gana "tries" al **usar** el skill: pegar con espada sube Sword, recibir golpes con escudo sube Shielding, fallar un ataque también suma (menos).
- **`removeSkillTries`** existe: al morir, se restan tries (y se puede bajar de nivel de skill):

```cpp
void Player::removeSkillTries(skills_t skill, uint64_t count, bool notify)
{
    while (count > skills[skill].tries) {
        count -= skills[skill].tries;
        if (skills[skill].level <= MINIMUM_SKILL_LEVEL) {
            skills[skill].level = MINIMUM_SKILL_LEVEL;
            skills[skill].tries = 0; count = 0; break;
        }
        skills[skill].tries = vocation->getReqSkillTries(skill, skills[skill].level);
        skills[skill].level--;
    }
    skills[skill].tries = std::max<int32_t>(0, skills[skill].tries - count);
    skills[skill].percent = Player::getBasisPointLevel(
        skills[skill].tries, vocation->getReqSkillTries(skill, skills[skill].level));
    ...
}
```

**Por qué el modelo de "tries" es superior a "XP de skill":** es *monótono y acumulativo*, así que el porcentaje siempre es exacto, no hay redondeo acumulado, y podés mostrar "% hacia el próximo nivel" trivialmente.

#### Vocaciones

| ID (OTClient `const.h`) | Vocación | Promovida | ID |
|---|---|---|---|
| 1 | Knight | Elite Knight | 11 |
| 2 | Paladin | Royal Paladin | 12 |
| 3 | Sorcerer | Master Sorcerer | 13 |
| 4 | Druid | Elder Druid | 14 |
| 5 | Monk | Exalted Monk | 15 |

*(Monk es una vocación agregada en versiones recientes.)*

Multiplicadores por vocación (en TFS viven en `Vocation`, `data/XML/vocations.xml`): `healthMultiplier`, `manaMultiplier`, `capacityMultiplier`, `speedMultiplier`, `attackSpeed`, `baseSpeed`, `armorMultiplier`, `defenseMultiplier`, `getReqSkillTries(skill, level)`, `getReqMana(magLevel)`, `getBaseMagLevel`.

Se aplican así en `player.cpp`:

```cpp
int32_t Player::getArmor() const {
    int32_t armor = 0;
    static const slots_t armorSlots[] = {CONST_SLOT_HEAD, CONST_SLOT_NECKLACE, CONST_SLOT_ARMOR,
                                         CONST_SLOT_LEGS, CONST_SLOT_FEET, CONST_SLOT_RING};
    for (slots_t slot : armorSlots) {
        Item* inventoryItem = inventory[slot];
        if (inventoryItem) armor += inventoryItem->getArmor();
    }
    return static_cast<int32_t>(armor * vocation->armorMultiplier);   // ← multiplicador
}
```

**Nota:** solo **6 slots** contribuyen a la armadura (head, necklace, armor, legs, feet, ring). El backpack, las manos y el ammo **no**.

**Diseño de vocaciones:**
- **Knight**: mucha HP, poca mana, skills de melee altos, `armorMultiplier` alto, curas caras.
- **Paladin**: híbrido, distance + shielding, HP media.
- **Sorcerer**: daño mágico puro, HP y capacity mínimas.
- **Druid**: curación y soporte, HP mínima.
- **Monk**: melee + artes marciales / armonía.

El **magic level** sube por *mana gastada*, no por intentos: `getReqMana(magLevel)` devuelve el mana total acumulado necesario. Esto es una segunda curva de progresión, distinta a la de skills.

---

### 1.7 Mundo: tiles, paredes, apilables, "use with", luz

#### Tiles de suelo

Un tile tiene **exactamente un `ground`**. En `Tile::addThing`:

```cpp
if (itemType.isGroundTile()) {
    if (!ground) {
        ground = item;
        onAddTileItem(item);
    } else {
        // reemplaza el ground existente
        Item* oldGround = ground;
        ...
    }
}
```

`groundSpeed` (la fricción) vive en el `ItemType::speed`. Si es 0, se usa 150.

#### Paredes con altura

Una pared **no es geometría**. Es un item:
- con `hasHeight = true` (`CONST_PROP_HASHEIGHT`) y/o `blockSolid = true`
- dibujado con un sprite más alto (p. ej. 32×64) y **desplazamiento vertical** (`ThingAttrDisplacement = 24`, `ThingAttrElevation = 25`)
- con `alwaysOnTop = true` y `alwaysOnTopOrder` bajo, para que se dibuje temprano en la pila de su tile (es decir, **debajo** de las criaturas de su propio tile, pero **encima** del suelo de tiles vecinos por el orden diagonal)

La altura lógica es un **contador**, no una magnitud:

```cpp
bool Tile::hasHeight(uint32_t n) const
{
    uint32_t height = 0;
    if (ground) {
        if (ground->hasProperty(CONST_PROP_HASHEIGHT)) ++height;
        if (n == height) return true;
    }
    if (const TileItemVector* items = getItemList()) {
        for (const Item* item : *items) {
            if (item->hasProperty(CONST_PROP_HASHEIGHT)) ++height;
            if (n == height) return true;
        }
    }
    return false;
}
```

Esto se usa para "no puedo tirar un objeto a un tile con 2 niveles de pared". Es un proxy barato de altura real.

#### "Use with" (usar item sobre item / sobre criatura)

El protocolo tiene tres operaciones distintas:

```cpp
void playerUseItem(uint32_t playerId, const Position& pos, uint8_t stackPos, uint8_t index, uint16_t spriteId);
void playerUseItemEx(uint32_t playerId, const Position& fromPos, uint8_t fromStackPos, uint16_t fromSpriteId,
                     const Position& toPos, uint8_t toStackPos, uint16_t toSpriteId);
void playerUseWithCreature(uint32_t playerId, const Position& fromPos, uint8_t fromStackPos,
                           uint32_t creatureId, uint16_t spriteId);
```

- `useItem`: click derecho sobre un item → "use".
- `useItemEx`: arrastrar item A sobre item B → **"use with"**. Ambos extremos identificados por `(pos, stackPos, spriteId)`.
- `useWithCreature`: usar un item sobre una criatura (p. ej. una runa de cura sobre un amigo).

La resolución de "qué item hay en tal stackpos" es `Tile::getUseItem(index)`:

```cpp
Item* Tile::getUseItem(int32_t index) const
{
    const TileItemVector* items = getItemList();
    if (!items || items->size() == 0) return ground;

    if (Thing* thing = getThing(index)) {          // 1) por índice explícito
        Item* thingItem = thing->getItem();
        if (thingItem) return thingItem;
    }
    if (Item* topDownItem = getTopDownItem()) return topDownItem;   // 2) el item "de abajo" más alto
    for (auto it = items->rbegin(), end = items->rend(); it != end; ++it) {
        if ((*it)->getDoor()) return (*it)->getItem();              // 3) una puerta
    }
    return *items->begin();                                          // 4) fallback
}
```

**La cadena de fallbacks es exactamente el comportamiento observable de Tibia**: si no especificás stackpos, se usa el item "más probable" según el contexto.

#### Luz

- La luz es un atributo **opcional** de item: `uint8_t lightLevel = 0; uint8_t lightColor = 0;` en `ItemType`.
- En OTClient `const.h`, `ThingAttrLight = 21` es el atributo del `.dat`.
- Un jugador tiene **dos fuentes de luz** que se combinan tomando el máximo:

```cpp
LightInfo Player::getCreatureLight() const
{
    if (internalLight.level > itemsLight.level) return internalLight;   // luz propia (spell)
    return itemsLight;                                                   // luz de items equipados
}

void Player::updateItemsLight(bool internal)
{
    LightInfo maxLight;
    for (int32_t i = CONST_SLOT_FIRST; i <= CONST_SLOT_LAST; ++i) {
        Item* item = inventory[i];
        if (item) {
            LightInfo curLight = item->getLightInfo();
            if (curLight.level > maxLight.level) maxLight = std::move(curLight);
        }
    }
    if (itemsLight.level != maxLight.level || itemsLight.color != maxLight.color) {
        itemsLight = maxLight;
        if (!internal) g_game.changeLight(this);
    }
}
```

⇒ **la luz más fuerte que llevás encima es la que se envía al cliente.** No hay suma de luces de inventario.

- El cliente renderiza con `LightView` y un *shade map*. Ver `MapView::drawLights()` y `MapView::updateLight()`:

```cpp
void MapView::updateLight()
{
    // El piso "bajo el mar" (z > mapSeaFloor) no recibe luz ambiental del cielo
    Light ambientLight = getCameraPosition().z > g_gameConfig.getMapSeaFloor()
                         ? Light() : g_map.getLight();
    ambientLight.intensity = std::max<uint8_t>(m_minimumAmbientLight * 255, ambientLight.intensity);
    m_lightView->setGlobalLight(ambientLight);
    m_lightView->setEnabled(isDrawingLights());
}
```

- **Detalle clave:** *bajo tierra no hay luz ambiental*. Solo ves lo que iluminás. Esto es lo que hace que las antorchas importen.
- Hay un **ciclo día/noche** (la luz global del mapa cambia con el tiempo) y un "light level" por tile.

#### Formato de mapa: OTBM

El formato binario OTBM (`[OTLand: descripción completa](https://otland.net/threads/a-comphrensive-description-of-the-otbm-format.258583/)`) es un **árbol de nodos** con marcadores `0xFE` (inicio) / `0xFF` (fin), header de 16 bytes:

```
MAGIC_IDENTIFIER (4 bytes)  — "OTBM" o vacío
OTBM_HEADER (16 bytes):
  version (4) | map width (2) | map height (2) | items major version (4) | items minor version (4)
```

Nodos: `OTBM_MAP_DATA=0x02`, `OTBM_TILE_AREA=0x04`, `OTBM_TILE=0x05`, `OTBM_ITEM=0x06`, `OTBM_TOWNS=0x0C`, `OTBM_TOWN=0x0D`, `OTBM_HOUSETILE=0x0E`, `OTBM_WAYPOINTS=0x0F`, `OTBM_WAYPOINT=0x10`.

Atributos: `DESCRIPTION=0x01`, `EXT_FILE=0x02`, `TILE_FLAGS=0x03`, `ACTION_ID=0x04`, `UNIQUE_ID=0x05`, `TEXT=0x06`, `TELE_DEST=0x08`, `ITEM=0x09`, `DEPOT_ID=0x0A`, `COUNT=0x0F`, `RUNE_CHARGES=0x16`.

Comprime las coordenadas de tile a **1 byte relativo al área padre** (el área usa 2 bytes), ahorrando ~50 % de espacio. Los items se pueden anidar indefinidamente (mochilas dentro de mochilas).

Flags de tile en el mapa (`TILE_FLAGS`, 4 bytes): `TILESTATE_PROTECTIONZONE = 0x00000001`, `TILESTATE_NOPVP = 0x00000004`, `TILESTATE_NOLOGOUT = 0x00000008`, `TILESTATE_PVPZONE = 0x00000010` (nomenclatura antigua; los valores actuales están en `tile.h` como `1 << n`).

**Servidores y clientes open-source de referencia:**
- [otland/forgottenserver](https://github.com/otland/forgottenserver) — el servidor (TFS).
- [opentibiabr/otclient](https://github.com/opentibiabr/otclient) y [mehah/otclient](https://github.com/mehah/otclient) — los clientes.
- [edubart/otclient](https://github.com/edubart/otclient) — el OTClient original.
- Estructura de `.dat`/`.spr`: hay análisis en [este hilo de OTLand](https://otland.net/threads/tibia-dat-reader-dat-spr-structure-and-spr-reading-code-link.25117/). El `.dat` describe cada `ThingType` (categoría, tamaño, capas, patrones, fases, flags); el `.spr` es un blob de sprites RGBA de tamaño fijo, indexados por ID. El `ThingAttr` completo está en OTClient `const.h` (`ThingAttrGround=0` … `ThingAttrDecoKit=44`).

**⚠️ Aviso legal:** los sprites y datos originales de CipSoft están protegidos por copyright. El código de TFS/OTClient es GPL/MIT, pero **el arte NO**. Ver §4.

---

### 1.8 Stackpos / orden de apilado por tile — el corazón del modelo de datos

Esta es la parte que más gente implementa mal. Aquí está el modelo real.

#### Estructura de datos

Un `Tile` contiene **tres** colecciones ([`tile.h`](https://github.com/otland/forgottenserver/blob/master/src/tile.h)):

```cpp
class Tile : virtual public Thing
{
    Item* ground = nullptr;        // 1 solo
    Position tilePos;
    uint32_t flags = 0;
};

class TileItemVector : private ItemVector
{
    // Un SOLO vector, pero partido en dos regiones por downItemCount:
    //
    //   [ begin ... begin+downItemCount )   ⇒  DOWN items  (se dibujan ABAJO de las criaturas)
    //   [ begin+downItemCount ... end )     ⇒  TOP items   (se dibujan ARRIBA de las criaturas)
    //
    //   getBeginDownItem() = begin()
    //   getEndDownItem()   = begin() + downItemCount
    //   getBeginTopItem()  = getEndDownItem()
    //   getEndTopItem()    = end()
    //   getTopItemCount()  = size() - downItemCount
    //   getTopTopItem()    = *(getEndTopItem() - 1)     // el último = el más alto
    //   getTopDownItem()   = *getBeginDownItem()        // el primero = el más bajo
    uint16_t downItemCount = 0;
};
```

Y las criaturas van aparte:

```cpp
using CreatureVector = std::vector<Creature*>;
// getTopCreature()    = *creatures->begin()    (la primera = la de más arriba)
// getBottomCreature() = *creatures->rbegin()
```

#### El orden canónico de un tile

**De abajo hacia arriba (orden de dibujo), el stackpos de un tile es:**

| # | Capa | Origen |
|---|---|---|
| 0 | **Ground** (suelo) | `Tile::ground` — 1 solo item |
| 1 | **Ground border / borders** | DOWN items con `alwaysOnTopOrder == 1` |
| 2 | **OnBottom** (alfombras, campos, agua, escaleras, signos, splashes) | DOWN items con `alwaysOnTopOrder == 2` |
| 3 | **Creatures** (jugadores, monstruos, NPCs) | `CreatureVector`, ordenadas |
| 4 | **OnTop** (puertas, paredes, muebles, antorchas, items decorativos) | TOP items con `alwaysOnTopOrder == 3` |
| 5 | **Common items** (items en el suelo, loot, mochilas) | el resto de TOP items |

El cliente de OTClient lo codifica explícitamente en [`const.h`](https://github.com/opentibiabr/otclient/blob/main/src/client/const.h):

```cpp
enum STACK_PRIORITY : uint8_t
{
    GROUND = 0,
    GROUND_BORDER = 1,
    ON_BOTTOM = 2,
    ON_TOP = 3,
    CREATURE = 4,
    COMMON_ITEMS = 5
};
```

Y el servidor lo documenta en un comentario de [`tile.cpp`](https://github.com/otland/forgottenserver/blob/master/src/tile.cpp):

```cpp
Item* Tile::getItemByTopOrder(int32_t topOrder)
{
    // topOrder:
    // 1: borders
    // 2: ladders, signs, splashes
    // 3: doors etc
    // 4: creatures
    for (auto it = ItemVector::const_reverse_iterator(items->getEndTopItem()),
              end = ItemVector::const_reverse_iterator(items->getBeginTopItem());
         it != end; ++it) {
        if (Item::items[(*it)->getID()].alwaysOnTopOrder == topOrder) {
            return (*it);
        }
    }
    return nullptr;
}
```

#### Cómo se calcula el stackpos de un item concreto

Verificado en [`tile.cpp`](https://github.com/otland/forgottenserver/blob/master/src/tile.cpp):

```cpp
int32_t Tile::getStackposOfItem(const Player* player, const Item* item) const
{
    int32_t n = 0;

    // 1) el ground ocupa el stackpos 0
    if (ground) {
        if (ground == item) return n;      // n = 0
        ++n;                                // n = 1
    }

    const TileItemVector* items = getItemList();
    if (items) {
        if (item->isAlwaysOnTop()) {
            // 2) si el item es alwaysOnTop, se busca dentro de la región TOP
            for (auto it = items->getBeginTopItem(), end = items->getEndTopItem(); it != end; ++it) {
                if (*it == item) return n;
                else if (++n == MAX_STACKPOS) return -1;    // ¡te pasaste del límite!
            }
        } else {
            // 3) si no, se salta toda la región TOP de una vez
            n += items->getTopItemCount();
            if (n >= MAX_STACKPOS) return -1;
        }
    }

    // 4) las criaturas visibles ocupan stackpos
    if (const CreatureVector* creatures = getCreatures()) {
        for (const Creature* creature : *creatures) {
            if (player->canSeeCreature(creature)) {
                if (++n >= MAX_STACKPOS) return -1;
            }
        }
    }

    // 5) y finalmente los DOWN items
    if (items && !item->isAlwaysOnTop()) {
        for (auto it = items->getBeginDownItem(), end = items->getEndDownItem(); it != end; ++it) {
            if (*it == item) return n;
            else if (++n >= MAX_STACKPOS) return -1;
        }
    }
    return -1;   // no encontrado
}
```

Y la variante para criaturas, `getClientIndexOfCreature`:

```cpp
int32_t Tile::getClientIndexOfCreature(const Player* player, const Creature* creature) const
{
    int32_t n;
    if (ground) n = 1; else n = 0;                  // el ground siempre cuenta
    const TileItemVector* items = getItemList();
    if (items) n += items->getTopItemCount();        // se saltan TODOS los top items
    if (const CreatureVector* creatures = getCreatures()) {
        for (auto it = creatures->rbegin(), end = creatures->rend(); it != end; ++it) {
            const Creature* c = (*it);
            if (c == creature) return n;
            else if (player->canSeeCreature(c)) ++n;
        }
    }
    return -1;
}
```

**Observaciones críticas:**

1. **`MAX_STACKPOS = 10`** ([`game.h`](https://github.com/otland/forgottenserver/blob/master/src/game.h): `inline constexpr int32_t MAX_STACKPOS = 10;`). El protocolo clásico solo puede indexar los **primeros 10 "things"** de un tile. Si un item cae en la posición 10 o superior, `getStackposOfItem` devuelve `-1` y el cliente no puede referenciarlo. **Es una limitación dura del protocolo, no del motor.**
2. El **ground siempre ocupa el stackpos 0** si existe.
3. El orden entre criaturas y items depende de `isAlwaysOnTop()`: un item `alwaysOnTop` se numera **antes** que las criaturas (queda visualmente debajo de ellas en el índice, aunque `alwaysOnTop` suene a lo contrario — el nombre significa "siempre encima del suelo", no "encima de todo").
4. **`canSeeCreature` filtra el conteo por espectador.** Dos jugadores distintos pueden calcular stackpos **diferentes** para el mismo item, si uno ve criaturas invisibles y el otro no. Esto es correcto y necesario: el stackpos es *relativo al observador*. Cuando el servidor borra un item, guarda el `oldStackPosVector` **por espectador**:

```cpp
void Tile::removeThing(Thing* thing, uint32_t count)
{
    ...
    std::vector<int32_t> oldStackPosVector;
    SpectatorVec spectators;
    g_game.map.getSpectators(spectators, getPosition(), true);
    for (Creature* spectator : spectators) {
        if (Player* spectatorPlayer = spectator->getPlayer()) {
            oldStackPosVector.push_back(getStackposOfItem(spectatorPlayer, item));
        }
    }
    ...
    onRemoveTileItem(spectators, oldStackPosVector, item);
}
```

**Este es el patrón más importante a copiar:** *el stackpos es una vista calculada por observador, no un campo almacenado.* Si lo guardás como campo, vas a tener bugs de desincronización imposibles de depurar.

#### Cómo se insertan los items (el orden real)

En `Tile::addThing`:

```cpp
} else if (itemType.alwaysOnTop) {
    // Los TOP items se insertan ORDENADOS por alwaysOnTopOrder (ascendente)
    bool isInserted = false;
    if (items) {
        for (auto it = items->getBeginTopItem(), end = items->getEndTopItem(); it != end; ++it) {
            if (itemType.alwaysOnTopOrder < Item::items[(*it)->getID()].alwaysOnTopOrder) {
                items->insert(it, item);      // se inserta ANTES del primero con orden mayor
                isInserted = true;
                break;
            }
        }
    }
    if (!isInserted) items->push_back(item);   // si nadie tiene orden mayor, va al final
}
```

⇒ **Dentro del mismo `alwaysOnTopOrder`, el criterio es FIFO (el primero en llegar queda más abajo).** Ordenar por orden y luego por inserción es un *sort estable*.

Y para los DOWN items:

```cpp
items = makeItemList();
items->insert(items->getBeginDownItem(), item);   // se inserta AL PRINCIPIO
items->addDownItemCount(1);
```

⇒ **Los DOWN items son LIFO: el último en llegar queda más abajo.** Esto es lo correcto para, por ejemplo, pisar algo: el item nuevo se "mete debajo".

En `Tile::internalAddThing` (carga del mapa desde OTBM) la condición de inserción de TOP items es ligeramente distinta (`>=` en vez de `<`), lo cual cambia el orden relativo para items con el mismo `alwaysOnTopOrder` cargados del mapa vs. creados en runtime:

```cpp
if (Item::items[(*it)->getID()].alwaysOnTopOrder >= itemType.alwaysOnTopOrder) {
    items->insert(it, item);
    isInserted = true;
    break;
}
```

**Recomendación:** documentá tu criterio de desempate y **sé consistente**. La inconsistencia de TFS entre `addThing` y `internalAddThing` es una fuente histórica de bugs visuales.

#### Flags que gobiernan el dibujo (del `.dat`)

Del enum `ThingAttr` / `DatOpts` de OTClient `const.h`:

| Flag | Significado para el render |
|---|---|
| `ThingAttrGround = 0` | es un suelo (ocupa la capa 0, uno solo por tile) |
| `ThingAttrGroundBorder = 1` | borde de suelo (se dibuja sobre el suelo, bajo todo lo demás) |
| `ThingAttrOnBottom = 2` | se dibuja **debajo** de las criaturas |
| `ThingAttrOnTop = 3` | se dibuja **encima** de las criaturas |
| `ThingAttrStackable = 5` | se apila con otros iguales (con contador) |
| `ThingAttrNotWalkable = 12` | bloquea el paso |
| `ThingAttrNotPathable = 15` | bloquea el pathfinding pero no necesariamente el paso |
| `ThingAttrNotMoveable = 13` | no se puede mover |
| `ThingAttrPickupable = 16` | se puede levantar |
| `ThingAttrHangable = 17` | cuelga de un tile (requiere `TILESTATE_SUPPORTS_HANGABLE`) |
| `ThingAttrLight = 21` | emite luz |
| `ThingAttrDontHide = 22` | no se oculta al fallar la línea de vista |
| `ThingAttrTranslucent = 23` | semitransparente (para techos) |
| `ThingAttrDisplacement = 24` | desplazamiento del sprite respecto al ancla |
| `ThingAttrElevation = 25` | elevación del sprite |
| `ThingAttrLyingCorpse = 26` | se dibuja como cadáver tumbado |
| `ThingAttrFullGround = 30` | el suelo cubre el tile entero (para el culling de "cubierto") |
| `ThingAttrTopEffect = 37` | los efectos se dibujan encima |

#### El algoritmo de dibujo del cliente, paso a paso

De `MapView::updateVisibleTiles()` + `drawFloor()`:

1. Cargar en caché los tiles visibles, recorriendo **por diagonales** desde `m_cachedLastVisibleFloor` hacia arriba hasta `cachedFirstVisibleFloor`. Cada tile se inserta con `tilePos.coveredUp(m_posInfo.camera.z - iz)` — o sea, la posición X/Y del piso `iz` se calcula **desplazándola** según la diferencia de piso. Ese es el offset de perspectiva entre plantas.

2. Para cada planta (de la más baja a la más alta):
   - Iterar los tiles en el orden diagonal cacheado.
   - `tile->draw(...)` que internamente dibuja, en orden: ground → ground borders → down items → creatures → top items → common items (según `getStackposOfItem`/`STACK_PRIORITY`).
   - Aplicar opacidad de fade si corresponde.
   - Dibujar un velo negro si `z == camera.z + 1`.
   - `g_drawPool.flush()`.

3. Los misiles/proyectiles de cada planta se dibujan después de los tiles de esa planta.

**El truco de `coveredUp`**: en [OTClient `position.h`](https://github.com/opentibiabr/otclient), `coveredUp(n)` / `coveredDown(n)` desplazan la posición en X/Y para compensar la diferencia de planta. Es la implementación concreta del `offsetz` que vimos en el servidor. **Es una línea de código que define toda la sensación de profundidad del juego.**

---

## 2. Técnicas modernas de sprites 2.5D

Ahora la parte de render moderno. Ordenado por **impacto visual / esfuerzo**.

### 2.1 Billboarding: sprites siempre mirando a la cámara

Un **billboard** es un quad que se orienta para enfrentar la cámara. En un juego de cámara fija (como Tibia), esto es trivial, pero importa si querés darle al jugador control de cámara o hacer zoom/rotación.

**Tres variantes:**

| Variante | Qué hace | Cuándo usarla |
|---|---|---|
| **Esférico / screen-aligned** | El quad copia exactamente la rotación de la cámara (mira al punto de la cámara) | Partículas, efectos de impacto, siempre bien |
| **Axial / cilíndrico** (`BILLBOARD_FIXED_Y`) | Rota solo alrededor del eje **Y** (arriba); su "arriba" siempre es el "arriba" mundial | **Personajes y árboles en juegos top-down con cámara que rota.** Es el correcto para un clon de Tibia. |
| **Fijo** | No rota nunca | Objetos planos anclados al suelo (alfombras, sombras) |

La diferencia entre esférico y axial es **visible e importante**: con esférico, si la cámara se inclina, los árboles y los personajes se "acuestan". Con axial, mantienen la vertical. **Para un juego top-down con sprites que representan cosas paradas, siempre axial.**

#### Godot

`Sprite3D` tiene la propiedad `billboard` con valores del enum `BaseMaterial3D.BillboardMode`:

- `BILLBOARD_DISABLED`
- `BILLBOARD_ENABLED` (esférico)
- `BILLBOARD_FIXED_Y` (**axial** — el que querés)
- `BILLBOARD_PARTICLES`

Documentación: [Godot — Sprite3D](https://docs.godotengine.org/en/stable/classes/class_sprite3d.html) y [Godot — BaseMaterial3D (billboard_mode)](https://docs.godotengine.org/en/stable/classes/class_basematerial3d.html). Para shaders visuales existe `VisualShaderNodeBillboard` ([docs](https://docs.godotengine.org/en/4.3/classes/class_visualshadernodebillboard.html)). Hay un demo oficial: [Sprites and Animated Sprites 3D Demo](https://store.godotengine.org/asset/godot-foundation/sprites-and-animated-sprites-3d-demo/).

`Sprite3D` también soporta `texture_filter`, `alpha_cut`, `shaded`, `double_sided`, `no_depth_test`, `render_priority`, `pixel_size`, `fixed_size`, `alpha_cut` y `billboard`. **El gotcha:** `Sprite3D` con `billboard` y `shaded=false` no recibe iluminación; si querés luces normales, activá `shaded` y `normal_map`, o usá un `MeshInstance3D` con un `QuadMesh` y un `StandardMaterial3D` con `BILLBOARD_FIXED_Y`.

**El shader manual** (para entender qué hace el flag) — en un vertex shader construís la matriz de modelo sin rotación:

```glsl
void vertex() {
    // Construir la base del billboard desde los vectores de la cámara
    vec3 cam_right = normalize(vec3(INV_VIEW_MATRIX[0][0], INV_VIEW_MATRIX[1][0], INV_VIEW_MATRIX[2][0]));
    vec3 cam_up;
    // axial: el "arriba" es siempre el mundial
    cam_up = vec3(0.0, 1.0, 0.0);
    cam_right = normalize(cross(cam_up, normalize(vec3(INV_VIEW_MATRIX[0][2], INV_VIEW_MATRIX[1][2], INV_VIEW_MATRIX[2][2]))));

    // Reemplazar la rotación del modelo, conservando la traslación y la escala
    mat4 billboard = mat4(
        vec4(cam_right * length(MODEL_MATRIX[0].xyz), 0.0),
        vec4(cam_up    * length(MODEL_MATRIX[1].xyz), 0.0),
        vec4(normalize(cross(cam_right, cam_up)) * length(MODEL_MATRIX[2].xyz), 0.0),
        MODEL_MATRIX[3]
    );
    MODELVIEW_MATRIX = VIEW_MATRIX * billboard;
    // ...
}
```

Godot ya expone `CameraMatrix`/`INV_VIEW_MATRIX` en `spatial` shaders, así que no tenés que hornear nada.

#### Unity

- **Para sprites con `SpriteRenderer`:** no hay billboard nativo. Opciones:
  1. **Billboard shader en Shader Graph** usando el nodo *Screen Position* + *Rotate About Axis*, o construir la matriz con los vectores de la cámara (`Camera.main.transform.right/up/forward`).
  2. **`Graphics.DrawMesh`** con una matriz construida manualmente:
     ```csharp
     Quaternion rot = Camera.main.transform.rotation;
     Matrix4x4 m = Matrix4x4.TRS(pos, rot, Vector3.one);
     Graphics.DrawMesh(quad, m, mat, 0);
     ```
     Esto es **spherical**. Para axial, usá `Quaternion.Euler(0, Camera.main.transform.eulerAngles.y, 0)`.
  3. Un `Quad` con `MeshRenderer` y un script `LateUpdate` que hace `transform.rotation = Camera.main.transform.rotation` (esférico) o `Quaternion.LookRotation(transform.position - cam.position, Vector3.up)`.
- **Ventaja de usar quads en vez de `SpriteRenderer`:** los quads reciben luces, sombras proyectadas, `DecalProjector`, post-procesado — `SpriteRenderer` **no**.
- Podés usar `SpriteRenderer` en un mundo 3D sin problema, pero su material por defecto (`Sprites/Default`) es unlit. Para que reciba luces necesitás `Sprites/Diffuse` o un shader custom.

#### Three.js

| Opción | Cómo | Pros | Contras |
|---|---|---|---|
| `THREE.Sprite` | `new THREE.Sprite(mat)` | Siempre enfrenta la cámara, `scale` en unidades de mundo, muy barato | **No se puede rotar** (siempre screen-aligned, ni siquiera axial); usa su propio `SpriteMaterial` (no PBR); **no recibe luces**; no proyecta sombras |
| `PlaneGeometry` + `lookAt` | `mesh.lookAt(camera.position)` cada frame | Control total, soporta `MeshStandardMaterial`, luces, sombras | Hay que actualizarlo; ojo con la rotación acumulada |
| `PlaneGeometry` + quaternion de la cámara | `mesh.quaternion.copy(camera.quaternion)` | Esférico perfecto, 1 línea | Idem; esférico (se acuesta si la cámara se inclina) |
| `PlaneGeometry` + billboard en vertex shader | `onBeforeCompile` con `#include <beginnormal_vertex>` reemplazado | **1 draw call por material, sin CPU por objeto, con luces y sombras** | Más setup |

Ejemplo de axial en Three.js actualizando el quaternion por Y:

```js
// axial (solo yaw de cámara)
const camYaw = Math.atan2(
  camera.position.x - mesh.position.x,
  camera.position.z - mesh.position.z
);
mesh.rotation.set(0, camYaw, 0);
```

**Recomendación:** si el mundo es 3D y querés billboards con iluminación y sombras, usá `PlaneGeometry` con un vertex shader de billboard. `THREE.Sprite` es para partículas/UI en mundo. Hay una discusión clásica en Stack Overflow: [PlaneGeometry lookAt camera](https://stackoverflow.com/questions/41345477/how-to-make-plane-geometry-lookat-camera-using-threejs) y [Three.js sprites and light](https://stackoverflow.com/feeds/question/19669200).

---

### 2.2 Sprite stacking / slice stacking

**La técnica:** tomás un sprite pixel art, y lo dibujás **N veces** apilado verticalmente con un pequeño offset entre capas. Si el sprite tiene "profundidad" pintada (cada capa representa un corte transversal del objeto), el resultado se lee como un volumen 3D. Si la cámara rota, el apilado revela paralaje entre capas y **parece voxel/3D real**.

Fue popularizada por el artículo viral *"This technique for making 2D pixel art look 3D is blowing people's minds"* ([Yahoo Tech](https://tech.yahoo.com/gaming/articles/technique-making-2d-pixel-art-150000575.html)).

#### Cómo se implementa (lo básico)

```
para i en 0..N-1:
    dibujar sprite en (x, y - i * step)
```

- **N** (número de slices): típicamente **8-64**. Más slices = más suave el volumen, más coste.
- **step** (offset vertical): **1 px** es lo habitual para pixel art, porque coincide con la grilla de píxeles y evita blurring. Para un efecto más "exagerado" se usa el *skew*: un desplazamiento horizontal proporcional a la profundidad, que simula perspectiva:

  ```
  para i en 0..N-1:
      dibujar sprite en (x + (i - N/2) * skew, y - i * step)
  ```

  El `skew` es lo que hace que las capas se "abran" en abanico y da la sensación de estar mirando el objeto desde un ángulo.

#### Herramientas

- **[SpriteStack.io](https://spritestack.io/)** (Rezoner) — editor de vóxel/slices orientado a artistas 2D. "Editor is based on spritestacking technique which means drawing a model slice by slice." Exporta **spritesheets, slices y `.vox`**; también importa modelos de MagicaVoxel y Qubicle. El renderer es custom ("handcrafted retro renderer"). Está en [itch.io](https://rezoner.itch.io/spritestack/purchase) y [Steam](https://store.steampowered.com/app/1106180/SpriteStack/). Su FAQ es explícita sobre el uso en motores: *"It outputs spritesheets that also contain color and normal maps — so it's an excellent companion for a 2D gamedev."* **Nota:** no exporta escenas 3D; exporta spritesheets pre-renderizados, que es exactamente lo que querés para producción.
- **MagicaVoxel / Qubicle** — para modelar en vóxeles y luego rebanar.
- Guía comunitaria: **[Sprite Sandwich — A guide to spritestacking](https://discourse.flowlab.io/t/sprite-sandwich-a-guide-to-spritestacking/40779)** (Flowlab Community).

#### Implementación GPU (esto es lo que importa para el rendimiento)

**El problema:** el naïve `for i in 0..N-1: draw(sprite, y - i*step)` son **N draw calls por objeto**. Con N=32 y 100 objetos en pantalla son 3200 draw calls. Inaceptable.

**La solución: un solo draw call con un shader que hace el ray-march / instancing de slices.**

El proyecto **[x3cca/Shader-Stacker](https://github.com/x3cca/Shader-Stacker)** ("GPU-accelerated sprite stacking for top-down 2.5D graphics in Godot") es exactamente esto: en vez de apilar nodos, un shader hace el apilado en la GPU. Estrategias:

1. **Instancing**: subir un `MultiMesh` / instanced draw con N instancias por objeto, cada una con un atributo de altura. **1 draw call por objeto** (con `MultiMeshInstance3D` en Godot, o `Graphics.DrawMeshInstanced` en Unity, o `InstancedMesh` en Three.js).
2. **Texture array / atlas 3D**: subir las N capas como un `Texture2DArray` (o un atlas vertical) y hacer que el fragment shader samplee la capa correcta según un ray-march sobre la altura. **1 draw call total**, cero geometría por slice.
3. **Ray-marching en el fragment shader**: renderizás un volumen bounding box y, por cada píxel, marchás a través de las capas hasta encontrar un texel opaco. Es el enfoque más elegante pero el más caro por píxel.

**El camino pragmático para un MMORPG:** **pre-renderizá**. Como la cámara de Tibia es fija y solo tiene 8 direcciones, podés hornear en tiempo de build, para cada personaje/objeto y cada dirección, la pila completa como un spritesheet. Resultado: **coste de runtime = 1 sprite normal, cero coste de apilado**. Esto es exactamente lo que hace SpriteStack.io. Perdés la capacidad de rotar la cámara libremente, pero *Tibia no tiene cámara libre*.

#### Ventajas y limitaciones

**Ventajas:**
- Volumen creíble sin modelar ni texturizar 3D.
- El artista sigue trabajando en pixel art 2D (curva de aprendizaje baja).
- Coherencia estética perfecta con el resto del juego 2D.
- Con pre-render, gratis en runtime.

**Limitaciones (reales y serias):**
1. **El sprite debe tener "profundidad pintada" consistente.** Si las capas no forman un volumen coherente, el resultado es ruido. Es mucho más difícil de dibujar que un sprite plano: tenés que pensar en cortes transversales.
2. **Siluetas finas se ven mal.** Una lanza, una cuerda, una vela: no tienen volumen que apilar. Se ven como una línea repetida.
3. **Oclusión y clipping con el mundo.** El apilado es geometría falsa: un personaje apilado va a *intersectar* paredes, porque el motor no sabe que tiene volumen. Tenés que resolverlo a mano (ordenar por profundidad, recortar capas, o deshabilitar el apilado cerca de paredes).
4. **Coste de memoria.** N capas × tamaño de sprite. Un personaje de 32×32 con 32 slices = 32×32×32 = 32 768 px = 128 KB RGBA por dirección. × 8 direcciones = 1 MB por personaje. **Pre-renderizar reduce esto a 32×32 × (altura visual) por dirección** (porque las capas se componen en una sola imagen), pero solo si aceptás la cámara fija.
5. **Sorting.** Un objeto apilado tiene N sub-quads; todos deben ordenarse como una unidad con el resto de la escena. Con un solo draw call de instancing esto se maneja solo; con N nodos, no.
6. **El apilado no interactúa con la iluminación 3D correctamente** si lo hacés con capas 2D en un canvas 2D — cada capa recibe la misma luz. En un motor 3D con slices como quads reales, sí (y ahí el apilado es *literalmente* voxels).

**Veredicto para un clon de Tibia:** el sprite stacking es una técnica excelente para **objetos decorativos** (estatuas, cofres, árboles) y opcionalmente para personajes, pero **es ortogonal al look de Tibia**. Tibia es 2D plano con orden de dibujo. Si querés el look Tibia, no necesitás stacking. Si querés *diferenciarte* de Tibia, el stacking es la herramienta más impactante — y como la cámara es fija, podés pre-renderizarlo y el coste es cero.

---

### 2.3 Integración 2D/3D híbrida

**Tres arquitecturas posibles para un "MMORPG 2D con sprites 2.5D":**

| Arquitectura | Mundo | Sprites | Pros | Contras |
|---|---|---|---|---|
| **A. Todo 2D** (recomendada para clon de Tibia) | `TileMapLayer` 2D + offsets por planta | `Sprite2D` con `z_index` / orden de nodo | Máximo rendimiento, pixel-perfect, cero problemas de z-fighting, es exactamente lo que hace Tibia | Sin cámara libre, sin luces 3D reales (pero Godot `Light2D` es suficiente) |
| **B. Mundo 3D + sprites billboard** | Geometría 3D real (cajas, planos) | `Sprite3D` axial / quads con billboard shader | Cámara libre, luces/sombras reales, física 3D, `DecalProjector`, niebla volumétrica | Perdés el pixel-perfect; los sprites 32×32 en un mundo 3D se ven borrosos; mucho más trabajo |
| **C. Híbrido** (la más práctica) | Mundo 3D **solo para altura y colisión** + render 2D | Sprites 2D dibujados en una segunda pasada usando la profundidad del mundo 3D | Lo mejor de ambos | Complejidad de sincronizar dos pipelines |

**Godot** permite lo mejor de A y B a la vez: se puede renderizar un `SubViewport` con `Sprite2D` y ponerlo como textura en un quad 3D, o usar `Sprite3D` directamente. Ver [Godot — Displaying 3D nodes in 2D](https://docs.godotengine.org/en/stable/tutorials/2d/introduction_to_2d.html#displaying-3d-nodes-in-2d).

**Y-sorting / ordenación por profundidad.** En Godot 2D, `Node2D` tiene `y_sort_enabled`: los hijos se ordenan por su `position.y`. **Para un juego con múltiples plantas esto no alcanza**, porque necesitás `(z_planta, y_local)`. Solución práctica:

```
z_index_efectivo = (planta_mas_baja - planta) * 10000 + int(position.y)
```

O mejor: un `CanvasLayer` por planta (o `TileMapLayer` por planta) con el orden de las capas fijo, y dentro de cada capa, Y-sort. Esto replica exactamente el `drawFloor()` de OTClient (iterar plantas de abajo a arriba; dentro de cada planta, ordenar).

En Unity, el equivalente es `SpriteRenderer.sortingOrder` + `sortingLayerName` (una sorting layer por planta), o `TransparencySortMode.CustomAxis` para ordenar por un eje custom.

En Three.js, para objetos con `transparent: true` el orden es `renderOrder` y luego la distancia a la cámara; es **frágil**. Para billboards, usá `material.depthWrite = false` + `renderOrder` explícito, o `SortingGroup`-equivalentes.

**Regla de oro:** con sprites transparentes, **el Z-buffer no te salva**. Necesitás orden explícito y determinista. Documentá tu criterio de desempate desde el día uno (ver §1.8: TFS mismo tiene una inconsistencia ahí).

---

### 2.4 Sombras y señales de profundidad

Ordenadas por impacto/esfuerzo:

#### 1. Drop shadow / blob shadow — **máximo impacto, mínimo esfuerzo** ⭐

Un elipse oscura semitransparente dibujada **debajo** del sprite, en el suelo. Es el truco #1.

- Implementación: un `Sprite2D` con un gradiente radial negro, `modulate.a ≈ 0.3`, escalado según el tamaño del objeto, dibujado **una capa por debajo** del sprite (o con `z_index` menor).
- Elíptico, no circular: `scale = Vector2(1.0, 0.5)` es lo típico en top-down/oblicuo.
- **No lo hagas demasiado oscuro ni demasiado grande.** Un blob shadow sutil es lo que separa un juego que se ve "plano como una calcomanía" de uno que se lee.
- En Godot: un `Sprite2D` con `CanvasItemMaterial` en modo blend `Mix`, o un shader de gradiente. Para muchos objetos, un solo `MultiMesh`/`MultiMeshInstance2D` con todos los blobs = 1 draw call.

#### 2. Sombra proyectada planar — impacto alto, esfuerzo medio

Proyectar el sprite sobre el plano del suelo con una **matriz de skew** y oscurecerlo. Da la sensación de que hay una luz direccional (el sol).

```glsl
// vertex shader: colapsar la Y del sprite sobre el plano del suelo
void vertex() {
    float height_factor = 0.5;   // cuánto "aplasta" la sombra
    VERTEX.y = VERTEX.y * 0.0 + <suelo_y>;   // aplanar
    VERTEX.x += VERTEX.y * height_factor;    // sesgar según la altura
}
```

- En Godot 3D: `Decal` node con una textura proyectada y `cull_mask` restringido al suelo. En Unity: `DecalProjector` (URP/HDRP).
- En 2D puro: un segundo `Sprite2D` con el mismo sprite, `modulate = Color(0,0,0,0.3)`, `scale = Vector2(1.0, -0.4)`, `skew` para dar el ángulo.
- **Ventaja sobre el blob:** la silueta es reconocible, se ve *qué* objeto proyecta la sombra.

#### 3. Ambient occlusion baked en el sprite — impacto medio-alto, esfuerzo bajo

Pintar a mano un borde oscuro donde el objeto toca el suelo (contact shadow / AO). Se nota muchísimo, es gratis en runtime, y es puro trabajo de arte. Es lo que hace que los sprites de Tibia se vean "asentados".

#### 4. Contact shadow dinámico — impacto medio, esfuerzo medio

Una sombra que se **oscurece y se achica** cuando el objeto se acerca al suelo (para saltos, vuelos, proyectiles). La distancia es información de gameplay (saber dónde va a caer algo).

#### 5. Ordenación por profundidad correcta — impacto **crítico**, esfuerzo bajo

Sin esto, todo lo anterior es inútil. Ver §1.8 y §2.3.

Fórmula de profundidad en pantalla, genérica para top-down con altura:

```
depth = (planta * ALTURA_PLANTA) + (y_mundo * FACTOR_Y) - (z_altura_del_objeto)
```

Con `FACTOR_Y` suficientemente grande para que no haya colisiones (típicamente el ancho del mundo, o usá enteros grandes). Y un **criterio de desempate determinista** para objetos en la misma posición (por ejemplo, el orden de creación, o un `id` estable).

#### 6. Sombras dinámicas reales (Godot `Light2D` con `shadow_enabled`) — impacto alto en escenas oscuras, esfuerzo bajo-medio

Godot 2D soporta **sombras reales proyectadas** desde `PointLight2D`/`DirectionalLight2D` usando `LightOccluder2D`. Ver [Godot — 2D lights and shadows](https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html). Requiere que cada objeto que proyecta sombra tenga un `LightOccluder2D` (un polígono). **Para un mundo de tiles es viable**: las paredes son occluders triviales (un rectángulo).

En Unity URP 2D, lo equivalente es `ShadowCaster2D` + `Light2D` con `Shadows` activado.

#### Resumen de impacto/esfuerzo

| Técnica | Impacto visual | Esfuerzo | Runtime |
|---|---|---|---|
| **Drop/blob shadow** | ★★★★★ | ★ | ~0 (1 quad) |
| **Ordenación por profundidad correcta** | ★★★★★ (sin esto todo falla) | ★ | 0 |
| **AO / contact shadow pintado en el sprite** | ★★★★ | ★★ | 0 |
| **Offset vertical por altura (paredes)** | ★★★★ | ★ | 0 |
| **Light2D + halos + viñeta** | ★★★★ | ★★ | Bajo |
| **Sombra proyectada planar** | ★★★ | ★★★ | Bajo-medio |
| **Normal maps + luces dinámicas per-pixel** | ★★★ | ★★★★ | Medio |
| **Sprite stacking** | ★★★★★ (si encaja estéticamente) | ★★★★★ | 0 si pre-renderizado |

---

### 2.5 Iluminación dinámica sobre sprites 2D

#### Normal maps generados para sprites

Para iluminación per-pixel en 2D necesitás un **normal map** por sprite. Se genera a partir de un **height map** (el canal de luminancia, o el alfa, o un mapa pintado a mano).

En vez de calcular el normal analíticamente (que es ruidoso en pixel art), la práctica es **dibujar el height map a mano** y derivar el normal — o usar una herramienta que lo aproxime y después retocar.

**Herramientas:**

| Herramienta | Licencia | Salida |
|---|---|---|
| **[Laigter](https://github.com/azagaya/laigter)** | **GPL-3.0** (confirmado en el README) | normal, **specular, occlusion, parallax**, con preview in-game. Multi-idioma (incluye español). CLI: `laigter --no-gui -d sprite.png -n -c -o -p` |
| **SpriteIlluminator** (CodeAndWeb) | Comercial (de pago) | normal, specular, AO; integración con muchos engines |
| **Sprite Lamp** | Comercial | normal desde height map pintado |
| **Materialize**, **NormalMap-Online** | Gratis | normal desde height genérico |
| **Aseprite + script** / **Pixelorama** | Aseprite: de pago (código disponible); Pixelorama: MIT | normal a mano |

**Laigter es la opción obvia por licencia libre y por CLI automatizable** — podés tener un paso de build que recorra tu carpeta de sprites y genere todos los normal maps. **Ojo con la licencia GPL-3.0:** afecta al *software*, no a las imágenes que generás con él (la salida de una herramienta no es obra derivada). Podés usar tus normal maps en un juego propietario sin problema.

Existe también **[Laigter Integration](https://godotengine.org/asset-library/asset/3422)** como plugin de Godot Asset Library.

#### Godot: `Light2D` + normal maps

Del [tutorial oficial](https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html):

- Nodos: `PointLight2D`, `DirectionalLight2D`, `LightOccluder2D`.
- Para que un `Sprite2D` reciba luz per-pixel necesitás un `CanvasItemMaterial` con:
  - `light_mode = LightOnly` / `Unshaded` / `Normal` (los tres modos: `CanvasItemMaterial.LightMode`)
  - `normal_map` asignado en el `CanvasItem` (`CanvasItem.texture_normal`)
- El `PointLight2D` tiene `texture` (una máscara de luz), `texture_scale`, `height`, `energy`, `color`, `shadow_enabled`, `shadow_color`, `shadow_filter`, `shadow_item_cull_mask`.
- **`height` en `PointLight2D`** es interesante: simula que la luz está a cierta altura, atenuando su alcance. Útil para antorchas en paredes vs. en el suelo.

Ahí mismo el tutorial documenta la alternativa barata y muy relevante:

> **"Using additive sprites as a faster alternative to 2D lights"**

Es decir: en vez de un `Light2D` real, dibujar un sprite radial **en modo blend aditivo** encima de la escena. Es exactamente lo que hacía Tibia (y la mayoría de juegos 2D de los 2000). **Es 10× más barato y en un juego pixel art se ve prácticamente igual.** Para un MMORPG con cientos de antorchas en pantalla, esta es la decisión correcta.

#### Unity URP 2D

- `Light2D` (Global / Point / Freeform / Sprite) + `ShadowCaster2D`.
- El material debe ser `Sprite-Lit-Default` (no `Sprite-Default`, que es unlit). El `Sprite-Lit-Default` samplea `_NormalMap` y el `_MaskTex`.
- Para 2D lights en el renderer: el `Renderer2DData` asset debe tener las luces habilitadas y los `BlendStyles` configurados (Multiply para luz, Additive para glow).
- Normal maps: se asignan en el `SpriteRenderer` como *secondary texture* llamada `_NormalMap` (importante: el nombre exacto).

#### Deferred lighting en 2D

Concepto: renderizar todas las luces a un **light buffer** (una textura aparte) y luego componer. Ventajas: cientos de luces sin coste por objeto, como en 3D deferred. Godot no lo expone nativamente en 2D, pero se puede implementar con:
- un `SubViewport` que renderiza solo las luces (con `CanvasLayer` y blend aditivo),
- y luego un `CanvasLayer` de composición con un `ColorRect` y un shader que multiplica la escena por la luz.

En Three.js esto es directo: render target + `EffectComposer` + un pase de composición custom.

#### El truco de la "capa de luz" (light canvas)

El patrón que usan casi todos los juegos 2D con iluminación:

1. Renderizar el mundo normal a un render target A.
2. Renderizar un render target B: negro sólido + `destination-out` / substracción de los gradientes de las luces + oclusores.
3. Componer: `A * (1 - B)` en multiply, o usar B como máscara.

Es simple, determinista, y funciona en cualquier motor. El resultado visual es indistinguible de un `Light2D` para luces radiales.

#### Viñeta y "oscuridad subterránea"

De OTClient `updateLight()`:

```cpp
Light ambientLight = getCameraPosition().z > g_gameConfig.getMapSeaFloor() ? Light() : g_map.getLight();
ambientLight.intensity = std::max<uint8_t>(m_minimumAmbientLight * 255, ambientLight.intensity);
```

**Bajo tierra no hay luz ambiental.** Implementá:
- Una luz ambiental global que depende de `z` (arriba: ciclo día/noche; abajo: 0).
- Un `m_minimumAmbientLight` para que el jugador nunca quede en negro absoluto (por usabilidad, no por realismo).
- Un ligero tinte azulado en las plantas subterráneas.

---

### 2.6 Cómo se ve la diferencia entre "sprites 2.5D" y "sprites 2D planos"

**Sprites 2D planos** (el caso por defecto, y lo que hace mucha gente sin darse cuenta):
- El sprite se pega sobre el suelo como una calcomanía.
- No hay relación entre el sprite y el espacio que ocupa.
- Personajes "flotando" sobre un suelo que no parece suelo.
- Todo se ve a la misma "distancia" de la cámara.

**Sprites 2.5D** (el objetivo):
- Cada sprite tiene un **punto de anclaje al suelo** claro: los pies están en el tile, y el cuerpo se extiende hacia arriba cruzando los tiles de atrás.
- Hay **offset vertical** entre el ancla y el sprite: un objeto alto invade visualmente los tiles de arriba.
- Hay una **sombra** que ancla el objeto al suelo.
- El **orden de dibujo** hace que un personaje detrás de una pared sea tapado por la pared, aunque ambos estén en la misma rejilla.
- Los objetos tienen **AO / contacto** donde tocan el suelo.
- La **luz** cae de forma distinta sobre objetos a distinta altura.

**Los 5 trucos con más impacto por esfuerzo, en orden:**

1. **Drop shadow bajo cada sprite** (elíptico, sutil). Sin esto, todo flota. Coste: ~0.
2. **Orden de dibujo correcto** (por diagonales + por planta, como OTClient). Sin esto, los personajes caminan "a través" de las paredes. Coste: 0 (es tu loop de render).
3. **Ancla y offset vertical**: el sprite se dibuja con su **base** en el tile, no su centro; las paredes se dibujan X píxeles más arriba. Coste: 0.
4. **AO/contact shadow pintado a mano** en los sprites que tocan el suelo. Coste: arte.
5. **Un polygon de oclusión + luces aditivas** para antorchas y ambiente. Coste: bajo.

**Lo que la mayoría subestima:** el punto 2. El *loop* de render por diagonales de OTClient existe porque sin él, dos objetos en tiles adyacentes se solapan mal. Es literalmente un `for` anidado con un orden no obvio, y determina si el juego se ve profesional o amateur.

---

## 3. Ejemplos y arte de referencia

> **Nota de honestidad:** los juegos que listo abajo los verifiqué por búsqueda web; no pude abrir y confirmar cada uno en detalle. Donde la atribución de la técnica es inferencia mía, lo digo.

### Sprite stacking

| Juego / proyecto | Técnica | Verificación |
|---|---|---|
| **[SpriteStack](https://store.steampowered.com/app/1106180/SpriteStack/)** (Rezoner) | Editor + renderer de sprite stacking. El propio autor lo describe como "a voxel editor suited for 2D artists featuring hand crafted retro renderer with animation support. It exports spritesheets, slices and vox models." No es un juego sino la herramienta, pero **es la referencia canónica de la técnica** | [Sitio oficial](https://spritestack.io/), Steam, itch.io |
| **[SpritePile 2.0](https://2850d1e0.web-app-326.pages.dev/games/spritepile-20)** | Aparece en bases de datos de Steam con la temática de apilar sprites. **No pude verificar su mecánica exacta**; lo menciono como referencia de que el género existe | Steambase (dudoso, verificar) |
| **[Pixel Constructor demo](https://store.steampowered.com/app/4226650/)** | Demo en Steam; aparece en búsquedas de sprite stacking. **Sin verificar** | Steam |
| **[x3cca/Shader-Stacker](https://github.com/x3cca/Shader-Stacker)** | **No es un juego**: es un proyecto de shader para Godot que implementa sprite stacking acelerado por GPU. "GPU-accelerated sprite stacking for top-down 2.5D graphics in Godot." Es la referencia técnica más útil | GitHub |
| **[HEATER / CHEATER](https://itch.io/jam/theveryseriousjuniperdevgamejam/rate/4706933)** | Aparece en itch.io game jams relacionados con stacking. **Sin verificar** | itch.io jam |

### 2.5D con sprites / HD-2D

| Juego | Técnica | Notas |
|---|---|---|
| **Octopath Traveler** (Square Enix, 2018) | "HD-2D": sprites pixel art 2D en un mundo 3D con **post-procesado** (depth of field, bloom, tilt-shift, viñeta) y **billboarding** de los sprites hacia la cámara. Es la referencia más influyente de los últimos años | No verificado en fuente primaria en esta investigación, pero es el caso de manual |
| **Diablo I/II** (Blizzard) | Sprites **pre-renderizados desde modelos 3D** (8 direcciones) e isométrico. La técnica inversa: 3D autoral → 2D final. **Muy relevante para un clon de Tibia**: es el pipeline más práctico | Ampliamente documentado |
| **Doom / Doom II** (id Software) | Sprites pre-renderizados de modelos de plastilina, billboard axial, depth ordering manual en un mundo 2.5D. **El abuelo de todo esto** | Ampliamente documentado |
| **Tunic** (Andrew Shouldice, 2022) | Isométrico 3D real con un personaje 3D, pero la estética *lee* como pixel art 2D. Útil como referencia de cómo la iluminación y el post-proceso hacen que lo 3D se vea 2D | No verificado |
| **The Legend of Zelda: A Link to the Past** (Nintendo, 1991) | El estándar del top-down 2D. **No es 2.5D** pero es la referencia de lectura visual para un clon de Tibia | Ampliamente documentado |
| **CrossCode** (Radical Fish Games) | 2D top-down con altura real (el motor soporta desniveles). Sprites 2D en un mundo con múltiples alturas renderizado en 2D | Referencia muy relevante para el sistema de plantas |

### Emuladores de Tibia como referencia técnica

| Proyecto | Qué es | Enlace |
|---|---|---|
| **The Forgotten Server (TFS)** | El servidor open-source de referencia. C++ | [otland/forgottenserver](https://github.com/otland/forgottenserver) |
| **OTClient (mehah)** | El cliente más activo hoy. Lua + C++ | [mehah/otclient](https://github.com/mehah/otclient) |
| **OTClient (opentibiabr)** | Fork de la comunidad brasileña, muy activo | [opentibiabr/otclient](https://github.com/opentibiabr/otclient) |
| **OTClient Redemption** | Cliente moderno, con soporte de shaders, auras, wings | [OTArchive/otclient](https://github.com/OTArchive/otclient) |
| **OTBM2JSON** | Conversor de mapas OTBM a JSON (útil para exportar tu mundo a otro formato) | [Inconcessus/OTBM2JSON](https://github.com/Inconcessus/OTBM2JSON) |
| **Remere's Map Editor** | El editor de mapas estándar del ecosistema | [opentibiabr/remeres-map-editor](https://github.com/opentibiabr/remeres-map-editor) |

**Por qué esto importa:** podés *leer el código* de TFS y OTClient para resolver cualquier ambigüedad de diseño. Es documentación ejecutable de un MMORPG 2D que funcionó durante 25 años. **Es el mejor recurso del mundo para este proyecto.** (Licencia: TFS es GPL-2.0; OTClient es MIT. Podés estudiarlos libremente; si copiás código, respetá las licencias.)

---

## 4. Recursos de arte libres (CC0/CC-BY)

### 4.1 Liberated Pixel Cup (LPC) — **el recurso más importante**

**Por qué:** es el único ecosistema grande de arte 2D top-down con **4 direcciones**, animaciones de caminar/atacar/lanzar hechizos, capas de ropa/armadura/pelo componibles, y ~15 años de contribuciones. **Es lo más cercano a un "Tibia libre".**

| Recurso | URL | Licencia | Notas |
|---|---|---|---|
| **LPC Base Assets (sprites & map tiles)** | [opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles](https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles) | **CC-BY-SA 3.0** + **GPL 3.0** (doble). *Algunos* assets de Sharm y Redshrike también bajo **OGA-BY 3.0** | Base de la competencia de 2012. Descarga directa: [`lpc_base_assets.zip`](https://opengameart.org/sites/default/files/lpc_base_assets.zip) (713 KB). Tags: 32x32, sprites, tiles, monsters |
| **Universal LPC Spritesheet Character Generator** | [github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) | GPL-3.0 / CC-BY-SA 3.0 (según los assets que compongas) | **El generador**: elegís cuerpo, ropa, pelo, arma y te exporta un spritesheet completo con todas las animaciones y direcciones. Existen forks: [NicholasEli (Less-Code-Fluff)](https://github.com/NicholasEli/Universal-LPC-Spritesheet-Character-Generator---Less-Code-Fluff), [forge-ai-gg/forgeai-characters](https://github.com/forge-ai-gg/forgeai-characters) |
| **LPC Collection** | [opengameart.org/content/lpc-collection](https://opengameart.org/content/lpc-collection) | Mixta (mayormente CC-BY-SA 3.0) | **~150 assets LPC** catalogados: tiles de terreno, castillos, cuevas, ciudades, interiores, monstruos (goblin, imp, araña, lobo, golem, orco, drakes, dark elves), NPCs, animales, armas, armaduras, efectos. **Empezá acá** |
| **LPC Tile Atlas** | [opengameart.org/content/lpc-tile-atlas](https://opengameart.org/content/lpc-tile-atlas) | CC-BY-SA 3.0 | Atlas de tiles 32×32 |
| **LPC Tile Atlas 2** | [opengameart.org/content/lpc-tile-atlas2](https://opengameart.org/content/lpc-tile-atlas2) | CC-BY-SA 3.0 | Continuación |
| **LPC Terrain Repack** | [opengameart.org/content/lpc-terrain-repack](https://opengameart.org/content/lpc-terrain-repack) | CC-BY-SA 3.0 | Terreno reorganizado y limpio |
| **LPC Cavern and ruin tiles** | [opengameart.org/content/lpc-cavern-and-ruin-tiles](https://opengameart.org/content/lpc-cavern-and-ruin-tiles) | CC-BY-SA 3.0 | **Ideal para el subsuelo estilo Tibia** |
| **LPC Castle Mega-Pack** | [opengameart.org/content/lpc-castle-mega-pack](https://opengameart.org/content/lpc-castle-mega-pack) | CC-BY-SA 3.0 | Castillos y murallas |
| **LPC House Insides** | [opengameart.org/content/lpc-house-insides](https://opengameart.org/content/lpc-house-insides) | CC-BY-SA 3.0 | Interiores de casas |
| **LPC City outside / inside** | [outside](https://opengameart.org/content/lpc-city-outside) · [inside](https://opengameart.org/content/lpc-city-inside) | CC-BY-SA 3.0 | Ciudades |
| **LPC Forest tiles** | [opengameart.org/content/lpc-forest-tiles](https://opengameart.org/content/lpc-forest-tiles) | CC-BY-SA 3.0 | Bosque |
| **LPC Medieval fantasy character sprites** | [opengameart.org/content/lpc-medieval-fantasy-character-sprites](https://opengameart.org/content/lpc-medieval-fantasy-character-sprites) | CC-BY-SA 3.0 | Personajes |
| **LPC Goblin - Full Sheet** | [opengameart.org/content/lpc-goblin-full-sheet](https://opengameart.org/content/lpc-goblin-full-sheet) | CC-BY-SA 3.0 | Monstruo completo, todas las animaciones |
| **LPC Wolf Animation** | [opengameart.org/content/lpc-wolf-animation](https://opengameart.org/content/lpc-wolf-animation) | CC-BY-SA 3.0 | Monstruo |
| **LPC Items and game effects** | [opengameart.org/content/lpc-items-and-game-effects](https://opengameart.org/content/lpc-items-and-game-effects) | CC-BY-SA 3.0 | Items y efectos |
| **LPC Animated Doors** | [opengameart.org/content/lpc-animated-doors](https://opengameart.org/content/lpc-animated-doors) | CC-BY-SA 3.0 | Puertas animadas |
| **LPC Animated Water and waterfalls** | [opengameart.org/content/lpc-animated-water-and-waterfalls](https://opengameart.org/content/lpc-animated-water-and-waterfalls) | CC-BY-SA 3.0 | Agua |
| **LPC farming tilesets, magic animations and UI elements** | [opengameart.org/content/lpc-farming-tilesets-magic-animations-and-ui-elements](https://opengameart.org/content/lpc-farming-tilesets-magic-animations-and-ui-elements) | CC-BY-SA 3.0 | **UI incluida** |
| **LPC Pennomi's UI Elements** | [opengameart.org/content/lpc-pennomis-ui-elements](https://opengameart.org/content/lpc-pennomis-ui-elements) | CC-BY-SA 3.0 | **UI/HUD — muy útil para el inventario y la battle list** |
| **LPC LifeBars** | [opengameart.org/content/lpc-lifebars](https://opengameart.org/content/lpc-lifebars) | CC-BY-SA 3.0 | Barras de vida |
| **LPC explosions / explosions 2** | [1](https://opengameart.org/content/lpc-explosions) · [2](https://opengameart.org/content/lpc-explosions-2) | CC-BY-SA 3.0 | Efectos de combate |
| **LPC runcycle and diagonal walkcycle** | [opengameart.org/content/lpc-runcycle-and-diagonal-walkcycle](https://opengameart.org/content/lpc-runcycle-and-diagonal-walkcycle) | CC-BY-SA 3.0 | **Animaciones diagonales — crítico para las 8 direcciones** |
| **LPC 16x16 Tiles extended** | [opengameart.org/content/lpc-16x16-tiles-extended](https://opengameart.org/content/lpc-16x16-tiles-extended) | CC-BY-SA 3.0 | Versión a 16×16 |

**Formato del spritesheet LPC** (importante para integrarlo):
- **Celdas de 64×64 px** (el personaje ocupa ~32×64 dentro de la celda).
- 4 direcciones: **up, left, down, right** (las diagonales se derivan o se toman de packs específicos).
- Filas por animación (orden estándar del `Universal-LPC-Spritesheet`): **spellcast, thrust, walk, slash, shoot, hurt** (y variantes con/sin arma, 1 o 2 manos).
- Las capas (cuerpo, pelo, torso, piernas, brazos, arma, escudo, casco) se componen por *blending* alineado — **el mismo sistema que necesita tu clon para equipamiento visible**.
- Tile size del terreno: **32×32**.

**⚖️ Advertencia sobre licencias LPC:** `CC-BY-SA 3.0` es **copyleft**. Si modificás los sprites, tenés que compartir las modificaciones bajo la misma licencia. **El juego en sí no se vuelve CC-BY-SA** (es una obra separada), pero el arte sí. Si necesitás arte propietario, hay un número limitado de assets LPC disponibles bajo **CC-BY** (los de Sharm y Redshrike, ver el comentario de bluecarrot16 en la página de LPC Base Assets). **Leé `CREDITS.TXT` de cada paquete: la licencia puede variar asset por asset.**

### 4.2 Kenney.nl — **CC0 puro, cero fricción legal**

Todos los assets de Kenney son **Creative Commons CC0 1.0** (dominio público, sin atribución requerida). Es la opción más segura legalmente.

| Pack | URL | Tile size | Contenido |
|---|---|---|---|
| **Tiny Dungeon** | [kenney.nl/assets/tiny-dungeon](https://kenney.nl/assets/tiny-dungeon) | **16×16** | 130 archivos. Mazmorras, alcantarillas, RPG, roguelike. Confirmado en la página: "License: Creative Commons CC0", "Tile size: 16 × 16", "Files: 130×" |
| **Tiny Town** | [kenney.nl/assets/tiny-town](https://kenney.nl/assets/tiny-town) | 16×16 | Pueblo |
| **Tiny Battle** | [kenney.nl/assets/tiny-battle](https://kenney.nl/assets/tiny-battle) | 16×16 | Combate |
| **Tiny Farm** | [kenney.nl/assets/tiny-farm](https://kenney.nl/assets/tiny-farm) | 16×16 | Granja |
| **Roguelike/RPG pack** | [kenney.nl/assets](https://kenney.nl/assets) (buscar "roguelike") | 16×16 | Tiles roguelike, monstruos, items |
| **1-Bit Pack** | [kenney.nl/assets/1-bit-pack](https://kenney.nl/assets/1-bit-pack) | variado | Estilo 1-bit |
| **Kenney Game Assets All-in-1** | [kenney.itch.io/kenney-game-assets](https://kenney.itch.io/kenney-game-assets) | — | Bundle completo (pago, con todo) |

**Limitación:** los packs "Tiny" son de 16×16, no 32×32, y las animaciones son mínimas (no hay spritesheets de caminar con 4 direcciones y 8 frames como LPC). **Kenney sirve para tiles, UI e iconos; para personajes animados multidireccionales, LPC es superior.**

### 4.3 OpenGameArt — otros recursos destacados

| Recurso | URL | Licencia | Notas |
|---|---|---|---|
| **DawnLike** | [opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v2](https://opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v2) | **CC-BY-SA 3.0** / GPL 3.0 | Tileset universal roguelike 16×16, enorme, con monstruos, items, terreno |
| **Tiled Terrains** | [opengameart.org/content/tiled-terrains](https://opengameart.org/content/tiled-terrains) | CC-BY-SA 3.0 | Terreno con transiciones |
| **Isometric 64x64 tilesets** | buscar en [opengameart.org](https://opengameart.org) | variable | Si querés isométrico en vez de top-down |
| **Búsqueda avanzada 2D top-down** | [opengameart.org/art-search-advanced](https://opengameart.org/art-search-advanced) | — | Filtrá por *2D Art* + tags `top-down`, `32x32`, `LPC` |

### 4.4 itch.io — **ojo: gratis ≠ libre**

Muchos packs de itch.io son **gratis pero con licencia restrictiva** (no comercial, o "solo para prototipos"). **Leé la licencia de cada uno.**

| Pack | Autor | Licencia | Notas |
|---|---|---|---|
| **Ninja Adventure Asset Pack** | Pixel-Boy | **CC0** | El más generoso de itch. Personajes, tiles, UI, música, SFX. Confirmado por el autor en [comentarios del pack](https://itch.io/post/16905291) |
| **Sprout Lands** | Cup Nooble | Gratis (ver licencia del pack) | Pixel art top-down muy popular. **Verificar licencia** |
| **Modern Interiors / Modern Exteriors** | LimeZu | Gratis / pago (ver licencia) | Interiores y exteriores modernos, muy completos. **No es CC0** |
| **Mystic Woods** | Game Endeavor | Gratis (ver licencia) | Top-down con personajes |
| **Pixel Art Top Down - Basic** | Cainos | Gratis (ver licencia) | Prototipado rápido |
| **Zelda-like tilesets and sprites** | ArMM1998 | **CC0** | En OpenGameArt: [opengameart.org/content/zelda-like-tilesets-and-sprites](https://opengameart.org/content/zelda-like-tilesets-and-sprites) |
| **Tiny Swords** | Pixel Frog | Gratis (ver licencia) | RTS/top-down |

**Regla práctica:** si el pack de itch.io no dice explícitamente "CC0" o "CC-BY", asumí que **no** podés usarlo comercialmente. Para un MMORPG (que probablemente quieras monetizar), **andá a CC0 o CC-BY**.

### 4.5 Herramientas de arte

| Herramienta | Licencia | Uso |
|---|---|---|
| **[Aseprite](https://www.aseprite.org/)** | De pago (~20 USD); el **código fuente** está disponible bajo licencia propia (no libre) | El estándar de facto del pixel art. Soporta capas, tiles, spritesheets, scripting Lua |
| **[LibreSprite](https://github.com/LibreSprite/LibreSprite)** | **GPL-2.0** | Fork libre de Aseprite (pre-rebranding) |
| **[Pixelorama](https://github.com/Orama-Interactive/Pixelorama)** | **MIT** | Editor de pixel art hecho en Godot. Excelente alternativa libre y moderna |
| **[Piskel](https://www.piskelapp.com/)** | Apache 2.0 | Editor web, cero instalación |
| **[Laigter](https://github.com/azagaya/laigter)** | **GPL-3.0** | Normal / specular / occlusion / parallax maps para sprites. CLI automatizable |
| **[Tiled](https://www.mapeditor.org/)** | GPL-2.0 (el editor) | Editor de mapas genérico con soporte de múltiples capas — **útil para diseñar tu formato de mapa** |
| **[LDtk](https://ldtk.io/)** | MIT | Editor de niveles moderno, con soporte nativo de múltiples capas y entidades |
| **[SpriteStack.io](https://spritestack.io/)** | De pago / alpha para patrons | Editor de sprite stacking → spritesheets |

### 4.6 Tabla comparativa final

| Recurso | URL | Licencia | Tamaño | Direcciones / Animaciones | Apto para clon de Tibia |
|---|---|---|---|---|---|
| **LPC Base Assets** | [OGA](https://opengameart.org/content/liberated-pixel-cup-lpc-base-assets-sprites-map-tiles) | CC-BY-SA 3.0 + GPL 3.0 | 32×32 tile / 64×64 celda | 4 dir + diag., walk/slash/thrust/spellcast/shoot/hurt | ★★★★★ **El mejor** |
| **Universal LPC Generator** | [GitHub](https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator) | GPL-3.0 / CC-BY-SA 3.0 | 64×64 celda | 4 dir, todas las animaciones, capas componibles | ★★★★★ **Imprescindible** |
| **LPC Collection (~150 assets)** | [OGA](https://opengameart.org/content/lpc-collection) | Mixta | 32×32 | Variado, con monstruos | ★★★★★ |
| **LPC Cavern and ruin tiles** | [OGA](https://opengameart.org/content/lpc-cavern-and-ruin-tiles) | CC-BY-SA 3.0 | 32×32 | Sin personajes | ★★★★★ (subsuelo) |
| **LPC Pennomi's UI** | [OGA](https://opengameart.org/content/lpc-pennomis-ui-elements) | CC-BY-SA 3.0 | — | UI/HUD | ★★★★★ (inventario, battle list) |
| **LPC diagonal walkcycle** | [OGA](https://opengameart.org/content/lpc-runcycle-and-diagonal-walkcycle) | CC-BY-SA 3.0 | 64×64 | 8 dir | ★★★★★ (las diagonales) |
| **Zelda-like tilesets (ArMM1998)** | [OGA](https://opengameart.org/content/zelda-like-tilesets-and-sprites) | **CC0** | 16×16 | 4 dir | ★★★★ (sin fricción legal) |
| **Ninja Adventure Pack** | [itch.io](https://pixel-boy.itch.io/ninja-adventure-asset-pack) | **CC0** | 16×16 | 4 dir, animado | ★★★★ (sin fricción legal) |
| **Kenney Tiny Dungeon** | [kenney.nl](https://kenney.nl/assets/tiny-dungeon) | **CC0** | 16×16 | Estático (sin animaciones de personaje) | ★★★ (tiles/UI) |
| **Kenney Tiny Town** | [kenney.nl](https://kenney.nl/assets/tiny-town) | **CC0** | 16×16 | Estático | ★★★ (tiles) |
| **DawnLike** | [OGA](https://opengameart.org/content/dawnlike-16x16-universal-rogue-like-tileset-v2) | CC-BY-SA 3.0 / GPL 3.0 | 16×16 | Estático, enorme variedad | ★★★ |
| **Sprout Lands** | [itch.io](https://cupnooble.itch.io/sprout-lands-asset-pack) | Gratis (**verificar**) | 16×16 | 4 dir | ★★★ (verificar licencia) |
| **Modern Interiors (LimeZu)** | [itch.io](https://limezu.itch.io/moderninteriors) | Gratis/pago (**no CC0**) | 16×16 | 4 dir | ★★ (interiores) |

**⚠️ Aviso legal final:** los sprites originales de **Tibia son propiedad de CipSoft GmbH** y **no se pueden reutilizar**. Reimplementar las mecánicas (grid, stackpos, multi-floor, vocaciones) es perfectamente legal — las mecánicas no son copyrighteables. Copiar sprites, nombres de items, mapas o assets sí lo es. **Usá el código de TFS/OTClient como referencia arquitectónica y el arte de LPC/Kenney/CC0 como assets.**

---

## 5. Apéndice: plan de implementación recomendado

### Decisiones de arquitectura

| Decisión | Recomendación | Por qué |
|---|---|---|
| **Motor** | Godot 4 (`TileMapLayer` + `Sprite2D` + `CanvasLayer` por planta) o Three.js si es web | Godot 2D es exactamente el modelo de Tibia. Three.js si necesitás el cliente en navegador. |
| **Render** | **2D puro con orden explícito**, NO sprites en mundo 3D | Es lo que hace Tibia, es 10× más barato, y el pixel-perfect se mantiene |
| **Proyección** | Oblicua / top-down puro, tile 32×32, sin rotación de cámara | Coincide con el arte disponible (LPC es 32×32) |
| **Plantas** | 16 (`z = 0..15`), `seaFloor = 7`, rango visible ±2 bajo tierra | Réplica exacta del modelo de Tibia |
| **Orden de render** | Plantas de abajo a arriba; dentro de cada planta, **orden diagonal** | Es el truco central de OTClient |
| **Stackpos** | **Calculado por observador, nunca almacenado** | Es el patrón de TFS y evita bugs de desincronización |
| **Movimiento** | Step-based, tick de 50 ms, duración = múltiplo de 50 ms | Réplica exacta; es lo que hace que "se sienta" Tibia |
| **Cooldowns** | **Grupos independientes** (attack / healing / support / special) | Define la rotación de combate |
| **Skills** | Modelo de **tries acumulativos** con `getReqSkillTries(skill, level)` | Monótono, sin redondeo acumulado, % exacto |
| **Arte** | LPC para personajes y tiles; Kenney para UI; normal maps con Laigter | Es lo único que cubre 8 direcciones con animaciones |
| **Sombra** | Blob shadow elíptico bajo cada sprite | Máximo impacto, coste cero |
| **Luz** | Sprite aditivo + capa de luz (no `Light2D` real) para antorchas masivas | Es lo que hacía Tibia; escala a cientos de luces |

### Orden de construcción sugerido

1. **Rejilla + movimiento step-based con tick de 50 ms.** Con la fórmula exacta de `getStepDuration` y los modificadores diagonal (×3) y cambio de piso (×2). Sin esto, el juego no se siente bien y todo lo demás es cosmético.
2. **Render por diagonales con stackpos calculado.** Empezá con 1 sola planta. Verificá que un objeto alto tapa correctamente a lo de atrás.
3. **Multi-planta** con `coveredUp` / offset y `calcFirstVisibleFloor` / `calcLastVisibleFloor`.
4. **Combate**: auto-attack con scheduler, cooldowns por grupo, defensa/armadura con `blockCount` (2/s).
5. **Inventario**: contenedores anidados con profundidad limitada, slots con máscara de bits, peso recursivo.
6. **Progresión**: tabla de exp cúbica, skills por tries, vocaciones con multiplicadores.
7. **Luz**: capa de luz aditiva + ambiente por planta.
8. **2.5D**: blob shadows, AO pintado, offset vertical de paredes, luces aditivas.
9. **Opcional**: sprite stacking pre-renderizado para objetos decorativos destacados.

### Fuentes primarias citadas

**Código fuente (verificado):**
- [otland/forgottenserver — `src/creature.cpp`](https://github.com/otland/forgottenserver/blob/master/src/creature.cpp) (step duration, speed, canSee, blockHit, light)
- [otland/forgottenserver — `src/tile.cpp`](https://github.com/otland/forgottenserver/blob/master/src/tile.cpp) (stackpos, addThing, queryDestination, getUseItem)
- [otland/forgottenserver — `src/tile.h`](https://github.com/otland/forgottenserver/blob/master/src/tile.h) (TileItemVector, tileflags)
- [otland/forgottenserver — `src/items.h`](https://github.com/otland/forgottenserver/blob/master/src/items.h) (SlotPositionBits, ItemType)
- [otland/forgottenserver — `src/game.h`](https://github.com/otland/forgottenserver/blob/master/src/game.h) (MAX_STACKPOS, handler signatures)
- [otland/forgottenserver — `src/const.h`](https://github.com/otland/forgottenserver/blob/master/src/const.h) (item ID enums, skulls, fluids)
- [otland/forgottenserver — `src/player.cpp`](https://github.com/otland/forgottenserver/blob/master/src/player.cpp) (attack speed, defense, skills, light, skulls, containers)
- [opentibiabr/otclient — `src/client/mapview.cpp`](https://github.com/opentibiabr/otclient/blob/main/src/client/mapview.cpp) (drawFloor, visible tiles, floor calc, light)
- [opentibiabr/otclient — `src/client/const.h`](https://github.com/opentibiabr/otclient/blob/main/src/client/const.h) (STACK_PRIORITY, ThingAttr, Direction, Skill, slots, vocations)

**Documentación y artículos:**
- [OTLand — A comprehensive description of the OTBM format](https://otland.net/threads/a-comphrensive-description-of-the-otbm-format.258583/)
- [OTLand — Tibia.dat Reader + .dat/.spr Structure](https://otland.net/threads/tibia-dat-reader-dat-spr-structure-and-spr-reading-code-link.25117/)
- [OTLand — TFS 1.5 walk delay (getStepDuration)](https://otland.net/threads/tfs-1-5-8-60-walk-delay.289889/)
- [TibiaQA — Maximum steps per second (server tick = 50 ms)](https://www.tibiaqa.com/37185/what-is-the-maximum-steps-per-second-a-character-can-do)
- [TibiaQA — Speed points to sqm/min (breakpoints)](https://www.tibiaqa.com/24503/how-to-convert-speed-points-to-sqm-min)
- [tibia.com — Experience Table](https://www.tibia.com/library/?subtopic=experiencetable)
- [tibia.com — Spells library](https://www.tibia.com/library/?subtopic=spells)
- [Tibia Fandom — Speed](https://tibia.fandom.com/wiki/Speed) · [Speed Breakpoints](https://tibia.fandom.com/wiki/Speed_Breakpoints) · [Formulae](https://tibia.fandom.com/wiki/Formulae) · [Experience Table](https://tibia.fandom.com/wiki/Experience_Table) · [Capacity](https://tibia.fandom.com/wiki/Capacity)
- [Godot — 2D lights and shadows](https://docs.godotengine.org/en/stable/tutorials/2d/2d_lights_and_shadows.html)
- [Godot — Sprite3D](https://docs.godotengine.org/en/stable/classes/class_sprite3d.html) · [BaseMaterial3D](https://docs.godotengine.org/en/stable/classes/class_basematerial3d.html) · [VisualShaderNodeBillboard](https://docs.godotengine.org/en/4.3/classes/class_visualshadernodebillboard.html)
- [Godot — 2D meshes](https://docs.godotengine.org/en/stable/tutorials/2d/2d_meshes.html) · [Using MultiMesh](https://docs.godotengine.org/en/stable/tutorials/performance/using_multimesh.html)
- [x3cca/Shader-Stacker — GPU-accelerated sprite stacking for Godot](https://github.com/x3cca/Shader-Stacker)
- [SpriteStack.io](https://spritestack.io/) · [Steam](https://store.steampowered.com/app/1106180/SpriteStack/)
- [Flowlab — Sprite Sandwich: A guide to spritestacking](https://discourse.flowlab.io/t/sprite-sandwich-a-guide-to-spritestacking/40779)
- [Godot Forum — Stacked sprites, pseudo 3d and possibly voxels](https://forum.godotengine.org/t/stacked-sprites-pseudo-3d-and-possibly-voxels/121248)
- [Yahoo Tech — This technique for making 2D pixel art look 3D](https://tech.yahoo.com/gaming/articles/technique-making-2d-pixel-art-150000575.html)
- [azagaya/laigter — automatic normal map generator for sprites (GPL-3.0)](https://github.com/azagaya/laigter)
- [Stack Overflow — PlaneGeometry lookAt camera in Three.js](https://stackoverflow.com/questions/41345477/how-to-make-plane-geometry-lookat-camera-using-threejs)
- [OpenGL SIGGRAPH 99 — 6.10 Billboards](http://www.opengl.org/archives/resources/code/samples/sig99/advanced99/notes/node73.html)

---

*Informe generado a partir de investigación web con fuentes primarias (código fuente de TFS/OTClient) y secundarias. Donde un dato no pudo verificarse, se indica explícitamente.*
