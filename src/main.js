import { Game } from './game/Game.js';

const canvas = document.createElement('canvas');
document.body.prepend(canvas);

const game = new Game(canvas);

function loop(time) {
  requestAnimationFrame(loop);
  game.tick(time);
}
requestAnimationFrame(loop);
