import { INPUT, EnemyState, PlayerState } from "./constants.js";
import { CameraSystem } from "./camera-system.js";
import { EnemySystem } from "./enemy-system.js";
import { MovementSystem } from "./movement-system.js";
import { PlayerController } from "./player-controller.js";
import { PowerupSystem } from "./powerup-system.js";
import { QuestionBlockSystem } from "./question-block-system.js";
import { StoryDirector } from "./story-director.js";
import { AdvancedStoryDirector } from "./advanced-story-director.js";
import { SurfaceSystem } from "./surface-system.js";
import { CinematicTransitionSystem } from "./cinematic-transition-system.js";
import { SILENT_AUDIO } from "./audio-system.js";

const eventClientX = (event) => {
  const original = event.originalEvent;
  return original?.clientX
    ?? original?.changedTouches?.[0]?.clientX
    ?? original?.touches?.[0]?.clientX
    ?? 0;
};

export class WeddingGame {
  constructor({ config, mapData, input, renderer, counter, photoSystem, debugOverlay, statusElement, audio = SILENT_AUDIO }) {
    this.config = config;
    this.mapData = mapData;
    this.input = input;
    this.renderer = renderer;
    this.counter = counter;
    this.photoSystem = photoSystem;
    this.debugOverlay = debugOverlay;
    this.statusElement = statusElement;
    this.audio = audio;
    this.player = new PlayerController(config.player_start);
    this.surfaces = new SurfaceSystem(mapData, config.map.ground_y);
    this.movement = new MovementSystem(config.movement, config.map.ground_y, this.surfaces);
    this.questionBlocks = new QuestionBlockSystem(config.question_blocks, config.map);
    this.enemies = new EnemySystem(config.enemies);
    this.powerups = new PowerupSystem();
    this.camera = new CameraSystem(config.camera, config.map);
    this.story = config.director_type === "advanced"
      ? new AdvancedStoryDirector(config)
      : new StoryDirector(config);
    this.cinematics = new CinematicTransitionSystem();
    this.chapterTransitionStarted = false;
    this.onChapterTransition = null;
    this.stopPoints = config.stop_points.map((point) => ({ ...point }));
    this.enemyDetectionPx = Number(config.movement.enemy_detection_px
      ?? config.movement.enemy_detection_cells * config.map.cell_width);
    this.flagDetectionPx = config.movement.flag_detection_cells * config.map.cell_width;
    this.debug = { enabled: Boolean(config.debug?.enabled) };
    this.status(config.ui?.start_message ?? "点击画面，开始旅程");
    this.camera.update(this.player, this.renderer.viewport);
  }

  status(message) {
    this.statusElement.textContent = message;
  }

  finishLevel(message) {
    const transition = this.config.chapter_transition;
    if (!transition || this.chapterTransitionStarted) {
      this.player.setState(PlayerState.LEVEL_COMPLETE);
      this.status(message);
      return;
    }
    this.chapterTransitionStarted = true;
    this.player.setState(PlayerState.TRANSITION);
    this.status(transition.message ?? message);
    this.playCinematic(transition.cinematic, () => {
      this.player.setState(PlayerState.LEVEL_COMPLETE);
      this.status(message);
      this.onChapterTransition?.(transition.next_level, this.persistentSnapshot());
    });
  }

  playCinematic(kind, onComplete = null) {
    this.audio.beginCinematic(kind);
    this.cinematics.play(kind, onComplete);
  }

  activateBlock(block) {
    if (!block || !this.questionBlocks.activate(block)) return false;
    const event = this.story.eventForTarget(block.id);
    if (["mushroom", "fire_flower"].includes(block.content_type)) this.audio.play("super");
    else if (["cat_powerup", "cap_powerup"].includes(event?.action)) this.audio.play("flower");
    else this.audio.play("coin");
    return true;
  }

  collectCoin(coin) {
    if (!coin?.active) return false;
    coin.active = false;
    this.audio.play("coin");
    return true;
  }

  snapPlayerToSurface(preferredFeetY = this.player.feetY) {
    return this.surfaces.snap(this.player, preferredFeetY);
  }

  handleGalleryInput(event) {
    if (event.type === INPUT.DOWN) {
      this.photoSystem.beginGalleryGesture(eventClientX(event));
      return;
    }
    if (event.type !== INPUT.UP) return;
    const result = this.photoSystem.endGalleryGesture(eventClientX(event), event.time);
    if (result !== "close") return;
    this.photoSystem.close();
    this.story.finishGallery(this);
  }

  handleInput() {
    for (const event of this.input.consume()) {
      if (this.player.state === PlayerState.GALLERY_MODAL) {
        this.handleGalleryInput(event);
        continue;
      }

      if (event.type === INPUT.UP || event.type === INPUT.CANCEL) {
        this.player.releaseJump();
        continue;
      }
      if (event.type !== INPUT.DOWN) continue;
      this.audio.unlock();

      if (this.player.state === PlayerState.PHOTO_MODAL) {
        if (this.photoSystem.canClose(event.time)) this.closePhotoAndResume();
        continue;
      }
      if (this.player.state === PlayerState.KISS_WAIT) {
        this.story.continueAfterKiss(this);
        continue;
      }
      if (this.player.state === PlayerState.SPLIT_WAIT) {
        this.story.startFinalExit(this);
        continue;
      }
      if (
        [PlayerState.SCRIPTED, PlayerState.POWERUP_TRANSITION, PlayerState.EXITING, PlayerState.LEVEL_COMPLETE]
          .includes(this.player.state)
      ) {
        continue;
      }
      if (this.player.state !== PlayerState.IDLE) continue;

      const eventConfig = this.player.activeStop?.storyEvent;
      if (!eventConfig) {
        this.player.startAutoRun();
        this.status("自动奔跑中");
        continue;
      }
      this.story.beginInteraction(eventConfig, this);
    }
  }

  update(dt) {
    if (this.cinematics.active) {
      this.input.consume();
      this.cinematics.update(dt);
      this.debugOverlay.update(this, dt);
      return;
    }
    this.handleInput();

    if ([PlayerState.PHOTO_MODAL, PlayerState.GALLERY_MODAL].includes(this.player.state)) {
      this.photoSystem.updateModal(dt);
      this.debugOverlay.update(this, dt);
      return;
    }

    this.player.updateAnimation(dt);
    this.questionBlocks.update(dt);
    this.story.updateAmbient(this, dt);
    this.enemies.update(dt, this.camera, this.renderer.viewport);
    this.powerups.update(dt, this.player, this);
    this.photoSystem.updateWorldPosition?.(
      this.camera.x + this.renderer.viewport.width,
    );

    if (this.story.update(this, dt)) {
      this.camera.update(this.player, this.renderer.viewport);
      this.debugOverlay.update(this, dt);
      return;
    }

    const movementResult = this.movement.update(this.player, dt, this.input.isDown);
    this.handleQuestionHit(movementResult.previous);
    this.handleEnemyStomp(movementResult.previous);

    if (movementResult.landed) this.handleLanding();
    if (this.player.state === PlayerState.AUTO_RUN) this.story.stopIfDue(this);

    if (this.photoSystem.update(dt)) {
      this.player.setState(PlayerState.PHOTO_MODAL);
      this.status("照片已解锁 · 再次点击继续");
    }

    this.camera.update(this.player, this.renderer.viewport);
    this.debugOverlay.update(this, dt);
  }

  handleQuestionHit(previousRect) {
    const block = this.questionBlocks.findHeadHit(this.player, previousRect);
    if (!this.activateBlock(block)) return;
    this.player.vy = Math.max(130, -this.player.vy * 0.22);
    const storyEvent = this.story.eventForTarget(block.id);

    if (block.content_type === "photo") {
      const photo = this.photoSystem.get(block.photo_id);
      if (!photo) throw new Error(`照片配置不存在：${block.photo_id}`);
      this.player.pendingPhoto = photo;
      this.photoSystem.setPending(photo);
      this.player.setState(PlayerState.PHOTO_PENDING);
      this.status("照片已顶出，先完成当前跳跃");
      return;
    }

    if (block.content_type === "bride") {
      this.story.beginBrideSequence(storyEvent, block, this);
      return;
    }

    if (block.content_type === "mushroom") {
      this.powerups.spawn("mushroom", block);
      this.story.complete(storyEvent);
      this.player.returnToRunOnLand = true;
      this.status("超级蘑菇出现");
      return;
    }

    if (block.content_type === "fire_flower") {
      this.powerups.spawn("fire_flower", block);
      this.story.complete(storyEvent);
      this.player.returnToRunOnLand = true;
    }
  }

  handleEnemyStomp(previousRect) {
    const enemy = this.enemies.findStomp(this.player, previousRect);
    if (!enemy) return;
    const result = this.enemies.stomp(
      enemy,
      this.player,
      this.config.movement.stomp_bounce_velocity,
    );
    this.audio.play("tap");
    if (!result.defeated) return;
    this.story.completeByTarget(enemy.id);
    this.status("蘑菇怪旋转飞出画面");
  }

  handleLanding() {
    if (this.player.pendingPhoto) {
      this.player.setState(PlayerState.IDLE);
      this.photoSystem.prepareAfterLanding();
      this.status("已落地，准备显示照片");
      return;
    }

    if (this.player.currentEnemyTarget) {
      const enemy = this.player.currentEnemyTarget;
      if ([EnemyState.ACTIVE, EnemyState.INVULNERABLE].includes(enemy.state) && enemy.hp > 0) {
        this.player.setState(PlayerState.IDLE);
        this.status("再次点击继续踩踏");
      } else {
        this.player.currentEnemyTarget = null;
        this.player.startAutoRun();
        this.status("怪物事件完成，继续奔跑");
      }
      return;
    }

    if (this.player.returnToRunOnLand) {
      this.player.returnToRunOnLand = false;
      this.player.startAutoRun();
      this.status("互动完成，继续奔跑");
      return;
    }
    this.player.setState(PlayerState.IDLE);
  }

  closePhotoAndResume() {
    const photo = this.photoSystem.close();
    if (!photo) return;
    const activeBlock = this.questionBlocks.blocks.find((block) => block.photo_id === photo.id);
    if (activeBlock) this.story.completeByTarget(activeBlock.id);
    this.story.afterPhotoClosed?.(this, photo);
    this.player.pendingPhoto = null;
    this.player.startAutoRun();
    this.status("照片关闭，继续奔跑");
  }

  toggleDebug() {
    this.debug.enabled = this.debugOverlay.toggle();
    return this.debug.enabled;
  }

  render() {
    this.renderer.render(this);
  }

  persistentSnapshot() {
    return {
      form: this.player.form,
      unlocked_photo_ids: [...this.photoSystem.unlockedPhotoIds],
      counter_value: this.counter.value,
      story_events: this.story.events.map((event) => ({ id: event.id, completed: event.completed })),
    };
  }
}
