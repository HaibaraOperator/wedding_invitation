import { StoryDirector } from "./story-director.js";
import { EnemyState, PlayerForm, PlayerState } from "./constants.js";
import { lerp } from "./utils.js";

const ease = (t) => t * t * (3 - 2 * t);

export class AdvancedStoryDirector extends StoryDirector {
  constructor(config) {
    super(config);
    this.actors = [];
    this.effects = [];
    this.pendingGalleryEvent = null;
    this.galleryContinuation = null;
    this.levelEnding = false;
    this.holdElapsed = 0;
  }

  x(column) { return (column - 1) * this.config.map.cell_width; }
  anchorY(game, row) { return row * this.config.map.cell_height - game.player.height; }
  groundTop(game) { return this.config.map.ground_y - game.player.height; }
  questionTouchY(block) { return block.y + block.height; }

  actor(id, frame, x, y, width = 32, height = 32, extra = {}) {
    const value = { id, frame, x, y, width, height, visible: true, flipX: false, opacity: 1, ...extra };
    this.actors = this.actors.filter((item) => item.id !== id);
    this.actors.push(value);
    return value;
  }

  removeActor(id) { this.actors = this.actors.filter((item) => item.id !== id); }

  startTimeline(game, event, steps, onComplete) {
    game.player.setState(PlayerState.SCRIPTED);
    game.player.vx = 0;
    game.player.vy = 0;
    this.script = { kind: "timeline", event, steps: [...steps], step: null, elapsed: 0, onComplete };
  }

  pathStep(toX, toY, duration, arc = 0, frame = null, onEnd = null, options = {}) {
    return {
      duration,
      start: (game, step) => {
        step.fromX = game.player.x;
        step.fromY = game.player.y;
        step.toX = typeof toX === "function" ? toX(game) : toX;
        step.toY = typeof toY === "function" ? toY(game) : toY;
        step.holdElapsed = 0;
        step.dynamicDuration = options.dynamicDuration !== false;
        const horizontalDuration = Math.abs(step.toX - step.fromX)
          / Math.max(1, game.config.movement.run_speed);
        const jumpFrame = frame === null || String(frame).includes("jump");
        if (jumpFrame && step.dynamicDuration) {
          // Keep scripted jumps readable at every height: a small hop finishes
          // quickly, while a high/held leap spends visibly longer in the air.
          // Horizontal travel still provides a lower bound, so the character
          // never accelerates simply to reach a distant landing point.
          const jumpHeight = Math.abs(step.toY - step.fromY) + Math.max(0, arc);
          const heightDuration = Math.min(1.28, Math.max(.3, .28 + jumpHeight * .004));
          const jumpSpeed = Math.max(1, Number(game.config.movement.jump_speed_multiplier ?? 1));
          step.duration = Math.max(horizontalDuration, heightDuration) / jumpSpeed;
        } else {
          step.duration = Math.max(duration, horizontalDuration);
        }
        if (options.audio) game.audio.play(options.audio);
        else {
          const jumpFrame = frame === null || String(frame).includes("jump");
          const beginsJump = jumpFrame && (step.toY < step.fromY - 4 || arc >= 40);
          if (options.sound !== false && beginsJump) game.audio.play("jump");
        }
      },
      update: (game, t, dt) => {
        const step = this.script.step;
        if (game.input.isDown && t < .55) {
          const previousHold = step.holdElapsed;
          step.holdElapsed = Math.min(
            game.config.movement.max_hold_duration,
            step.holdElapsed + dt,
          );
          // Long holds extend both height and airtime, using only the newly
          // accumulated hold interval so the result stays frame-rate neutral.
          if (step.dynamicDuration) {
            const jumpSpeed = Math.max(1, Number(game.config.movement.jump_speed_multiplier ?? 1));
            step.duration += (step.holdElapsed - previousHold) * .9 / jumpSpeed;
          }
        }
        const holdRatio = step.holdElapsed / Math.max(.001, game.config.movement.max_hold_duration);
        const holdBonus = arc > 0
          ? holdRatio * Math.min(64, game.config.movement.max_jump_height * .25)
          : 0;
        game.player.x = lerp(step.fromX, step.toX, t);
        game.player.y = lerp(step.fromY, step.toY, ease(t))
          - Math.sin(Math.PI * t) * (arc + holdBonus);
        game.player.frameOverride = frame ?? this._jumpFrame(game.player);
      },
      end: (game) => {
        const step = this.script?.step;
        if (step) {
          game.player.x = step.toX;
          game.player.y = step.toY;
        }
        onEnd?.(game);
      },
    };
  }

  waitStep(duration, frame = null, onStart = null, onEnd = null) {
    return {
      duration,
      start: (game) => { if (frame) game.player.frameOverride = frame; onStart?.(game); },
      update: () => {},
      end: onEnd,
    };
  }

  _updateTimeline(game, dt) {
    const timeline = this.script;
    if (!timeline.step) {
      timeline.step = timeline.steps.shift();
      timeline.elapsed = 0;
      if (!timeline.step) {
        this.script = null;
        timeline.onComplete?.();
        return false;
      }
      timeline.step.start?.(game, timeline.step);
    }
    timeline.elapsed += dt;
    const t = Math.min(1, timeline.elapsed / Math.max(0.001, timeline.step.duration));
    timeline.step.update?.(game, t, dt);
    if (t >= 1) {
      timeline.step.end?.(game);
      timeline.step = null;
    }
    return true;
  }

  update(game, dt) {
    if (this.script?.kind === "timeline") return this._updateTimeline(game, dt);
    if (this.script?.kind === "heart_hold") return this.updateHeartHold(game, dt);
    return super.update(game, dt);
  }

  updateAmbient(game, dt) {
    super.updateAmbient(game, dt);
    for (const effect of this.effects) {
      effect.elapsed = (effect.elapsed ?? 0) + dt;
      effect.update?.(effect, dt, game);
    }
    this.effects = this.effects.filter((effect) => !effect.done);
  }

  beginInteraction(event, game) {
    if (!event || event.completed) return false;
    const actions = {
      pipe_jump: () => this.startPipeJump(event, game),
      koopa_coin_chain: () => this.startKoopaCoinChain(event, game),
      cat_powerup: () => this.startCatPowerup(event, game),
      linked_gallery: () => this.startLinkedGallery(event, game),
      linked_gallery_shower: () => this.startLinkedGallery(event, game, true),
      bowser_five: () => this.startBowserFive(event, game),
      castle_exit: () => this.startCastleExit(event, game),
      mentor_intro: () => this.startMentor(event, game),
      cap_powerup: () => this.startCapPowerup(event, game),
      koopa_trajectory: () => this.startKoopaTrajectory(event, game),
      koopa_first_stomp: () => this.startKoopaFirstStomp(event, game),
      koopa_shell_launch: () => this.startKoopaShellLaunch(event, game),
      scripted_jump: () => this.startScriptedJump(event, game),
      pipe_piranha: () => this.startPipePiranha(event, game),
      flower_collect: () => this.startFlowerCollect(event, game),
      fire_piranha: () => this.startFirePiranha(event, game),
      form_jump: () => this.startFormJump(event, game),
      chain_jump: () => this.startChainJump(event, game),
      landmark_zoom: () => this.startLandmarkZoom(event, game),
      balloon_transition: () => this.startBalloonTransition(event, game),
      coin_pop: () => this.startCoinPop(event, game),
      perch_gallery: () => this.startPerchGallery(event, game),
      jump_to_perch: () => this.startJumpToPerch(event, game),
      bowser_fire_hit: () => this.startBowserFireHit(event, game),
      board_bus: () => this.startBoardBus(event, game),
      collect_coin_jump: () => this.startCollectCoinJump(event, game),
      gallery_then_bus: () => this.startLinkedGallery(event, game),
      bus_dismount_gallery: () => { game.player.setForm(PlayerForm.COUPLE); return this.startLinkedGallery(event, game); },
      bus_battle: () => this.startBusBattle(event, game),
      proposal: () => this.startProposal(event, game),
      shower_gallery: () => this.startShowerGallery(event, game),
      split_departure: () => this.startSplitDeparture(event, game),
      stair_photo: () => this.startStairPhoto(event, game),
      heart_finale: () => this.startHeartHold(event, game),
      flag_finale: () => this.startFinale(event, game),
    };
    if (actions[event.action]) return actions[event.action]();
    return super.beginInteraction(event, game);
  }

  activateBlocks(game, ids = []) {
    ids.forEach((id) => {
      const block = game.questionBlocks.byId(id);
      if (block) game.activateBlock(block);
    });
  }

  showGallery(event, game, continuation = null) {
    this.pendingGalleryEvent = event;
    this.galleryContinuation = continuation;
    game.photoSystem.showGallery(game.config.galleries.find((item) => item.id === event.gallery_id));
    game.player.setState(PlayerState.GALLERY_MODAL);
    game.status("左右滑动浏览照片，轻触关闭");
  }

  finishGallery(game) {
    const event = this.pendingGalleryEvent ?? game.player.activeStop?.storyEvent;
    this.pendingGalleryEvent = null;
    const continuation = this.galleryContinuation;
    this.galleryContinuation = null;
    if (continuation) { continuation(); return; }
    if (event?.after_action === "bus_battle") {
      this.startBusBattle(event, game);
      return;
    }
    this.complete(event);
    if (event?.after_form) game.player.setForm(PlayerForm[event.after_form]);
    game.player.frameOverride = null;
    game.snapPlayerToSurface();
    game.player.startAutoRun();
    game.status("照片收好，继续向前");
  }

  afterPhotoClosed(game, photo) {
    const event = this.eventForTarget(game.questionBlocks.blocks.find((block) => block.photo_id === photo?.id)?.id);
    if (event?.after_form) {
      game.player.setForm(PlayerForm[event.after_form]);
      game.snapPlayerToSurface();
    }
  }

  startPipeJump(event, game) {
    const topX = this.x(event.pipe_top[0]);
    const topY = this.anchorY(game, event.pipe_top[1]);
    this.startTimeline(game, event, [
      this.pathStep(topX, topY, .62, 84),
      this.pathStep(this.x(event.landing[0]), this.anchorY(game, event.landing[1]), .7, 70),
    ], () => this.finishRun(event, game, "越过管道，继续旅行"));
    return true;
  }

  startKoopaCoinChain(event, game) {
    const first = game.enemies.byId(event.enemy_ids[0]);
    const second = game.enemies.byId(event.enemy_ids[1]);
    const coin = this.collectibles.find((item) => item.id === event.coin_id);
    const ground = this.groundTop(game);
    this.startTimeline(game, event, [
      this.pathStep(first.x, first.y - game.player.height, .56, 92, null, () => {
        game.audio.play("tap");
        game.enemies.retractKoopa(first);
        game.status("第一次踩踏：乌龟缩入壳中");
      }),
      this.pathStep(coin.x, coin.y - game.player.height, .46, 70, null, () => { game.collectCoin(coin); }),
      this.pathStep(first.x, first.y - game.player.height, .46, 0, null, () => {
        game.audio.play("tap");
        first.state = EnemyState.SHELL_WAIT;
      }),
      this.pathStep(first.x, ground, .42, 0),
      {
        duration: second ? Math.max(.35, (second.x - first.x) / 330) : .35,
        start: (_game, step) => {
          step.shellStartX = first.x;
          step.shellTargetX = second?.x ?? first.x + 112;
          first.state = EnemyState.SHELL_WAIT;
        },
        update: (_game, t) => {
          const step = this.script.step;
          first.x = lerp(step.shellStartX, step.shellTargetX, t);
          first.rotation += Math.PI * 4 * (1 / 60);
        },
        end: () => {
          if (second) {
            first.x = second.x;
            game.enemies.retractKoopa(second);
            game.status("第一只龟壳撞上第二只乌龟，两只同时缩壳");
          }
        },
      },
      this.waitStep(.18, this._walkFrame(game.player), null, () => {
        for (const enemy of [first, second].filter(Boolean)) {
          enemy.state = EnemyState.DYING;
          enemy.deathVx = 330;
          enemy.deathVy = 0;
        }
      }),
      this.waitStep(1.55, this._walkFrame(game.player), null, () => {
        first.state = EnemyState.REMOVED;
        if (second) second.state = EnemyState.REMOVED;
      }),
    ], () => this.finishRun(event, game, "龟壳向右飞出，继续旅行"));
    return true;
  }

  startCatPowerup(event, game) {
    const block = game.questionBlocks.byId(event.target_id);
    const emergeX = this.x(event.emerge?.[0] ?? 129);
    const emergeY = this.anchorY(game, event.emerge?.[1] ?? 10);
    const moveX = this.x(event.move_to?.[0] ?? 133);
    const moveY = this.anchorY(game, event.move_to?.[1] ?? 9);
    const cat = this.actor("cat_powerup", "tabby_cat_side", emergeX, emergeY, 32, 32, { visible: false });
    this.startTimeline(game, event, [
      this.pathStep(this.x(event.jump_peak?.[0] ?? 129), this.questionTouchY(block), .55, 0, null, () => {
        this.activateBlocks(game, [event.target_id]);
        cat.visible = true;
      }),
      this.pathStep(block.x + 28, () => this.groundTop(game), .54, 0),
      {
        duration: .72,
        start: () => {},
        update: (_game, t) => {
          cat.x = lerp(emergeX, moveX, ease(t));
          cat.y = lerp(emergeY, moveY, ease(t));
        },
      },
      {
        duration: .65,
        start: () => {},
        update: (_game, t) => {
          cat.x = moveX;
          cat.y = lerp(moveY, game.player.y + game.player.height - 32, ease(t));
        },
        end: () => {
          this.removeActor("cat_powerup");
          game.player.setForm(PlayerForm.COUPLE_CAT);
          game.snapPlayerToSurface();
        },
      },
    ], () => this.finishRun(event, game, "小花猫加入旅程"));
    return true;
  }

  startLinkedGallery(event, game, withShower = false) {
    const block = game.questionBlocks.byId(event.target_id);
    const ground = this.groundTop(game);
    const peak = event.jump_peak ?? [Math.round(block.x / this.config.map.cell_width) + 1, 9];
    let shower = null;
    this.startTimeline(game, event, [
      this.pathStep(this.x(peak[0]), this.questionTouchY(block), .56, 0, null, () => {
        this.activateBlocks(game, event.block_ids ?? [event.target_id]);
        if (withShower) shower = this.actor("travel_coin_heart_shower", "coin_heart_shower_00", 0, 0, 384, 224, { screenSpace: true });
      }),
      ...(withShower ? [{ duration: 1.15, start: () => {}, update: (_g, t) => {
        shower.frame = `coin_heart_shower_${String(Math.min(11, Math.floor(t * 12))).padStart(2, "0")}`;
        shower.x = game.renderer.viewport.width / 2 - 192;
        shower.y = game.renderer.viewport.height / 2 - 112;
      }, end: () => this.removeActor("travel_coin_heart_shower") }] : []),
      this.pathStep(block.x + 28, ground, .58, 0),
    ], () => this.showGallery(event, game));
    return true;
  }

  startBowserFive(event, game) {
    const enemy = game.enemies.byId(event.target_id);
    const steps = [];
    for (let i = 0; i < 5; i += 1) {
      steps.push(this.pathStep(enemy.x, enemy.y - game.player.height, .46, 82, null, () => {
        game.audio.play("tap");
        enemy.hp = Math.max(0, enemy.hp - 1);
        enemy.state = EnemyState.INVULNERABLE;
        enemy.invulnerableTimer = .12;
      }));
    }
    steps.push(this.bowserDefeatStep(enemy));
    steps.push(this.pathStep(enemy.x + 78, this.groundTop(game), .58, 34));
    this.startTimeline(game, event, steps, () => this.finishRun(event, game, "库巴被连续踩踏五次后消失"));
    return true;
  }

  startCastleExit(event, game) {
    const fadeStartX = this.x(event.fade_from?.[0] ?? 197);
    const castleX = this.x(event.fade_to?.[0] ?? 201);
    this.startTimeline(game, event, [
      this.pathStep(fadeStartX, this.groundTop(game), .25, 0, this._walkFrame(game.player)),
      {
        duration: Math.max(.55, Math.abs(castleX - fadeStartX) / game.config.movement.run_speed),
        start: (g, step) => { step.fromX = g.player.x; },
        update: (_g, t) => {
          game.player.x = lerp(fadeStartX, castleX, t);
          game.player.y = this.groundTop(game);
          game.player.opacity = 1 - t;
          game.player.frameOverride = this._walkFrame(game.player, Math.floor(t * 8) % 2 === 1);
        },
      },
    ], () => {
      this.complete(event);
      game.player.opacity = 0;
      game.finishLevel("第二段旅行故事完成");
    });
    return true;
  }

  startMentor(event, game) {
    const block = game.questionBlocks.byId(event.target_id);
    const mentor = this.actor("mentor", "mentor_idle", block.x, block.y - 48, 32, 48, { visible: false });
    const targetX = this.x(27);
    this.startTimeline(game, event, [
      this.pathStep(block.x, this.questionTouchY(block), .45, 0, null, () => {
        this.activateBlocks(game, [event.target_id]);
        mentor.visible = true;
      }),
      this.pathStep(block.x, () => this.groundTop(game), .45, 0),
      { duration: 1.0, start: () => {}, update: (_g, t) => { mentor.frame = `mentor_run_right_${Math.floor(t * 8) % 2 ? "b" : "a"}`; mentor.x = lerp(block.x, targetX, t); mentor.y = lerp(block.y - 48, 368, t) - Math.sin(Math.PI * t) * 30; } },
      { duration: .9, start: () => { mentor.flipX = true; }, update: (_g, t) => { mentor.frame = `mentor_run_left_${Math.floor(t * 8) % 2 ? "b" : "a"}`; mentor.x = lerp(targetX, game.player.x + 38, t); } },
      this.waitStep(.7, null, () => { mentor.flipX = false; mentor.frame = "mentor_wave_a"; }, () => { mentor.frame = "mentor_wave_b"; }),
    ], () => this.finishRun(event, game, "导师挥手送上祝福"));
    return true;
  }

  startCapPowerup(event, game) {
    const block = game.questionBlocks.byId(event.target_id); this.activateBlocks(game, [event.target_id]);
    const cap = this.actor("cap", "graduation_cap", block.x, block.y - 18, 32, 32);
    this.startTimeline(game, event, [
      this.pathStep(block.x, block.y + 32, .55, 0),
      this.pathStep(block.x + 24, () => this.groundTop(game), .58, 0),
      { duration: .9, start: () => {}, update: (_g, t) => { cap.x = lerp(block.x, game.player.x, t); cap.y = lerp(block.y - 32, game.player.y, t) - Math.sin(Math.PI * t) * 36; }, end: () => { this.removeActor("cap"); game.snapPlayerToSurface(); } },
    ], () => this.finishRun(event, game, "博士帽已收下"));
    return true;
  }

  startKoopaTrajectory(event, game) {
    const enemy = game.enemies.byId(event.target_id);
    const shellStartX = enemy.x;
    const shellStartY = enemy.y;
    const horizontalX = this.x(84);
    const exitX = this.x(89);
    const exitY = 15 * this.config.map.cell_height;
    this.startTimeline(game, event, [
      this.pathStep(enemy.x, enemy.y - game.player.height, .7, 112, null, () => {
        game.audio.play("tap");
        game.enemies.retractKoopa(enemy);
        game.status("第一次踩踏：乌龟缩入壳中");
      }),
      this.pathStep(enemy.x, enemy.y - game.player.height, .62, 82, null, () => {
        game.audio.play("tap");
        enemy.state = EnemyState.SHELL_WAIT;
        game.status("第二次踩踏：龟壳开始移动");
      }),
      this.pathStep(this.x(82), () => this.groundTop(game), .5, 24),
      {
        duration: Math.max(.4, Math.abs(horizontalX - shellStartX) / game.config.movement.run_speed),
        start: () => { enemy.state = EnemyState.SHELL_WAIT; enemy.x = shellStartX; enemy.y = shellStartY; },
        update: (_g, t) => { enemy.x = lerp(shellStartX, horizontalX, t); enemy.y = shellStartY; },
      },
      {
        duration: Math.max(.55, Math.abs(exitX - horizontalX) / game.config.movement.run_speed),
        start: () => {},
        update: (_g, t) => {
          enemy.x = lerp(horizontalX, exitX, t);
          enemy.y = lerp(shellStartY, exitY, t) + Math.sin(Math.PI * t) * 34;
          enemy.rotation += Math.PI * 2.4 / 60;
        },
        end: () => { enemy.state = EnemyState.REMOVED; },
      },
    ], () => this.finishRun(event, game, "第二次踩踏后，龟壳沿向下抛物线飞出地图"));
    return true;
  }

  startKoopaFirstStomp(event, game) {
    const enemy = game.enemies.byId(event.target_id);
    this.startTimeline(game, event, [
      this.pathStep(this.x(80), this.anchorY(game, 11), .7, 112, null, () => {
        game.audio.play("tap");
        game.enemies.retractKoopa(enemy);
        game.status("第一次踩踏：乌龟缩入壳中");
      }),
      this.pathStep(this.x(78), this.anchorY(game, 13), .58, 58),
    ], () => this.finishAtNextStop(event, game, "龟壳已缩起，再次点击将它击飞"));
    return true;
  }

  startKoopaShellLaunch(event, game) {
    const enemy = game.enemies.byId(event.target_id);
    const shellStartX = enemy.x;
    const shellStartY = enemy.y;
    const horizontalX = this.x(84);
    const exitX = this.x(89);
    const exitY = 15 * this.config.map.cell_height;
    this.startTimeline(game, event, [
      this.pathStep(shellStartX, shellStartY - game.player.height, .46, 54),
      {
        duration: Math.max(.4, Math.abs(horizontalX - shellStartX) / game.config.movement.run_speed),
        start: () => { enemy.state = EnemyState.SHELL_WAIT; },
        update: (_g, t) => { enemy.x = lerp(shellStartX, horizontalX, t); enemy.y = shellStartY; },
      },
      {
        duration: .58,
        start: () => {},
        update: (_g, t) => {
          enemy.x = lerp(horizontalX, exitX, t);
          enemy.y = lerp(shellStartY, exitY, t) + Math.sin(Math.PI * t) * 34;
          enemy.rotation += Math.PI * 3 * (1 / 60);
        },
        end: () => { enemy.state = EnemyState.REMOVED; },
      },
      this.pathStep(this.x(84), this.anchorY(game, 13), .44, 20),
    ], () => this.finishAtNextStop(event, game, "龟壳飞出，继续前进"));
    return true;
  }

  startScriptedJump(event, game) {
    const landing = event.landing;
    this.startTimeline(game, event, [
      this.pathStep(this.x(landing[0]), this.anchorY(game, landing[1]), event.duration ?? .72, event.arc ?? 104),
    ], () => this.finishRun(event, game, event.message ?? "跳跃完成，继续前进"));
    return true;
  }

  startPipePiranha(event, game) {
    const enemy = game.enemies.byId(event.enemy_id);
    this.startTimeline(game, event, [
      this.pathStep(this.x(128), this.anchorY(game, 9), .58, 82),
      this.pathStep(this.x(135), this.anchorY(game, 13), .64, 78, null, () => game.enemies.revealPiranha(enemy)),
    ], () => this.finishAtNextStop(event, game, "食人花从管道中升起，长按跳跃取得火焰花"));
    return true;
  }

  startFlowerCollect(event, game) {
    const block = game.questionBlocks.byId(event.target_id);
    const flower = this.actor("script_flower", "fire_flower", block.x, block.y - 32, 32, 32, { visible: false });
    this.startTimeline(game, event, [
      this.pathStep(this.x(event.jump_peak?.[0] ?? 135), this.questionTouchY(block), .58, 0, null, () => {
        this.activateBlocks(game, [event.target_id]);
        flower.visible = true;
      }),
      this.pathStep(this.x(137), this.anchorY(game, 13), .52, 0),
      this.pathStep(this.x(135), this.anchorY(game, 6), .62, 92, null, () => {
        this.removeActor("script_flower");
        game.player.setForm(PlayerForm.FIRE);
      }),
    ], () => this.finishAtNextStop(event, game, "已获得火焰花，再次点击攻击食人花"));
    return true;
  }

  startFirePiranha(event, game) {
    const enemy = game.enemies.byId(event.enemy_id);
    const projectile = this.actor("fireball", "attack_fire_0", this.x(135), this.anchorY(game, 6) + 10, 32, 32, { visible: false });
    this.startTimeline(game, event, [
      { duration: .65, start: () => { game.player.flipX = true; projectile.visible = true; }, update: (_g, t) => {
        projectile.frame = `attack_fire_${Math.min(3, Math.floor(t * 4))}`;
        projectile.x = lerp(this.x(135), this.x(129), t);
        projectile.y = lerp(this.anchorY(game, 6) + 10, this.anchorY(game, 8) + 10, t);
      }, end: () => {
        projectile.visible = false;
        game.enemies.forceLaunch(enemy, -260, -130);
        game.player.flipX = false;
      } },
      this.pathStep(this.x(137), this.anchorY(game, 13), .54, 48),
    ], () => this.finishRun(event, game, "火焰花击退食人花"));
    return true;
  }

  startFormJump(event, game) {
    const ground = this.groundTop(game);
    this.startTimeline(game, event, [this.pathStep(this.x(event.landing[0]), ground, .7, 96)], () => {
      game.player.setForm(PlayerForm[event.form]); this.finishRun(event, game, "两人继续并肩前进");
    }); return true;
  }

  startChainJump(event, game) {
    const steps = event.waypoints.map((point, index) => this.pathStep(
      this.x(point[0]), point[1] * 32 - game.player.height, .5 + index * .04, 70 + index * 16,
    ));
    this.startTimeline(game, event, steps, () => this.finishRun(event, game, "连续跳跃完成")); return true;
  }

  startLandmarkZoom(event, game) {
    const balloon = this.actor("zoom_balloon", "couple_hot_air_balloon", game.player.x - 40, 100, 160, 160, { screenSpace: true, opacity: 0 });
    this.startTimeline(game, event, [
      { duration: 1.1, start: () => {}, update: (_g, t) => { balloon.opacity = t; balloon.width = 160 + t * 420; balloon.height = 160 + t * 420; balloon.x = game.renderer.viewport.width / 2 - balloon.width / 2; balloon.y = game.renderer.viewport.height / 2 - balloon.height / 2; } },
      this.waitStep(.7),
      { duration: .8, start: () => {}, update: (_g, t) => { balloon.opacity = 1 - t; }, end: () => this.removeActor("zoom_balloon") },
    ], () => this.finishRun(event, game, "热气球掠过世界地图")); return true;
  }

  startBalloonTransition(event, game) {
    const steps = (event.waypoints ?? []).map((point, index) => this.pathStep(
      this.x(point[0]), this.anchorY(game, point[1]), .54 + index * .04, 76 + index * 18,
    ));
    const balloon = this.actor("zoom_balloon", "couple_hot_air_balloon", 0, 0, 160, 160, { screenSpace: true, opacity: 0 });
    steps.push({
      duration: 1.25,
      start: () => { game.player.opacity = 0; this.transitionBlank = true; },
      update: (_g, t) => {
        balloon.opacity = t;
        balloon.width = 160 + t * 420;
        balloon.height = 160 + t * 420;
        balloon.x = game.renderer.viewport.width / 2 - balloon.width / 2;
        balloon.y = game.renderer.viewport.height / 2 - balloon.height / 2;
      },
    });
    steps.push(this.waitStep(.5));
    steps.push({
      duration: .62,
      start: () => {},
      update: (_g, t) => { balloon.opacity = 1 - t; },
      end: () => {
        this.removeActor("zoom_balloon");
        this.transitionBlank = false;
        this.actor("world_balloon", "couple_hot_air_balloon", this.x(239), 9 * 32 - 160, 160, 160);
        game.player.setForm(PlayerForm.COUPLE_FIRE);
        game.player.x = this.x(239);
        game.player.y = this.anchorY(game, 9);
        game.player.opacity = 1;
      },
    });
    steps.push(this.pathStep(this.x(243), this.anchorY(game, 13), .68, 88));
    this.startTimeline(game, event, steps, () => this.finishRun(event, game, "热气球落下，我们继续归途"));
    return true;
  }

  startCoinPop(event, game) {
    const block = game.questionBlocks.byId(event.target_id);
    const peak = event.jump_peak ?? [Math.round(block.x / 16) + 1, 12];
    this.startTimeline(game, event, [
      this.pathStep(this.x(peak[0]), this.questionTouchY(block), .55, 0, null, () => {
        this.activateBlocks(game, [event.target_id]);
        game.powerups.spawnCoin(block);
      }),
      this.pathStep(this.x(peak[0]), () => this.groundTop(game), .5, 0),
    ], () => {
      this.finishRun(event, game, "金币弹出");
    }); return true;
  }

  startJumpToPerch(event, game) {
    this.startTimeline(game, event, [
      this.pathStep(this.x(event.landing[0]), this.anchorY(game, event.landing[1]), .72, event.arc ?? 96),
    ], () => this.finishAtNextStop(event, game, "抵达高台，点击继续"));
    return true;
  }

  startPerchGallery(event, game) {
    const block = game.questionBlocks.byId(event.target_id);
    const landing = event.landing;
    this.startTimeline(game, event, [
      this.pathStep(block.x, this.questionTouchY(block), .5, 0, null, () => this.activateBlocks(game, [event.target_id])),
      this.pathStep(this.x(landing[0]), this.anchorY(game, landing[1]), .5, 0),
    ], () => this.showGallery(event, game, () => this.finishAtNextStop(event, game, "照片收好，继续高台路线")));
    return true;
  }

  startBowserFireHit(event, game) {
    const bowser = game.enemies.byId(event.target_id);
    const projectile = this.actor(`bowser_fire_${event.hit_index}`, "attack_fire_0", game.player.x, game.player.y + 10, 32, 32);
    const isFinalHit = Number(event.hit_index) >= 3;
    const steps = [{
      duration: .52,
      start: () => {},
      update: (_g, t) => {
        projectile.frame = `attack_fire_${Math.min(3, Math.floor(t * 4))}`;
        projectile.x = lerp(this.x(294), this.x(305), t);
        projectile.y = lerp(this.anchorY(game, 9) + 10, this.anchorY(game, 12) + 10, t);
      },
      end: () => {
        this.removeActor(projectile.id);
        bowser.hp = Math.max(0, bowser.hp - 1);
        if (bowser.hp === 0) {
          bowser.state = EnemyState.DYING;
          bowser.deathVx = 0;
          bowser.deathVy = 0;
          bowser.flash = true;
        }
        else { bowser.state = EnemyState.INVULNERABLE; bowser.invulnerableTimer = .12; }
      },
    }];
    if (isFinalHit) {
      steps.push(this.bowserDefeatStep(bowser, () => {
        this.actor(
          "waiting_baby_bus_vehicle",
          "wedding_baby_bus_idle",
          bowser.originalX ?? bowser.x,
          game.config.map.ground_y - 64,
          96,
          64,
          { sourceRect: { x: 0, y: 0, width: 96, height: 64 } },
        );
      }));
    }
    this.startTimeline(game, event, steps, () => this.finishAtNextStop(event, game, bowser.hp > 0 ? `库巴还需 ${bowser.hp} 次火焰` : "库巴旋转闪烁消失，宝宝巴士已经出现"));
    return true;
  }

  bowserDefeatStep(bowser, onEnd = null) {
    return {
      duration: .72,
      start: (_game, step) => {
        step.startX = bowser.x;
        step.startY = bowser.y;
        bowser.originalX = bowser.x;
        bowser.originalY = bowser.y;
        bowser.state = EnemyState.DYING;
        bowser.deathVx = 0;
        bowser.deathVy = 0;
        bowser.rotation = 0;
        bowser.flash = true;
      },
      update: (_game, t) => {
        const step = this.script.step;
        bowser.x = lerp(step.startX, step.startX + 96, ease(t));
        bowser.y = step.startY;
        bowser.rotation = lerp(0, Math.PI / 2, ease(t));
      },
      end: () => {
        bowser.state = EnemyState.REMOVED;
        bowser.flash = false;
        onEnd?.();
      },
    };
  }

  startBoardBus(event, game) {
    const triggerColumns = event.trigger_columns ?? [318, 324, 330];
    const enemies = event.goomba_ids.map((id) => game.enemies.byId(id));
    this.startTimeline(game, event, [
      this.pathStep(this.x(305), this.anchorY(game, 13), .72, 96, null, () => {
        this.removeActor("waiting_baby_bus_vehicle");
        game.player.setForm(PlayerForm.BABY_BUS);
      }),
      ...triggerColumns.flatMap((column, index) => [
        this.pathStep(this.x(column), this.anchorY(game, 13), .45, 0, `wedding_baby_bus_drive_${index % 2 ? "b" : "a"}`, () => {
          const enemy = enemies[index];
          if (enemy) game.enemies.forceLaunch(enemy, 290, -150);
        }),
        this.waitStep(.16, `wedding_baby_bus_drive_${index % 2 ? "a" : "b"}`, null, () => {
          if (enemies[index]) enemies[index].state = EnemyState.REMOVED;
        }),
      ]),
      this.pathStep(this.x(335), this.anchorY(game, 13), .4, 0, "wedding_baby_bus_idle"),
      this.waitStep(.65, "wedding_baby_bus_idle", null, () => {
        game.player.setForm(PlayerForm.COUPLE);
        game.player.x = this.x(339);
        game.player.y = this.anchorY(game, 13);
      }),
    ], () => this.finishRun(event, game, "下车后，点击顶格子继续"));
    return true;
  }

  startCollectCoinJump(event, game) {
    const coin = this.collectibles.find((item) => item.id === event.coin_id);
    const ground = this.groundTop(game);
    this.startTimeline(game, event, [
      this.pathStep(coin.x, coin.y - game.player.height * .35, .5, 72, null, () => { game.collectCoin(coin); }),
      this.pathStep(coin.x + 30, ground, .48, 18),
    ], () => this.finishRun(event, game, "金币已收集"));
    return true;
  }

  startBusBattle(event, game) {
    const bowser = game.enemies.byId(event.bowser_id);
    const projectiles = [0, 1, 2].map((i) => this.actor(`bus_fire_${i}`, `attack_fire_${i}`, game.player.x, game.player.y + 10, 32, 32, { visible: false }));
    const steps = [];
    for (let i = 0; i < 3; i += 1) steps.push({ duration: .5, start: () => { projectiles[i].visible = true; }, update: (_g, t) => { projectiles[i].x = lerp(game.player.x, bowser.x, t); projectiles[i].y = lerp(game.player.y, bowser.y + 16, t); }, end: () => { projectiles[i].visible = false; } });
    steps.push(this.waitStep(.4, null, () => { bowser.state = EnemyState.DYING; bowser.deathVx = 0; bowser.deathVy = 0; bowser.flash = true; }, () => {
      bowser.state = EnemyState.REMOVED;
      projectiles.forEach((projectile) => this.removeActor(projectile.id));
      game.player.setForm(PlayerForm.BABY_BUS);
      game.snapPlayerToSurface();
    }));
    for (const enemyId of event.goomba_ids) {
      const enemy = game.enemies.byId(enemyId);
      steps.push(this.pathStep(enemy.x, () => this.groundTop(game), .45, 0, "wedding_baby_bus_drive_a", () => game.enemies.forceLaunch(enemy, 260, -170)));
      steps.push(this.waitStep(.18, "wedding_baby_bus_drive_b", null, () => { enemy.state = EnemyState.REMOVED; }));
    }
    this.startTimeline(game, event, steps, () => this.finishRun(event, game, "宝宝巴士一路向前")); return true;
  }

  startProposal(event, game) {
    const block = game.questionBlocks.byId(event.target_id); this.activateBlocks(game, [event.target_id]);
    const heart = this.actor("proposal_heart", "heart_red", game.player.x + 48, game.player.y - 30, 32, 32, { visible: false });
    game.player.width = 96;
    this.startTimeline(game, event, [
      this.pathStep(block.x, block.y + 32, .5, 0),
      this.pathStep(this.x(event.anchor?.[0] ?? 357), this.config.map.ground_y - game.player.height, .46, 0),
      this.waitStep(.8, "proposal_offer_flower"),
      this.waitStep(.8, "proposal_kneel_hold_hand"),
      this.waitStep(.95, "proposal_present_ring", () => { heart.visible = true; }),
      this.waitStep(1.0, "proposal_celebrate_petals"),
    ], () => { heart.visible = false; game.player.setForm(PlayerForm.COUPLE); game.player.width = 64; this.finishRun(event, game, "求婚成功，一起奔向未来"); }); return true;
  }

  startShowerGallery(event, game) {
    this.activateBlocks(game, event.block_ids);
    const shower = this.actor("coin_heart_shower", "coin_heart_shower_00", 0, 0, 384, 224, { screenSpace: true });
    this.startTimeline(game, event, [
      this.pathStep(this.x(371), 192, .62, 90),
      { duration: 1.5, start: () => {}, update: (_g, t) => { shower.frame = `coin_heart_shower_${String(Math.min(11, Math.floor(t * 12))).padStart(2, "0")}`; shower.x = game.renderer.viewport.width / 2 - 192; shower.y = game.renderer.viewport.height / 2 - 112; }, end: () => this.removeActor("coin_heart_shower") },
      this.pathStep(this.x(373), this.groundTop(game), .5, 20),
    ], () => this.showGallery(event, game)); return true;
  }

  startSplitDeparture(event, game) {
    game.player.setForm(PlayerForm.BIG);
    const bride = this.actor("departing_bride", "bride_walk_a", game.player.x, this.config.map.ground_y - 48, 32, 48);
    this.startTimeline(game, event, [
      { duration: .62, start: () => { bride.frame = "bride_jump"; }, update: (_g, t) => {
        bride.x = lerp(game.player.x, game.player.x + 48, t);
        bride.y = this.config.map.ground_y - 48 - Math.sin(Math.PI * t) * 52;
      } },
      { duration: 1.35, start: (_g, step) => { step.fromX = bride.x; }, update: (_g, t) => {
        bride.frame = `bride_walk_${Math.floor(t * 12) % 2 ? "b" : "a"}`;
        bride.x = lerp(game.player.x + 48, game.camera.x + game.renderer.viewport.width + 96, t);
        bride.y = this.config.map.ground_y - 48;
      }, end: () => { bride.visible = false; } },
    ], () => this.finishRun(event, game, "新娘先行，新郎继续攀登")); return true;
  }

  startStairPhoto(event, game) {
    const targetY = event.landing[1] * 32 - game.player.height;
    const block = game.questionBlocks.byId(event.target_id);
    this.startTimeline(game, event, [this.pathStep(this.x(event.landing[0]), targetY, .48, 50, null, () => {
      if (block) this.activateBlocks(game, [event.target_id]);
    })], () => this.showGallery(event, game, () => this.finishAtNextStop(event, game, "照片收好，点击登上下一阶"))); return true;
  }

  startHeartHold(event, game) {
    this.holdElapsed = 0;
    this.script = { kind: "heart_hold", event };
    game.player.setState(PlayerState.SCRIPTED);
    game.status("长按三秒，让红心完整显现");
    return true;
  }

  updateHeartHold(game, dt) {
    if (!game.input.isDown) { this.holdElapsed = 0; return true; }
    this.holdElapsed = Math.min(3, this.holdElapsed + dt);
    const index = this.holdElapsed < .75 ? "30" : this.holdElapsed < 1.5 ? "50" : this.holdElapsed < 2.25 ? "80" : "100";
    let heart = this.actors.find((actor) => actor.id === "final_heart");
    if (!heart) heart = this.actor("final_heart", `heart_red_96_reveal_${index}`, 0, 0, 96, 96, { screenSpace: true });
    heart.frame = `heart_red_96_reveal_${index}`;
    heart.x = game.renderer.viewport.width / 2 - 48;
    heart.y = game.renderer.viewport.height / 2 - 48;
    if (this.holdElapsed < 3) return true;
    this.removeActor("final_heart");
    const event = this.script.event;
    this.script = null;
    this.startFinale(event, game);
    return true;
  }

  startFinale(event, game) {
    const flagX = this.x(404);
    game.player.setForm(PlayerForm.BIG);
    const bride = this.actor("final_bride", "bride_idle", this.x(413), this.config.map.ground_y - 48, 32, 48, { flipX: true, visible: false });
    const firework = this.actor("final_firework", "firework_orange_small", 0, 0, 32, 32, { screenSpace: true, visible: false });
    const fireworkWorld = this.actor("final_firework_world", "firework_orange_small", this.x(413), 5 * 32 - 32, 32, 32, { visible: false });
    this.startTimeline(game, event, [
      // The finale is deliberately paced by the preceding three-second heart
      // hold, so it keeps its authored one-second flight instead of adopting
      // the general height-based jump-duration rule.
      this.pathStep(flagX, this.anchorY(game, 7), 1.0, 130, null, null, { dynamicDuration: false }),
      { duration: .92, start: (_game, step) => {
        step.fromY = game.player.y;
        game.player.frameOverride = "groom_big_jump";
        game.audio.play("flagship");
      }, update: (_g, t) => {
        game.player.x = this.x(405);
        game.player.y = lerp(this.script.step.fromY, this.anchorY(game, 13), ease(t));
        game.counter.set(String(Math.round(9999 + (20261005 - 9999) * t)));
      } },
      { duration: .9, start: () => { bride.visible = true; }, update: (_g, t) => { game.player.frameOverride = this._walkFrame(game.player, Math.floor(t * 8) % 2 === 1); game.player.x = lerp(this.x(405), bride.x, t); }, end: () => { bride.visible = false; } },
      this.waitStep(.8, "couple_heart_pose", () => { game.player.setForm(PlayerForm.COUPLE); game.player.width = 96; }),
      this.waitStep(.8, "couple_embrace_heart"),
      this.waitStep(1.2, "wedding_kiss", () => {
        game.player.width = 48;
        game.audio.beginFireworks();
        firework.visible = true;
        fireworkWorld.visible = true;
        firework.x = game.renderer.viewport.width / 2 - 48;
        firework.y = 60;
      }),
      { duration: 1.5, start: () => {}, update: (_g, t) => {
        const frame = t < .33 ? "firework_orange_small" : t < .66 ? "firework_orange_medium" : "firework_orange_large";
        const size = t < .33 ? 32 : t < .66 ? 64 : 96;
        for (const item of [firework, fireworkWorld]) { item.frame = frame; item.width = item.height = size; }
      } },
    ], () => {
      this.complete(event); game.counter.set("20261005"); game.player.setState(PlayerState.LEVEL_COMPLETE); game.status("我们的故事，未完待续");
    });
  }

  finishRun(event, game, message) {
    this.complete(event);
    game.player.frameOverride = null;
    game.snapPlayerToSurface();
    game.player.startAutoRun();
    game.status(message);
  }

  finishAtNextStop(event, game, message) {
    this.complete(event);
    game.player.frameOverride = null;
    game.player.activeStop = null;
    game.player.startAutoRun();
    game.status(message);
  }
}
