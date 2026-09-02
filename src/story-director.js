import { EnemyState, FORM_PREFIX, PlayerForm, PlayerState } from "./constants.js";
import { lerp } from "./utils.js";

const easeInOut = (t) => t * t * (3 - 2 * t);

export class StoryDirector {
  constructor(config) {
    this.config = config;
    this.events = config.story_events.map((event) => ({ ...event, completed: false }));
    this.script = null;
    this.coinClock = 0;
    this.finalExit = false;
    this.piranhaRevealStarted = false;
    this.bride = {
      visible: false,
      x: 0,
      y: 0,
      width: 32,
      height: 48,
      frame: "bride_idle",
      flipX: false,
      behindBlocks: false,
    };
    this.collectibles = (config.collectibles ?? []).map((coin) => ({
      ...coin,
      x: (coin.column - 1) * config.map.cell_width,
      y: coin.row * config.map.cell_height - 32,
      width: 32,
      height: 32,
      active: true,
    }));
  }

  byId(id) {
    return this.events.find((event) => event.id === id) ?? null;
  }

  complete(event) {
    if (!event) return;
    event.completed = true;
  }

  completeByTarget(targetId) {
    const event = this.events.find(
      (candidate) => !candidate.completed && candidate.target_id === targetId,
    );
    this.complete(event);
  }

  eventForTarget(targetId) {
    return this.events.find(
      (candidate) => !candidate.completed && candidate.target_id === targetId,
    ) ?? null;
  }

  stopIfDue(game) {
    if (this.finalExit || game.player.state !== PlayerState.AUTO_RUN) return false;
    // Story events are authored in narrative order. Only the next incomplete
    // event may stop the player, so a wide enemy look-ahead cannot overtake a
    // preceding scripted route (notably the (51,13) coin route).
    const candidate = this.events.find((event) => !event.completed);
    if (!candidate) return false;
    const triggerX = this.triggerX(candidate, game);
    if (game.player.x < triggerX) return false;
    const stopX = Math.max(triggerX, game.player.x);
    game.player.stopAt({
      id: candidate.id,
      x: stopX,
      reason: candidate.reason,
      target_id: candidate.target_id,
      storyEvent: candidate,
    });
    game.status(candidate.prompt ?? "点击继续故事");
    return true;
  }

  triggerX(event, game) {
    const enemyActions = new Set([
      "standard_enemy", "bowser_five", "koopa_trajectory", "koopa_coin_chain",
    ]);
    if (!enemyActions.has(event.action)) return event.stop_x;
    const enemyId = event.target_id ?? event.enemy_ids?.[0];
    const enemy = game.enemies.byId(enemyId);
    if (!enemy || enemy.state === EnemyState.REMOVED) return event.stop_x;
    return Math.max(0, enemy.x - game.player.width - game.enemyDetectionPx);
  }

  beginInteraction(event, game) {
    if (!event || event.completed) return false;
    switch (event.action) {
      case "jump_block":
        game.audio.play("jump");
        game.player.startJump(game.config.movement);
        game.status("长按可以跳得更高");
        return true;
      case "standard_enemy": {
        const enemy = game.enemies.byId(event.target_id);
        if (!enemy || enemy.state !== EnemyState.ACTIVE) return false;
        game.player.currentEnemyTarget = enemy;
        game.audio.play("jump");
        game.player.startJump(game.config.movement, enemy);
        game.status("跳向蘑菇怪头顶");
        return true;
      }
      case "special_coin_route":
        this.startSpecialCoinRoute(event, game);
        return true;
      case "piranha_stomp":
        return this.startPiranhaStomp(event, game);
      case "koopa_double_stomp":
        return this.startKoopaDoubleStomp(event, game);
      case "coin_gauntlet":
        this.startCoinGauntlet(event, game);
        return true;
      case "photo_gallery":
        game.photoSystem.showGallery(game.config.galleries.find((item) => item.id === event.gallery_id));
        game.player.setState(PlayerState.GALLERY_MODAL);
        game.status("左右滑动浏览照片，轻触关闭");
        return true;
      default:
        throw new Error(`未知故事动作：${event.action}`);
    }
  }

  updateAmbient(game, dt) {
    this.coinClock += dt;
    const reveal = game.config.piranha_reveal;
    if (reveal && !this.piranhaRevealStarted) {
      const triggerX = (reveal.trigger_column - 1) * game.config.map.cell_width;
      if (game.camera.x + game.renderer.viewport.width >= triggerX) {
        this.piranhaRevealStarted = true;
        game.enemies.revealPiranha(game.enemies.byId(reveal.enemy_id));
      }
    }
    if (this.finalExit && game.player.x > game.config.map.width + 72) {
      this.finalExit = false;
      game.finishLevel("第一段故事完成");
    }
  }

  coinFrameKey() {
    return `coin_${Math.floor(this.coinClock / 0.1) % 4}`;
  }

  _jumpFrame(player) {
    return `${FORM_PREFIX[player.form]}_jump`;
  }

  _walkFrame(player, alternate = false) {
    return `${FORM_PREFIX[player.form]}_walk_${alternate ? "b" : "a"}`;
  }

  _startPath(game, event, phases, onComplete) {
    game.player.setState(PlayerState.SCRIPTED);
    game.player.vx = 0;
    game.player.vy = 0;
    this.script = {
      kind: "path",
      event,
      phases: phases.map((phase) => ({
        ...phase,
        duration: phase.duration / Math.max(1, Number(game.config.movement.jump_speed_multiplier ?? 1)),
      })),
      current: null,
      elapsed: 0,
      onComplete,
    };
  }

  _updatePath(game, dt) {
    const script = this.script;
    if (!script.current) {
      script.current = script.phases.shift();
      script.elapsed = 0;
      if (!script.current) {
        this.script = null;
        script.onComplete?.();
        return false;
      }
      script.current.fromX = game.player.x;
      script.current.fromY = game.player.y;
      const isJump = script.current.sound !== false
        && (script.current.sound === true
          || script.current.toY < script.current.fromY - 4
          || (script.current.arc ?? 0) >= 40);
      if (isJump) game.audio.play("jump");
    }
    const phase = script.current;
    script.elapsed += dt;
    const t = Math.min(1, script.elapsed / phase.duration);
    const eased = easeInOut(t);
    game.player.x = lerp(phase.fromX, phase.toX, eased);
    game.player.y = lerp(phase.fromY, phase.toY, eased) - Math.sin(Math.PI * t) * (phase.arc ?? 0);
    game.player.frameOverride = phase.frame ?? this._jumpFrame(game.player);
    if (t >= 1) {
      game.player.x = phase.toX;
      game.player.y = phase.toY;
      phase.onArrive?.();
      script.current = null;
    }
    return true;
  }

  update(game, dt) {
    if (!this.script) return false;
    if (this.script.kind === "path") return this._updatePath(game, dt);
    if (this.script.kind === "bride") return this._updateBride(game, dt);
    return false;
  }

  startSpecialCoinRoute(event, game) {
    const block = game.questionBlocks.byId(event.target_id);
    const waypointX = (event.waypoint.column - 1) * game.config.map.cell_width;
    const waypointY = event.waypoint.row * game.config.map.cell_height - game.player.height;
    const ledgeX = (event.ledge_landing.column - 1) * game.config.map.cell_width;
    const ledgeY = event.ledge_landing.row * game.config.map.cell_height - game.player.height;
    const landingX = (event.ground_landing.column - 1) * game.config.map.cell_width;
    const groundY = game.config.map.ground_y - game.player.height;
    this._startPath(
      game,
      event,
      [
        { toX: waypointX, toY: waypointY, duration: 0.72, arc: 92 },
        {
          toX: block.x,
          toY: block.y + block.height,
          duration: 0.62,
          arc: 0,
          onArrive: () => {
            game.activateBlock(block);
            game.powerups.spawnCoin(block);
            game.status("金币从问号格子中弹出");
          },
        },
        { toX: ledgeX, toY: ledgeY, duration: 0.42, arc: 0, sound: false },
        {
          toX: landingX,
          toY: groundY,
          duration: 0.78,
          arc: 0,
          sound: false,
          frame: this._walkFrame(game.player),
        },
      ],
      () => {
        this.complete(event);
        game.player.frameOverride = null;
        game.player.startAutoRun();
        game.status("继续向前");
      },
    );
  }

  startPiranhaStomp(event, game) {
    const enemy = game.enemies.byId(event.target_id);
    if (!enemy || enemy.state !== EnemyState.ACTIVE) {
      game.status("食人花正在从管道中升起…");
      return false;
    }
    const groundY = game.config.map.ground_y - game.player.height;
    this._startPath(
      game,
      event,
      [
        {
          toX: enemy.x,
          toY: enemy.y - game.player.height,
          duration: 0.72,
          arc: 132,
          onArrive: () => {
            game.audio.play("tap");
            game.enemies.forceLaunch(enemy, 245, -145);
          },
        },
        { toX: enemy.x + 96, toY: groundY, duration: 0.64, arc: 22 },
      ],
      () => {
        this.complete(event);
        game.player.frameOverride = null;
        game.player.startAutoRun();
        game.status("食人花被踩飞，继续前进");
      },
    );
    return true;
  }

  startKoopaDoubleStomp(event, game) {
    const enemy = game.enemies.byId(event.target_id);
    if (!enemy || enemy.state !== EnemyState.ACTIVE) return false;
    const targetY = enemy.y - game.player.height;
    const groundY = game.config.map.ground_y - game.player.height;
    this._startPath(
      game,
      event,
      [
        {
          toX: enemy.x,
          toY: targetY,
          duration: 0.68,
          arc: 112,
          onArrive: () => {
            game.audio.play("tap");
            game.enemies.retractKoopa(enemy);
            game.status("第一次踩踏：乌龟缩入壳中");
          },
        },
        {
          toX: enemy.x,
          toY: targetY,
          duration: 0.64,
          arc: 88,
          onArrive: () => {
            game.audio.play("tap");
            game.enemies.forceLaunch(enemy, 300, -28);
          },
        },
        { toX: enemy.x + 88, toY: groundY, duration: 0.58, arc: 16 },
      ],
      () => {
        this.complete(event);
        game.player.frameOverride = null;
        game.player.startAutoRun();
        game.status("第二次踩踏：龟壳飞出画面");
      },
    );
    return true;
  }

  startCoinGauntlet(event, game) {
    const groundY = game.config.map.ground_y - game.player.height;
    const phases = [];
    for (let index = 0; index < event.enemy_ids.length; index += 1) {
      const enemy = game.enemies.byId(event.enemy_ids[index]);
      const coin = this.collectibles.find((item) => item.id === event.coin_ids[index]);
      phases.push({
        toX: enemy.x,
        toY: enemy.y - game.player.height,
        duration: 0.56,
        arc: index === 0 ? 105 : 72,
        onArrive: () => {
          game.audio.play("tap");
          game.enemies.forceLaunch(enemy, 150, -190);
        },
      });
      phases.push({
        toX: coin.x,
        toY: coin.y - game.player.height * 0.35,
        duration: 0.58,
        arc: 96,
        onArrive: () => { game.collectCoin(coin); },
      });
    }
    const lastCoin = this.collectibles.find(
      (item) => item.id === event.coin_ids[event.coin_ids.length - 1],
    );
    phases.push({
      toX: lastCoin.x + 96,
      toY: groundY,
      duration: 0.76,
      arc: 16,
    });
    this._startPath(game, event, phases, () => {
      this.complete(event);
      game.player.frameOverride = null;
      game.player.startAutoRun();
      game.status("连续踩踏与金币路线完成");
    });
  }

  beginBrideSequence(event, block, game) {
    const destinationX = (event.bride_destination.column - 1) * game.config.map.cell_width;
    const groundY = game.config.map.ground_y;
    game.player.y = groundY - game.player.height;
    game.player.vx = 0;
    game.player.vy = 0;
    game.player.setState(PlayerState.SCRIPTED);
    game.player.frameOverride = `${FORM_PREFIX[game.player.form]}_idle`;
    this.bride.visible = true;
    this.bride.behindBlocks = true;
    this.bride.flipX = true;
    this.bride.frame = "bride_idle";
    this.bride.x = block.x;
    this.bride.y = block.y + block.height;
    this.script = {
      kind: "bride",
      event,
      block,
      destinationX,
      destinationY: groundY - this.bride.height,
      stage: "emerge",
      elapsed: 0,
      duration: 0.72,
      startX: this.bride.x,
      startY: this.bride.y,
      targetX: block.x,
      targetY: block.y - this.bride.height,
    };
    game.status("新娘从问号格子中出现");
  }

  _updateBride(game, dt) {
    const script = this.script;
    script.elapsed += dt;
    const t = Math.min(1, script.elapsed / script.duration);
    const eased = easeInOut(t);
    if (script.stage === "emerge" || script.stage === "bride_move") {
      this.bride.x = lerp(script.startX, script.targetX, eased);
      this.bride.y = lerp(script.startY, script.targetY, eased)
        - (script.stage === "bride_move" ? Math.sin(Math.PI * t) * 42 : 0);
      this.bride.frame = script.stage === "emerge"
        ? "bride_idle"
        : `bride_walk_${Math.floor(script.elapsed / 0.14) % 2 === 0 ? "a" : "b"}`;
    } else if (script.stage === "groom_move") {
      game.player.x = lerp(script.startX, script.targetX, eased);
      game.player.y = script.targetY;
      game.player.frameOverride = this._walkFrame(game.player, Math.floor(script.elapsed / 0.14) % 2 === 1);
    }
    if (t < 1) return true;

    if (script.stage === "emerge") {
      script.stage = "bride_move";
      script.elapsed = 0;
      script.duration = 1.15;
      script.startX = this.bride.x;
      script.startY = this.bride.y;
      script.targetX = script.destinationX;
      script.targetY = script.destinationY;
      this.bride.behindBlocks = false;
      return true;
    }
    if (script.stage === "bride_move") {
      this.bride.x = script.destinationX;
      this.bride.y = script.destinationY;
      this.bride.frame = "bride_idle";
      script.stage = "groom_move";
      script.elapsed = 0;
      script.duration = 0.62;
      script.startX = game.player.x;
      script.startY = game.player.y;
      script.targetX = script.destinationX;
      script.targetY = game.config.map.ground_y - game.player.height;
      game.status("新郎走向等待中的新娘");
      return true;
    }

    this.bride.visible = false;
    game.player.setForm(PlayerForm.COUPLE);
    game.player.x = script.destinationX;
    game.player.y = game.config.map.ground_y - game.player.height;
    game.player.frameOverride = "wedding_kiss";
    game.player.setState(PlayerState.KISS_WAIT);
    this.script = null;
    game.status("亲吻时刻 · 再次点击共同出发");
    return false;
  }

  continueAfterKiss(game) {
    const event = game.player.activeStop?.storyEvent;
    this.complete(event);
    game.player.frameOverride = null;
    game.player.setForm(PlayerForm.COUPLE);
    game.player.startAutoRun();
    game.status("新郎与新娘并肩前进");
  }

  finishGallery(game) {
    const event = game.player.activeStop?.storyEvent;
    const anchorX = game.player.x;
    this.bride.visible = true;
    this.bride.behindBlocks = false;
    this.bride.x = anchorX;
    this.bride.y = game.config.map.ground_y - this.bride.height;
    this.bride.frame = "bride_idle";
    this.bride.flipX = false;
    game.player.setForm(PlayerForm.BIG);
    game.player.x = anchorX + 40;
    game.player.y = game.config.map.ground_y - game.player.height;
    game.player.flipX = true;
    game.player.frameOverride = "groom_big_idle";
    game.player.setState(PlayerState.SPLIT_WAIT);
    game.player.activeStop = { ...game.player.activeStop, storyEvent: event };
    game.status("短暂分别 · 再次点击让新郎继续前行");
  }

  startFinalExit(game) {
    const event = game.player.activeStop?.storyEvent;
    this.complete(event);
    game.player.flipX = false;
    game.player.frameOverride = null;
    game.player.startAutoRun();
    game.player.setState(PlayerState.EXITING);
    this.finalExit = true;
    game.status("新郎向下一段故事出发");
  }
}
