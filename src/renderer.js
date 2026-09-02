import { EnemyState, PlayerState } from "./constants.js";
import { RenderAdapter } from "./render-adapter.js";
import { isVisible } from "./utils.js";

export class Renderer extends RenderAdapter {
  constructor(canvas, assets, debugConfig) {
    super();
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.assets = assets;
    this.debugConfig = debugConfig;
    this._viewport = { width: 960, height: 540 };
    this.dpr = 1;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  get viewport() {
    return this._viewport;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this._viewport.width = Math.max(1, rect.width);
    this._viewport.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  drawImage(key, x, y, width, height) {
    this.ctx.drawImage(this.assets.get(key), Math.round(x), Math.round(y), width, height);
  }

  drawActor(key, x, y, width, height, flipX = false) {
    if (!flipX) {
      this.drawImage(key, x, y, width, height);
      return;
    }
    this.ctx.save();
    this.ctx.translate(Math.round(x + width), Math.round(y));
    this.ctx.scale(-1, 1);
    this.ctx.drawImage(this.assets.get(key), 0, 0, width, height);
    this.ctx.restore();
  }

  render(game) {
    const { ctx, viewport } = this;
    const { camera } = game;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#5c94fc";
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    const transitionBlank = Boolean(game.story.transitionBlank);
    if (transitionBlank) {
      this.drawBlankTransitionBackground(viewport);
    } else {
      const mapImage = this.assets.get("map_image");
      ctx.drawImage(mapImage, Math.round(-camera.x), Math.round(-camera.y));
    }

    const bride = game.story.bride;
    if (!transitionBlank && bride.visible && bride.behindBlocks && isVisible(bride, camera, viewport)) {
      this.drawActor(
        bride.frame,
        bride.x - camera.x,
        bride.y - camera.y,
        bride.width,
        bride.height,
        bride.flipX,
      );
    }

    for (const block of transitionBlank ? [] : game.questionBlocks.blocks) {
      if (!isVisible(block, camera, viewport)) continue;
      const sx = block.x - camera.x;
      const sy = block.y + block.renderOffsetY - camera.y;
      if (block.activated) {
        ctx.save();
        this.drawImage("question_block", sx, sy, block.width, block.height);
        // Canvas filter support and cache behavior differ between browsers.
        // Use an explicit opaque tint so an activated block always loses its
        // bright orange highlight, even in mobile WebViews.
        ctx.globalAlpha = .72;
        ctx.fillStyle = "#5f4938";
        ctx.fillRect(Math.round(sx), Math.round(sy), block.width, block.height);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#2a211b";
        ctx.lineWidth = 2;
        ctx.strokeRect(Math.round(sx) + 1, Math.round(sy) + 1, block.width - 2, block.height - 2);
        ctx.restore();
      } else {
        this.drawImage("question_block", sx, sy, block.width, block.height);
      }
    }

    for (const item of transitionBlank ? [] : game.powerups.items) {
      if (!isVisible(item, camera, viewport)) continue;
      this.drawImage(game.powerups.frameKey(item), item.x - camera.x, item.y - camera.y, 32, 32);
    }

    for (const coin of transitionBlank ? [] : game.story.collectibles) {
      if (!coin.active || !isVisible(coin, camera, viewport)) continue;
      this.drawImage(
        game.story.coinFrameKey(),
        coin.x - camera.x,
        coin.y - camera.y,
        coin.width,
        coin.height,
      );
    }

    for (const enemy of transitionBlank ? [] : game.enemies.enemies) {
      if (
        [EnemyState.REMOVED, EnemyState.HIDDEN].includes(enemy.state)
        || !isVisible(enemy, camera, viewport)
      ) continue;
      const image = this.assets.get(game.enemies.frameKey(enemy));
      const sx = enemy.x - camera.x;
      const sy = enemy.y - camera.y;
      const clipPiranha = enemy.type === "piranha"
        && enemy.revealClipY !== null
        && enemy.state !== EnemyState.DYING;
      if (clipPiranha) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(
          sx - 4,
          -camera.y - 256,
          enemy.width + 8,
          enemy.revealClipY - camera.y + 256,
        );
        ctx.clip();
      }
      if (enemy.state === EnemyState.DYING) {
        ctx.save();
        if (enemy.flash && Math.floor(enemy.animationClock / .1) % 2 === 0) ctx.globalAlpha = .18;
        ctx.translate(sx + enemy.width / 2, sy + enemy.height / 2);
        ctx.rotate(enemy.rotation);
        ctx.drawImage(image, -enemy.width / 2, -enemy.height / 2, enemy.width, enemy.height);
        ctx.restore();
      } else {
        ctx.drawImage(image, Math.round(sx), Math.round(sy), enemy.width, enemy.height);
      }
      if (clipPiranha) ctx.restore();
    }


    if (!transitionBlank && bride.visible && !bride.behindBlocks && isVisible(bride, camera, viewport)) {
      this.drawActor(
        bride.frame,
        bride.x - camera.x,
        bride.y - camera.y,
        bride.width,
        bride.height,
        bride.flipX,
      );
    }

    this.drawStoryActors(game);

    const player = game.player;
    ctx.save();
    ctx.globalAlpha = player.opacity ?? 1;
    this.drawActor(
      player.currentFrameKey(),
      player.x - camera.x,
      player.y - camera.y,
      player.width,
      player.height,
      player.flipX,
    );
    ctx.restore();

    if (game.cinematics?.active) game.cinematics.render(ctx, viewport, this.assets);

    if (game.debug.enabled && this.debugConfig.draw_colliders) this.drawDebug(game);
    if (player.state === PlayerState.LEVEL_COMPLETE) this.drawComplete(viewport);
  }

  drawStoryActors(game) {
    const actors = game.story.actors ?? [];
    for (const actor of actors) {
      if (!actor.visible) continue;
      if (!actor.screenSpace && !isVisible(actor, game.camera, this.viewport)) continue;
      const x = actor.screenSpace ? actor.x : actor.x - game.camera.x;
      const y = actor.screenSpace ? actor.y : actor.y - game.camera.y;
      this.ctx.save();
      this.ctx.globalAlpha = actor.opacity ?? 1;
      if (actor.sourceRect && !actor.flipX) {
        const source = actor.sourceRect;
        this.ctx.drawImage(
          this.assets.get(actor.frame),
          source.x,
          source.y,
          source.width,
          source.height,
          Math.round(x),
          Math.round(y),
          actor.width,
          actor.height,
        );
      } else {
        this.drawActor(actor.frame, x, y, actor.width, actor.height, actor.flipX);
      }
      this.ctx.restore();
    }
  }

  drawBlankTransitionBackground(viewport) {
    const { ctx } = this;
    ctx.fillStyle = "#5c94fc";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    const baseline = viewport.height - 76;
    ctx.fillStyle = "#00a800";
    for (let x = -64; x < viewport.width + 96; x += 128) {
      ctx.beginPath();
      ctx.moveTo(x, baseline);
      ctx.lineTo(x + 48, baseline - 64);
      ctx.lineTo(x + 96, baseline);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#008800";
    for (let x = 12; x < viewport.width + 64; x += 96) {
      ctx.fillRect(x + 12, baseline - 24, 8, 24);
      ctx.fillRect(x, baseline - 44, 32, 24);
    }
  }

  drawDebug(game) {
    const { ctx } = this;
    const camera = game.camera;
    const player = game.player;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#7dd3fc";
    ctx.strokeRect(player.x - camera.x, player.y - camera.y, player.width, player.height);

    for (const enemy of game.enemies.enemies) {
      if (![EnemyState.ACTIVE, EnemyState.INVULNERABLE].includes(enemy.state)) continue;
      ctx.strokeStyle = "#fb7185";
      ctx.strokeRect(enemy.x - camera.x, enemy.y - camera.y, enemy.width, enemy.height);
    }

    if (this.debugConfig.draw_detection_ranges) {
      const alpha = Number(this.debugConfig.collision_debug_alpha ?? 0);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = "#fb7185";
      ctx.fillRect(
        player.x + player.width - camera.x,
        player.y - camera.y,
        game.enemyDetectionPx,
        player.height,
      );
      ctx.fillStyle = "#fde047";
      ctx.fillRect(
        player.x + player.width - camera.x,
        player.y - camera.y - 18,
        game.flagDetectionPx,
        player.height + 36,
      );
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  drawComplete(viewport) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = "#05070cbb";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "700 22px ui-monospace, monospace";
    ctx.fillText("LOVE STORY COMPLETE", viewport.width / 2, viewport.height / 2 - 4);
    ctx.font = "13px ui-monospace, monospace";
    ctx.fillText("这一段故事已经完成", viewport.width / 2, viewport.height / 2 + 24);
    ctx.restore();
  }
}
