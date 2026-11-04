import { Vector2 } from "three";

const MOVEMENT_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

export class InputController {
  readonly direction = new Vector2();
  private keys = new Set<string>();
  private touch = new Vector2();
  private onKeyDown = (event: KeyboardEvent) => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest(
        'input, textarea, select, [contenteditable="true"], [role="dialog"]',
      )
    )
      return;
    if (MOVEMENT_KEYS.has(event.code) || event.code === "KeyE") {
      event.preventDefault();
      if (!event.repeat && event.code === "KeyE") this.onInteract();
      this.keys.add(event.code);
    }
  };
  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };
  private onBlur = () => this.clear();
  private onVisibility = () => {
    if (document.hidden) this.clear();
  };

  constructor(private onInteract: () => void) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  setTouch(x: number, y: number) {
    this.touch.set(x, y).clampLength(0, 1);
  }
  clear() {
    this.keys.clear();
    this.touch.set(0, 0);
    this.direction.set(0, 0);
  }

  update() {
    this.direction
      .set(
        Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
          Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft")),
        Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
          Number(this.keys.has("KeyS") || this.keys.has("ArrowDown")),
      )
      .add(this.touch)
      .clampLength(0, 1);
    return this.direction;
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.clear();
  }
}
