export class QuestionBlockSystem {
  constructor(blockConfigs, map) {
    this.map = map;
    this.blocks = blockConfigs.map((block) => ({
      ...block,
      x: block.column * map.cell_width,
      y: (block.row + 1) * map.cell_height - 32,
      width: 32,
      height: 32,
      activated: Boolean(block.activated),
      bumpElapsed: 0,
      bumpDuration: 0.24,
      renderOffsetY: 0,
    }));
  }

  byId(id) {
    return this.blocks.find((block) => block.id === id) ?? null;
  }

  update(dt) {
    for (const block of this.blocks) {
      if (block.bumpElapsed <= 0) continue;
      block.bumpElapsed += dt;
      const progress = Math.min(1, block.bumpElapsed / block.bumpDuration);
      block.renderOffsetY = -Math.sin(progress * Math.PI) * 16;
      if (progress >= 1) {
        block.bumpElapsed = 0;
        block.renderOffsetY = 0;
      }
    }
  }

  findHeadHit(player, previousRect) {
    if (player.vy >= 0) return null;
    const currentTop = player.y;
    for (const block of this.blocks) {
      if (block.activated) continue;
      const blockBottom = block.y + block.height;
      const crossedBottom = previousRect.y >= blockBottom && currentTop <= blockBottom;
      const horizontal = player.x < block.x + block.width && player.x + player.width > block.x;
      if (crossedBottom && horizontal) return block;
    }
    return null;
  }

  activate(block) {
    if (!block || block.activated) return false;
    block.activated = true;
    block.bumpElapsed = Number.EPSILON;
    return true;
  }
}
