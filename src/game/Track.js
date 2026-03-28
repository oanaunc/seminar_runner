import * as THREE from 'three';
import {
  SEGMENT_LENGTH, SEGMENT_COUNT,
  TRACK_HALF_WIDTH, WALL_HEIGHT,
  LANE_WIDTH,
  randFloat, randInt,
} from './Utils.js';

/**
 * Recycling track geometry with:
 *   - Detailed street surface (asphalt + sidewalks + crosswalks + manhole covers)
 *   - Procedural buildings of varying heights/widths on both sides
 *   - Street lamps, bollards, lane markings
 *   - Rails and overhead wires
 *
 * Each segment is self-contained and randomised at creation so recycled
 * segments always look slightly different — no visible repetition.
 */

// Seeded-random helper scoped to segment construction so each rebuild is unique
const _rng = () => Math.random();

export class Track {
  constructor(scene) {
    this.scene = scene;
    this.segments = [];
    this._worldOffset = 0;

    // ── Shared materials ────────────────────────────
    this._asphaltMat = new THREE.MeshStandardMaterial({
      color: 0x1e1e2a, roughness: 0.92, metalness: 0.05,
    });
    this._sidewalkMat = new THREE.MeshStandardMaterial({
      color: 0x2a2a3a, roughness: 0.85, metalness: 0.05,
    });
    this._curbMat = new THREE.MeshStandardMaterial({
      color: 0x3a3a4a, roughness: 0.75,
    });
    this._lineMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff, emissive: 0x003344, roughness: 0.3, metalness: 0.5,
    });
    this._whiteLineMat = new THREE.MeshStandardMaterial({
      color: 0x888899, emissive: 0x111115, roughness: 0.5,
    });
    this._railMat = new THREE.MeshStandardMaterial({
      color: 0x5a5a6a, roughness: 0.55, metalness: 0.5,
    });
    this._crosswalkMat = new THREE.MeshStandardMaterial({
      color: 0x444455, roughness: 0.7,
    });
    this._manholeMat = new THREE.MeshStandardMaterial({
      color: 0x333340, roughness: 0.6, metalness: 0.3,
    });

    // Building palette — several tones so the skyline isn't monotone
    this._buildingMats = [
      new THREE.MeshStandardMaterial({ color: 0x14142a, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x1a1a35, roughness: 0.75 }),
      new THREE.MeshStandardMaterial({ color: 0x0f0f22, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0x18182e, roughness: 0.7 }),
      new THREE.MeshStandardMaterial({ color: 0x111128, roughness: 0.8 }),
    ];
    this._windowMat = new THREE.MeshStandardMaterial({
      color: 0xffdd66, emissive: 0x665500, roughness: 0.2, metalness: 0.1,
    });
    this._windowDarkMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e, emissive: 0x050510, roughness: 0.5,
    });
    this._roofMat = new THREE.MeshStandardMaterial({
      color: 0x222235, roughness: 0.7, metalness: 0.15,
    });
    this._lampPoleMat = new THREE.MeshStandardMaterial({
      color: 0x444455, roughness: 0.5, metalness: 0.6,
    });
    this._lampGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffeebb, emissive: 0xaa8833, roughness: 0.2,
    });
    this._bollardMat = new THREE.MeshStandardMaterial({
      color: 0xff6600, emissive: 0x441100, roughness: 0.4, metalness: 0.2,
    });
    this._wireMat = new THREE.MeshStandardMaterial({
      color: 0x333344, roughness: 0.5, metalness: 0.6,
    });

    // Reusable geometries
    this._lampPoleGeo = new THREE.CylinderGeometry(0.06, 0.08, 4.5, 6);
    this._lampHeadGeo = new THREE.BoxGeometry(0.8, 0.12, 0.25);
    this._lampBulbGeo = new THREE.SphereGeometry(0.1, 6, 6);
    this._bollardGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.7, 6);

    // Build initial segments
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const seg = this._createSegment(i);
      seg.group.position.z = -i * SEGMENT_LENGTH;
      this.segments.push(seg);
      scene.add(seg.group);
    }
  }

  // ── Segment factory ───────────────────────────────
  _createSegment(seed) {
    const g = new THREE.Group();
    const SL = SEGMENT_LENGTH;
    const HW = TRACK_HALF_WIDTH;

    // ── Road surface ──
    const road = new THREE.Mesh(
      new THREE.BoxGeometry(HW * 2, 0.15, SL),
      this._asphaltMat,
    );
    road.position.y = -0.075;
    road.receiveShadow = true;
    g.add(road);

    // ── Sidewalks (slightly raised) ──
    const swWidth = 2.8;
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(
        new THREE.BoxGeometry(swWidth, 0.25, SL),
        this._sidewalkMat,
      );
      sw.position.set(side * (HW + swWidth * 0.5), 0.025, 0);
      sw.receiveShadow = true;
      g.add(sw);

      // Curb edge
      const curb = new THREE.Mesh(
        new THREE.BoxGeometry(0.15, 0.2, SL),
        this._curbMat,
      );
      curb.position.set(side * HW, 0.05, 0);
      g.add(curb);
    }

    // ── Lane divider lines (dashed feel via segments) ──
    for (const xOff of [-LANE_WIDTH, LANE_WIDTH]) {
      const dashCount = Math.floor(SL / 2.5);
      for (let d = 0; d < dashCount; d++) {
        if (d % 2 === 0) {
          const dash = new THREE.Mesh(
            new THREE.BoxGeometry(0.08, 0.02, 1.2),
            this._lineMat,
          );
          dash.position.set(xOff, 0.01, -SL * 0.5 + d * 2.5 + 0.6);
          g.add(dash);
        }
      }
    }

    // ── Edge road lines (solid white) ──
    for (const side of [-1, 1]) {
      const edgeLine = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.02, SL),
        this._whiteLineMat,
      );
      edgeLine.position.set(side * (HW - 0.15), 0.01, 0);
      g.add(edgeLine);
    }

    // ── Rails (three lanes) ──
    for (const laneIdx of [-1, 0, 1]) {
      for (const rSide of [-0.38, 0.38]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.07, 0.09, SL),
          this._railMat,
        );
        rail.position.set(laneIdx * LANE_WIDTH + rSide, 0.045, 0);
        g.add(rail);
      }
      // Crossties
      const tieCount = Math.floor(SL / 1.8);
      for (let t = 0; t < tieCount; t++) {
        const tie = new THREE.Mesh(
          new THREE.BoxGeometry(1.1, 0.05, 0.18),
          this._railMat,
        );
        tie.position.set(laneIdx * LANE_WIDTH, 0.01, -SL * 0.5 + t * 1.8 + 0.4);
        g.add(tie);
      }
    }

    // ── Crosswalk (random chance per segment) ──
    if (_rng() < 0.3) {
      const cwZ = randFloat(-SL * 0.3, SL * 0.3);
      for (let s = 0; s < 6; s++) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(HW * 2 * 0.85, 0.02, 0.3),
          this._crosswalkMat,
        );
        stripe.position.set(0, 0.012, cwZ + s * 0.55 - 1.5);
        g.add(stripe);
      }
    }

    // ── Manhole cover (random chance) ──
    if (_rng() < 0.4) {
      const mLane = [0, -1, 1][randInt(0, 2)];
      const manhole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.03, 10),
        this._manholeMat,
      );
      manhole.position.set(mLane * LANE_WIDTH, 0.015, randFloat(-SL * 0.3, SL * 0.3));
      g.add(manhole);
    }

    // ── Buildings on both sides ──
    for (const side of [-1, 1]) {
      this._addBuildings(g, side, SL, HW, swWidth);
    }

    // ── Street lamps ──
    for (const side of [-1, 1]) {
      const lampX = side * (HW + 0.5);
      const pole = new THREE.Mesh(this._lampPoleGeo, this._lampPoleMat);
      pole.position.set(lampX, 2.25, 0);
      g.add(pole);

      const arm = new THREE.Mesh(this._lampHeadGeo, this._lampPoleMat);
      arm.position.set(lampX - side * 0.3, 4.5, 0);
      g.add(arm);

      const bulb = new THREE.Mesh(this._lampBulbGeo, this._lampGlowMat);
      bulb.position.set(lampX - side * 0.3, 4.38, 0);
      g.add(bulb);
    }

    // ── Bollards along curb (every few meters) ──
    const bollardCount = randInt(2, 4);
    for (let b = 0; b < bollardCount; b++) {
      const bSide = _rng() < 0.5 ? -1 : 1;
      const bz = randFloat(-SL * 0.4, SL * 0.4);
      const bollard = new THREE.Mesh(this._bollardGeo, this._bollardMat);
      bollard.position.set(bSide * (HW + 0.2), 0.35, bz);
      g.add(bollard);
    }

    // ── Overhead wires ──
    for (const wireX of [-LANE_WIDTH, 0, LANE_WIDTH]) {
      const wire = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.02, SL),
        this._wireMat,
      );
      wire.position.set(wireX, WALL_HEIGHT + 1.5, 0);
      g.add(wire);
    }
    // Wire support bar spanning the track
    const supportBar = new THREE.Mesh(
      new THREE.BoxGeometry(HW * 2 + 1, 0.08, 0.08),
      this._wireMat,
    );
    supportBar.position.set(0, WALL_HEIGHT + 1.5, 0);
    g.add(supportBar);

    // Support poles at each end
    for (const side of [-1, 1]) {
      const sp = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.07, WALL_HEIGHT + 1.5, 6),
        this._lampPoleMat,
      );
      sp.position.set(side * (HW + 0.3), (WALL_HEIGHT + 1.5) * 0.5, 0);
      g.add(sp);
    }

    return { group: g };
  }

  /**
   * Place 2–4 buildings of random size along one side of the segment.
   * Each building is a box + optional roof detail + window grid.
   */
  _addBuildings(group, side, segLen, hw, swWidth) {
    const buildingSetback = hw + swWidth + 0.3;
    const maxDepth = 5.0;
    let zCursor = -segLen * 0.5;

    while (zCursor < segLen * 0.5 - 2) {
      const bWidth = randFloat(3.5, 8);      // along z
      const bDepth = randFloat(2.5, maxDepth); // away from road (x)
      const bHeight = randFloat(4, 16);       // tall variation
      const gap = randFloat(0.3, 1.2);

      const mat = this._buildingMats[randInt(0, this._buildingMats.length - 1)];

      const bx = side * (buildingSetback + bDepth * 0.5);
      const bz = zCursor + bWidth * 0.5;

      // Main volume
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(bDepth, bHeight, bWidth),
        mat,
      );
      body.position.set(bx, bHeight * 0.5, bz);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);

      // Roof accent (smaller box on top, ~30% chance)
      if (_rng() < 0.35 && bHeight > 6) {
        const roofW = bWidth * randFloat(0.3, 0.6);
        const roofD = bDepth * randFloat(0.4, 0.7);
        const roofH = randFloat(1, 3);
        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(roofD, roofH, roofW),
          this._roofMat,
        );
        roof.position.set(bx, bHeight + roofH * 0.5, bz);
        group.add(roof);
      }

      // Windows — grid on the face toward the road
      const windowCols = Math.max(1, Math.floor(bWidth / 1.8));
      const windowRows = Math.max(1, Math.floor(bHeight / 2.2));
      const facingX = side * (buildingSetback + 0.01);
      const wSpacingZ = bWidth / (windowCols + 1);
      const wSpacingY = bHeight / (windowRows + 1);

      for (let r = 0; r < windowRows; r++) {
        for (let c = 0; c < windowCols; c++) {
          const lit = _rng() < 0.55;
          const wMat = lit ? this._windowMat : this._windowDarkMat;
          const win = new THREE.Mesh(
            new THREE.BoxGeometry(0.05, 0.9, 0.7),
            wMat,
          );
          win.position.set(
            facingX,
            wSpacingY * (r + 1),
            zCursor + wSpacingZ * (c + 1),
          );
          group.add(win);
        }
      }

      zCursor += bWidth + gap;
    }
  }

  // ── Update / recycle ──────────────────────────────
  update(dt, speed) {
    const move = speed * dt;
    this._worldOffset += move;

    for (const seg of this.segments) {
      seg.group.position.z += move;
    }

    const recycleThreshold = SEGMENT_LENGTH * 1.5;

    for (const seg of this.segments) {
      if (seg.group.position.z > recycleThreshold) {
        let minZ = Infinity;
        for (const s of this.segments) {
          if (s.group.position.z < minZ) minZ = s.group.position.z;
        }

        // Rebuild geometry so recycled segments look different
        const oldGroup = seg.group;
        const parent = oldGroup.parent;
        parent.remove(oldGroup);
        this._disposeGroup(oldGroup);

        const fresh = this._createSegment();
        fresh.group.position.z = minZ - SEGMENT_LENGTH;
        seg.group = fresh.group;
        parent.add(seg.group);
      }
    }
  }

  /** Dispose all geometries in a group to avoid GPU memory leaks. */
  _disposeGroup(group) {
    group.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
      }
    });
  }

  get worldOffset() { return this._worldOffset; }

  reset() {
    this._worldOffset = 0;
    for (let i = 0; i < this.segments.length; i++) {
      const oldGroup = this.segments[i].group;
      const parent = oldGroup.parent;
      parent.remove(oldGroup);
      this._disposeGroup(oldGroup);

      const fresh = this._createSegment(i);
      fresh.group.position.z = -i * SEGMENT_LENGTH;
      this.segments[i].group = fresh.group;
      this.scene.add(fresh.group);
    }
  }
}
