/**
 * Rendering boundary shared by the game model and concrete renderers.
 * A future Pygame port only needs to implement this contract while keeping
 * level config, state names, entity models and event sequencing unchanged.
 */
export class RenderAdapter {
  get viewport() {
    throw new Error("RenderAdapter.viewport must be implemented");
  }

  render(_game) {
    throw new Error("RenderAdapter.render(game) must be implemented");
  }
}
