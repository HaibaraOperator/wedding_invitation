const MEDIA_REVISION = "20260903-1";

const versionedMediaUrl = (path, retry = 0) => {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}media_v=${MEDIA_REVISION}${retry ? `&photo_retry=${retry}` : ""}`;
};

export class PhotoSystem {
  constructor(photoConfigs, galleryConfigs, elements, counter) {
    this.photos = new Map(photoConfigs.map((photo) => [photo.id, photo]));
    this.elements = elements;
    this.galleries = new Map((galleryConfigs ?? []).map((gallery) => [gallery.id, gallery]));
    this.counter = counter;
    this.pending = null;
    this.prepareTimer = 0;
    this.visible = false;
    this.canCloseAt = Infinity;
    this.unlockedPhotoIds = new Set();
    this.fullText = "";
    this.visibleCharacters = 0;
    this.typewriterCps = 14;
    this.mode = "single";
    this.gallery = null;
    this.galleryIndex = 0;
    this.staticGalleryCaption = false;
    this.gestureStartX = null;
    this.preloadPlan = [];
    this.stagedPaths = new Set();
    this.pathPromises = new Map();
    this.pathImages = new Map();
    this.loadQueue = [];
    this.loadWorkers = 0;
    this.maxLoadWorkers = 2;
    this.loading = false;
    this.loadFailed = false;
    this.loadToken = 0;
    this.activeMedia = null;
  }

  configurePreloadPlan(config) {
    const galleryById = new Map((config.galleries ?? []).map((gallery) => [gallery.id, gallery]));
    const blockById = new Map((config.question_blocks ?? []).map((block) => [block.id, block]));
    this.preloadPlan = (config.story_events ?? []).flatMap((event) => {
      const gallery = galleryById.get(event.gallery_id);
      if (gallery) {
        return [{ x: Number(event.stop_x ?? 0), paths: gallery.photos.map((photo) => photo.photo_path), staged: false }];
      }
      const block = blockById.get(event.target_id);
      const photo = block?.photo_id ? this.photos.get(block.photo_id) : null;
      return photo ? [{ x: Number(event.stop_x ?? 0), paths: [photo.photo_path], staged: false }] : [];
    });
  }

  primeUpcoming() {
    if (!this.preloadPlan.length) return;
    const firstX = this.preloadPlan[0].x;
    const paths = this.preloadPlan
      .filter((entry) => entry.x <= firstX + 384)
      .flatMap((entry) => {
        entry.staged = true;
        return entry.paths;
      });
    this.stagePaths(paths);
  }

  // Kept as a compatibility alias. It intentionally primes only the first
  // nearby event instead of downloading an entire chapter's photo library.
  warmAllInBackground() {
    this.primeUpcoming();
  }

  updateWorldPosition(visibleRightX) {
    for (const entry of this.preloadPlan) {
      if (entry.staged || entry.x > visibleRightX + 1280) continue;
      entry.staged = true;
      this.stagePaths(entry.paths);
    }
  }

  stagePaths(paths, { priority = false } = {}) {
    if (typeof Image !== "function") return Promise.resolve([]);
    return Promise.all((paths ?? []).filter(Boolean).map((path) => {
      this.stagedPaths.add(path);
      return this.loadPath(path, { priority });
    }));
  }

  loadPath(path, { priority = false } = {}) {
    if (this.pathImages.has(path)) return Promise.resolve(this.pathImages.get(path));
    if (this.pathPromises.has(path)) {
      if (priority) {
        const queuedIndex = this.loadQueue.findIndex((task) => task.path === path);
        if (queuedIndex > 0) this.loadQueue.unshift(this.loadQueue.splice(queuedIndex, 1)[0]);
      }
      return this.pathPromises.get(path);
    }
    const promise = new Promise((resolve) => {
      const task = { path, resolve };
      if (priority) this.loadQueue.unshift(task);
      else this.loadQueue.push(task);
      this.pumpLoadQueue();
    });
    this.pathPromises.set(path, promise);
    return promise;
  }

  pumpLoadQueue() {
    while (this.loadWorkers < this.maxLoadWorkers && this.loadQueue.length) {
      const task = this.loadQueue.shift();
      this.loadWorkers += 1;
      this.loadPathWithRetry(task.path).then((image) => {
        if (image) this.pathImages.set(task.path, image);
        else this.pathPromises.delete(task.path);
        task.resolve(image);
      }).finally(() => {
        this.loadWorkers -= 1;
        this.pumpLoadQueue();
      });
    }
  }

  async loadPathWithRetry(path, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const image = new Image();
      image.decoding = "async";
      image.loading = "eager";
      const source = versionedMediaUrl(path, attempt);
      const loaded = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 45000);
        image.onload = () => { clearTimeout(timer); resolve(true); };
        image.onerror = () => { clearTimeout(timer); resolve(false); };
        image.src = source;
      });
      if (loaded) {
        await image.decode?.().catch(() => {});
        return image;
      }
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    return null;
  }

  get(id) {
    return this.photos.get(id) ?? null;
  }

  setPending(photo) {
    this.pending = photo;
  }

  prepareAfterLanding(delay = 0.18) {
    this.prepareTimer = delay;
  }

  update(dt) {
    if (!this.pending || this.visible || this.prepareTimer <= 0) return false;
    this.prepareTimer -= dt;
    if (this.prepareTimer <= 0) {
      this.show(this.pending);
      return true;
    }
    return false;
  }

  show(photo) {
    this.mode = "single";
    this.gallery = null;
    this.activeMedia = photo;
    this.elements.single.hidden = false;
    this.elements.gallery.hidden = true;
    this.elements.card.classList.remove("gallery-mode");
    this.visible = true;
    this.loading = true;
    this.loadFailed = false;
    const token = ++this.loadToken;
    this.unlockedPhotoIds.add(photo.id);
    this.elements.title.textContent = photo.title ?? "";
    this.elements.image.removeAttribute?.("src");
    this.elements.image.style.objectFit = photo.fit ?? "contain";
    this.fullText = photo.text ?? photo.caption ?? "再次点击继续";
    this.visibleCharacters = 0;
    this.typewriterCps = Math.max(1, Number(photo.typewriter_cps ?? 14));
    this.elements.caption.textContent = "照片载入中…";
    this.elements.card.classList.add("is-loading");
    this.elements.modal.hidden = false;
    this.canCloseAt = Infinity;
    if (typeof Image !== "function") {
      this.elements.image.src = photo.photo_path;
      this.finishMediaLoad();
      if (photo.days_together !== null && photo.days_together !== undefined) {
        this.counter.set(photo.days_together);
      }
      return;
    }
    this.stagePaths([photo.photo_path], { priority: true }).then(([image]) => {
      if (token !== this.loadToken || !this.visible) return;
      if (!image) { this.finishLoadError(); return; }
      this.elements.image.src = image.currentSrc || image.src;
      this.elements.image.alt = photo.alt ?? "婚纱照";
      this.finishMediaLoad();
      if (photo.days_together !== null && photo.days_together !== undefined) {
        this.counter.set(photo.days_together);
      }
    });
  }

  showGallery(gallery) {
    if (!gallery) throw new Error("轮播照片配置不存在");
    this.mode = "gallery";
    this.gallery = gallery;
    this.activeMedia = gallery;
    this.galleryIndex = 0;
    const captions = gallery.photos.map((photo) => String(photo.caption ?? gallery.text ?? ""));
    this.staticGalleryCaption = captions.length > 1
      && captions.every((caption) => caption === captions[0]);
    this.visible = true;
    this.loading = true;
    this.loadFailed = false;
    const token = ++this.loadToken;
    this.pending = null;
    this.elements.single.hidden = true;
    this.elements.gallery.hidden = false;
    this.elements.card.classList.add("gallery-mode");
    this.elements.card.classList.add("is-loading");
    this.elements.title.textContent = gallery.title ?? "";
    this.fullText = gallery.text ?? "";
    this.visibleCharacters = 0;
    this.typewriterCps = Math.max(1, Number(gallery.typewriter_cps ?? 14));
    this.elements.caption.textContent = "照片载入中…";
    this.elements.modal.hidden = false;
    this.canCloseAt = Infinity;
    if (typeof Image !== "function") {
      this.finishMediaLoad();
      this.renderGallery();
      return;
    }
    const paths = gallery.photos.map((photo) => photo.photo_path);
    this.stagePaths(paths, { priority: true }).then((images) => {
      if (token !== this.loadToken || !this.visible) return;
      if (images.some((image) => !image)) { this.finishLoadError(); return; }
      this.finishMediaLoad();
      this.renderGallery();
    });
  }

  finishMediaLoad() {
    this.loading = false;
    this.loadFailed = false;
    this.visibleCharacters = 0;
    this.elements.caption.textContent = "";
    this.elements.card.classList.remove("is-loading");
    this.canCloseAt = performance.now() + 360;
  }

  finishLoadError() {
    this.loading = false;
    this.loadFailed = true;
    this.elements.card.classList.remove("is-loading");
    this.elements.caption.textContent = "照片载入失败，请检查网络后轻触重试";
    this.canCloseAt = Infinity;
  }

  retryActiveMedia() {
    if (!this.loadFailed || !this.activeMedia) return;
    const active = this.activeMedia;
    for (const path of this.mode === "gallery"
      ? active.photos.map((photo) => photo.photo_path)
      : [active.photo_path]) {
      this.pathPromises.delete(path);
      this.pathImages.delete(path);
    }
    if (this.mode === "gallery") this.showGallery(active);
    else this.show(active);
  }

  renderGallery() {
    if (!this.gallery) return;
    const photos = this.gallery.photos;
    const count = photos.length;
    const centeredPhoto = photos[this.galleryIndex];
    if (centeredPhoto.counter_value !== null && centeredPhoto.counter_value !== undefined) {
      this.counter.set(centeredPhoto.counter_value);
    }
    while (this.elements.galleryImages.length < count) {
      const image = document.createElement("img");
      image.className = "gallery-photo";
      this.elements.gallery.insertBefore(image, this.elements.galleryDots);
      this.elements.galleryImages.push(image);
    }
    this.elements.galleryImages.forEach((image, index) => {
      if (index >= count) { image.hidden = true; return; }
      image.hidden = false;
      const relative = (index - this.galleryIndex + count) % count;
      const position = relative === 0 ? "center" : relative === 1 ? "right" : "left";
      const cached = this.pathImages.get(photos[index].photo_path);
      image.src = cached?.currentSrc || cached?.src || versionedMediaUrl(photos[index].photo_path);
      image.alt = photos[index].alt ?? `照片 ${index + 1}`;
      image.dataset.position = position;
      image.style.zIndex = position === "center" ? "3" : "1";
    });
    this.fullText = centeredPhoto.caption ?? this.gallery.text ?? "";
    if (this.staticGalleryCaption) {
      // A gallery with one shared caption displays it once and leaves it in
      // place while the viewer swipes or autoplay advances between photos.
      this.visibleCharacters = this.fullText.length;
      this.elements.caption.textContent = this.fullText;
    } else {
      this.visibleCharacters = 0;
      this.elements.caption.textContent = "";
    }
    this.elements.galleryDots.textContent = photos
      .map((_, index) => (index === this.galleryIndex ? "●" : "○"))
      .join("  ");
  }

  beginGalleryGesture(clientX) {
    this.gestureStartX = Number(clientX);
  }

  endGalleryGesture(clientX, now = performance.now()) {
    if (this.mode !== "gallery" || !this.gallery) return "none";
    if (this.loading || this.loadFailed) {
      if (this.loadFailed) this.retryActiveMedia();
      return "none";
    }
    const start = this.gestureStartX;
    this.gestureStartX = null;
    if (!Number.isFinite(start)) return "none";
    const delta = Number(clientX) - start;
    if (Math.abs(delta) >= 44) {
      const count = this.gallery.photos.length;
      this.galleryIndex = (this.galleryIndex + (delta < 0 ? 1 : -1) + count) % count;
      this.renderGallery();
      this.canCloseAt = now + 180;
      return "navigate";
    }
    return now >= this.canCloseAt ? "close" : "none";
  }

  updateModal(dt) {
    if (!this.visible || this.loading || this.loadFailed || this.visibleCharacters >= this.fullText.length) return;
    this.visibleCharacters = Math.min(
      this.fullText.length,
      this.visibleCharacters + this.typewriterCps * dt,
    );
    this.elements.caption.textContent = this.fullText.slice(
      0,
      Math.floor(this.visibleCharacters),
    );
  }

  canClose(now = performance.now()) {
    if (this.loadFailed) {
      this.retryActiveMedia();
      return false;
    }
    return this.visible && now >= this.canCloseAt;
  }

  close() {
    if (!this.visible) return null;
    const closed = this.mode === "gallery" ? this.gallery : this.pending;
    this.visible = false;
    this.loading = false;
    this.loadFailed = false;
    this.loadToken += 1;
    this.activeMedia = null;
    this.pending = null;
    this.prepareTimer = 0;
    this.fullText = "";
    this.visibleCharacters = 0;
    this.elements.modal.hidden = true;
    this.elements.image.removeAttribute("src");
    this.elements.card.classList.remove("gallery-mode");
    this.elements.card.classList.remove("is-loading");
    this.elements.gallery.hidden = true;
    this.elements.single.hidden = false;
    this.mode = "single";
    this.gallery = null;
    this.staticGalleryCaption = false;
    this.gestureStartX = null;
    return closed;
  }
}
