import { describe, expect, it, vi } from "vitest";
import { ShrineAudio, type SoundSnapshot } from "../src/audio/ShrineAudio";

function setup(stored = "null", loader = vi.fn(async (_signal: AbortSignal) => new ArrayBuffer(8))) {
  class Visibility extends EventTarget { hidden = false; }
  const visibility = new Visibility();
  const sources: ReturnType<typeof createSource>[] = [];
  function createSource() {
    return { buffer: null, loop: false, onended: null,
      connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  }
  const gain = { gain: { value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    currentTime: 0, state: "suspended", destination: {}, onstatechange: null,
    createGain: vi.fn(() => gain),
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
  const audio = new ShrineAudio(changes, { createContext, load: loader, visibility, storage });
  const changeVisibility = (hidden: boolean) => {
    visibility.hidden = hidden;
    visibility.dispatchEvent(new Event("visibilitychange"));
  };
  return { audio, context, gain, sources, storage, loader, createContext, changeVisibility,
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
    expect(s.context.close).toHaveBeenCalledOnce();
    const calls = s.changes.mock.calls.length;
    s.changeVisibility(true);
    await s.audio.setEnabled(true);
    expect(s.changes).toHaveBeenCalledTimes(calls);
  });
});
