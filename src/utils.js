export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;

export function intersects(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function isVisible(rect, camera, viewport, margin = 96) {
  return (
    rect.x + rect.width >= camera.x - margin &&
    rect.x <= camera.x + viewport.width + margin &&
    rect.y + rect.height >= camera.y - margin &&
    rect.y <= camera.y + viewport.height + margin
  );
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export const worldToCell = (x, y, map) => ({
  column: Math.floor(x / map.cell_width),
  row: Math.floor(y / map.cell_height),
});

export const formatTarget = (target) => (target ? target.id : "—");
