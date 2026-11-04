/** Canvas-only gestures leave the Vue controls and joystick independent. */
export class PointerController {
  private pointers = new Map<number, { x: number; y: number }>();
  private origin = { x: 0, y: 0 };
  private dragged = false;
  private pinchDistance = 0;
  private onDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    this.surface.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.origin = { x: event.clientX, y: event.clientY };
      this.dragged = event.button === 2;
    } else {
      this.dragged = true;
      this.pinchDistance = this.getPinchDistance();
    }
  };
  private onMove = (event: PointerEvent) => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x,
      dy = event.clientY - previous.y;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size > 1) {
      const distance = this.getPinchDistance();
      if (this.pinchDistance)
        this.onZoom((distance - this.pinchDistance) * 0.005);
      this.pinchDistance = distance;
    } else {
      if (
        Math.hypot(
          event.clientX - this.origin.x,
          event.clientY - this.origin.y,
        ) > 6
      )
        this.dragged = true;
      if (this.dragged) this.onRotate(dx, dy);
    }
  };
  private onUp = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) return;
    const click =
      this.pointers.size === 1 && !this.dragged && event.type === "pointerup";
    this.pointers.delete(event.pointerId);
    if (this.surface.hasPointerCapture(event.pointerId))
      this.surface.releasePointerCapture(event.pointerId);
    if (click) this.onClick(event.clientX, event.clientY);
    this.pinchDistance = 0;
  };
  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.onZoom(-Math.max(-80, Math.min(80, event.deltaY)) * 0.002);
  };
  private onContextMenu = (event: Event) => event.preventDefault();
  private onBlur = () => this.clear();

  constructor(
    private surface: HTMLElement,
    private onRotate: (x: number, y: number) => void,
    private onZoom: (delta: number) => void,
    private onClick: (x: number, y: number) => void,
  ) {
    surface.addEventListener("pointerdown", this.onDown);
    surface.addEventListener("pointermove", this.onMove);
    surface.addEventListener("pointerup", this.onUp);
    surface.addEventListener("pointercancel", this.onUp);
    surface.addEventListener("lostpointercapture", this.onUp);
    surface.addEventListener("wheel", this.onWheel, { passive: false });
    surface.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("blur", this.onBlur);
  }

  private getPinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  clear() {
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    ids.forEach((id) => {
      if (this.surface.hasPointerCapture(id))
        this.surface.releasePointerCapture(id);
    });
    this.dragged = true;
    this.pinchDistance = 0;
  }
  dispose() {
    this.clear();
    this.surface.removeEventListener("pointerdown", this.onDown);
    this.surface.removeEventListener("pointermove", this.onMove);
    this.surface.removeEventListener("pointerup", this.onUp);
    this.surface.removeEventListener("pointercancel", this.onUp);
    this.surface.removeEventListener("lostpointercapture", this.onUp);
    this.surface.removeEventListener("wheel", this.onWheel);
    this.surface.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("blur", this.onBlur);
  }
}
