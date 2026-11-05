import { describe, expect, it } from "vitest";
import { createOmikujiSound } from "../src/audio/OmikujiSound";

function rms(samples: Float32Array, rate: number, start = 0, end = samples.length / rate) {
  const slice = samples.subarray(Math.floor(start * rate), Math.floor(end * rate));
  return Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length);
}

describe("wooden omikuji sound", () => {
  it("leaves the anticipation silent, makes the shake audible, then follows the rising stick", () => {
    const rate = 32000;
    const sound = createOmikujiSound(rate);
    expect(sound.length / rate).toBeCloseTo(1.8);
    expect(rms(sound, rate, 0, 0.14)).toBe(0);
    expect(rms(sound, rate, 0.16, 0.9)).toBeGreaterThan(0.02);
    expect(rms(sound, rate, 1.05, 1.45)).toBeGreaterThan(0.002);
    expect(rms(sound, rate, 1.57, 1.67)).toBeGreaterThan(0.01);
    expect(rms(sound, rate, 1.75, 1.8)).toBeLessThan(0.001);
  });

  it.each([8000, 44100, 48000, 96000])("stays finite, bounded and quiet at its boundaries at %iHz", rate => {
    const sound = createOmikujiSound(rate);
    expect(sound.every(Number.isFinite)).toBe(true);
    expect(sound.every(value => Math.abs(value) <= 0.8)).toBe(true);
    expect(sound[0]).toBe(0);
    expect(Math.abs(sound.at(-1)!)).toBe(0);
    expect(Math.abs(sound.reduce((sum, value) => sum + value, 0) / sound.length)).toBeLessThan(0.0001);
  });

  it("creates repeatable original audio with a separate sound seed", () => {
    const first = createOmikujiSound(16000, false, 42);
    expect(createOmikujiSound(16000, false, 42)).toEqual(first);
    expect(createOmikujiSound(16000, false, 43)).not.toEqual(first);
  });

  it("uses a brief, softer single-stick sound when the shake animation is skipped", () => {
    const rate = 32000;
    const sound = createOmikujiSound(rate, true);
    expect(sound.length / rate).toBeCloseTo(0.24);
    expect(rms(sound, rate, 0.01, 0.2)).toBeGreaterThan(0.01);
    expect(sound.every(value => Math.abs(value) <= 0.4)).toBe(true);
    expect(sound[0]).toBe(0);
    expect(Math.abs(sound.at(-1)!)).toBe(0);
  });

  it("rejects invalid sample rates before allocating samples", () => {
    for (const rate of [NaN, Infinity, 0, -1, 1000000])
      expect(() => createOmikujiSound(rate)).toThrow(RangeError);
  });
});
