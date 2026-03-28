import * as THREE from 'three';
import {
  LANE_WIDTH, LANE_X,
  PLAYER_WIDTH, PLAYER_DEPTH, PLAYER_HEIGHT, PLAYER_SLIDE_HEIGHT,
  JUMP_VELOCITY, GRAVITY,
  SLIDE_DURATION, SLIDE_COOLDOWN,
  LANE_SWITCH_DURATION,
  lerp, clamp,
} from './Utils.js';

/**
 * Player controller.
 *
 * The player mesh stays near z = 0; the world scrolls toward +z.
 * Movement:
 *   - Lane switching: smooth interpolation over LANE_SWITCH_DURATION
 *   - Jump: ballistic arc (velocity + gravity, no physics engine)
 *   - Slide: shrink collider height for SLIDE_DURATION
 *
 * Collision uses a simple AABB returned by getAABB().
 */
export class Player {
  constructor(scene) {
    this.laneIndex = 0;          // -1, 0, 1
    this._targetLane = 0;
    this._laneSwitchT = 1;       // 0..1 progress; 1 = done
    this._fromX = 0;

    this.y = 0;
    this._vy = 0;
    this._isGrounded = true;
    this.groundLevel = 0;       // 0 = street; set higher when on a train roof

    this._sliding = false;
    this._slideTimer = 0;
    this._slideCooldown = 0;

    // Visual mesh: simple capsule-like figure built from primitives
    this.group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2288dd, roughness: 0.5, metalness: 0.1 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffcca0, roughness: 0.6 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.5), bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    this.group.add(body);
    this._bodyMesh = body;

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 10), headMat);
    head.position.y = 1.35;
    head.castShadow = true;
    this.group.add(head);
    this._headMesh = head;

    // Legs
    const legMat = new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.5 });
    this._legs = [];
    for (const xOff of [-0.18, 0.18]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 0.26), legMat);
      leg.position.set(xOff, -0.025, 0);
      leg.castShadow = true;
      this.group.add(leg);
      this._legs.push(leg);
    }

    this.group.position.set(0, 0, 0);
    scene.add(this.group);
  }

  reset() {
    this.laneIndex = 0;
    this._targetLane = 0;
    this._laneSwitchT = 1;
    this._fromX = 0;
    this.y = 0;
    this._vy = 0;
    this._isGrounded = true;
    this.groundLevel = 0;
    this._sliding = false;
    this._slideTimer = 0;
    this._slideCooldown = 0;
    this.group.position.set(0, 0, 0);
    this.group.scale.set(1, 1, 1);
    this._bodyMesh.position.y = 0.55;
    this._headMesh.position.y = 1.35;
    this._headMesh.visible = true;
    this._legs.forEach((l, i) => {
      l.position.set(i === 0 ? -0.18 : 0.18, -0.025, 0);
    });
  }

  // ── Actions ───────────────────────────────────────
  moveLeft() {
    if (this._targetLane > -1 && this._laneSwitchT >= 0.85) {
      this._fromX = this.group.position.x;
      this._targetLane = this._targetLane - 1;
      this._laneSwitchT = 0;
    }
  }

  moveRight() {
    if (this._targetLane < 1 && this._laneSwitchT >= 0.85) {
      this._fromX = this.group.position.x;
      this._targetLane = this._targetLane + 1;
      this._laneSwitchT = 0;
    }
  }

  jump() {
    if (!this._isGrounded) return false;
    this._vy = JUMP_VELOCITY;
    this._isGrounded = false;
    if (this._sliding) this._endSlide();
    return true;
  }

  slide() {
    if (this._sliding || this._slideCooldown > 0 || !this._isGrounded) return false;
    this._sliding = true;
    this._slideTimer = SLIDE_DURATION;
    return true;
  }

  _endSlide() {
    this._sliding = false;
    this._slideTimer = 0;
    this._slideCooldown = SLIDE_COOLDOWN;
  }

  // ── Update ────────────────────────────────────────
  update(dt, _speed) {
    // Lane interpolation
    if (this._laneSwitchT < 1) {
      this._laneSwitchT = clamp(this._laneSwitchT + dt / LANE_SWITCH_DURATION, 0, 1);
      const t = this._laneSwitchT;
      const ease = t * t * (3 - 2 * t);
      this.group.position.x = lerp(this._fromX, LANE_X(this._targetLane), ease);
      if (this._laneSwitchT >= 1) this.laneIndex = this._targetLane;
    } else {
      this.group.position.x = LANE_X(this._targetLane);
      this.laneIndex = this._targetLane;
    }

    // Vertical (jump) — land on groundLevel (0 = street, higher = train roof)
    if (!this._isGrounded) {
      this._vy -= GRAVITY * dt;
      this.y += this._vy * dt;
      if (this.y <= this.groundLevel) {
        this.y = this.groundLevel;
        this._vy = 0;
        this._isGrounded = true;
      }
    } else {
      // If grounded but ground disappeared (ran off end of train), start falling
      if (this.y > this.groundLevel + 0.01) {
        this._isGrounded = false;
      } else {
        this.y = this.groundLevel;
      }
    }
    this.group.position.y = this.y;

    // Slide timer
    if (this._sliding) {
      this._slideTimer -= dt;
      if (this._slideTimer <= 0) this._endSlide();
    }
    if (this._slideCooldown > 0) this._slideCooldown -= dt;

    // Visual: squash when sliding
    if (this._sliding) {
      this.group.scale.y = PLAYER_SLIDE_HEIGHT / PLAYER_HEIGHT;
    } else {
      this.group.scale.y = lerp(this.group.scale.y, 1, 0.2);
    }

    // Simple run animation (leg swing)
    const freq = 8 + _speed * 0.3;
    const swing = Math.sin(performance.now() * 0.001 * freq) * 0.3;
    if (this._isGrounded && !this._sliding) {
      this._legs[0].rotation.x = swing;
      this._legs[1].rotation.x = -swing;
    } else {
      this._legs[0].rotation.x = lerp(this._legs[0].rotation.x, 0, 0.15);
      this._legs[1].rotation.x = lerp(this._legs[1].rotation.x, 0, 0.15);
    }
  }

  /** AABB for collision: { x, y, z, hw, hh, hd } */
  getAABB() {
    const h = this._sliding ? PLAYER_SLIDE_HEIGHT : PLAYER_HEIGHT;
    return {
      x: this.group.position.x,
      y: this.y + h * 0.5,
      z: this.group.position.z,
      hw: PLAYER_WIDTH * 0.5,
      hh: h * 0.5,
      hd: PLAYER_DEPTH * 0.5,
    };
  }

  get isSliding() { return this._sliding; }
  get isGrounded() { return this._isGrounded; }
}
