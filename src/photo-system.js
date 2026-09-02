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
    this.gestureStartX = null;
    this.preloadPlan = [];
    this.stagedPaths = new Set();
    this.warmedPaths = new Set();
    this.warmQueue = [];
    this.warmWorkers = 0;
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

  warmAllInBackground() {
    if (typeof fetch !== "function") return;
    const paths = new Set([
      ...[...this.photos.values()].map((photo) => photo.photo_path),
      ...[...this.galleries.values()].flatMap((gallery) => gallery.photos.map((photo) => photo.photo_path)),
    ]);
    this.warmQueue.push(...[...paths].filter(Boolean));
    const start = () => {
      while (this.warmWorkers < 2 && this.warmQueue.length) this.runWarmWorker();
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: 900 });
    else setTimeout(start, 0);
  }

  async runWarmWorker() {
    const path = this.warmQueue.shift();
    if (!path) return;
    this.warmWorkers += 1;
    try {
      const response = await fetch(path, { cache: "force-cache", priority: "low" });
      if (response.ok) await response.arrayBuffer();
      this.warmedPaths.add(path);
    } catch {
      // A missing optional photo is reported when its event is actually opened.
    } finally {
      this.warmWorkers -= 1;
      if (this.warmQueue.length) this.runWarmWorker();
    }
  }

  updateWorldPosition(visibleRightX) {
    for (const entry of this.preloadPlan) {
      if (entry.staged || entry.x > visibleRightX + 320) continue;
      entry.staged = true;
      this.stagePaths(entry.paths);
    }
  }

  stagePaths(paths) {
    if (typeof Image !== "function") return;
    for (const path of paths ?? []) {
      if (!path || this.stagedPaths.has(path)) continue;
      this.stagedPaths.add(path);
      const image = new Image();
      image.decoding = "async";
      image.src = path;
      image.decode?.().catch(() => {});
    }
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
    this.stagePaths([photo.photo_path]);
    this.mode = "single";
    this.gallery = null;
    this.elements.single.hidden = false;
    this.elements.gallery.hidden = true;
    this.elements.card.classList.remove("gallery-mode");
    this.visible = true;
    this.unlockedPhotoIds.add(photo.id);
    this.elements.title.textContent = photo.title ?? "";
    this.elements.image.src = photo.photo_path;
    this.elements.image.style.objectFit = photo.fit ?? "contain";
    this.fullText = photo.text ?? photo.caption ?? "再次点击继续";
    this.visibleCharacters = 0;
    this.typewriterCps = Math.max(1, Number(photo.typewriter_cps ?? 14));
    this.elements.caption.textContent = "";
    this.elements.modal.hidden = false;
    if (photo.days_together !== null && photo.days_together !== undefined) {
      this.counter.set(photo.days_together);
    }
    this.canCloseAt = performance.now() + 280;
  }

  showGallery(gallery) {
    if (!gallery) throw new Error("轮播照片配置不存在");
    this.stagePaths(gallery.photos.map((photo) => photo.photo_path));
    this.mode = "gallery";
    this.gallery = gallery;
    this.galleryIndex = 0;
    this.visible = true;
    this.pending = null;
    this.elements.single.hidden = true;
    this.elements.gallery.hidden = false;
    this.elements.card.classList.add("gallery-mode");
    this.elements.title.textContent = gallery.title ?? "";
    this.fullText = gallery.text ?? "";
    this.visibleCharacters = 0;
    this.typewriterCps = Math.max(1, Number(gallery.typewriter_cps ?? 14));
    this.elements.caption.textContent = "";
    this.elements.modal.hidden = false;
    this.canCloseAt = performance.now() + 360;
    this.renderGallery();
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
      image.src = photos[index].photo_path;
      image.alt = photos[index].alt ?? `照片 ${index + 1}`;
      image.dataset.position = position;
      image.style.zIndex = position === "center" ? "3" : "1";
    });
    this.fullText = centeredPhoto.caption ?? this.gallery.text ?? "";
    this.visibleCharacters = 0;
    this.elements.caption.textContent = "";
    this.elements.galleryDots.textContent = photos
      .map((_, index) => (index === this.galleryIndex ? "●" : "○"))
      .join("  ");
  }

  beginGalleryGesture(clientX) {
    this.gestureStartX = Number(clientX);
  }

  endGalleryGesture(clientX, now = performance.now()) {
    if (this.mode !== "gallery" || !this.gallery) return "none";
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
    if (!this.visible || this.visibleCharacters >= this.fullText.length) return;
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
    return this.visible && now >= this.canCloseAt;
  }

  close() {
    if (!this.visible) return null;
    const closed = this.mode === "gallery" ? this.gallery : this.pending;
    this.visible = false;
    this.pending = null;
    this.prepareTimer = 0;
    this.fullText = "";
    this.visibleCharacters = 0;
    this.elements.modal.hidden = true;
    this.elements.image.removeAttribute("src");
    this.elements.card.classList.remove("gallery-mode");
    this.elements.gallery.hidden = true;
    this.elements.single.hidden = false;
    this.mode = "single";
    this.gallery = null;
    this.gestureStartX = null;
    return closed;
  }
}
