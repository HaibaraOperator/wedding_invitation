import { PlayerState } from "./constants.js";

const PHYSICS_STATES = new Set([
  PlayerState.JUMP_ASCEND,
  PlayerState.JUMP_DESCEND,
  PlayerState.STOMP_BOUNCE,
  PlayerState.PHOTO_PENDING,
]);

export class MovementSystem {
  constructor(config, groundY, surfaces = null) {
    this.config = config;
    this.groundY = groundY;
    this.surfaces = surfaces;
    this.jumpSpeed = Math.max(1, Number(config.jump_speed_multiplier ?? 1));
  }

  update(player, dt, inputDown) {
    const previous = { ...player.rect };

    if ([PlayerState.AUTO_RUN, PlayerState.POWERUP_TRANSITION, PlayerState.EXITING].includes(player.state)) {
      player.x += this.config.run_speed * dt;
    }

    if (!PHYSICS_STATES.has(player.state)) {
      return { previous, landed: false };
    }

    if (
      inputDown &&
      player.jumpHeld &&
      player.vy < 0 &&
      player.jumpHoldElapsed < this.config.max_hold_duration / this.jumpSpeed
    ) {
      player.vy -= this.config.hold_jump_acceleration * this.jumpSpeed ** 2 * dt;
      player.jumpHoldElapsed += dt;
    }

    player.vy += this.config.gravity * this.jumpSpeed ** 2 * dt;
    player.x += player.vx * dt;
    player.y += player.vy * dt;

    const highestY = player.jumpStartY - this.config.max_jump_height;
    if (player.y < highestY) {
      player.y = highestY;
      player.vy = Math.max(40, player.vy);
      player.jumpHeld = false;
    }

    if (player.state !== PlayerState.PHOTO_PENDING) {
      if (player.vy < 0 && player.state !== PlayerState.STOMP_BOUNCE) {
        player.setState(PlayerState.JUMP_ASCEND);
      } else if (player.vy >= 0 && player.state !== PlayerState.STOMP_BOUNCE) {
        player.setState(PlayerState.JUMP_DESCEND);
      }
    }

    const currentFeetY = player.y + player.height;
    const crossedSurface = player.vy >= 0
      ? this.surfaces?.crossedTop(player.x, player.width, previous.y + previous.height, currentFeetY)
      : null;
    const landingY = crossedSurface ?? this.groundY;
    if (currentFeetY >= landingY && player.vy >= 0) {
      player.y = landingY - player.height;
      player.vx = 0;
      player.vy = 0;
      player.jumpHeld = false;
      return { previous, landed: true };
    }
    return { previous, landed: false };
  }
}
