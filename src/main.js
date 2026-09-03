import { ASSET_PATHS } from "./constants.js";
import { AssetLoader } from "./asset-loader.js?v=mobile-media-2";
import { CounterDisplay } from "./counter-display.js";
import { DebugOverlay } from "./debug-overlay.js";
import { GameLoop } from "./game-loop.js";
import { WeddingGame } from "./game.js";
import { InputController } from "./input-controller.js";
import { LevelConfigLoader, MapLoader } from "./level-config-loader.js";
import { PhotoSystem } from "./photo-system.js?v=mobile-media-2";
import { Renderer } from "./renderer.js";
import { AudioSystem } from "./audio-system.js?v=mobile-media-2";

const elements = {
  canvas: document.querySelector("#game-canvas"),
  counter: document.querySelector("#counter-value"),
  status: document.querySelector("#status-pill"),
  debug: document.querySelector("#debug-overlay"),
  debugToggle: document.querySelector("#debug-toggle"),
  photoModal: document.querySelector("#photo-modal"),
  photoTitle: document.querySelector("#photo-title"),
  photoImage: document.querySelector("#photo-image"),
  photoCard: document.querySelector(".photo-card"),
  singlePhoto: document.querySelector("#single-photo-content"),
  galleryStage: document.querySelector("#gallery-stage"),
  galleryImages: [...document.querySelectorAll(".gallery-photo")],
  galleryDots: document.querySelector("#gallery-dots"),
  photoCaption: document.querySelector("#photo-caption"),
  loading: document.querySelector("#loading-overlay"),
  loadingProgress: document.querySelector("#loading-progress"),
  loadingLabel: document.querySelector("#loading-label"),
};

function setProgress(completed, total) {
  const value = total > 0 ? Math.round((completed / total) * 100) : 0;
  elements.loadingProgress.value = value;
  elements.loadingLabel.textContent = `${value}%`;
}

function criticalAssetKeys(config) {
  const form = String(config.player_start?.form ?? "SMALL").toLowerCase();
  const prefix = form === "small" ? "groom_small" : form === "fire" ? "groom_fire" : "groom_big";
  return [
    "map_image",
    `${prefix}_idle`, `${prefix}_walk_a`, `${prefix}_walk_b`, `${prefix}_jump`,
    "question_block",
    "coin_0", "coin_1", "coin_2", "coin_3",
    "goomba_walk_a", "goomba_walk_b",
    "koopa_walk_a", "koopa_walk_b", "koopa_retract", "koopa_shell_idle", "koopa_shell_move",
    "piranha_open", "piranha_closed",
    "bowser_mouth_closed", "bowser_mouth_open",
    "super_mushroom", "fire_flower",
  ];
}

async function boot() {
  const query = new URLSearchParams(window.location.search);
  const requestedLevel = query.get("level") ?? "meet";
  const allowedLevels = new Set(["meet", "travel", "home"]);
  const level = allowedLevels.has(requestedLevel) ? requestedLevel : "meet";
  const config = await LevelConfigLoader.load(`./config/level.${level}.json`);
  document.title = config.ui?.document_title ?? "我们的婚礼故事";
  document.querySelector(".eyebrow").textContent = config.ui?.eyebrow ?? "OUR WEDDING JOURNEY";
  document.querySelector("h1").textContent = config.ui?.title ?? "王郅臻与梁晓媛的婚礼故事";
  document.querySelector("#game-stage").setAttribute("aria-label", config.ui?.title ?? "婚礼故事");
  document.querySelector("#loading-overlay span").textContent = config.ui?.loading_message ?? "载入婚礼故事";
  const [mapData] = await Promise.all([MapLoader.loadJson(config.map.json)]);
  const loader = new AssetLoader(setProgress);
  // 照片按弹窗需要惰性载入，避免长关卡启动时并发解码几十张大图。
  const manifest = {
    ...ASSET_PATHS,
    map_image: config.map.image,
  };
  const criticalKeys = criticalAssetKeys(config);
  // 首屏只等待地图、玩家与近场互动素材。其余小型像素图在游戏
  // 开始后以受控并发数补载，避免手机首页同时发出一百多个请求。
  await loader.loadManifest(manifest, { keys: criticalKeys, concurrency: 6, required: true });
  loader.preloadManifest(manifest, { excludeKeys: criticalKeys, concurrency: 3 });

  const counter = new CounterDisplay(elements.counter, config.counter.initial_value);
  const audio = new AudioSystem();
  audio.bindUnlock(window);
  audio.startBackground(true);
  const renderer = new Renderer(elements.canvas, loader, config.debug ?? {});
  const debugOverlay = new DebugOverlay(elements.debug, config.debug?.enabled);
  elements.debugToggle.textContent = debugOverlay.enabled ? "关闭调试" : "开启调试";
  elements.debugToggle.setAttribute("aria-pressed", String(debugOverlay.enabled));
  const input = new InputController([elements.canvas, elements.photoModal]);
  const photoSystem = new PhotoSystem(
    config.photos,
    config.galleries,
    {
      modal: elements.photoModal,
      card: elements.photoCard,
      single: elements.singlePhoto,
      title: elements.photoTitle,
      image: elements.photoImage,
      caption: elements.photoCaption,
      gallery: elements.galleryStage,
      galleryImages: elements.galleryImages,
      galleryDots: elements.galleryDots,
    },
    counter,
  );
  photoSystem.configurePreloadPlan(config);
  photoSystem.primeUpcoming();

  const game = new WeddingGame({
    config,
    mapData,
    input,
    renderer,
    counter,
    photoSystem,
    debugOverlay,
    statusElement: elements.status,
    audio,
  });
  try {
    const serializedTransition = window.sessionStorage.getItem("wedding_story_transition");
    const transfer = serializedTransition ? JSON.parse(serializedTransition) : null;
    if (transfer?.nextLevel === level && transfer.snapshot) {
      if (transfer.snapshot.form) game.player.setForm(transfer.snapshot.form);
      if (transfer.snapshot.counter_value !== undefined) counter.set(transfer.snapshot.counter_value);
      for (const photoId of transfer.snapshot.unlocked_photo_ids ?? []) {
        photoSystem.unlockedPhotoIds.add(photoId);
      }
      window.sessionStorage.removeItem("wedding_story_transition");
    }
  } catch {
    // A malformed or unavailable session store must not prevent the next
    // chapter from starting.
  }
  game.onChapterTransition = (nextLevel, snapshot) => {
    try {
      window.sessionStorage.setItem("wedding_story_transition", JSON.stringify({ nextLevel, snapshot }));
    } catch {
      // Navigation still works when storage is unavailable (for example in a
      // privacy-restricted embedded browser).
    }
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("level", nextLevel);
    nextUrl.searchParams.delete("cinematic");
    nextUrl.searchParams.set("fresh", String(Date.now()));
    window.location.assign(nextUrl);
  };
  const loop = new GameLoop((dt) => game.update(dt), () => game.render());

  elements.debugToggle.addEventListener("click", () => {
    const enabled = game.toggleDebug();
    elements.debugToggle.textContent = enabled ? "关闭调试" : "开启调试";
    elements.debugToggle.setAttribute("aria-pressed", String(enabled));
  });
  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() !== "d") return;
    const enabled = game.toggleDebug();
    elements.debugToggle.textContent = enabled ? "关闭调试" : "开启调试";
    elements.debugToggle.setAttribute("aria-pressed", String(enabled));
  });

  window.weddingGame = game;
  window.weddingLevel = level;
  window.weddingCinematics = Object.freeze({
    flightToIreland: (onComplete) => game.playCinematic("flight_to_ireland", onComplete),
    flagTrainTour: (onComplete) => game.playCinematic("flag_train_tour", onComplete),
  });
  const cinematicPreview = query.get("cinematic");
  if (["flight_to_ireland", "flag_train_tour"].includes(cinematicPreview)) {
    game.playCinematic(cinematicPreview);
  }
  elements.loading.hidden = true;
  elements.canvas.focus();
  loop.start();
}

boot().catch((error) => {
  console.error(error);
  elements.loading.hidden = false;
  elements.loading.querySelector("span").textContent = "载入失败";
  elements.loadingLabel.textContent = error.message;
  elements.loadingProgress.remove();
});
