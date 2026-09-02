import { FORM_PREFIX, PLAYER_FRAME_SIZE, PlayerForm, PlayerState } from "./constants.js";

export class PlayerController {
  constructor(start) {
    this.x = start.x;
    this.y = start.y;
    this.vx = 0;
    this.vy = 0;
    this.form = start.form ?? PlayerForm.SMALL;
    this.state = PlayerState.IDLE;
    this.width = PLAYER_FRAME_SIZE[this.form].width;
    this.height = PLAYER_FRAME_SIZE[this.form].height;
    this.animationClock = 0;
    this.jumpHoldElapsed = 0;
    this.jumpStartY = this.y;
    this.jumpHeld = false;
    this.guidedTarget = null;
    this.currentEnemyTarget = null;
    this.currentFlagTarget = null;
    this.pendingPhoto = null;
    this.activeStop = null;
    this.returnToRunOnLand = false;
    this.transitionTimer = 0;
    this.frameOverride = null;
    this.flipX = false;
    this.opacity = 1;
  }

  get rect() {
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  get feetY() {
    return this.y + this.height;
  }

  setState(state) {
    if (this.state !== state) {
      this.state = state;
      this.animationClock = 0;
    }
  }

  startAutoRun() {
    this.activeStop = null;
    this.guidedTarget = null;
    this.setState(PlayerState.AUTO_RUN);
    this.frameOverride = null;
  }

  stopAt(stopPoint) {
    this.x = stopPoint.x;
    this.vx = 0;
    this.activeStop = stopPoint;
    this.setState(PlayerState.IDLE);
  }

  startJump(movement, guidedTarget = null) {
    const jumpSpeed = Math.max(1, Number(movement.jump_speed_multiplier ?? 1));
    this.vy = -movement.normal_jump_velocity * jumpSpeed;
    this.vx = guidedTarget
      ? Math.max(
          movement.run_speed * 0.62 * jumpSpeed,
          (guidedTarget.x - this.x - this.width * 0.35) / (0.78 / jumpSpeed),
        )
      : 0;
    this.jumpHoldElapsed = 0;
    this.jumpStartY = this.y;
    this.jumpHeld = true;
    this.guidedTarget = guidedTarget;
    this.setState(PlayerState.JUMP_ASCEND);
  }

  releaseJump() {
    this.jumpHeld = false;
  }

  setForm(form) {
    if (this.form === form) return;
    const feet = this.feetY;
    this.form = form;
    this.width = PLAYER_FRAME_SIZE[form].width;
    this.height = PLAYER_FRAME_SIZE[form].height;
    this.y = feet - this.height;
  }

  beginPowerupTransition(form, duration = 0.42) {
    this.setForm(form);
    this.transitionTimer = duration;
    this.setState(PlayerState.POWERUP_TRANSITION);
  }

  updateAnimation(dt) {
    this.animationClock += dt;
  }

  currentFrameKey() {
    if (this.frameOverride) return this.frameOverride;
    const prefix = FORM_PREFIX[this.form];
    const jumping = [
      PlayerState.JUMP_ASCEND,
      PlayerState.JUMP_DESCEND,
      PlayerState.STOMP_BOUNCE,
      PlayerState.PHOTO_PENDING,
      PlayerState.FLAG_LEAP,
    ].includes(this.state);
    if (jumping) return `${prefix}_jump`;
    if ([PlayerState.AUTO_RUN, PlayerState.POWERUP_TRANSITION, PlayerState.EXITING].includes(this.state)) {
      return `${prefix}_walk_${Math.floor(this.animationClock / 0.13) % 2 === 0 ? "a" : "b"}`;
    }
    return `${prefix}_idle`;
  }
}
