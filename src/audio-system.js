export const AUDIO_PATHS = Object.freeze({
  ground: "./assets/audio/Ground_Theme.mp3",
  jump: "./assets/audio/jump.mp3",
  coin: "./assets/audio/coin.mp3",
  super: "./assets/audio/super.mp3",
  flower: "./assets/audio/flower.mp3",
  tap: "./assets/audio/tap.mp3",
  flagship: "./assets/audio/flagship.mp3",
  aircraft: "./assets/audio/aircraft.mp3",
  train: "./assets/audio/train.mp3",
  firework: "./assets/audio/firework.mp3",
});

const EFFECT_VOLUME = Object.freeze({
  jump: .72,
  coin: .74,
  super: .78,
  flower: .76,
  tap: .78,
  flagship: .82,
  aircraft: .82,
  train: .82,
  firework: .84,
});

export class AudioSystem {
  constructor(paths = AUDIO_PATHS) {
    this.paths = paths;
    this.available = typeof Audio !== "undefined";
    this.unlocked = false;
    this.backgroundRequested = false;
    this.background = null;
    this.effectPools = new Map();
    this.retryTimers = new Map();
    if (!this.available) return;

    this.background = new Audio(paths.ground);
    this.background.loop = true;
    this.background.preload = "auto";
    this.background.volume = .38;
    this.background.load();
    for (const [name, path] of Object.entries(paths)) {
      if (name === "ground") continue;
      const pool = Array.from({ length: 1 }, () => {
        const track = new Audio(path);
        track.preload = "auto";
        track.volume = EFFECT_VOLUME[name] ?? .75;
        track.load();
        return track;
      });
      this.effectPools.set(name, pool);
    }
  }

  bindUnlock(target = window) {
    if (!this.available || !target?.addEventListener) return;
    const unlock = () => this.unlock();
    target.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    target.addEventListener("touchstart", unlock, { capture: true, passive: true });
    target.addEventListener("mousedown", unlock, { capture: true, passive: true });
    if (typeof document !== "undefined") {
      document.addEventListener("WeixinJSBridgeReady", unlock, { once: true });
    }
    if (typeof window !== "undefined" && window.WeixinJSBridge) unlock();
  }

  unlock() {
    if (!this.available || this.unlocked) return;
    this.unlocked = true;
    if (this.backgroundRequested) this.startBackground(true);
  }

  startBackground(restart = false) {
    this.backgroundRequested = true;
    if (!this.available || !this.background) return;
    if (!this.unlocked) return;
    if (restart) this.background.currentTime = 0;
    const playback = this.background.play();
    playback?.catch?.(() => {
      // Mobile browsers resume this request synchronously on the first
      // pointer/touch gesture through bindUnlock().
    });
  }

  stopBackground(reset = false) {
    this.backgroundRequested = false;
    if (!this.available || !this.background) return;
    this.background.pause();
    if (reset) this.background.currentTime = 0;
  }

  play(name) {
    if (!this.available || !this.unlocked) return;
    const pool = this.effectPools.get(name);
    if (!pool?.length) return;
    const track = pool.find((candidate) => candidate.paused || candidate.ended) ?? pool[0];
    track.currentTime = 0;
    track.play()?.catch?.(() => {
      track.load();
      clearTimeout(this.retryTimers.get(name));
      this.retryTimers.set(name, setTimeout(() => {
        if (!this.unlocked) return;
        track.currentTime = 0;
        track.play()?.catch?.(() => {});
      }, 220));
    });
  }

  beginCinematic(kind) {
    this.stopBackground(true);
    if (kind === "flight_to_ireland") this.play("aircraft");
    if (kind === "flag_train_tour") this.play("train");
  }

  beginFireworks() {
    this.stopBackground(true);
    this.play("firework");
  }
}

export const SILENT_AUDIO = Object.freeze({
  bindUnlock() {}, unlock() {}, startBackground() {}, stopBackground() {},
  play() {}, beginCinematic() {}, beginFireworks() {},
});
