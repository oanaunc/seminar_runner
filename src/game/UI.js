/**
 * Thin DOM-based UI controller.
 * Grabs references to elements declared in index.html and exposes
 * show/hide/update helpers consumed by Game.js.
 */
export class UI {
  constructor() {
    this.hud = document.getElementById('hud');
    this.scoreEl = document.getElementById('hud-score');
    this.coinsEl = document.getElementById('hud-coins');
    this.speedEl = document.getElementById('hud-speed');

    this.startScreen = document.getElementById('start-screen');
    this.btnPlay = document.getElementById('btn-play');

    this.gameOver = document.getElementById('game-over');
    this.goScore = document.getElementById('go-score');
    this.goBest = document.getElementById('go-best');
    this.goCoins = document.getElementById('go-coins');
    this.btnRestart = document.getElementById('btn-restart');

    this.pauseOverlay = document.getElementById('pause-overlay');
  }

  showStart() {
    this.startScreen.style.display = 'flex';
    this.hud.style.display = 'none';
    this.gameOver.style.display = 'none';
    this.pauseOverlay.style.display = 'none';
  }

  showHUD() {
    this.startScreen.style.display = 'none';
    this.hud.style.display = 'flex';
    this.gameOver.style.display = 'none';
    this.pauseOverlay.style.display = 'none';
  }

  showGameOver(score, best, coins) {
    this.gameOver.style.display = 'flex';
    this.hud.style.display = 'none';
    this.goScore.textContent = score;
    this.goBest.textContent = best;
    this.goCoins.textContent = coins;
  }

  showPause(visible) {
    this.pauseOverlay.style.display = visible ? 'flex' : 'none';
  }

  updateHUD(score, coins, speed) {
    this.scoreEl.textContent = score;
    this.coinsEl.textContent = coins;
    this.speedEl.textContent = `Speed ${speed.toFixed(1)}`;
  }
}
