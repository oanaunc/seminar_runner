/**
 * Unified input: keyboard + touch swipes.
 * Emits semantic actions consumed once per frame by the Game.
 */
export class Input {
  constructor() {
    this._actions = { left: false, right: false, jump: false, slide: false, pause: false, restart: false };
    this._touchStart = null;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onTouchStart = this._onTouchStart.bind(this);
    this._onTouchEnd = this._onTouchEnd.bind(this);

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('touchstart', this._onTouchStart, { passive: true });
    window.addEventListener('touchend', this._onTouchEnd, { passive: true });
  }

  /** Read and clear queued actions. */
  consume() {
    const snap = { ...this._actions };
    this._actions.left = false;
    this._actions.right = false;
    this._actions.jump = false;
    this._actions.slide = false;
    this._actions.pause = false;
    this._actions.restart = false;
    return snap;
  }

  _onKeyDown(e) {
    switch (e.code) {
      case 'ArrowLeft':  case 'KeyA': this._actions.left = true; break;
      case 'ArrowRight': case 'KeyD': this._actions.right = true; break;
      case 'ArrowUp':    case 'KeyW': case 'Space': this._actions.jump = true; break;
      case 'ArrowDown':  case 'KeyS': this._actions.slide = true; break;
      case 'KeyP': this._actions.pause = true; break;
      case 'KeyR': this._actions.restart = true; break;
    }
  }

  _onTouchStart(e) {
    const t = e.changedTouches[0];
    this._touchStart = { x: t.clientX, y: t.clientY, time: performance.now() };
  }

  _onTouchEnd(e) {
    if (!this._touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - this._touchStart.x;
    const dy = t.clientY - this._touchStart.y;
    const elapsed = performance.now() - this._touchStart.time;
    this._touchStart = null;

    const SWIPE_THRESHOLD = 30;
    const MAX_TIME = 400;
    if (elapsed > MAX_TIME) return;

    if (Math.abs(dx) > Math.abs(dy)) {
      if (Math.abs(dx) > SWIPE_THRESHOLD) {
        if (dx < 0) this._actions.left = true;
        else this._actions.right = true;
      }
    } else {
      if (Math.abs(dy) > SWIPE_THRESHOLD) {
        if (dy < 0) this._actions.jump = true;
        else this._actions.slide = true;
      }
    }
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('touchstart', this._onTouchStart);
    window.removeEventListener('touchend', this._onTouchEnd);
  }
}
