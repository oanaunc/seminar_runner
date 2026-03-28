import * as THREE from 'three';
import { Player } from './Player.js';
import { Track } from './Track.js';
import { Spawner } from './Spawner.js';
import { Difficulty } from './Difficulty.js';
import { Input } from './Input.js';
import { Audio } from './Audio.js';
import { UI } from './UI.js';
import { aabbOverlap } from './Utils.js';

const SCORE_MULT = 1.8;
const BEST_KEY = 'runner_best_score';

const STATE_MENU = 0;
const STATE_PLAYING = 1;
const STATE_OVER = 2;
const STATE_PAUSED = 3;

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
    this.renderer.setClearColor(0x0a0a14);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0a0a14, 30, 120);

    // Camera — third-person behind + above player
    this.camera = new THREE.PerspectiveCamera(65, 1, 0.5, 200);
    this.camera.position.set(0, 4.5, 7);
    this.camera.lookAt(0, 1.2, -15);

    // Lighting
    const ambient = new THREE.AmbientLight(0x8888cc, 0.6);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(5, 12, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 60;
    dir.shadow.camera.left = -15;
    dir.shadow.camera.right = 15;
    dir.shadow.camera.top = 15;
    dir.shadow.camera.bottom = -15;
    this.scene.add(dir);

    const hemi = new THREE.HemisphereLight(0x4444aa, 0x111122, 0.35);
    this.scene.add(hemi);

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

    if (this.state === STATE_MENU) {
      // idle scene drift
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

    // Collision: obstacles
    const pBox = this.player.getAABB();
    for (const obs of this.spawner.obstacles) {
      const oBox = this.spawner.getObstacleAABB(obs);
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

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
