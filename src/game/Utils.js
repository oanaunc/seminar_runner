/**
 * Shared constants and utility helpers.
 */

// ── Layout ──────────────────────────────────────────
export const LANE_WIDTH = 2.5;
export const LANES = [-1, 0, 1];
export const LANE_X = (index) => index * LANE_WIDTH; // -1 → left, 0 → center, 1 → right

// ── Player defaults ─────────────────────────────────
export const PLAYER_WIDTH = 0.9;
export const PLAYER_DEPTH = 0.9;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_SLIDE_HEIGHT = 0.8;
export const JUMP_VELOCITY = 11;
export const GRAVITY = 28;
export const SLIDE_DURATION = 0.55;
export const SLIDE_COOLDOWN = 0.15;
export const LANE_SWITCH_DURATION = 0.14;

// ── Track / world ───────────────────────────────────
export const SEGMENT_LENGTH = 22;
export const SEGMENT_COUNT = 14;
export const TRACK_HALF_WIDTH = LANE_WIDTH * 1.8;
export const WALL_HEIGHT = 5;
export const PILLAR_SPACING = SEGMENT_LENGTH;

// ── Spawner ─────────────────────────────────────────
export const SPAWN_AHEAD_MIN = 65;
export const SPAWN_AHEAD_MAX = 200;
export const DESPAWN_BEHIND = 15;
export const COIN_Y = 1.1;

// ── Difficulty defaults ─────────────────────────────
export const MIN_SPEED = 13;
export const MAX_SPEED = 30;
export const SPEED_TAU = 45;
export const MIN_SPAWN_INTERVAL = 0.55;
export const MAX_SPAWN_INTERVAL = 1.6;
export const SPAWN_TAU = 50;
export const MIN_REACTION_TIME = 0.45;
export const REACTION_SAFETY_BUFFER = 3.0;

// ── Math helpers ────────────────────────────────────
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function smoothCurve(t, tau) {
  return 1 - Math.exp(-t / tau);
}

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randFloat(min, max) {
  return Math.random() * (max - min) + min;
}

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── AABB overlap test ───────────────────────────────
// Each box: { x, y, z, hw, hh, hd } (center + half-extents)
export function aabbOverlap(a, b) {
  return (
    Math.abs(a.x - b.x) < a.hw + b.hw &&
    Math.abs(a.y - b.y) < a.hh + b.hh &&
    Math.abs(a.z - b.z) < a.hd + b.hd
  );
}
