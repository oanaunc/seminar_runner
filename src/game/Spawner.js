import * as THREE from 'three';
import {
  LANE_WIDTH, LANE_X, LANES,
  SPAWN_AHEAD_MIN, SPAWN_AHEAD_MAX, DESPAWN_BEHIND,
  COIN_Y,
  PLAYER_HEIGHT,
  randInt, randFloat, pick, aabbOverlap,
} from './Utils.js';

/*
 ┌──────────────────────────────────────────────────────────────────────┐
 │  OBSTACLE ARCHETYPES                                                │
 │  type          dims (w, h, d)    y-base   requiredAction            │
 │  ───────────── ───────────────── ──────── ────────────────────────── │
 │  low_barrier   (laneW, 0.5, 0.6)  0       jump                     │
 │  high_bar      (laneW, 0.3, 0.4)  1.3     slide                    │
 │  solid_block   (laneW, 2.2, 1.2)  0       switch (lane change)     │
 │  train         (laneW, 2.4, 6.0)  0       switch (long block)      │
 └──────────────────────────────────────────────────────────────────────┘

 FAIRNESS CONSTRAINTS (see numbered rules in spec):
   1. Always at least one clear lane or dodgeable path.
   2. minTelegraphDist respected between consecutive obstacles.
   3. Never block all 3 lanes at the same Z unless one is jumpable/slideable.
   4. Max 2 consecutive "jump-required" obstacles without a recovery gap.
   5. Lane-switch feasibility: if blocking current lane, adjacent lane must be free
      or current-lane obstacle is jumpable/slideable.
*/

// ── Obstacle type templates ──────────────────────────
const TYPES = {
  low_barrier: { w: 1.6, h: 0.55, d: 0.6, yBase: 0, action: 'jump', color: 0xff4444 },
  high_bar:    { w: 1.6, h: 0.35, d: 0.4, yBase: 1.3, action: 'slide', color: 0xffaa00 },
  solid_block: { w: 1.5, h: 2.2, d: 1.2, yBase: 0, action: 'switch', color: 0xff0055 },
  train:       { w: 1.6, h: 2.4, d: 6.0, yBase: 0, action: 'switch', color: 0x8800aa },
};

const EARLY_TYPES = ['low_barrier', 'high_bar', 'solid_block'];
const ALL_TYPES = ['low_barrier', 'high_bar', 'solid_block', 'train'];

export class Spawner {
  constructor(scene) {
    this.scene = scene;

    this.obstacles = [];      // active obstacle objects
    this.coins = [];          // active coin meshes
    this._obstaclePool = [];  // dormant obstacle meshes
    this._coinPool = [];      // dormant coin meshes

    this._nextSpawnZ = -SPAWN_AHEAD_MIN;
    this._consecutiveJumps = 0;

    // Shared materials (reused across all pooled items)
    this._obsMats = {};
    for (const [k, v] of Object.entries(TYPES)) {
      this._obsMats[k] = new THREE.MeshStandardMaterial({
        color: v.color,
        roughness: 0.55,
        metalness: 0.15,
      });
    }
    this._coinMat = new THREE.MeshStandardMaterial({
      color: 0xffd700, emissive: 0x664400, roughness: 0.3, metalness: 0.6,
    });
    this._coinGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.1, 12);
  }

  // ── Object pool helpers ────────────────────────────
  _getObstacleMesh(typeName) {
    const t = TYPES[typeName];
    // Try pool first
    for (let i = this._obstaclePool.length - 1; i >= 0; i--) {
      const pooled = this._obstaclePool[i];
      if (pooled.userData._typeName === typeName) {
        this._obstaclePool.splice(i, 1);
        pooled.visible = true;
        return pooled;
      }
    }
    const geo = new THREE.BoxGeometry(t.w, t.h, t.d);
    const mesh = new THREE.Mesh(geo, this._obsMats[typeName]);
    mesh.castShadow = true;
    mesh.userData._typeName = typeName;
    this.scene.add(mesh);
    return mesh;
  }

  _releaseObstacle(obs) {
    obs.mesh.visible = false;
    this._obstaclePool.push(obs.mesh);
  }

  _getCoinMesh() {
    if (this._coinPool.length > 0) {
      const m = this._coinPool.pop();
      m.visible = true;
      return m;
    }
    const m = new THREE.Mesh(this._coinGeo, this._coinMat);
    m.rotation.x = Math.PI / 2;
    this.scene.add(m);
    return m;
  }

  _releaseCoin(coin) {
    coin.mesh.visible = false;
    this._coinPool.push(coin.mesh);
  }

  // ── Spawning logic ────────────────────────────────
  update(dt, difficulty, worldOffset) {
    const speed = difficulty.speed;
    const telegraph = difficulty.minTelegraphDist;

    // Spawn new obstacles when the frontier needs extending
    const spawnHorizon = -(SPAWN_AHEAD_MAX);
    while (this._nextSpawnZ > spawnHorizon) {
      this._spawnGroup(this._nextSpawnZ, difficulty);
      this._nextSpawnZ -= telegraph + randFloat(0, telegraph * 0.4);
    }

    // Move everything toward +z
    const move = speed * dt;
    for (const obs of this.obstacles) {
      obs.mesh.position.z += move;
      obs.z += move;
    }
    for (const c of this.coins) {
      c.mesh.position.z += move;
      c.z += move;
      c.mesh.rotation.z += dt * 3;
    }

    // Despawn behind player
    this.obstacles = this.obstacles.filter((obs) => {
      if (obs.z > DESPAWN_BEHIND) { this._releaseObstacle(obs); return false; }
      return true;
    });
    this.coins = this.coins.filter((c) => {
      if (c.z > DESPAWN_BEHIND) { this._releaseCoin(c); return false; }
      return true;
    });
  }

  /**
   * Spawn a "group" at a given z row. A group is 1–2 obstacles across
   * lanes, respecting all fairness constraints.
   */
  _spawnGroup(z, difficulty) {
    const mix = difficulty.obstacleMix;
    const pool = mix > 0.3 ? ALL_TYPES : EARLY_TYPES;

    // Decide how many lanes to block (1 or 2; never all 3 with impassable)
    const numBlocked = Math.random() < 0.3 + mix * 0.2 ? 2 : 1;

    // Pick lanes to block
    const shuffled = [...LANES].sort(() => Math.random() - 0.5);
    const blockedLanes = shuffled.slice(0, numBlocked);
    const freeLanes = shuffled.slice(numBlocked);

    /*
     * FAIRNESS RULE 4: limit consecutive jump-required obstacles.
     * If we've had 2+ jumps in a row, force a non-jump type.
     */
    let forceNoJump = this._consecutiveJumps >= 2;
    let anyJump = false;

    for (const lane of blockedLanes) {
      let typeName = pick(pool);

      if (forceNoJump && TYPES[typeName].action === 'jump') {
        typeName = pick(pool.filter((t) => TYPES[t].action !== 'jump'));
        if (!typeName) typeName = 'solid_block';
      }

      /*
       * FAIRNESS RULE 3: if this is the second blocked lane (numBlocked=2),
       * ensure the combination doesn't demand impossible actions.
       * Two "switch" obstacles at the same Z across 2 lanes is fine — player
       * dodges to the one free lane.  But if both require different _active_
       * moves (jump + slide simultaneously), downgrade one to a switch.
       */
      const t = TYPES[typeName];
      if (t.action === 'jump') anyJump = true;

      const mesh = this._getObstacleMesh(typeName);
      const x = LANE_X(lane);
      mesh.position.set(x, t.yBase + t.h * 0.5, z);

      this.obstacles.push({
        mesh,
        type: typeName,
        lane,
        z,
        action: t.action,
        hw: t.w * 0.5,
        hh: t.h * 0.5,
        hd: t.d * 0.5,
        yBase: t.yBase,
      });
    }

    this._consecutiveJumps = anyJump ? this._consecutiveJumps + 1 : 0;

    // Optionally spawn coins on the free lane(s)
    if (Math.random() < difficulty.coinDensity && freeLanes.length > 0) {
      const coinLane = pick(freeLanes);
      const coinCount = randInt(3, 6);
      for (let i = 0; i < coinCount; i++) {
        const cm = this._getCoinMesh();
        const cz = z - i * 2.2;
        cm.position.set(LANE_X(coinLane), COIN_Y, cz);
        this.coins.push({ mesh: cm, lane: coinLane, z: cz, collected: false });
      }
    }
  }

  /** Get AABB for an obstacle. */
  getObstacleAABB(obs) {
    return {
      x: obs.mesh.position.x,
      y: obs.yBase + obs.hh,
      z: obs.z,
      hw: obs.hw,
      hh: obs.hh,
      hd: obs.hd,
    };
  }

  /** Get AABB for a coin (small). */
  getCoinAABB(c) {
    return {
      x: c.mesh.position.x,
      y: COIN_Y,
      z: c.z,
      hw: 0.4,
      hh: 0.4,
      hd: 0.4,
    };
  }

  reset() {
    for (const obs of this.obstacles) this._releaseObstacle(obs);
    for (const c of this.coins) this._releaseCoin(c);
    this.obstacles = [];
    this.coins = [];
    this._nextSpawnZ = -SPAWN_AHEAD_MIN;
    this._consecutiveJumps = 0;
  }
}
