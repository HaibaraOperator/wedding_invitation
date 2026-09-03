export class AssetLoader {
  constructor(progress = () => {}) {
    this.images = new Map();
    this.promises = new Map();
    this.failures = new Map();
    this.progress = progress;
    this.placeholder = typeof document === "undefined"
      ? null
      : Object.assign(document.createElement("canvas"), { width: 1, height: 1 });
  }

  async loadImage(key, path, { required = true, retries = 2 } = {}) {
    if (this.images.has(key)) return this.images.get(key);
    if (this.promises.has(key)) return this.promises.get(key);
    const task = (async () => {
      let lastError = null;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const image = new Image();
          image.decoding = "async";
          image.loading = "eager";
          const loaded = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              image.onload = null;
              image.onerror = null;
              reject(new Error(`载入图片超时：${path}`));
            }, 20000);
            image.onload = () => {
              clearTimeout(timer);
              resolve(image);
            };
            image.onerror = () => {
              clearTimeout(timer);
              reject(new Error(`无法载入图片：${path}`));
            };
            image.src = attempt === 0 ? path : this.retryUrl(path, attempt);
          });
          await loaded.decode?.().catch(() => {});
          this.images.set(key, loaded);
          this.failures.delete(key);
          return loaded;
        } catch (error) {
          lastError = error;
          if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 180 * (attempt + 1)));
        }
      }
      this.failures.set(key, lastError);
      if (required) throw lastError;
      return null;
    })();
    this.promises.set(key, task);
    try {
      return await task;
    } finally {
      this.promises.delete(key);
    }
  }

  retryUrl(path, attempt) {
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}asset_retry=${attempt}`;
  }

  async loadManifest(manifest, { keys = null, concurrency = 6, required = true } = {}) {
    const selected = keys ? new Set(keys) : null;
    const entries = Object.entries(manifest).filter(([key]) => !selected || selected.has(key));
    let completed = 0;
    let cursor = 0;
    const errors = [];
    const worker = async () => {
      while (cursor < entries.length) {
        const [key, path] = entries[cursor];
        cursor += 1;
        try {
          await this.loadImage(key, path, { required, retries: required ? 2 : 1 });
        } catch (error) {
          errors.push(error);
        }
        completed += 1;
        this.progress(completed, entries.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length || 1) }, worker));
    if (required && errors.length) throw errors[0];
    return this.images;
  }

  preloadManifest(manifest, { excludeKeys = [], concurrency = 3 } = {}) {
    const excluded = new Set(excludeKeys);
    const remaining = Object.fromEntries(Object.entries(manifest).filter(([key]) => !excluded.has(key)));
    const start = () => this.loadManifest(remaining, { concurrency, required: false }).catch(() => {});
    if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: 1200 });
    else setTimeout(start, 120);
  }

  get(key) {
    const image = this.images.get(key);
    return image ?? this.placeholder;
  }
}
