import { clamp } from "./utils.js";

export class CameraSystem {
  constructor(config, map) {
    this.config = config;
    this.map = map;
    this.x = 0;
    this.y = 0;
  }

  update(player, viewport) {
    const target = player.x - viewport.width * this.config.player_screen_ratio;
    this.x = clamp(target, 0, Math.max(0, this.map.width - viewport.width));
    // Negative camera_y is intentional when the viewport is taller than the
    // map: it bottom-aligns the 480px story map instead of leaving the ground
    // floating halfway up a desktop canvas.
    this.y = this.config.vertical_mode === "bottom"
      ? this.map.height - viewport.height
      : 0;
  }
}
