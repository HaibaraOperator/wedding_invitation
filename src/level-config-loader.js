import { assert } from "./utils.js";

export class LevelConfigLoader {
  static async load(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`无法读取关卡配置：${path}`);
    const config = await response.json();
    this.validate(config);
    return config;
  }

  static validate(config) {
    assert(config.level_id, "level_id 不能为空");
    assert(config.map?.width % 32 === 0, "地图宽度必须是 32 的倍数");
    assert(config.map?.height % 32 === 0, "地图高度必须是 32 的倍数");
    assert(config.map.width <= 19968, "地图宽度不能超过 19968");
    assert(config.map.height <= 992, "地图高度不能超过 992");
    assert(config.map.cell_width === 16, "横向逻辑单元必须为 16 像素");
    assert(config.map.cell_height === 32, "纵向逻辑单元必须为 32 像素");
    assert(Array.isArray(config.stop_points), "stop_points 必须是数组");
    assert(Array.isArray(config.photos), "photos 必须是数组");
    const ids = new Set(config.stop_points.map((point) => point.id));
    assert(ids.size === config.stop_points.length, "stop_points 的 id 不可重复");
  }
}

export class MapLoader {
  static async loadJson(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error(`无法读取地图 JSON：${path}`);
    return response.json();
  }
}
