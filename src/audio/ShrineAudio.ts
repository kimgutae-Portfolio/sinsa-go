export type SoundState = "off" | "loading" | "playing" | "paused" | "blocked" | "error";
export interface SoundSnapshot {
  state: SoundState;
  enabled: boolean;
  volume: number;
  remembered: boolean;
}
interface AudioEnvironment {
  createContext: () => AudioContext;
  load: (signal: AbortSignal) => Promise<ArrayBuffer>;
  visibility: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  storage?: Pick<Storage, "getItem" | "setItem">;
}
const SETTINGS_KEY = "komorebi.sound.v1";
const DEFAULT_VOLUME = 0.35;
function browserEnvironment(): AudioEnvironment {
  let storage: Storage | undefined;
  try { storage = localStorage; } catch { /* Private browsing may deny storage. */ }
  return {
    createContext: () => {
      const Constructor = window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) throw new Error("Web Audio unavailable");
      return new Constructor({ latencyHint: "playback" });
    },
    load: async (signal) => {
      const response = await fetch(`${import.meta.env.BASE_URL}audio/shrine-garden.mp3`, { signal });
      if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
      return response.arrayBuffer();
    },
    visibility: document,
    storage,
  };
}

/** Lazy, gesture-started audio. No render loop, network request or context before enable(). */
export class ShrineAudio {
  private context?: AudioContext;
  private gain?: GainNode;
  private buffer?: AudioBuffer;
  private loading?: Promise<AudioBuffer>;
  private source?: AudioBufferSourceNode;
  private sources = new Set<AudioBufferSourceNode>();
  private abort = new AbortController();
  private offset = 0;
  private startedAt = 0;
  private disposed = false;
  private generation = 0;
  private suspendTimer?: ReturnType<typeof setTimeout>;
  private settings: SoundSnapshot = {
    state: "off", enabled: false, volume: DEFAULT_VOLUME, remembered: false,
  };
  constructor(
    private readonly onChange: (value: SoundSnapshot) => void,
    private readonly environment = browserEnvironment(),
  ) {
    try {
      const stored = JSON.parse(environment.storage?.getItem(SETTINGS_KEY) ?? "null");
      if (typeof stored?.volume === "number" && Number.isFinite(stored.volume))
        this.settings.volume = Math.max(0, Math.min(1, stored.volume));
      this.settings.remembered = stored?.enabled === true;
    } catch { /* Corrupt or unavailable settings must never block the game. */ }
    environment.visibility.addEventListener("visibilitychange", this.onVisibility);
    this.publish();
  }
  get snapshot() { return { ...this.settings }; }
  private publish() { if (!this.disposed) this.onChange(this.snapshot); }
  private save() {
    try {
      this.environment.storage?.setItem(SETTINGS_KEY,
        JSON.stringify({ enabled: this.settings.remembered, volume: this.settings.volume }));
    } catch { /* Sound still works without persistent preferences. */ }
  }
  setVolume(volume: number) {
    if (this.disposed || !Number.isFinite(volume)) return;
    this.settings.volume = Math.max(0, Math.min(1, volume));
    if (this.context && this.gain) {
      this.gain.gain.cancelScheduledValues(this.context.currentTime);
      this.gain.gain.setTargetAtTime(this.settings.volume, this.context.currentTime, 0.05);
    }
    this.save();
    this.publish();
  }
  async setEnabled(enabled: boolean) {
    if (this.disposed) return;
    this.settings.enabled = enabled;
    this.settings.remembered = enabled;
    this.save();
    clearTimeout(this.suspendTimer);
    const generation = ++this.generation;
    if (!enabled) {
      this.stopPlayback(true);
      this.settings.state = "off";
      this.publish();
      this.suspendTimer = setTimeout(() => {
        if (!this.disposed && !this.settings.enabled) void this.context?.suspend().catch(() => {});
      }, 180);
      return;
    }
    this.settings.state = "loading";
    this.publish();
    try {
      if (!this.context) {
        this.context = this.environment.createContext();
        this.gain = this.context.createGain();
        this.gain.gain.value = 0;
        this.gain.connect(this.context.destination);
        this.context.onstatechange = () => {
          if (this.settings.enabled && this.source && !this.environment.visibility.hidden &&
              this.context?.state !== "running") {
            this.settings.state = "blocked";
            this.publish();
          }
        };
      }
      // Must happen synchronously in the click handler, before fetching/decoding.
      const resumed = this.context.resume();
      const [buffer] = await Promise.all([
        this.buffer ?? (this.loading ??= this.loadBuffer(this.context)), resumed,
      ]);
      if (this.disposed || generation !== this.generation) return;
      this.buffer = buffer;
      if (this.environment.visibility.hidden) {
        this.settings.state = "paused";
        await this.context.suspend();
      } else if (this.context.state !== "running") {
        this.settings.state = "blocked";
      } else {
        this.startPlayback();
      }
      this.publish();
    } catch {
      if (this.disposed || generation !== this.generation) return;
      this.stopPlayback(false);
      this.settings.state = this.buffer ? "blocked" : "error";
      void this.context?.suspend().catch(() => {});
      this.publish();
    }
  }
  private async loadBuffer(context: AudioContext) {
    try {
      const bytes = await this.environment.load(this.abort.signal);
      if (this.disposed) throw new Error("Disposed");
      const buffer = await context.decodeAudioData(bytes);
      if (!this.disposed) this.buffer = buffer;
      return buffer;
    } finally { this.loading = undefined; }
  }
  private startPlayback() {
    const context = this.context;
    if (!context || !this.buffer || !this.gain) return;
    if (!this.source) {
      // A rapid off/on must not mix a fading previous source into the new one.
      for (const old of this.sources) { old.disconnect(); }
      const source = context.createBufferSource();
      source.buffer = this.buffer;
      source.loop = true;
      source.connect(this.gain);
      this.sources.add(source);
      source.onended = () => { source.disconnect(); this.sources.delete(source); };
      source.start(0, this.offset);
      this.startedAt = context.currentTime;
      this.source = source;
    }
    this.gain.gain.cancelScheduledValues(context.currentTime);
    this.gain.gain.setValueAtTime(0, context.currentTime);
    this.gain.gain.linearRampToValueAtTime(this.settings.volume, context.currentTime + 1.2);
    this.settings.state = "playing";
  }
  private stopPlayback(fade: boolean) {
    if (!this.context || !this.source || !this.buffer) return;
    this.offset = (this.offset + this.context.currentTime - this.startedAt) % this.buffer.duration;
    const now = this.context.currentTime;
    if (fade && this.gain) {
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setValueAtTime(this.gain.gain.value, now);
      this.gain.gain.linearRampToValueAtTime(0, now + 0.12);
    }
    this.source.stop(fade ? now + 0.13 : now);
    this.source = undefined;
  }
  private onVisibility = () => {
    if (this.disposed || !this.settings.enabled) return;
    if (this.environment.visibility.hidden) {
      ++this.generation;
      clearTimeout(this.suspendTimer);
      this.stopPlayback(false);
      void this.context?.suspend().catch(() => {});
      this.settings.state = "paused";
      this.publish();
    } else {
      void this.setEnabled(true);
    }
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.generation;
    clearTimeout(this.suspendTimer);
    this.abort.abort();
    this.environment.visibility.removeEventListener("visibilitychange", this.onVisibility);
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
      source.buffer = null;
    }
    this.sources.clear();
    this.source = undefined;
    this.gain?.disconnect();
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
    }
    this.buffer = undefined;
    this.loading = undefined;
  }
}
