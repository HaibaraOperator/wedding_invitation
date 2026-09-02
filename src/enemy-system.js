import { EnemyState, PlayerState } from "./constants.js";
import { intersects } from "./utils.js";

const SIZE_BY_TYPE = {
  goomba: [32, 32],
  koopa: [32, 48],
  bowser: [64, 64],
  piranha: [32, 48],
};

export class EnemySystem {
  constructor(configs) {
    this.enemies = configs.map((config) => {
      const [width, height] = SIZE_BY_TYPE[config.type] ?? [32, 32];
      return {
        ...config,
        width,
        height,
        y: config.y ?? (config.ground_y - height),
        state: config.state ?? EnemyState.ACTIVE,
        hp: config.type === "bowser" ? (config.hp ?? 5) : (config.hp ?? 1),
        animationClock: 0,
        invulnerableTimer: 0,
        shellTimer: 0,
        deathVx: 0,
        deathVy: 0,
        rotation: 0,
        revealElapsed: 0,
        revealDuration: config.reveal_duration ?? 1.15,
        hiddenY: config.hidden_y ?? config.y ?? (config.ground_y - height),
        targetY: config.target_y ?? config.y ?? (config.ground_y - height),
        revealClipY: config.reveal_clip_y ?? null,
      };
    });
  }

  byId(id) {
    return this.enemies.find((enemy) => enemy.id === id) ?? null;
  }

  nearestAhead(player, distance) {
    return this.enemies
      .filter((enemy) => enemy.state === EnemyState.ACTIVE && enemy.x >= player.x)
      .filter((enemy) => enemy.x - (player.x + player.width) <= distance)
      .sort((a, b) => a.x - b.x)[0] ?? null;
  }

  update(dt, camera, viewport) {
    for (const enemy of this.enemies) {
      enemy.animationClock += dt;
      if (enemy.state === EnemyState.INVULNERABLE) {
        enemy.invulnerableTimer -= dt;
        if (enemy.invulnerableTimer <= 0) enemy.state = EnemyState.ACTIVE;
      }
      if (enemy.state === EnemyState.SHELL_PAUSE) {
        enemy.shellTimer -= dt;
        if (enemy.shellTimer <= 0) this.launch(enemy, 260, -40);
      }
      if (enemy.state === EnemyState.EMERGING) {
        enemy.revealElapsed += dt;
        const t = Math.min(1, enemy.revealElapsed / enemy.revealDuration);
        const eased = 1 - (1 - t) ** 3;
        enemy.y = enemy.hiddenY + (enemy.targetY - enemy.hiddenY) * eased;
        if (t >= 1) enemy.state = EnemyState.ACTIVE;
      }
      if (enemy.state === EnemyState.DYING) {
        enemy.x += enemy.deathVx * dt;
        enemy.y += enemy.deathVy * dt;
        enemy.rotation += Math.PI * 3.2 * dt;
        if (
          enemy.x - camera.x > viewport.width + 160 ||
          enemy.x + enemy.width < camera.x - 160 ||
          enemy.y + enemy.height < camera.y - 180
        ) {
          enemy.state = EnemyState.REMOVED;
        }
      }
    }
  }

  findStomp(player, previousRect) {
    if (player.vy <= 0) return null;
    const candidates = this.enemies
      .filter((enemy) => enemy.state === EnemyState.ACTIVE)
      .filter((enemy) => {
        const rect = { x: enemy.x, y: enemy.y, width: enemy.width, height: enemy.height };
        const crossedHead = previousRect.y + previousRect.height <= enemy.y + 10;
        return crossedHead && intersects(player.rect, rect);
      })
      .sort((a, b) => a.y - b.y);
    return candidates[0] ?? null;
  }

  stomp(enemy, player, bounceVelocity) {
    if (!enemy || enemy.state !== EnemyState.ACTIVE) return { defeated: false };
    enemy.hp -= 1;
    player.y = enemy.y - player.height;
    player.vy = -bounceVelocity;
    player.vx = 0;
    player.setState(PlayerState.STOMP_BOUNCE);

    if (enemy.type === "bowser" && enemy.hp > 0) {
      enemy.state = EnemyState.INVULNERABLE;
      enemy.invulnerableTimer = 0.58;
      return { defeated: false, needsAnotherStomp: true };
    }
    if (enemy.type === "koopa") {
      enemy.state = EnemyState.SHELL_PAUSE;
      enemy.shellTimer = 0.26;
      return { defeated: true, shell: true };
    }
    this.launch(enemy, 110, -210);
    return { defeated: true };
  }

  launch(enemy, vx, vy) {
    enemy.state = EnemyState.DYING;
    enemy.deathVx = vx;
    enemy.deathVy = vy;
  }

  revealPiranha(enemy) {
    if (!enemy || enemy.state !== EnemyState.HIDDEN) return false;
    enemy.y = enemy.hiddenY;
    enemy.revealElapsed = 0;
    enemy.state = EnemyState.EMERGING;
    return true;
  }

  retractKoopa(enemy) {
    if (!enemy || enemy.type !== "koopa") return false;
    enemy.state = EnemyState.SHELL_WAIT;
    enemy.animationClock = 0;
    return true;
  }

  forceLaunch(enemy, vx = 220, vy = -120) {
    if (!enemy || enemy.state === EnemyState.REMOVED) return false;
    this.launch(enemy, vx, vy);
    return true;
  }

  frameKey(enemy) {
    if (enemy.type === "goomba") {
      return `goomba_walk_${Math.floor(enemy.animationClock / 0.14) % 2 === 0 ? "a" : "b"}`;
    }
    if (enemy.type === "koopa") {
      if (enemy.state === EnemyState.SHELL_WAIT) return "koopa_retract";
      if ([EnemyState.SHELL_PAUSE, EnemyState.DYING].includes(enemy.state)) return "koopa_shell_move";
      return `koopa_walk_${Math.floor(enemy.animationClock / 0.15) % 2 === 0 ? "a" : "b"}`;
    }
    if (enemy.type === "piranha") {
      return `piranha_${Math.floor(enemy.animationClock / 0.24) % 2 === 0 ? "closed" : "open"}`;
    }
    return `bowser_mouth_${Math.floor(enemy.animationClock / 0.22) % 2 === 0 ? "closed" : "open"}`;
  }
}
