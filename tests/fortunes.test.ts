import { describe, expect, it } from "vitest";
import { FORTUNES, FORTUNE_CATEGORIES, formatFortuneNumber } from "../src/game/fortunes";

describe("shrine omikuji readings", () => {
  it("has one hundred distinct numbered slips with twenty of each grade", () => {
    expect(FORTUNES).toHaveLength(100);
    expect(new Set(FORTUNES.map(fortune => fortune.number)).size).toBe(100);
    expect(new Set(FORTUNES.map(fortune => fortune.message)).size).toBe(100);
    expect(new Set(FORTUNES.map(fortune => fortune.detail)).size).toBe(100);
    expect(FORTUNES.map(fortune => fortune.number).sort((a, b) => a - b))
      .toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
    for (const title of ["大吉", "中吉", "小吉", "吉", "末吉"])
      expect(FORTUNES.filter(fortune => fortune.title === title)).toHaveLength(20);
  });

  it("gives every slip a complete interpretation for all eight traditional categories", () => {
    expect(FORTUNE_CATEGORIES.map(category => category.label))
      .toEqual(["願望", "待人", "失物", "旅行", "商売", "学問", "縁談", "転居"]);
    const keys = FORTUNE_CATEGORIES.map(category => category.key).sort();
    for (const fortune of FORTUNES) {
      expect(Object.keys(fortune.readings).sort()).toEqual(keys);
      for (const { key } of FORTUNE_CATEGORIES) {
        expect(fortune.readings[key].trim().length).toBeGreaterThan(14);
      }
      expect(fortune).not.toHaveProperty("color");
      expect(fortune).not.toHaveProperty("item");
    }
  });

  it("prints slip numbers in Japanese without a leading one before ten or one hundred", () => {
    for (const [number, expected] of [
      [1, "一"], [9, "九"], [10, "十"], [11, "十一"], [20, "二十"],
      [21, "二十一"], [90, "九十"], [99, "九十九"], [100, "百"],
    ] as const) expect(formatFortuneNumber(number)).toBe(expected);
  });
});
