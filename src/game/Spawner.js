import * as THREE from 'three';
import {
  LANE_WIDTH, LANE_X, LANES,
  SPAWN_AHEAD_MIN, SPAWN_AHEAD_MAX, DESPAWN_BEHIND,
  COIN_Y, TRAIN_ROOF_Y,
  randInt, randFloat, pick,
} from './Utils.js';

/*
 ┌──────────────────────────────────────────────────────────────────────┐
 │  OBSTACLE ARCHETYPES                                                │
 │  type          dims (w, h, d)      y-base   requiredAction          │
 │  ───────────── ─────────────────── ──────── ──────────────────────── │
 │  low_barrier   (1.6, 0.55, 0.6)    0        jump                   │
 │  high_bar      (1.6, 0.35, 0.4)    1.3      slide                  │
 │  solid_block   (1.5, 2.2, 1.2)     0        switch                 │
 │  train         (1.8, 2.5, 8.0)     0        jump_on / switch       │
 └──────────────────────────────────────────────────────────────────────┘
 Trains are special: the player can jump on the roof and ride on top.
 Collision only triggers on the SIDES of the train body (below roof).
 The roof acts as a platform (handled in Game.js).

 FAIRNESS CONSTRAINTS:
   1. Always at least one clear lane or dodgeable path.
   2. minTelegraphDist respected between consecutive obstacles.
   3. Never block all 3 lanes at same Z with impassable obstacles.
   4. Max 2 consecutive jump-required obstacles without recovery gap.
   5. Lane-switch feasibility enforced.
*/

const TYPES = {
  low_barrier: { w: 1.6, h: 0.55, d: 0.6, yBase: 0, action: 'jump', color: 0xff4444 },
  high_bar:    { w: 1.6, h: 0.35, d: 0.4, yBase: 1.3, action: 'slide', color: 0xffaa00 },
  solid_block: { w: 1.5, h: 2.2, d: 1.2, yBase: 0, action: 'switch', color: 0xdd2244 },
  train:       { w: 1.8, h: 2.5, d: 8.0, yBase: 0, action: 'switch', color: 0x3366aa },
};

const EARLY_TYPES = ['low_barrier', 'high_bar', 'solid_block'];
const ALL_TYPES = ['low_barrier', 'high_bar', 'solid_block', 'train'];

// Train color palette — each spawn picks randomly
const TRAIN_BODY_COLORS = [0xcc3333, 0x2266bb, 0x22aa55, 0xdd8822, 0x8833aa];
const TRAIN_STRIPE_COLORS = [0xffcc00, 0xffffff, 0x00ccff, 0xff6600];

export class Spawner {
  constructor(scene) {
    this.scene = scene;

    this.obstacles = [];
    this.coins = [];
    this._obstaclePool = [];
    this._coinPool = [];

    this._nextSpawnZ = -SPAWN_AHEAD_MIN;
    this._consecutiveJumps = 0;

    // Simple obstacle materials
    this._obsMats = {};
    for (const [k, v] of Object.entries(TYPES)) {
      if (k === 'train') continue;
      this._obsMats[k] = new THREE.MeshStandardMaterial({
        color: v.color, roughness: 0.55, metalness: 0.15,
      });
    }

    // Coin
    this._coinMat = new THREE.MeshStandardMaterial({
      color: 0xffd700, emissive: 0x664400, roughness: 0.3, metalness: 0.6,
    });
    this._coinGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.1, 12);

    // Train shared materials
    this._trainRoofMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.6, metalness: 0.3 });
    this._trainWindowMat = new THREE.MeshStandardMaterial({ color: 0x88ccee, roughness: 0.1, metalness: 0.4 });
    this._trainWheelMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.5 });
    this._trainDoorMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.3 });
    this._trainBufferMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.6 });
    this._trainHeadlightMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xaaaa44, roughness: 0.2 });
    this._trainUnderMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7, metalness: 0.2 });

    // Reusable wheel geometry
    this._wheelGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 10);
  }

  // ── Train mesh builder ────────────────────────────
  _buildTrainMesh() {
    const g = new THREE.Group();
    const t = TYPES.train;
    const W = t.w;
    const H = t.h;
    const D = t.d;

    const bodyColor = pick(TRAIN_BODY_COLORS);
    const stripeColor = pick(TRAIN_STRIPE_COLORS);
    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.5, metalness: 0.15 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: stripeColor, roughness: 0.4, metalness: 0.1 });

    // Undercarriage
    const under = new THREE.Mesh(
      new THREE.BoxGeometry(W * 0.85, 0.3, D),
      this._trainUnderMat,
    );
    under.position.y = 0.15;
    g.add(under);

    // Main body
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(W, H * 0.72, D),
      bodyMat,
    );
    body.position.y = H * 0.36 + 0.3;
    body.castShadow = true;
    g.add(body);

    // Roof (rounded look with a slightly wider box + a cylinder)
    const roofFlat = new THREE.Mesh(
      new THREE.BoxGeometry(W * 0.95, 0.15, D * 0.96),
      this._trainRoofMat,
    );
    roofFlat.position.y = H * 0.72 + 0.3 + 0.075;
    g.add(roofFlat);

    const roofCurve = new THREE.Mesh(
      new THREE.CylinderGeometry(W * 0.48, W * 0.48, D * 0.94, 8, 1, false, 0, Math.PI),
      this._trainRoofMat,
    );
    roofCurve.rotation.x = Math.PI / 2;
    roofCurve.rotation.z = Math.PI;
    roofCurve.position.y = H * 0.72 + 0.3 + 0.15;
    g.add(roofCurve);

    // Horizontal stripe along both sides
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(
        new THREE.BoxGeometry(0.03, 0.18, D * 0.92),
        stripeMat,
      );
      stripe.position.set(side * (W * 0.5 + 0.01), H * 0.36 + 0.3, 0);
      g.add(stripe);
    }

    // Windows — two rows on each side
    const windowCount = Math.floor(D / 1.3);
    for (const side of [-1, 1]) {
      for (let i = 0; i < windowCount; i++) {
        const wz = -D * 0.5 + 0.8 + i * (D - 1.2) / (windowCount - 1);
        // Skip where doors will be
        if (i === Math.floor(windowCount * 0.33) || i === Math.floor(windowCount * 0.66)) continue;

        const win = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, 0.5, 0.6),
          this._trainWindowMat,
        );
        win.position.set(side * (W * 0.5 + 0.01), H * 0.5 + 0.3, wz);
        g.add(win);
      }
    }

    // Doors (2 per side)
    for (const side of [-1, 1]) {
      for (const dFrac of [0.33, 0.66]) {
        const dz = -D * 0.5 + D * dFrac;
        const door = new THREE.Mesh(
          new THREE.BoxGeometry(0.04, H * 0.55, 0.7),
          this._trainDoorMat,
        );
        door.position.set(side * (W * 0.5 + 0.01), H * 0.28 + 0.3, dz);
        g.add(door);

        // Door window
        const dw = new THREE.Mesh(
          new THREE.BoxGeometry(0.05, 0.3, 0.4),
          this._trainWindowMat,
        );
        dw.position.set(side * (W * 0.5 + 0.02), H * 0.48 + 0.3, dz);
        g.add(dw);
      }
    }

    // Wheels (3 pairs per side)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const wz = -D * 0.35 + i * D * 0.35;
        const wheel = new THREE.Mesh(this._wheelGeo, this._trainWheelMat);
        wheel.rotation.x = Math.PI / 2;
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * (W * 0.35), 0.22, wz);
        g.add(wheel);
      }
    }

    // Front face — headlights + buffer
    const frontPlate = new THREE.Mesh(
      new THREE.BoxGeometry(W * 0.9, H * 0.6, 0.08),
      bodyMat,
    );
    frontPlate.position.set(0, H * 0.35 + 0.3, -D * 0.5 - 0.04);
    g.add(frontPlate);

    // Headlights
    for (const hx of [-W * 0.28, W * 0.28]) {
      const hl = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 0.06, 8),
        this._trainHeadlightMat,
      );
      hl.rotation.x = Math.PI / 2;
      hl.position.set(hx, H * 0.55 + 0.3, -D * 0.5 - 0.08);
      g.add(hl);
    }

    // Windshield
    const windshield = new THREE.Mesh(
      new THREE.BoxGeometry(W * 0.55, 0.4, 0.04),
      this._trainWindowMat,
    );
    windshield.position.set(0, H * 0.58 + 0.3, -D * 0.5 - 0.06);
    g.add(windshield);

    // Front buffer bar
    const buffer = new THREE.Mesh(
      new THREE.BoxGeometry(W * 0.7, 0.12, 0.15),
      this._trainBufferMat,
    );
    buffer.position.set(0, 0.35, -D * 0.5 - 0.07);
    g.add(buffer);

    // Rear coupling
    const coupling = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.15, 0.25),
      this._trainBufferMat,
    );
    coupling.position.set(0, 0.35, D * 0.5 + 0.12);
    g.add(coupling);

    g.userData._typeName = 'train';
    return g;
  }

  // ── Object pool helpers ────────────────────────────
  _getObstacleMesh(typeName) {
    if (typeName === 'train') return this._getTrainMesh();

    const t = TYPES[typeName];
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

  _getTrainMesh() {
    for (let i = this._obstaclePool.length - 1; i >= 0; i--) {
      const pooled = this._obstaclePool[i];
      if (pooled.userData._typeName === 'train') {
        this._obstaclePool.splice(i, 1);
        pooled.visible = true;
        return pooled;
      }
    }
    const mesh = this._buildTrainMesh();
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

    const spawnHorizon = -(SPAWN_AHEAD_MAX);
    while (this._nextSpawnZ > spawnHorizon) {
      this._spawnGroup(this._nextSpawnZ, difficulty);
      this._nextSpawnZ -= telegraph + randFloat(0, telegraph * 0.4);
    }

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

    this.obstacles = this.obstacles.filter((obs) => {
      if (obs.z > DESPAWN_BEHIND) { this._releaseObstacle(obs); return false; }
      return true;
    });
    this.coins = this.coins.filter((c) => {
      if (c.z > DESPAWN_BEHIND) { this._releaseCoin(c); return false; }
      return true;
    });
  }

  _spawnGroup(z, difficulty) {
    const mix = difficulty.obstacleMix;
    const pool = mix > 0.3 ? ALL_TYPES : EARLY_TYPES;

    const numBlocked = Math.random() < 0.3 + mix * 0.2 ? 2 : 1;

    const shuffled = [...LANES].sort(() => Math.random() - 0.5);
    const blockedLanes = shuffled.slice(0, numBlocked);
    const freeLanes = shuffled.slice(numBlocked);

    let forceNoJump = this._consecutiveJumps >= 2;
    let anyJump = false;

    for (const lane of blockedLanes) {
      let typeName = pick(pool);

      if (forceNoJump && TYPES[typeName].action === 'jump') {
        typeName = pick(pool.filter((t) => TYPES[t].action !== 'jump'));
        if (!typeName) typeName = 'solid_block';
      }

      const t = TYPES[typeName];
      if (t.action === 'jump') anyJump = true;

      const mesh = this._getObstacleMesh(typeName);
      const x = LANE_X(lane);

      if (typeName === 'train') {
        mesh.position.set(x, 0, z);
      } else {
        mesh.position.set(x, t.yBase + t.h * 0.5, z);
      }

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
        isTrain: typeName === 'train',
      });
    }

    this._consecutiveJumps = anyJump ? this._consecutiveJumps + 1 : 0;

    // Coins on free lanes
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

    // Sometimes place coins on TOP of trains as reward for jumping on
    const trains = this.obstacles.filter((o) => o.isTrain && o.z === z);
    for (const train of trains) {
      if (Math.random() < 0.6) {
        const coinCount = randInt(3, 5);
        for (let i = 0; i < coinCount; i++) {
          const cm = this._getCoinMesh();
          const cz = z - i * 2.0;
          cm.position.set(LANE_X(train.lane), TRAIN_ROOF_Y + 0.6, cz);
          this.coins.push({ mesh: cm, lane: train.lane, z: cz, collected: false });
        }
      }
    }
  }

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

  /** Side-only AABB for trains — excludes the roof area so the player can land on top. */
  getTrainSideAABB(obs) {
    const sideH = TRAIN_ROOF_Y * 0.85;
    return {
      x: obs.mesh.position.x,
      y: sideH * 0.5,
      z: obs.z,
      hw: obs.hw,
      hh: sideH * 0.5,
      hd: obs.hd,
    };
  }

  getCoinAABB(c) {
    return {
      x: c.mesh.position.x,
      y: c.mesh.position.y,
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
