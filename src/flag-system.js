import { PlayerState } from "./constants.js";
import { clamp, lerp } from "./utils.js";

export class FlagSystem {
  constructor(config) {
    this.flag = {
      ...config,
      y: config.ground_y - config.height,
    };
    this.leap = null;
  }

  withinDetection(player, cellWidth, configuredCells) {
    const range = cellWidth * configuredCells;
    const distance = this.flag.x - (player.x + player.width);
    return distance >= 0 && distance <= range;
  }

  start(player, duration) {
    const targetX = this.flag.x + Math.round(this.flag.width * 0.46) - player.width / 2;
    const targetY = this.flag.y - player.height + 12;
    this.leap = {
      elapsed: 0,
      duration,
      startX: player.x,
      startY: player.y,
      targetX,
      targetY,
      arcHeight: 118,
    };
    player.currentFlagTarget = this.flag;
    player.setState(PlayerState.FLAG_LEAP);
  }

  update(player, dt) {
    if (!this.leap) return false;
    this.leap.elapsed += dt;
    const t = clamp(this.leap.elapsed / this.leap.duration, 0, 1);
    player.x = lerp(this.leap.startX, this.leap.targetX, t);
    player.y = lerp(this.leap.startY, this.leap.targetY, t) - 4 * this.leap.arcHeight * t * (1 - t);
    if (t >= 1) {
      player.x = this.leap.targetX;
      player.y = this.leap.targetY;
      this.leap = null;
      return true;
    }
    return false;
  }
}
