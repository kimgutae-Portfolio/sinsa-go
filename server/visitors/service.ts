import { randomUUID } from "node:crypto";
import {
  emptyVisitorCounters,
  type VisitorCounter,
  type VisitorSummary,
} from "../../src/shared/visitorStats";
import { validRoom } from "../../src/shared/multiplayer";
import {
  MemoryVisitorRepository,
  type StoredVisitor,
  type VisitorRepository,
} from "./repository";

export const VISIT_GAP_MS = 30 * 60 * 1000;
const JST_OFFSET = 9 * 3600000;
export function visitorDay(time: number) {
  return new Date(time + JST_OFFSET).toISOString().slice(0, 10);
}
export type VisitorActivity =
  | "prayerCount"
  | "fortuneCount"
  | "emaViewCount"
  | "lanternHangCount"
  | "lanternRemoveCount";
interface ActiveVisitor {
  sessions: Set<string>;
  accountedAt: number;
}
export class VisitorStatsService {
  private visitors = new Map<string, StoredVisitor>();
  private sessions = new Map<string, string>();
  private active = new Map<string, ActiveVisitor>();
  private revision = 0;
  private savedRevision = 0;
  private saving?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private onError: (error: unknown) => void;
  constructor(
    private repository: VisitorRepository = new MemoryVisitorRepository(),
    options: {
      saveIntervalMs?: number;
      onError?: (error: unknown) => void;
    } = {},
  ) {
    for (const visitor of repository.load())
      this.visitors.set(visitor.ownerHash, visitor);
    this.onError =
      options.onError ??
      ((error) =>
        console.error(
          "Visitor statistics could not be saved; pending changes will be retried.",
          error instanceof Error ? error.message : "Storage error",
        ));
    const interval = options.saveIntervalMs ?? 5000;
    if (interval > 0) {
      this.timer = setInterval(() => {
        void this.flush().catch(this.onError);
      }, interval);
      this.timer.unref();
    }
  }
  begin(ownerHash: string, sessionId: string, room: string, now: number) {
    if (
      !/^[a-f0-9]{64}$/.test(ownerHash) ||
      !validRoom(room) ||
      this.sessions.has(sessionId)
    )
      return false;
    let visitor = this.visitors.get(ownerHash);
    if (!visitor) {
      visitor = {
        visitorId: randomUUID(),
        ownerHash,
        accountId: null,
        firstSeenAt: now,
        lastSeenAt: now,
        lastRoom: room,
        ...emptyVisitorCounters(),
        daily: {},
      };
      this.visitors.set(ownerHash, visitor);
    }
    const active = this.active.get(ownerHash);
    const isNewVisit =
      visitor.connectionCount === 0 ||
      (!active && now - visitor.lastSeenAt >= VISIT_GAP_MS);
    if (active) this.account(ownerHash, now);
    else this.active.set(ownerHash, { sessions: new Set(), accountedAt: now });
    this.active.get(ownerHash)!.sessions.add(sessionId);
    this.sessions.set(sessionId, ownerHash);
    visitor.lastRoom = room;
    visitor.lastSeenAt = Math.max(visitor.lastSeenAt, now);
    this.increment(visitor, "connectionCount", 1, now);
    if (isNewVisit) this.increment(visitor, "visitCount", 1, now);
    return true;
  }
  record(ownerHash: string, activity: VisitorActivity, now: number) {
    const visitor = this.visitors.get(ownerHash);
    if (!visitor) return false;
    this.increment(visitor, activity, 1, now);
    visitor.lastSeenAt = Math.max(visitor.lastSeenAt, now);
    return true;
  }
  end(sessionId: string, now: number) {
    const ownerHash = this.sessions.get(sessionId);
    if (!ownerHash) return;
    this.account(ownerHash, now);
    const active = this.active.get(ownerHash)!;
    active.sessions.delete(sessionId);
    this.sessions.delete(sessionId);
    if (!active.sessions.size) this.active.delete(ownerHash);
  }
  pulse(now: number) {
    for (const ownerHash of this.active.keys()) this.account(ownerHash, now);
  }
  summary(ownerHash: string): VisitorSummary | null {
    const visitor = this.visitors.get(ownerHash);
    if (!visitor) return null;
    const {
      ownerHash: _owner,
      accountId: _account,
      daily: _daily,
      ...summary
    } = visitor;
    return { ...summary };
  }
  administration() {
    return [...this.visitors.values()].map(
      ({ accountId: _account, ...visitor }) => ({
        ...structuredClone(visitor),
        online: this.active.has(visitor.ownerHash),
      }),
    );
  }
  private increment(
    visitor: StoredVisitor,
    counter: VisitorCounter,
    amount: number,
    now: number,
  ) {
    const day = visitorDay(now);
    const daily = (visitor.daily[day] ??= emptyVisitorCounters());
    visitor[counter] += amount;
    daily[counter] += amount;
    this.revision++;
  }
  private account(ownerHash: string, now: number) {
    const active = this.active.get(ownerHash),
      visitor = this.visitors.get(ownerHash);
    if (!active || !visitor || now <= active.accountedAt) return;
    let start = active.accountedAt;
    while (start < now) {
      const end = Math.min(
        now,
        (Math.floor((start + JST_OFFSET) / 86400000) + 1) * 86400000 -
          JST_OFFSET,
      );
      this.increment(visitor, "connectedMs", end - start, start);
      start = end;
    }
    active.accountedAt = now;
    visitor.lastSeenAt = Math.max(visitor.lastSeenAt, now);
  }
  async flush(): Promise<void> {
    if (this.saving) {
      await this.saving;
      if (this.revision !== this.savedRevision) await this.flush();
      return;
    }
    if (this.revision === this.savedRevision) return;
    const task = (async () => {
      while (this.savedRevision !== this.revision) {
        const revision = this.revision;
        const snapshot = structuredClone([...this.visitors.values()]);
        await this.repository.save(snapshot);
        this.savedRevision = revision;
      }
    })();
    this.saving = task;
    try {
      await task;
    } finally {
      if (this.saving === task) this.saving = undefined;
    }
  }
  async dispose() {
    clearInterval(this.timer);
    await this.flush();
  }
}
