export class CounterDisplay {
  constructor(element, initialValue) {
    this.element = element;
    this.value = initialValue;
    this.render();
  }

  set(value) {
    this.value = value;
    this.render();
  }

  render() {
    this.element.textContent = String(this.value);
  }
}
