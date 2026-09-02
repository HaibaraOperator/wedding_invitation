import { INPUT } from "./constants.js";

export class InputController {
  constructor(targets) {
    this.targets = targets.filter(Boolean);
    this.queue = [];
    this.isDown = false;
    this.locked = false;
    this.lastTouchAt = -Infinity;
    this.listeners = [];
    this.bind();
  }

  bindEvent(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.listeners.push(() => target.removeEventListener(type, handler, options));
  }

  emit(type, originalEvent) {
    if (this.locked && type === INPUT.DOWN) return;
    const now = performance.now();
    this.queue.push({ type, time: now, originalEvent });
    if (type === INPUT.DOWN) this.isDown = true;
    if (type === INPUT.UP || type === INPUT.CANCEL) this.isDown = false;
  }

  bind() {
    const passiveFalse = { passive: false };
    if ("PointerEvent" in window) {
      for (const target of this.targets) {
        this.bindEvent(target, "pointerdown", (event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          event.preventDefault();
          target.setPointerCapture?.(event.pointerId);
          this.emit(INPUT.DOWN, event);
        }, passiveFalse);
        this.bindEvent(target, "pointerup", (event) => {
          event.preventDefault();
          this.emit(INPUT.UP, event);
        }, passiveFalse);
        this.bindEvent(target, "pointercancel", (event) => {
          event.preventDefault();
          this.emit(INPUT.CANCEL, event);
        }, passiveFalse);
      }
    } else {
      for (const target of this.targets) {
        this.bindEvent(target, "touchstart", (event) => {
          this.lastTouchAt = performance.now();
          event.preventDefault();
          this.emit(INPUT.DOWN, event);
        }, passiveFalse);
        this.bindEvent(target, "touchend", (event) => {
          event.preventDefault();
          this.emit(INPUT.UP, event);
        }, passiveFalse);
        this.bindEvent(target, "touchcancel", (event) => {
          event.preventDefault();
          this.emit(INPUT.CANCEL, event);
        }, passiveFalse);
        this.bindEvent(target, "mousedown", (event) => {
          if (event.button !== 0 || performance.now() - this.lastTouchAt < 700) return;
          event.preventDefault();
          this.emit(INPUT.DOWN, event);
        }, passiveFalse);
        this.bindEvent(target, "mouseup", (event) => {
          if (event.button !== 0 || performance.now() - this.lastTouchAt < 700) return;
          event.preventDefault();
          this.emit(INPUT.UP, event);
        }, passiveFalse);
      }
    }
    this.bindEvent(window, "blur", (event) => this.emit(INPUT.CANCEL, event));
  }

  consume() {
    return this.queue.splice(0);
  }

  setLocked(locked) {
    this.locked = Boolean(locked);
    if (locked) {
      this.queue.length = 0;
      this.isDown = false;
    }
  }

  destroy() {
    this.listeners.splice(0).forEach((remove) => remove());
  }
}
