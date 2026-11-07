import { afterEach, describe, expect, it, vi } from "vitest";
import { createOfferingSound, OFFERING_REDUCED_SOUND_SECONDS, OFFERING_SOUND_SECONDS } from "../src/audio/OfferingSound";
import { ShrineAudio } from "../src/audio/ShrineAudio";

function rms(samples: Float32Array, rate: number, start: number, end: number) {
  const slice = samples.subarray(Math.floor(start * rate), Math.floor(end * rate));
  return Math.sqrt(slice.reduce((sum, value) => sum + value * value, 0) / slice.length);
}

describe("a small coin in the wooden offering box", () => {
  it("leaves the flight quiet and places the main contact at the box's entry", () => {
    const rate = 32000, sound = createOfferingSound(rate);
    expect(sound.length / rate).toBeCloseTo(OFFERING_SOUND_SECONDS);
    expect(rms(sound, rate, 0.02, 0.10)).toBeGreaterThan(0.001);
    expect(rms(sound, rate, 0.24, 0.42)).toBeLessThan(0.00001);
    expect(rms(sound, rate, 0.45, 0.53)).toBeGreaterThan(0.015);
    expect(rms(sound, rate, 0.68, 0.72)).toBeLessThan(0.0001);
  });

  it.each([8000, 44100, 48000, 96000])("is finite, quiet at the boundaries and below clipping at %iHz", rate => {
    for (const reduced of [false, true]) {
      const sound = createOfferingSound(rate, reduced);
      expect(sound.every(Number.isFinite)).toBe(true);
      expect(sound.every(value => Math.abs(value) < 0.27)).toBe(true);
      expect(sound[0]).toBe(0);
      expect(Math.abs(sound.at(-1)!)).toBe(0);
      expect(Math.abs(sound.reduce((sum, value) => sum + value, 0) / sound.length)).toBeLessThan(0.0001);
    }
  });

  it("uses an immediate softer contact when the coin animation is skipped", () => {
    const rate = 32000, sound = createOfferingSound(rate, true);
    expect(sound.length / rate).toBeCloseTo(OFFERING_REDUCED_SOUND_SECONDS);
    expect(rms(sound, rate, 0.015, 0.08)).toBeGreaterThan(0.01);
    expect(sound.every(value => Math.abs(value) <= 0.21)).toBe(true);
    expect(createOfferingSound(rate, true)).toEqual(sound);
  });

  it("rejects unsupported sample rates before allocating audio", () => {
    for (const rate of [NaN, Infinity, 0, -1, 1000000])
      expect(() => createOfferingSound(rate)).toThrow(RangeError);
  });
});

const owned: ShrineAudio[] = [];
afterEach(() => owned.splice(0).forEach(audio => audio.dispose()));
function environment() {
  class Visibility extends EventTarget { hidden = false; }
  const visibility = new Visibility();
  const makeGain = () => ({ gain: { value: 0, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() });
  const master = makeGain(), ambience = makeGain();
  const sources: { buffer: unknown; loop: boolean; onended: (() => void) | null;
    connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    currentTime: 0, sampleRate: 16000, state: "suspended", destination: {}, onstatechange: null,
    createGain: vi.fn().mockReturnValueOnce(master).mockReturnValueOnce(ambience),
    createBuffer: vi.fn((_channels: number, length: number, rate: number) => ({
      duration: length / rate, copyToChannel: vi.fn(),
    })),
    createBufferSource: vi.fn(() => {
      const source = { buffer: null as unknown, loop: false, onended: null as (() => void) | null,
        connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      sources.push(source);
      return source;
    }),
    resume: vi.fn(async () => { context.state = "running"; }),
    suspend: vi.fn(async () => { context.state = "suspended"; }),
    close: vi.fn(async () => { context.state = "closed"; }),
    decodeAudioData: vi.fn(async () => ({ duration: 48 })),
  };
  const createContext = vi.fn(() => context as unknown as AudioContext);
  const audio = new ShrineAudio(() => {}, {
    createContext, load: vi.fn(async () => new ArrayBuffer(8)), visibility, now: () => 0,
  });
  owned.push(audio);
  return { audio, context, master, sources, visibility, createContext };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }

describe("offering gesture under the shared sound switch", () => {
  it("never enables sound itself and caches the regular and reduced clips behind the existing master", async () => {
    const s = environment();
    s.audio.playOffering()();
    expect(s.createContext).not.toHaveBeenCalled();
    expect(s.audio.snapshot.enabled).toBe(false);
    await s.audio.setEnabled(true);
    const cancel = s.audio.playOffering();
    await settle();
    expect(s.sources[1]!.connect).toHaveBeenCalledWith(s.master);
    expect(s.sources[1]!.start).toHaveBeenCalledWith(0, 0);
    cancel(); cancel();
    expect(s.sources[1]!.stop).toHaveBeenCalledOnce();
    s.audio.playOffering();
    s.audio.playOffering(true);
    await settle();
    expect(s.context.createBuffer).toHaveBeenCalledTimes(2);
    expect(s.sources[2]!.buffer).toBe(s.context.createBuffer.mock.results[0]!.value);
    expect(s.sources[3]!.buffer).toBe(s.context.createBuffer.mock.results[1]!.value);
    expect(s.createContext).toHaveBeenCalledOnce();
    await s.audio.setEnabled(false);
    const before = s.sources.length;
    s.audio.playOffering();
    expect(s.sources).toHaveLength(before);
    expect(s.sources[2]!.stop).toHaveBeenCalledOnce();
    expect(s.sources[3]!.stop).toHaveBeenCalledOnce();
  });

  it("stops and disconnects the pending gesture when hidden or disposed", async () => {
    const s = environment();
    await s.audio.setEnabled(true);
    s.audio.playOffering();
    await settle();
    const effect = s.sources[1]!;
    s.visibility.hidden = true;
    s.visibility.dispatchEvent(new Event("visibilitychange"));
    expect(effect.stop).toHaveBeenCalledOnce();
    expect(effect.disconnect).toHaveBeenCalledOnce();
    expect(effect.buffer).toBeNull();
    const before = s.sources.length;
    s.audio.playOffering();
    expect(s.sources).toHaveLength(before);
    s.audio.dispose(); s.audio.dispose();
    expect(s.context.close).toHaveBeenCalledOnce();
    expect(effect.stop).toHaveBeenCalledOnce();
  });
});
