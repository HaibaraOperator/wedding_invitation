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
    this.backgroundRestartPending = false;
    this.backgroundPlayPending = null;
    this.background = null;
    this.effectPools = new Map();
    this.retryTimers = new Map();
    if (!this.available) return;

    const embeddedBackground = typeof document !== "undefined"
      ? document.querySelector("#background-audio")
      : null;
    this.background = embeddedBackground ?? new Audio(paths.ground);
    this.background.loop = true;
    this.background.preload = "auto";
    this.background.volume = .38;
    this.background.setAttribute?.("playsinline", "");
    this.background.setAttribute?.("webkit-playsinline", "");
    this.background.load();
    for (const [name, path] of Object.entries(paths)) {
      if (name === "ground") continue;
      const pool = Array.from({ length: 1 }, () => {
        // Reserve the mobile media connection/decoder for the background
        // track during startup. Effects fetch on first use and never block it.
        const track = new Audio();
        track.preload = "none";
        track.volume = EFFECT_VOLUME[name] ?? .75;
        track.src = path;
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
    target.addEventListener("click", unlock, { capture: true, passive: true });
    if (typeof document !== "undefined") {
      document.addEventListener("WeixinJSBridgeReady", unlock);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.resumeBackground();
      });
    }
    target.addEventListener("pageshow", () => this.resumeBackground());
    if (typeof window !== "undefined" && window.WeixinJSBridge) unlock();
  }

  unlock() {
    if (!this.available) return;
    this.unlocked = true;
    // Do not make unlock a one-shot operation. Some mobile WebViews report a
    // bridge event before audio is actually permitted; every later gesture
    // must therefore be able to retry the pending background track.
    this.resumeBackground();
  }

  startBackground(restart = false) {
    this.backgroundRequested = true;
    if (restart) this.backgroundRestartPending = true;
    this.resumeBackground();
  }

  resumeBackground() {
    if (!this.available || !this.background) return;
    if (!this.unlocked || !this.backgroundRequested) return;
    if (this.backgroundPlayPending) return;
    if (!this.background.paused && !this.background.ended) {
      this.backgroundRestartPending = false;
      return;
    }
    if (this.backgroundRestartPending) this.background.currentTime = 0;
    const playback = this.background.play();
    this.backgroundPlayPending = playback ?? null;
    playback?.then?.(() => {
      this.backgroundRestartPending = false;
      this.backgroundPlayPending = null;
    }).catch?.(() => {
      // Keep the request pending. The next real touch/click will retry it.
      this.backgroundPlayPending = null;
    });
  }

  stopBackground(reset = false) {
    this.backgroundRequested = false;
    this.backgroundRestartPending = false;
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
