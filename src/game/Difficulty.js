import {
  lerp, smoothCurve,
  MIN_SPEED, MAX_SPEED, SPEED_TAU,
  MIN_SPAWN_INTERVAL, MAX_SPAWN_INTERVAL, SPAWN_TAU,
  MIN_REACTION_TIME, REACTION_SAFETY_BUFFER,
} from './Utils.js';

/**
 * Progressive difficulty scaling.
 *
 * Curves use exponential approach: value = lerp(start, end, 1 - e^(-t/τ))
 * This gives a fast initial ramp that gradually flattens — the player
 * feels the game "getting harder" in the first 30-60 s but it never
 * becomes literally impossible because the curve has an asymptote.
 *
 * KEY PARAMETERS (tweak in Utils.js):
 *   MIN_SPEED / MAX_SPEED  – world-scroll speed range
 *   SPEED_TAU              – seconds to reach ~63 % of max speed
 *   MIN/MAX_SPAWN_INTERVAL – time between obstacle groups
 *   SPAWN_TAU              – how fast spawn interval shrinks
 *   MIN_REACTION_TIME      – absolute floor for player reaction budget
 */
export class Difficulty {
  constructor() {
    this.elapsed = 0;
    this.speed = MIN_SPEED;
    this.spawnInterval = MAX_SPAWN_INTERVAL;
    this.reactionTime = 1.0;
    this.obstacleMix = 0;   // 0 → only simple types, 1 → full mix including trains
    this.coinDensity = 0.35; // probability a spawn also places coins
  }

  reset() {
    this.elapsed = 0;
    this.update(0);
  }

  update(dt) {
    this.elapsed += dt;
    const t = this.elapsed;

    const speedT = smoothCurve(t, SPEED_TAU);
    this.speed = lerp(MIN_SPEED, MAX_SPEED, speedT);

    const spawnT = smoothCurve(t, SPAWN_TAU);
    this.spawnInterval = lerp(MAX_SPAWN_INTERVAL, MIN_SPAWN_INTERVAL, spawnT);

    // Reaction budget: shrinks but never below the absolute floor
    this.reactionTime = Math.max(
      MIN_REACTION_TIME,
      lerp(1.0, MIN_REACTION_TIME, smoothCurve(t, SPEED_TAU * 0.8))
    );

    // Obstacle mix ramps up after ~15 s
    this.obstacleMix = smoothCurve(Math.max(0, t - 15), 40);

    // Coins get slightly more frequent as positive reinforcement
    this.coinDensity = lerp(0.35, 0.55, smoothCurve(t, 60));
  }

  /** Minimum Z distance an obstacle must be placed from the last one. */
  get minTelegraphDist() {
    return this.speed * this.reactionTime + REACTION_SAFETY_BUFFER;
  }
}
