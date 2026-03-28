/**
 * Minimal sound effects via Web Audio API oscillator envelopes.
 * No external assets needed.
 */
export class Audio {
  constructor() {
    this._ctx = null;
  }

  _ensure() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  }

  _play(freq, type, dur, vol = 0.15) {
    try {
      const ctx = this._ensure();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + dur);
    } catch { /* graceful no-op if audio blocked */ }
  }

  coin() { this._play(1200, 'sine', 0.1, 0.12); }
  jump() { this._play(400, 'triangle', 0.15, 0.08); }
  slide() { this._play(200, 'sawtooth', 0.12, 0.06); }

  gameOver() {
    try {
      const ctx = this._ensure();
      [180, 140, 100].forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.12, ctx.currentTime + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 0.25);
      });
    } catch { /* no-op */ }
  }
}
