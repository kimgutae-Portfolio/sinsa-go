import { drawFortune, type Fortune } from "./fortunes";

export const OMIKUJI_DRAW_DURATION = 1600;
export interface OmikujiDrawState {
  phase: "ready" | "drawing" | "drawn" | "reading";
  fortune: Fortune | null;
}

/** One ticket per opened experience; closing it cancels the pending reveal. */
export class OmikujiDraw {
  private current: OmikujiDrawState = { phase: "ready", fortune: null };
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(
    private onChange: (state: OmikujiDrawState) => void,
    private onDraw: () => void,
    private random: () => number = Math.random,
  ) {}

  get state(): OmikujiDrawState {
    return { ...this.current };
  }

  draw(reducedMotion = false) {
    if (this.disposed || this.current.phase !== "ready") return false;
    this.current = {
      phase: reducedMotion ? "drawn" : "drawing",
      fortune: drawFortune(this.random),
    };
    this.onDraw();
    if (this.disposed) return true;
    this.onChange(this.state);
    if (!reducedMotion && !this.disposed) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        if (this.disposed) return;
        this.current = { ...this.current, phase: "drawn" };
        this.onChange(this.state);
      }, OMIKUJI_DRAW_DURATION);
    }
    return true;
  }

  open() {
    if (this.disposed || this.current.phase !== "drawn") return false;
    this.current = { ...this.current, phase: "reading" };
    this.onChange(this.state);
    return true;
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
