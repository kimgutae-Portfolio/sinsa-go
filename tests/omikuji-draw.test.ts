import { afterEach, describe, expect, it, vi } from "vitest";
import { OmikujiDraw, OMIKUJI_DRAW_DURATION } from "../src/game/OmikujiDraw";
import { FORTUNES } from "../src/game/fortunes";

afterEach(() => vi.useRealTimers());

describe("a visitor's omikuji draw", () => {
  it("waits for a press, selects once despite repeated presses, and requires opening the ticket", () => {
    vi.useFakeTimers();
    const random = vi.fn(() => 0.995);
    const changed = vi.fn();
    const counted = vi.fn();
    const draw = new OmikujiDraw(changed, counted, random);
    expect(draw.state).toEqual({ phase: "ready", fortune: null });
    expect(random).not.toHaveBeenCalled();
    expect(counted).not.toHaveBeenCalled();
    expect(draw.open()).toBe(false);

    expect(draw.draw()).toBe(true);
    expect(draw.draw()).toBe(false);
    expect(draw.open()).toBe(false);
    expect(random).toHaveBeenCalledTimes(1);
    expect(counted).toHaveBeenCalledTimes(1);
    expect(draw.state.phase).toBe("drawing");
    vi.advanceTimersByTime(OMIKUJI_DRAW_DURATION - 1);
    expect(draw.state.phase).toBe("drawing");
    vi.advanceTimersByTime(1);
    expect(draw.state).toEqual({ phase: "drawn", fortune: FORTUNES.at(-1) });
    expect(draw.open()).toBe(true);
    expect(draw.state).toEqual({ phase: "reading", fortune: FORTUNES.at(-1) });
    expect(draw.open()).toBe(false);
    expect(draw.draw()).toBe(false);
    expect(counted).toHaveBeenCalledTimes(1);
    draw.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a closing draw without revealing it later or affecting a fresh experience", () => {
    vi.useFakeTimers();
    const stale = vi.fn();
    const counted = vi.fn();
    const closed = new OmikujiDraw(stale, counted, () => 0);
    closed.draw();
    vi.advanceTimersByTime(OMIKUJI_DRAW_DURATION - 1);
    closed.dispose();
    stale.mockClear();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10000);
    expect(stale).not.toHaveBeenCalled();
    expect(closed.draw()).toBe(false);
    expect(closed.open()).toBe(false);
    const reopened = new OmikujiDraw(vi.fn(), counted, () => 0.5);
    expect(reopened.state.fortune).toBeNull();
    reopened.draw();
    vi.advanceTimersByTime(OMIKUJI_DRAW_DURATION);
    expect(reopened.state.fortune).toBe(FORTUNES[50]);
    expect(counted).toHaveBeenCalledTimes(2);
    reopened.dispose();
  });

  it("skips motion and waiting when reduced motion is requested", () => {
    vi.useFakeTimers();
    const counted = vi.fn();
    const draw = new OmikujiDraw(vi.fn(), counted, () => 0);
    expect(draw.draw(true)).toBe(true);
    expect(draw.state).toEqual({ phase: "drawn", fortune: FORTUNES[0] });
    expect(vi.getTimerCount()).toBe(0);
    expect(draw.open()).toBe(true);
    expect(counted).toHaveBeenCalledTimes(1);
    draw.dispose();
  });

  it("does not leave a timer if the draw callback closes the experience", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const draw = new OmikujiDraw(changed, () => draw.dispose());
    draw.draw();
    expect(changed).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
