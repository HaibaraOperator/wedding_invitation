import { INPUT, PlayerState } from "./constants.js";

const ACTION_DELAY = 0.38;
const NORMAL_HOLD = 0.46;
// Leave several frames of margin after the authored three-second threshold so
// the release event can never race updateHeartHold on a low-refresh device.
const HEART_HOLD = 3.35;
const PHOTO_SECONDS = 3;

/**
 * Supplies the same input messages as a viewer, but only when the authored
 * state machine is waiting for one.  Story/physics code therefore stays
 * shared with the interactive version and the two modes cannot drift apart.
 */
export class AutoPlayController {
  constructor({ photoSeconds = PHOTO_SECONDS, onComplete = null } = {}) {
    this.photoSeconds = Math.max(0.1, Number(photoSeconds) || PHOTO_SECONDS);
    this.onComplete = onComplete;
    this.state = null;
    this.actionDelay = ACTION_DELAY;
    this.holdRemaining = 0;
    this.mediaElapsed = 0;
    this.lastGalleryIndex = -1;
    this.completionSent = false;
    this.retryElapsed = 0;
  }

  resetForState(state) {
    this.state = state;
    this.actionDelay = ACTION_DELAY;
    this.mediaElapsed = 0;
    this.lastGalleryIndex = -1;
    this.retryElapsed = 0;
  }

  emit(game, type) {
    game.input.emit(type, {
      clientX: game.renderer?.viewport?.width / 2 || 0,
      autoplay: true,
    });
  }

  beginAutomaticPress(game) {
    const action = game.player.activeStop?.storyEvent?.action;
    this.holdRemaining = action === "heart_finale" ? HEART_HOLD : NORMAL_HOLD;
    this.emit(game, INPUT.DOWN);
    this.actionDelay = Infinity;
  }

  updateMedia(dt, game) {
    const photos = game.photoSystem;
    if (photos.loadFailed) {
      this.retryElapsed += dt;
      if (this.retryElapsed >= 1.5) {
        this.retryElapsed = 0;
        photos.retryActiveMedia();
      }
      return;
    }
    if (photos.loading || !photos.visible) return;

    if (game.player.state === PlayerState.PHOTO_MODAL) {
      this.mediaElapsed += dt;
      if (this.mediaElapsed >= this.photoSeconds) {
        this.mediaElapsed = 0;
        game.closePhotoAndResume();
      }
      return;
    }

    if (photos.galleryIndex !== this.lastGalleryIndex) {
      this.lastGalleryIndex = photos.galleryIndex;
      this.mediaElapsed = 0;
    }
    this.mediaElapsed += dt;
    if (this.mediaElapsed < this.photoSeconds) return;

    const count = photos.gallery?.photos?.length ?? 0;
    if (photos.galleryIndex < count - 1) {
      photos.galleryIndex += 1;
      photos.renderGallery();
      this.lastGalleryIndex = photos.galleryIndex;
      this.mediaElapsed = 0;
      return;
    }

    photos.close();
    game.story.finishGallery(game);
    this.mediaElapsed = 0;
  }

  update(dt, game) {
    const state = game.player.state;
    if (state !== this.state) this.resetForState(state);

    if (this.holdRemaining > 0) {
      this.holdRemaining -= dt;
      if (this.holdRemaining <= 0) {
        this.holdRemaining = 0;
        this.emit(game, INPUT.UP);
      }
    }

    if ([PlayerState.PHOTO_MODAL, PlayerState.GALLERY_MODAL].includes(state)) {
      this.updateMedia(dt, game);
      return;
    }

    if (state === PlayerState.LEVEL_COMPLETE) {
      if (!this.completionSent) {
        this.completionSent = true;
        this.onComplete?.(game);
      }
      return;
    }

    if (game.cinematics?.active || this.holdRemaining > 0) return;
    if (![PlayerState.IDLE, PlayerState.KISS_WAIT, PlayerState.SPLIT_WAIT].includes(state)) return;

    // A photo block briefly returns the player to IDLE before its modal opens.
    // Waiting here prevents an artificial click from re-triggering the block.
    if (game.player.pendingPhoto || game.photoSystem.prepareTimer > 0) return;

    this.actionDelay -= dt;
    if (this.actionDelay <= 0) this.beginAutomaticPress(game);
  }
}
