import { PlayerForm, PlayerState } from "./constants.js";
import { lerp } from "./utils.js";

export class PowerupSystem {
  constructor() {
    this.items = [];
  }

  spawn(type, block) {
    this.items.push({
      id: `${type}_${performance.now().toFixed(0)}`,
      type,
      x: block.x,
      y: block.y,
      width: 32,
      height: 32,
      startX: block.x,
      startY: block.y,
      elapsed: 0,
      duration: 0.36,
      phase: "emerge",
      active: true,
    });
  }

  spawnCoin(block) {
    this.items.push({
      id: `coin_${performance.now().toFixed(0)}`,
      type: "coin",
      x: block.x,
      y: block.y,
      width: 32,
      height: 32,
      startX: block.x,
      startY: block.y,
      elapsed: 0,
      duration: 0.72,
      active: true,
    });
  }

  update(dt, player, game = null) {
    for (const item of this.items) {
      if (!item.active) continue;
      item.elapsed += dt;
      const t = Math.min(1, item.elapsed / item.duration);
      if (item.type === "coin") {
        item.x = item.startX;
        item.y = item.startY - Math.sin(t * Math.PI) * 76;
        if (t >= 1) item.active = false;
        continue;
      }
      if (item.phase === "emerge") {
        item.x = item.startX;
        item.y = lerp(item.startY, item.startY - 32, t);
        if (t >= 1) {
          item.phase = "wait_for_landing";
          item.elapsed = 0;
        }
        continue;
      }

      const playerGrounded = [PlayerState.IDLE, PlayerState.AUTO_RUN, PlayerState.POWERUP_TRANSITION]
        .includes(player.state) && Math.abs(player.vy) < 0.01;
      if (item.phase === "wait_for_landing") {
        item.y = item.startY - 32;
        if (!playerGrounded) continue;
        item.phase = "chase";
        item.elapsed = 0;
        item.duration = 0.78;
        item.startX = item.x;
        item.startY = item.y;
        continue;
      }

      const targetX = player.x + player.width * 0.25;
      const targetY = player.y + player.height * 0.35;
      item.x = lerp(item.startX, targetX, t);
      item.y = lerp(item.startY, targetY, t) - Math.sin(t * Math.PI) * 34;
      if (t >= 1) {
        item.active = false;
        const form = item.type === "fire_flower" ? PlayerForm.FIRE : PlayerForm.BIG;
        player.beginPowerupTransition(form);
        game?.snapPlayerToSurface();
      }
    }
    this.items = this.items.filter((item) => item.active);

    if (player.state === PlayerState.POWERUP_TRANSITION) {
      player.transitionTimer -= dt;
      if (player.transitionTimer <= 0) player.startAutoRun();
    }
  }

  frameKey(item) {
    if (item.type === "coin") {
      return `coin_${Math.floor(item.elapsed / 0.09) % 4}`;
    }
    return item.type === "fire_flower" ? "fire_flower" : "super_mushroom";
  }
}
