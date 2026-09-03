export class CounterDisplay {
  constructor(element, initialValue) {
    this.element = element;
    this.value = initialValue;
    this.animationQueued = false;
    this.render();
  }

  set(value) {
    const changed = String(value) !== String(this.value);
    this.value = value;
    this.render();
    if (changed) this.animateChange();
  }

  render() {
    this.element.textContent = String(this.value);
  }

  animateChange() {
    if (!this.element?.classList) return;
    if (this.element.classList.contains("counter-jump")) {
      this.animationQueued = true;
      return;
    }
    this.animationQueued = false;
    this.element.classList.add("counter-jump");
    this.element.addEventListener("animationend", () => {
      this.element.classList.remove("counter-jump");
      if (!this.animationQueued) return;
      this.animationQueued = false;
      requestAnimationFrame(() => this.animateChange());
    }, { once: true });
  }
}
