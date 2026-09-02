import { clamp, lerp } from "./utils.js";

export const CINEMATIC_DURATION = 5;
const MOSAIC_DURATION = .65;

export const CINEMATIC_DEFINITIONS = Object.freeze({
  flight_to_ireland: Object.freeze({
    duration: CINEMATIC_DURATION,
    background: "eurasia_world_map",
    vehicle: "groom_787_airplane",
    chinaPoint: [.73, .59],
    chinaOffset: [-10, -5],
    irelandPoint: [.29, .34],
    arcRatio: .27,
  }),
  flag_train_tour: Object.freeze({
    duration: CINEMATIC_DURATION,
    vehicle: "couple_high_speed_train",
    flags: Object.freeze(["flag_uk", "flag_ireland", "flag_japan", "flag_turkey", "flag_china"]),
    landscapeSeed: 20261005,
  }),
});

const smooth = (value) => {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

export class CinematicTransitionSystem {
  constructor() {
    this.active = false;
    this.kind = null;
    this.elapsed = 0;
    this.onComplete = null;
    this.buffer = null;
  }

  play(kind, onComplete = null) {
    if (!CINEMATIC_DEFINITIONS[kind]) throw new Error(`未知转场动画：${kind}`);
    this.active = true;
    this.kind = kind;
    this.elapsed = 0;
    this.onComplete = onComplete;
  }

  stop() {
    const callback = this.onComplete;
    this.active = false;
    this.kind = null;
    this.elapsed = 0;
    this.onComplete = null;
    callback?.();
  }

  update(dt) {
    if (!this.active) return false;
    this.elapsed = Math.min(CINEMATIC_DURATION, this.elapsed + dt);
    if (this.elapsed >= CINEMATIC_DURATION) this.stop();
    return true;
  }

  timing() {
    const entry = smooth(this.elapsed / MOSAIC_DURATION);
    const exit = smooth((CINEMATIC_DURATION - this.elapsed) / MOSAIC_DURATION);
    const visibility = Math.min(entry, exit);
    return {
      visibility,
      mosaic: Math.max(1, Math.round(1 + (1 - visibility) * 23)),
      travel: smooth((this.elapsed - MOSAIC_DURATION) / (CINEMATIC_DURATION - MOSAIC_DURATION * 2)),
    };
  }

  snapshot(viewport) {
    const timing = this.timing();
    if (this.kind === "flight_to_ireland") {
      const definition = CINEMATIC_DEFINITIONS.flight_to_ireland;
      const start = {
        x: viewport.width * definition.chinaPoint[0] + definition.chinaOffset[0],
        y: viewport.height * definition.chinaPoint[1] + definition.chinaOffset[1],
      };
      const end = { x: viewport.width * definition.irelandPoint[0], y: viewport.height * definition.irelandPoint[1] };
      const planeWidth = Math.min(256, viewport.width * .28);
      const planeHeight = planeWidth * 96 / 256;
      const centerX = lerp(start.x, end.x, timing.travel);
      const centerY = lerp(start.y, end.y, timing.travel)
        - Math.sin(Math.PI * timing.travel) * viewport.height * definition.arcRatio;
      return {
        ...timing,
        kind: this.kind,
        start,
        end,
        mapRect: { x: 0, y: 0, width: viewport.width, height: viewport.height },
        vehicle: {
          key: definition.vehicle,
          x: centerX - planeWidth / 2,
          y: centerY - planeHeight / 2,
          width: planeWidth,
          height: planeHeight,
          flipX: false,
        },
      };
    }

    const definition = CINEMATIC_DEFINITIONS.flag_train_tour;
    const left = viewport.width * .1;
    const right = viewport.width * .9;
    const spacing = (right - left) / (definition.flags.length - 1);
    const groundY = viewport.height * .79;
    const trainWidth = Math.min(256, viewport.width * .3);
    const trainHeight = trainWidth * 96 / 256;
    return {
      ...timing,
      kind: this.kind,
      groundY,
      seed: definition.landscapeSeed,
      flags: definition.flags.map((key, index) => ({
        key,
        x: left + spacing * index - 32,
        y: groundY - 48,
        width: 64,
        height: 48,
      })),
      vehicle: {
        key: definition.vehicle,
        x: lerp(-trainWidth, viewport.width + trainWidth * .08, timing.travel),
        y: groundY - trainHeight,
        width: trainWidth,
        height: trainHeight,
        flipX: true,
      },
    };
  }

  _ensureBuffer(width, height) {
    if (!this.buffer) {
      if (typeof OffscreenCanvas !== "undefined") this.buffer = new OffscreenCanvas(width, height);
      else this.buffer = document.createElement("canvas");
    }
    if (this.buffer.width !== width) this.buffer.width = width;
    if (this.buffer.height !== height) this.buffer.height = height;
    return this.buffer;
  }

  _drawLandscape(ctx, viewport, snapshot) {
    ctx.fillStyle = "#5c94fc";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    const pseudo = (index) => {
      const value = Math.sin((index + 1) * snapshot.seed * .000013) * 43758.5453;
      return value - Math.floor(value);
    };
    ctx.fillStyle = "#00a800";
    for (let index = 0; index < 9; index += 1) {
      const x = (index - 1) * viewport.width / 7 + pseudo(index) * 34;
      const width = 90 + pseudo(index + 20) * 90;
      const height = 44 + pseudo(index + 40) * 70;
      ctx.beginPath();
      ctx.moveTo(x, snapshot.groundY);
      ctx.lineTo(x + width / 2, snapshot.groundY - height);
      ctx.lineTo(x + width, snapshot.groundY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#008800";
    for (let index = 0; index < 14; index += 1) {
      const x = pseudo(index + 80) * viewport.width;
      const size = 18 + pseudo(index + 100) * 22;
      ctx.fillRect(x + size * .42, snapshot.groundY - size, 5, size);
      ctx.fillRect(x, snapshot.groundY - size * 1.7, size, size);
    }
    ctx.fillStyle = "#c84c0c";
    ctx.fillRect(0, snapshot.groundY, viewport.width, viewport.height - snapshot.groundY);
    ctx.fillStyle = "#f8b800";
    for (let x = 0; x < viewport.width; x += 32) ctx.fillRect(x, snapshot.groundY, 30, 4);
  }

  _drawScene(ctx, viewport, assets, snapshot) {
    ctx.imageSmoothingEnabled = false;
    if (snapshot.kind === "flight_to_ireland") {
      ctx.fillStyle = "#2458a0";
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      ctx.drawImage(
        assets.get("eurasia_world_map"),
        snapshot.mapRect.x,
        snapshot.mapRect.y,
        snapshot.mapRect.width,
        snapshot.mapRect.height,
      );
      ctx.fillStyle = "#fff4a8";
      for (const point of [snapshot.start, snapshot.end]) {
        ctx.fillRect(Math.round(point.x) - 4, Math.round(point.y) - 4, 8, 8);
      }
    } else {
      this._drawLandscape(ctx, viewport, snapshot);
      for (const flag of snapshot.flags) {
        ctx.drawImage(assets.get(flag.key), flag.x, flag.y, flag.width, flag.height);
      }
    }

    const vehicle = snapshot.vehicle;
    ctx.save();
    if (vehicle.flipX) {
      ctx.translate(vehicle.x + vehicle.width, vehicle.y);
      ctx.scale(-1, 1);
      ctx.drawImage(assets.get(vehicle.key), 0, 0, vehicle.width, vehicle.height);
    } else {
      ctx.drawImage(assets.get(vehicle.key), vehicle.x, vehicle.y, vehicle.width, vehicle.height);
    }
    ctx.restore();
  }

  render(ctx, viewport, assets) {
    if (!this.active) return;
    const snapshot = this.snapshot(viewport);
    const mosaic = snapshot.mosaic;
    const width = Math.max(1, Math.ceil(viewport.width / mosaic));
    const height = Math.max(1, Math.ceil(viewport.height / mosaic));
    const buffer = this._ensureBuffer(width, height);
    const bufferContext = buffer.getContext("2d", { alpha: false });
    bufferContext.setTransform(1 / mosaic, 0, 0, 1 / mosaic, 0, 0);
    bufferContext.imageSmoothingEnabled = false;
    this._drawScene(bufferContext, viewport, assets, snapshot);

    ctx.save();
    ctx.globalAlpha = snapshot.visibility;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buffer, 0, 0, width, height, 0, 0, viewport.width, viewport.height);
    ctx.restore();
  }
}
