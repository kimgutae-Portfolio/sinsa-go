import { describe, expect, it } from "vitest";
import { layoutLabels } from "../src/game/labelLayout";

const label = (id: string, x: number, y: number, extra = {}) => ({
  id,
  x,
  y,
  width: 60,
  height: 24,
  visible: true,
  ...extra,
});

describe("scene label layout", () => {
  it("keeps labels in place when nothing collides", () => {
    expect(layoutLabels([label("a", 100, 300), label("b", 300, 300)], [])).toEqual([
      { id: "a", offset: 0, visible: true },
      { id: "b", offset: 0, visible: true },
    ]);
  });
  it("lifts a label clear of a HUD panel and hides it when no room is left", () => {
    const panel = { left: 50, top: 250, right: 250, bottom: 310 };
    const [lifted] = layoutLabels([label("a", 100, 320)], [panel]);
    expect(lifted!.visible).toBe(true);
    expect(lifted!.offset).toBeLessThan(0);
    // A tall panel up to the top edge leaves nowhere to go.
    const [hidden] = layoutLabels(
      [label("a", 100, 320)],
      [{ left: 0, top: 0, right: 400, bottom: 330 }],
    );
    expect(hidden).toEqual({ id: "a", offset: 0, visible: false });
  });
  it("separates overlapping labels, giving the nearby place priority", () => {
    const result = layoutLabels(
      [label("far", 200, 300), label("near", 210, 305, { priority: true })],
      [],
    );
    const near = result.find((item) => item.id === "near")!;
    const far = result.find((item) => item.id === "far")!;
    expect(near.offset).toBe(0);
    expect(far.visible).toBe(true);
    expect(far.offset).toBeLessThan(0);
  });
  it("never shows labels the camera reports as off screen", () => {
    expect(layoutLabels([label("a", 100, 300, { visible: false })], [])[0]).toEqual({
      id: "a",
      offset: 0,
      visible: false,
    });
  });
});
