import * as THREE from 'three';
import { Player } from './Player.js';
import { Track } from './Track.js';
import { Spawner } from './Spawner.js';
import { Difficulty } from './Difficulty.js';
import { Input } from './Input.js';
import { Audio } from './Audio.js';
import { UI } from './UI.js';
import { aabbOverlap, randFloat, TRAIN_ROOF_Y } from './Utils.js';

const SCORE_MULT = 1.8;
const BEST_KEY = 'runner_best_score';

const STATE_MENU = 0;
const STATE_PLAYING = 1;
const STATE_OVER = 2;
const STATE_PAUSED = 3;

const SKY_COLOR = 0x78c4f0;

/**
 * Main game orchestrator — owns the Three.js scene and drives
 * the update loop via requestAnimationFrame with delta time.
 */
export class Game {
  constructor(canvas) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.setClearColor(SKY_COLOR);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.Fog(SKY_COLOR, 50, 160);

    // Camera — third-person behind + above player
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.5, 250);
    this.camera.position.set(0, 4.5, 7);
    this.camera.lookAt(0, 1.2, -15);

    // ── Daylight lighting ───────────────────────────
    // Bright warm sunlight from upper-right
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(8, 20, -5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -20;
    this.scene.add(sun);

    // Hemisphere: sky-blue from above, warm ground bounce from below
    const hemi = new THREE.HemisphereLight(0x88ccff, 0xc4a882, 0.7);
    this.scene.add(hemi);

    // Soft ambient fill
    const ambient = new THREE.AmbientLight(0xddeeff, 0.45);
    this.scene.add(ambient);

    // ── Clouds ──────────────────────────────────────
    this._clouds = [];
    this._cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1.0, metalness: 0.0,
      transparent: true, opacity: 0.85,
    });
    this._cloudPuffGeo = new THREE.SphereGeometry(1, 8, 6);
    this._initClouds();

    // Subsystems
    this.input = new Input();
    this.audio = new Audio();
    this.ui = new UI();
    this.difficulty = new Difficulty();
    this.track = new Track(this.scene);
    this.spawner = new Spawner(this.scene);
    this.player = new Player(this.scene);

    // State
    this.state = STATE_MENU;
    this.score = 0;
    this.coins = 0;
    this.best = parseInt(localStorage.getItem(BEST_KEY) || '0', 10);

    this._prevTime = 0;

    // UI bindings
    this.ui.btnPlay.addEventListener('click', () => this._startGame());
    this.ui.btnRestart.addEventListener('click', () => this._startGame());

    // Resize
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    this._onResize();

    this.ui.showStart();
  }

  // ── Game flow ─────────────────────────────────────
  _startGame() {
    this.state = STATE_PLAYING;
    this.score = 0;
    this.coins = 0;
    this.difficulty.reset();
    this.track.reset();
    this.spawner.reset();
    this.player.reset();
    this._prevTime = performance.now();
    this.ui.showHUD();
    this.ui.updateHUD(0, 0, this.difficulty.speed);
  }

  _gameOver() {
    this.state = STATE_OVER;
    this.audio.gameOver();
    const finalScore = Math.floor(this.score);
    if (finalScore > this.best) {
      this.best = finalScore;
      localStorage.setItem(BEST_KEY, String(this.best));
    }
    this.ui.showGameOver(finalScore, this.best, this.coins);
  }

  // ── Main loop ─────────────────────────────────────
  tick(now) {
    const raw = (now - this._prevTime) / 1000;
    this._prevTime = now;
    const dt = Math.min(raw, 0.05); // cap to avoid spiral of death

    // Process input
    const acts = this.input.consume();

    // Clouds always animate regardless of state
    this._updateClouds(dt, this.state === STATE_PLAYING ? this.difficulty.speed : 5);

    if (this.state === STATE_MENU) {
      this.track.update(dt, 5);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.state === STATE_OVER) {
      if (acts.restart) this._startGame();
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.state === STATE_PAUSED) {
      if (acts.pause) {
        this.state = STATE_PLAYING;
        this.ui.showPause(false);
        this._prevTime = performance.now();
      }
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // ── STATE_PLAYING ──
    if (acts.pause) {
      this.state = STATE_PAUSED;
      this.ui.showPause(true);
      return;
    }

    // Player actions
    if (acts.left) this.player.moveLeft();
    if (acts.right) this.player.moveRight();
    if (acts.jump && this.player.jump()) this.audio.jump();
    if (acts.slide && this.player.slide()) this.audio.slide();

    // Difficulty
    this.difficulty.update(dt);
    const speed = this.difficulty.speed;

    // Update world
    this.track.update(dt, speed);
    this.spawner.update(dt, this.difficulty, this.track.worldOffset);
    this.player.update(dt, speed);

    // ── Train-roof platform logic ──
    // Check if the player is standing on (or can land on) a train roof.
    // Set groundLevel to the roof height while horizontally overlapping a train;
    // reset to 0 otherwise so the player falls back to street level.
    let onTrain = false;
    const pBox = this.player.getAABB();

    for (const obs of this.spawner.obstacles) {
      if (!obs.isTrain) continue;

      const sameX = Math.abs(pBox.x - obs.mesh.position.x) < obs.hw + pBox.hw;
      const overlapZ = Math.abs(pBox.z - obs.z) < obs.hd + pBox.hd;
      if (!sameX || !overlapZ) continue;

      const playerBottom = this.player.y;
      const roofY = TRAIN_ROOF_Y;

      // Player is above (or falling onto) the roof
      if (playerBottom >= roofY - 0.3 && this.player.y >= roofY - 0.5) {
        onTrain = true;
        this.player.groundLevel = roofY;
        break;
      }
    }
    if (!onTrain) {
      this.player.groundLevel = 0;
    }

    // ── Collision: obstacles ──
    for (const obs of this.spawner.obstacles) {
      let oBox;
      if (obs.isTrain) {
        // Only collide with the train body (sides), not the roof surface
        if (this.player.y >= TRAIN_ROOF_Y - 0.15) continue;
        oBox = this.spawner.getTrainSideAABB(obs);
      } else {
        oBox = this.spawner.getObstacleAABB(obs);
      }
      if (aabbOverlap(pBox, oBox)) {
        this._gameOver();
        return;
      }
    }

    // Collision: coins
    for (const c of this.spawner.coins) {
      if (c.collected) continue;
      const cBox = this.spawner.getCoinAABB(c);
      if (aabbOverlap(pBox, cBox)) {
        c.collected = true;
        c.mesh.visible = false;
        this.coins++;
        this.audio.coin();
      }
    }

    // Score
    this.score += dt * speed * SCORE_MULT;

    // HUD
    this.ui.updateHUD(Math.floor(this.score), this.coins, speed);

    // Camera follow (subtle sway)
    this.camera.position.x += (this.player.group.position.x * 0.35 - this.camera.position.x) * 0.08;

    this.renderer.render(this.scene, this.camera);
  }

  // ── Clouds ───────────────────────────────────────
  _initClouds() {
    for (let i = 0; i < 18; i++) {
      this._spawnCloud(true);
    }
  }

  _spawnCloud(scatter = false) {
    const group = new THREE.Group();

    // Each cloud is 4-7 overlapping spheres of varying size
    const puffCount = 4 + Math.floor(Math.random() * 4);
    for (let p = 0; p < puffCount; p++) {
      const s = randFloat(1.2, 3.5);
      const puff = new THREE.Mesh(this._cloudPuffGeo, this._cloudMat);
      puff.scale.set(s, s * randFloat(0.5, 0.75), s * randFloat(0.7, 1.0));
      puff.position.set(
        randFloat(-2.5, 2.5),
        randFloat(-0.4, 0.6),
        randFloat(-1.5, 1.5),
      );
      group.add(puff);
    }

    const x = randFloat(-40, 40);
    const y = randFloat(18, 35);
    const z = scatter ? randFloat(-180, 20) : randFloat(-200, -160);
    group.position.set(x, y, z);

    const drift = randFloat(0.4, 1.8);
    this.scene.add(group);
    this._clouds.push({ group, drift });
  }

  _updateClouds(dt, speed) {
    for (let i = this._clouds.length - 1; i >= 0; i--) {
      const c = this._clouds[i];
      // Clouds drift with the world scroll + a slow lateral drift
      c.group.position.z += speed * dt;
      c.group.position.x += c.drift * dt;

      if (c.group.position.z > 60) {
        this.scene.remove(c.group);
        this._clouds.splice(i, 1);
        this._spawnCloud(false);
      }
    }
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
