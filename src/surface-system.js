const SOLID_MATERIALS = new Set(["001", "007"]);

export class SurfaceSystem {
  constructor(mapData, fallbackGroundY) {
    this.fallbackGroundY = fallbackGroundY;
    this.surfaces = (mapData?.placements ?? [])
      .filter((placement) => SOLID_MATERIALS.has(String(placement.material_id)))
      .map((placement) => ({
        x: Number(placement.pixel_position?.x ?? 0),
        width: Number(placement.size?.width ?? 32),
        top: Number(placement.pixel_position?.y_bottom ?? fallbackGroundY + 32)
          - Number(placement.size?.height ?? 32),
      }));
  }

  candidates(x, width = 1) {
    const right = x + Math.max(1, width);
    return this.surfaces.filter((surface) => x < surface.x + surface.width && right > surface.x);
  }

  nearestTop(x, width, preferredFeetY = this.fallbackGroundY) {
    const candidates = this.candidates(x, width);
    if (!candidates.length) return this.fallbackGroundY;
    return candidates
      .sort((a, b) => Math.abs(a.top - preferredFeetY) - Math.abs(b.top - preferredFeetY))[0].top;
  }

  crossedTop(x, width, previousFeetY, currentFeetY) {
    const candidates = this.candidates(x, width)
      .filter((surface) => previousFeetY <= surface.top + 2 && currentFeetY >= surface.top)
      .sort((a, b) => a.top - b.top);
    return candidates[0]?.top ?? null;
  }

  snap(player, preferredFeetY = player.feetY) {
    const top = this.nearestTop(player.x, player.width, preferredFeetY);
    player.y = top - player.height;
    player.vx = 0;
    player.vy = 0;
    return top;
  }
}
