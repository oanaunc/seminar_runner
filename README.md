# seminar_runner

Endless 3-lane runner prototype (Subway Surfers-style) built with Three.js + Vite.

**Dominant mechanic:** progressive difficulty scaling — speed, obstacle density, and reaction window compress over time while fairness constraints guarantee no impossible spawns.

## Run

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build → dist/
```

## Controls

| Action | Keyboard | Mobile |
|--------|----------|--------|
| Move left | A / ← | Swipe left |
| Move right | D / → | Swipe right |
| Jump | W / ↑ / Space | Swipe up |
| Slide | S / ↓ | Swipe down |
| Pause | P | — |
| Restart | R (game over) | Tap button |

## Key Parameters (tweak in `src/game/Utils.js` and `src/game/Difficulty.js`)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `MIN_SPEED` / `MAX_SPEED` | 13 / 30 | World scroll speed range |
| `SPEED_TAU` | 45 s | Time constant for speed curve (~63 % at τ) |
| `MIN_SPAWN_INTERVAL` / `MAX_SPAWN_INTERVAL` | 0.55 / 1.6 s | Obstacle spacing range |
| `MIN_REACTION_TIME` | 0.45 s | Absolute floor for player reaction budget |
| `REACTION_SAFETY_BUFFER` | 3.0 units | Extra telegraph distance on top of reaction time |

## Fairness Rules

1. At least one clear lane (or jumpable/slideable path) always exists.
2. Minimum telegraph distance respected between consecutive obstacles.
3. Never three impassable obstacles across all lanes at the same depth.
4. Max 2 consecutive jump-required obstacles before a recovery gap.
5. Lane-switch feasibility enforced — adjacent lane always reachable in time.
