import * as THREE from 'three';
import {
  SEGMENT_LENGTH, SEGMENT_COUNT,
  TRACK_HALF_WIDTH, WALL_HEIGHT, PILLAR_SPACING,
  LANE_WIDTH,
} from './Utils.js';

/**
 * Recycling track geometry: floor segments, side walls, pillars, rail lines.
 * Segments recycle from behind the camera to in front of it, creating
 * the illusion of endless forward motion.
 */
export class Track {
  constructor(scene) {
    this.scene = scene;
    this.segments = [];
    this._worldOffset = 0;

    // Shared materials
    this._floorMat = new THREE.MeshStandardMaterial({
      color: 0x1a1a2e, roughness: 0.85, metalness: 0.1,
    });
    this._wallMat = new THREE.MeshStandardMaterial({
      color: 0x0d0d1a, emissive: 0x110022, roughness: 0.7,
    });
    this._pillarMat = new THREE.MeshStandardMaterial({
      color: 0x3a0066, emissive: 0x220044, roughness: 0.5, metalness: 0.3,
    });
    this._lineMat = new THREE.MeshStandardMaterial({
      color: 0x00e5ff, emissive: 0x004466, roughness: 0.3, metalness: 0.5,
    });
    this._railMat = new THREE.MeshStandardMaterial({
      color: 0x555566, roughness: 0.6, metalness: 0.4,
    });

    // Build initial segments
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      const seg = this._createSegment();
      seg.group.position.z = -i * SEGMENT_LENGTH;
      this.segments.push(seg);
      scene.add(seg.group);
    }
  }

  _createSegment() {
    const g = new THREE.Group();

    // Floor
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(TRACK_HALF_WIDTH * 2, 0.2, SEGMENT_LENGTH),
      this._floorMat,
    );
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    g.add(floor);

    // Lane dividers
    for (const xOff of [-LANE_WIDTH, LANE_WIDTH]) {
      const line = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.05, SEGMENT_LENGTH),
        this._lineMat,
      );
      line.position.set(xOff, 0.01, 0);
      g.add(line);
    }

    // Rails (decorative)
    for (const laneIdx of [-1, 0, 1]) {
      for (const side of [-0.35, 0.35]) {
        const rail = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, 0.08, SEGMENT_LENGTH),
          this._railMat,
        );
        rail.position.set(laneIdx * LANE_WIDTH + side, 0.04, 0);
        g.add(rail);
      }
    }

    // Side walls
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, WALL_HEIGHT, SEGMENT_LENGTH),
        this._wallMat,
      );
      wall.position.set(side * TRACK_HALF_WIDTH, WALL_HEIGHT * 0.5, 0);
      g.add(wall);

      // Pillar
      const pillar = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, WALL_HEIGHT + 1, 0.5),
        this._pillarMat,
      );
      pillar.position.set(side * (TRACK_HALF_WIDTH - 0.1), WALL_HEIGHT * 0.5, 0);
      g.add(pillar);

      // Emissive accent strip on wall
      const accent = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.15, SEGMENT_LENGTH),
        this._lineMat,
      );
      accent.position.set(
        side * (TRACK_HALF_WIDTH - 0.16),
        WALL_HEIGHT * 0.35,
        0,
      );
      g.add(accent);
    }

    // Overhead bar (connecting pillars)
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(TRACK_HALF_WIDTH * 2, 0.15, 0.15),
      this._pillarMat,
    );
    bar.position.set(0, WALL_HEIGHT + 0.5, 0);
    g.add(bar);

    return { group: g };
  }

  /**
   * Move all segments toward +z at `speed`.  When a segment passes behind
   * the camera, recycle it to the front of the queue.
   */
  update(dt, speed) {
    const move = speed * dt;
    this._worldOffset += move;

    for (const seg of this.segments) {
      seg.group.position.z += move;
    }

    // Recycle segments that have passed behind the player
    const recycleThreshold = SEGMENT_LENGTH * 1.5;
    const farthest = -(SEGMENT_COUNT - 1) * SEGMENT_LENGTH;

    for (const seg of this.segments) {
      if (seg.group.position.z > recycleThreshold) {
        let minZ = Infinity;
        for (const s of this.segments) {
          if (s.group.position.z < minZ) minZ = s.group.position.z;
        }
        seg.group.position.z = minZ - SEGMENT_LENGTH;
      }
    }
  }

  get worldOffset() { return this._worldOffset; }

  reset() {
    this._worldOffset = 0;
    for (let i = 0; i < this.segments.length; i++) {
      this.segments[i].group.position.z = -i * SEGMENT_LENGTH;
    }
  }
}
