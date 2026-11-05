import { describe, expect, it, vi } from "vitest";
import { ShrineAudio, type SoundSnapshot } from "../src/audio/ShrineAudio";
import { OMIKUJI_REDUCED_SOUND_SECONDS, OMIKUJI_SOUND_SECONDS } from "../src/audio/OmikujiSound";
import { TEMIZU_DURATION } from "../src/game/ritual";

function setup(stored = "null", loader = vi.fn(async (_signal: AbortSignal) => new ArrayBuffer(8))) {
  class Visibility extends EventTarget { hidden = false; }
  const visibility = new Visibility();
  const sources: ReturnType<typeof createSource>[] = [];
  function createSource() {
    return { buffer: null, loop: false, onended: null as (() => void) | null,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
  const createGain = () => ({ gain: { value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() });
  const gain = createGain(), ambienceGain = createGain();
  const buffers: { duration: number; length: number; copyToChannel: ReturnType<typeof vi.fn> }[] = [];
  let now = 0;
  const context = {
    currentTime: 0, sampleRate: 32000, state: "suspended", destination: {}, onstatechange: null,
    createGain: vi.fn().mockReturnValueOnce(gain).mockReturnValueOnce(ambienceGain),
    createBuffer: vi.fn((_channels: number, length: number, rate: number) => {
      const buffer = { duration: length / rate, length, copyToChannel: vi.fn() };
      buffers.push(buffer);
      return buffer;
    }),
    createBufferSource: vi.fn(() => { const source = createSource(); sources.push(source); return source; }),
    decodeAudioData: vi.fn(async () => ({ duration: 48 })),
    resume: vi.fn(async () => { context.state = "running"; }),
    suspend: vi.fn(async () => { context.state = "suspended"; }),
    close: vi.fn(async () => { context.state = "closed"; }),
  };
  const storage = { getItem: vi.fn(() => stored), setItem: vi.fn() };
  const createContext = vi.fn(() => context as unknown as AudioContext);
  let status: SoundSnapshot;
  const changes = vi.fn((value: SoundSnapshot) => { status = value; });
  const audio = new ShrineAudio(changes, { createContext, load: loader, visibility, storage, now: () => now });
  const changeVisibility = (hidden: boolean) => {
    visibility.hidden = hidden;
    visibility.dispatchEvent(new Event("visibilitychange"));
  };
  return { audio, context, gain, ambienceGain, buffers, sources, storage, loader, createContext, changeVisibility,
    advance: (milliseconds: number) => { now += milliseconds; },
    changes, status: () => status! };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("shrine sound lifecycle", () => {
  it("remembers settings without autoplay, network traffic or allocating an audio context", () => {
    const s = setup('{"enabled":true,"volume":0.22}');
    expect(s.status()).toEqual({ enabled: false, remembered: true, volume: 0.22, state: "off" });
    expect(s.createContext).not.toHaveBeenCalled();
    expect(s.loader).not.toHaveBeenCalled();
    s.audio.dispose();
  });
  it("starts only from enable, decodes once and resumes at the saved loop offset", async () => {
    const s = setup();
    const started = s.audio.setEnabled(true);
    expect(s.context.resume).toHaveBeenCalledOnce();
    await started;
    expect(s.status().state).toBe("playing");
    expect(s.sources[0]?.loop).toBe(true);
    s.context.currentTime = 51;
    await s.audio.setEnabled(false);
    expect(s.status().state).toBe("off");
    await s.audio.setEnabled(true);
    expect(s.loader).toHaveBeenCalledOnce();
    expect(s.context.decodeAudioData).toHaveBeenCalledOnce();
    expect(s.sources[1]?.start).toHaveBeenCalledWith(0, 3);
    expect(s.sources[0]?.disconnect).toHaveBeenCalled();
    s.audio.dispose();
  });
  it("pauses in hidden tabs and resumes without creating duplicate sources", async () => {
    const s = setup();
    await s.audio.setEnabled(true);
    s.context.currentTime = 7;
    s.changeVisibility(true);
    expect(s.status().state).toBe("paused");
    expect(s.context.suspend).toHaveBeenCalledOnce();
    s.changeVisibility(false);
    await settle();
    expect(s.status().state).toBe("playing");
    expect(s.sources[1]?.start).toHaveBeenCalledWith(0, 7);
    s.audio.dispose();
  });
  it("never starts playback after being muted during loading", async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    const s = setup("null", vi.fn(() => new Promise<ArrayBuffer>(resolve => { finish = resolve; })));
    const pending = s.audio.setEnabled(true);
    await s.audio.setEnabled(false);
    finish(new ArrayBuffer(8));
    await pending;
    expect(s.context.createBufferSource).not.toHaveBeenCalled();
    expect(s.status().state).toBe("off");
    s.audio.dispose();
  });
  it("offers retry after a failed audio request and tolerates corrupt settings", async () => {
    const loader = vi.fn(async (_signal: AbortSignal) => new ArrayBuffer(8));
    loader.mockRejectedValueOnce(new Error("offline"));
    const s = setup("broken", loader);
    await s.audio.setEnabled(true);
    expect(s.status().state).toBe("error");
    await s.audio.setEnabled(true);
    expect(s.status().state).toBe("playing");
    expect(s.loader).toHaveBeenCalledTimes(2);
    s.audio.dispose();
  });
  it("handles autoplay rejection and can resume from the next explicit gesture", async () => {
    const s = setup();
    await s.audio.setEnabled(true);
    s.changeVisibility(true);
    s.context.resume.mockRejectedValueOnce(new Error("gesture required"));
    s.changeVisibility(false);
    await settle();
    expect(s.status().state).toBe("blocked");
    expect(s.sources).toHaveLength(1);
    await s.audio.setEnabled(true);
    expect(s.status().state).toBe("playing");
    s.audio.dispose();
  });
  it("clamps volume, rejects invalid input and still works when storage is unavailable", async () => {
    const s = setup();
    s.storage.setItem.mockImplementation(() => { throw new Error("denied"); });
    s.audio.setVolume(4);
    expect(s.status().volume).toBe(1);
    s.audio.setVolume(NaN);
    expect(s.status().volume).toBe(1);
    await s.audio.setEnabled(true);
    s.audio.setVolume(0.2);
    expect(s.gain.gain.setTargetAtTime).toHaveBeenCalledWith(0.2, 0, 0.05);
    s.audio.dispose();
  });
  it("aborts pending loads, removes listeners and releases all resources exactly once", async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    const pending = setup("null", vi.fn(() => new Promise<ArrayBuffer>(resolve => { finish = resolve; })));
    const enabling = pending.audio.setEnabled(true);
    const signal = pending.loader.mock.calls[0]![0];
    pending.audio.dispose();
    expect(signal.aborted).toBe(true);
    finish(new ArrayBuffer(8));
    await enabling;
    expect(pending.context.decodeAudioData).not.toHaveBeenCalled();
    const s = setup();
    await s.audio.setEnabled(true);
    s.audio.dispose();
    s.audio.dispose();
    expect(s.sources[0]?.stop).toHaveBeenCalledOnce();
    expect(s.sources[0]?.disconnect).toHaveBeenCalledOnce();
    expect(s.sources[0]?.buffer).toBeNull();
    expect(s.gain.disconnect).toHaveBeenCalledOnce();
    expect(s.ambienceGain.disconnect).toHaveBeenCalledOnce();
    expect(s.context.close).toHaveBeenCalledOnce();
    const calls = s.changes.mock.calls.length;
    s.changeVisibility(true);
    await s.audio.setEnabled(true);
    expect(s.changes).toHaveBeenCalledTimes(calls);
  });
});

describe("omikuji sound with the shared shrine audio", () => {
  it("respects default-off and remembered-off playback without allocating or enabling audio", async () => {
    const s = setup('{"enabled":true,"volume":0.22}');
    const cancel = s.audio.playOmikujiDraw();
    cancel();
    cancel();
    expect(s.createContext).not.toHaveBeenCalled();
    expect(s.loader).not.toHaveBeenCalled();
    expect(s.status().enabled).toBe(false);
    await s.audio.setEnabled(true);
    await s.audio.setEnabled(false);
    s.audio.playOmikujiDraw();
    expect(s.sources).toHaveLength(1);
    s.audio.dispose();
  });

  it("plays through the shared master while the background is still loading and survives its arrival", async () => {
    let finish!: (bytes: ArrayBuffer) => void;
    const s = setup("null", vi.fn(() => new Promise<ArrayBuffer>(resolve => { finish = resolve; })));
    const enabling = s.audio.setEnabled(true);
    s.audio.playOmikujiDraw();
    expect(s.context.resume).toHaveBeenCalledTimes(2);
    await settle();
    const effect = s.sources[0]!;
    expect(effect.start).toHaveBeenCalledOnce();
    expect(effect.loop).toBe(false);
    expect(effect.connect).toHaveBeenCalledWith(s.gain);
    expect(s.gain.connect).toHaveBeenCalledWith(s.context.destination);
    expect(s.gain.gain.value).toBe(0.35);
    expect(s.context.decodeAudioData).not.toHaveBeenCalled();
    expect(s.loader).toHaveBeenCalledOnce();
    finish(new ArrayBuffer(8));
    await enabling;
    expect(s.createContext).toHaveBeenCalledOnce();
    expect(s.context.createGain).toHaveBeenCalledTimes(2);
    expect(s.sources[1]!.connect).toHaveBeenCalledWith(s.ambienceGain);
    expect(s.ambienceGain.connect).toHaveBeenCalledWith(s.gain);
    expect(s.ambienceGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 1.2);
    expect(s.gain.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    expect(effect.disconnect).not.toHaveBeenCalled();
    expect(effect.stop).not.toHaveBeenCalled();
    s.audio.setVolume(0.12);
    expect(s.gain.gain.setTargetAtTime).toHaveBeenCalledWith(0.12, 0, 0.05);
    expect(s.ambienceGain.gain.setTargetAtTime).not.toHaveBeenCalled();
    s.audio.dispose();
  });

  it("cancels a pending resume immediately and cannot start after the dialog closes", async () => {
    const s = setup();
    await s.audio.setEnabled(true);
    let resume!: () => void;
    s.context.resume.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
    const cancel = s.audio.playOmikujiDraw();
    const effect = s.sources[1]!;
    cancel();
    cancel();
    resume();
    await settle();
    expect(effect.start).not.toHaveBeenCalled();
    expect(effect.stop).toHaveBeenCalledOnce();
    expect(effect.disconnect).toHaveBeenCalledOnce();
    expect(effect.buffer).toBeNull();
    s.audio.dispose();
    expect(effect.stop).toHaveBeenCalledOnce();
  });

  it("discards a late resume rather than playing the shake after its visual moment", async () => {
    const s = setup();
    await s.audio.setEnabled(true);
    let resume!: () => void;
    s.context.resume.mockImplementationOnce(() => new Promise<void>(resolve => { resume = resolve; }));
    s.audio.playOmikujiDraw();
    s.advance(201);
    resume();
    await settle();
    expect(s.sources[1]!.start).not.toHaveBeenCalled();
    expect(s.sources[1]!.disconnect).toHaveBeenCalledOnce();
    s.audio.dispose();
  });

  it("contains resume failures without disabling the fortune interaction", async () => {
    const s = setup();
    await s.audio.setEnabled(true);
    s.context.resume.mockRejectedValueOnce(new Error("gesture rejected"));
    expect(() => s.audio.playOmikujiDraw()).not.toThrow();
    await settle();
    expect(s.sources[1]!.start).not.toHaveBeenCalled();
    expect(s.sources[1]!.disconnect).toHaveBeenCalledOnce();
    expect(s.status().enabled).toBe(true);
    s.audio.dispose();
  });

  it.each(["mute", "hidden", "dispose"] as const)("stops an active draw on %s and never replays it", async reason => {
    const s = setup();
    await s.audio.setEnabled(true);
    s.audio.playOmikujiDraw();
    await settle();
    const effect = s.sources[1]!;
    expect(effect.start).toHaveBeenCalledOnce();
    if (reason === "mute") await s.audio.setEnabled(false);
    if (reason === "hidden") s.changeVisibility(true);
    if (reason === "dispose") s.audio.dispose();
    expect(effect.stop).toHaveBeenCalledOnce();
    expect(effect.disconnect).toHaveBeenCalledOnce();
    expect(effect.buffer).toBeNull();
    if (reason === "hidden") {
      s.audio.playOmikujiDraw();
      expect(s.sources).toHaveLength(2);
      s.changeVisibility(false);
    } else await s.audio.setEnabled(true);
    await settle();
    expect(effect.start).toHaveBeenCalledOnce();
    expect(s.sources.filter(source => !source.loop)).toHaveLength(1);
    s.audio.dispose();
    expect(effect.stop).toHaveBeenCalledOnce();
  });

  it("reuses synthesized buffers and gives reduced motion a short reveal sound", async () => {
    const s = setup();
    await s.audio.setEnabled(true);
    const cancelFirst = s.audio.playOmikujiDraw();
    await settle();
    cancelFirst();
    const cancelSecond = s.audio.playOmikujiDraw();
    await settle();
    cancelSecond();
    s.audio.playOmikujiDraw(true);
    await settle();
    expect(s.buffers).toHaveLength(2);
    expect(s.buffers[0]!.duration).toBeCloseTo(OMIKUJI_SOUND_SECONDS);
    expect(s.buffers[1]!.duration).toBeCloseTo(OMIKUJI_REDUCED_SOUND_SECONDS);
    expect(s.buffers[1]!.duration).toBeLessThan(0.3);
    expect(s.buffers.every(buffer => buffer.copyToChannel.mock.calls[0]?.[0] instanceof Float32Array)).toBe(true);
    expect(s.buffers.every(buffer => buffer.copyToChannel.mock.calls[0]?.[1] === 0)).toBe(true);
    expect(s.sources[1]!.buffer).toBeNull();
    expect(s.sources[3]!.buffer).toBe(s.buffers[1]);
    s.sources[3]!.onended?.();
    expect(s.sources[3]!.disconnect).toHaveBeenCalledOnce();
    s.audio.dispose();
    expect(s.sources[3]!.stop).toHaveBeenCalledOnce();
  });
});

describe("temizu sound following the local ritual", () => {
  it("shares the global sound switch and does not allocate audio for muted or expired rituals", async () => {
    const s = setup();
    s.audio.playTemizu();
    s.audio.playTemizu(NaN);
    s.audio.playTemizu(Infinity);
    expect(s.createContext).not.toHaveBeenCalled();
    await s.audio.setEnabled(true);
    s.audio.playTemizu(TEMIZU_DURATION);
    expect(s.sources).toHaveLength(1);
    expect(s.buffers).toHaveLength(0);
    s.audio.dispose();
  });

  it("starts at the current wash phase and resumes from a later phase using one cached buffer", async () => {
    const s = setup();
    await s.audio.setEnabled(true);
    const cancel = s.audio.playTemizu(2.75);
    s.advance(40);
    await settle();
    const first = s.sources[1]!;
    expect(first.connect).toHaveBeenCalledWith(s.gain);
    expect(first.start).toHaveBeenCalledWith(0, 2.79);
    cancel();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(first.buffer).toBeNull();
    s.audio.playTemizu(5.5);
    await settle();
    expect(s.sources[2]!.start).toHaveBeenCalledWith(0, 5.5);
    expect(s.buffers).toHaveLength(1);
    expect(s.buffers[0]!.duration).toBeGreaterThanOrEqual(TEMIZU_DURATION);
    expect(s.buffers[0]!.duration).toBeLessThan(TEMIZU_DURATION + 0.3);
    s.changeVisibility(true);
    expect(s.sources[2]!.stop).toHaveBeenCalledOnce();
    expect(s.sources[2]!.buffer).toBeNull();
    s.audio.dispose();
  });
});
