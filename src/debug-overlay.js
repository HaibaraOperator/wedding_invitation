import { formatTarget, worldToCell } from "./utils.js";

export class DebugOverlay {
  constructor(element, enabled = true) {
    this.element = element;
    this.enabled = enabled;
    this.fps = 0;
    this.smoothDelta = 1 / 60;
    this.setEnabled(enabled);
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    this.element.hidden = !this.enabled;
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  update(game, delta) {
    if (!this.enabled) return;
    this.smoothDelta = this.smoothDelta * 0.9 + delta * 0.1;
    this.fps = this.smoothDelta > 0 ? 1 / this.smoothDelta : 0;
    const player = game.player;
    const screen = { x: player.x - game.camera.x, y: player.y - game.camera.y };
    const cell = worldToCell(player.x, player.feetY - 1, game.config.map);
    this.element.textContent = [
      `FPS: ${this.fps.toFixed(1)}`,
      `delta: ${(delta * 1000).toFixed(2)} ms`,
      `world: (${player.x.toFixed(1)}, ${player.y.toFixed(1)})`,
      `screen: (${screen.x.toFixed(1)}, ${screen.y.toFixed(1)})`,
      `camera_x: ${game.camera.x.toFixed(1)}`,
      `state: ${player.state}`,
      `form: ${player.form}`,
      `cell: (${cell.column}, ${cell.row})`,
      `enemy range: ${game.enemyDetectionPx}px`,
      `flag range: ${game.flagDetectionPx}px`,
      `current_enemy_target: ${formatTarget(player.currentEnemyTarget)}`,
      `current_flag_target: ${formatTarget(player.currentFlagTarget)}`,
      `pending_photo: ${player.pendingPhoto?.id ?? "—"}`,
      `counter: ${game.counter.value}`,
      `stop: ${player.activeStop?.id ?? "—"}`,
    ].join("\n");
  }
}
