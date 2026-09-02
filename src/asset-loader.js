export class AssetLoader {
  constructor(progress = () => {}) {
    this.images = new Map();
    this.progress = progress;
  }

  async loadImage(key, path) {
    if (this.images.has(key)) return this.images.get(key);
    const image = new Image();
    image.decoding = "async";
    const ready = new Promise((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`无法载入图片：${path}`));
    });
    image.src = path;
    const loaded = await ready;
    this.images.set(key, loaded);
    return loaded;
  }

  async loadManifest(manifest) {
    const entries = Object.entries(manifest);
    let completed = 0;
    await Promise.all(
      entries.map(async ([key, path]) => {
        await this.loadImage(key, path);
        completed += 1;
        this.progress(completed, entries.length);
      }),
    );
    return this.images;
  }

  get(key) {
    const image = this.images.get(key);
    if (!image) throw new Error(`素材尚未载入：${key}`);
    return image;
  }
}
