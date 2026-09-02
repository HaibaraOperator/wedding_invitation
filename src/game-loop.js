export class GameLoop {
  constructor(update, render) {
    this.update = update;
    this.render = render;
    this.running = false;
    this.lastTime = 0;
    this.frame = this.frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
  }

  frame(now) {
    if (!this.running) return;
    const rawDelta = (now - this.lastTime) / 1000;
    const delta = Math.min(rawDelta, 0.05);
    this.lastTime = now;
    this.update(delta, now / 1000);
    this.render(delta, now / 1000);
    requestAnimationFrame(this.frame);
  }
}
