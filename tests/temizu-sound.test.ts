import { describe, expect, it } from "vitest";
import { createTemizuSound, TEMIZU_SOUND_SECONDS } from "../src/audio/TemizuSound";
import { ALIGN_DURATION, TEMIZU_DURATION, TEMIZU_STEPS } from "../src/game/ritual";

function rms(samples: Float32Array, rate: number, start: number, end: number) {
  const slice = samples.subarray(Math.floor(start * rate), Math.floor(end * rate));
  return Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length);
}

describe("temizu water sound", () => {
  it("waits for alignment and follows each palm pour, cupped hand and handle rinse", () => {
    const rate = 32000;
    const sound = createTemizuSound(rate);
    expect(sound.length / rate).toBeCloseTo(TEMIZU_SOUND_SECONDS);
    expect(sound.length / rate).toBeGreaterThanOrEqual(TEMIZU_DURATION);
    expect(sound.length / rate).toBeLessThan(TEMIZU_DURATION + 0.2);
    expect(rms(sound, rate, 0, ALIGN_DURATION)).toBe(0);
    let start = ALIGN_DURATION;
    for (const step of TEMIZU_STEPS) {
      const active = step.kind === "mouth" ? [0.21, 0.34] : [0.38, 0.65];
      const water = rms(sound, rate, start + step.duration * active[0]!, start + step.duration * active[1]!);
      expect(water).toBeGreaterThan(0.01);
      const rest = rms(sound, rate, start + step.duration * 0.92, start + step.duration * 0.98);
      expect(rest).toBeLessThan(water * 0.3);
      start += step.duration;
    }
  });

  it("leaves a pause while the cupped hand reaches the mouth instead of continuous water or voices", () => {
    const rate = 32000;
    const sound = createTemizuSound(rate);
    const mouthStart = ALIGN_DURATION + TEMIZU_STEPS[0].duration + TEMIZU_STEPS[1].duration;
    const intoPalm = rms(sound, rate, mouthStart + 0.5, mouthStart + 0.8);
    const raisedHand = rms(sound, rate, mouthStart + 1.1, mouthStart + 1.25);
    expect(intoPalm).toBeGreaterThan(0.01);
    expect(raisedHand).toBeLessThan(intoPalm * 0.05);
  });

  it.each([8000, 44100, 48000, 96000])("is finite and leaves headroom for the background track at %iHz", rate => {
    const sound = createTemizuSound(rate);
    expect(sound.every(Number.isFinite)).toBe(true);
    expect(sound.every(value => Math.abs(value) <= 0.46)).toBe(true);
    expect(sound[0]).toBe(0);
    expect(Math.abs(sound.at(-1)!)).toBe(0);
    expect(Math.abs(sound.reduce((sum, value) => sum + value, 0) / sound.length)).toBeLessThan(0.0001);
    expect(rms(sound, rate, TEMIZU_DURATION, TEMIZU_SOUND_SECONDS)).toBeLessThan(0.001);
  });

  it("produces repeatable original sound without consuming the fortune random source", () => {
    const first = createTemizuSound(16000);
    expect(createTemizuSound(16000)).toEqual(first);
  });

  it("rejects unsupported sample rates before allocating samples", () => {
    for (const rate of [NaN, Infinity, 0, -1, 1000000])
      expect(() => createTemizuSound(rate)).toThrow(RangeError);
  });
});
