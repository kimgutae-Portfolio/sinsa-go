import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileVisitorRepository,
  MemoryVisitorRepository,
} from "../server/visitors/repository";
import {
  VisitorStatsService,
  VISIT_GAP_MS,
  visitorDay,
} from "../server/visitors/service";
const owner = (name = "a") => createHash("sha256").update(name).digest("hex");
const now = Date.UTC(2026, 10, 4, 2);
const services: VisitorStatsService[] = [];
let directory: string | undefined;
function service(repository = new MemoryVisitorRepository()) {
  const stats = new VisitorStatsService(repository, { saveIntervalMs: 0 });
  services.push(stats);
  return stats;
}
afterEach(async () => {
  for (const stats of services) await stats.dispose();
  services.length = 0;
  vi.restoreAllMocks();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});
describe("anonymous visitor statistics", () => {
  it("persists room changes without counting another connection or visit", async () => {
    const repository = new MemoryVisitorRepository();
    const stats = service(repository);
    stats.begin(owner(), "session", "komorebi", now);
    expect(stats.moveRoom("unknown-session", "hinoki", now)).toBe(false);
    expect(stats.moveRoom("session", "../invalid", now)).toBe(false);
    await stats.flush();
    expect(stats.moveRoom("session", "hinoki", now)).toBe(true);
    await stats.flush();
    expect(repository.load()[0]).toMatchObject({ lastRoom: "hinoki", connectionCount: 1, visitCount: 1, connectedMs: 0 });
    stats.moveRoom("session", "sugi", now + 1000);
    stats.end("session", now + 2000);
    expect(stats.summary(owner())).toMatchObject({ lastRoom: "sugi", connectionCount: 1, visitCount: 1, connectedMs: 2000 });
  });
  it("keeps a stable visitor across refreshes and separates connections from 30-minute visits", () => {
    const stats = service();
    stats.begin(owner(), "session1", "garden", now);
    const first = stats.summary(owner())!;
    stats.begin(owner(), "session1", "garden", now);
    expect(stats.summary(owner())!.connectionCount).toBe(1);
    stats.end("session1", now + 1000);
    stats.begin(owner(), "session2", "other", now + 2000);
    expect(stats.summary(owner())).toMatchObject({
      visitorId: first.visitorId,
      connectionCount: 2,
      visitCount: 1,
      firstSeenAt: now,
      lastRoom: "other",
    });
    stats.end("session2", now + 3000);
    stats.begin(owner(), "session3", "garden", now + 3000 + VISIT_GAP_MS);
    expect(stats.summary(owner())).toMatchObject({
      connectionCount: 3,
      visitCount: 2,
    });
    expect(stats.begin("invalid", "bad", "garden", now)).toBe(false);
    expect(stats.summary("invalid")).toBeNull();
  });
  it("counts connected time once across tabs and excludes time after the last session closes", () => {
    const stats = service();
    stats.begin(owner(), "one", "garden", now);
    stats.begin(owner(), "two", "garden", now + 1000);
    stats.pulse(now + 5000);
    stats.end("one", now + 6000);
    stats.end("one", now + 7000);
    stats.end("two", now + 8000);
    stats.pulse(now + 20000);
    expect(stats.summary(owner())).toMatchObject({
      connectionCount: 2,
      visitCount: 1,
      connectedMs: 8000,
      lastSeenAt: now + 8000,
    });
  });
  it("splits daily counters and session duration at midnight in Japan", async () => {
    const repo = new MemoryVisitorRepository();
    const stats = service(repo);
    const midnight = Date.UTC(2026, 10, 4, 15);
    stats.begin(owner(), "one", "garden", midnight - 2000);
    stats.record(owner(), "prayerCount", midnight - 1000);
    stats.end("one", midnight + 3000);
    await stats.flush();
    const daily = repo.load()[0]!.daily;
    expect(visitorDay(midnight)).toBe("2026-11-05");
    expect(daily["2026-11-04"]).toMatchObject({
      prayerCount: 1,
      connectedMs: 2000,
    });
    expect(daily["2026-11-05"]).toMatchObject({
      prayerCount: 0,
      connectedMs: 3000,
    });
  });
  it("saves activity counters and returns only the owner-facing summary", async () => {
    const repo = new MemoryVisitorRepository();
    const stats = service(repo);
    stats.begin(owner(), "one", "garden", now);
    for (const activity of [
      "prayerCount",
      "fortuneCount",
      "emaViewCount",
      "lanternHangCount",
      "lanternRemoveCount",
    ] as const)
      stats.record(owner(), activity, now + 1);
    await stats.flush();
    const summary = stats.summary(owner())!;
    expect(summary).toMatchObject({
      prayerCount: 1,
      fortuneCount: 1,
      emaViewCount: 1,
      lanternHangCount: 1,
      lanternRemoveCount: 1,
    });
    expect(JSON.stringify(summary)).not.toContain(owner());
    expect(summary).not.toHaveProperty("daily");
    expect(summary).not.toHaveProperty("accountId");
    expect(repo.load()[0]).toMatchObject({
      accountId: null,
      ownerHash: owner(),
    });
  });
  it("retries a failed save without discarding counters and preserves updates made during a write", async () => {
    const repo = new MemoryVisitorRepository();
    const stats = service(repo);
    const save = vi
      .spyOn(repo, "save")
      .mockRejectedValueOnce(new Error("Disk full"));
    stats.begin(owner(), "one", "garden", now);
    await expect(stats.flush()).rejects.toThrow("Disk full");
    expect(stats.summary(owner())!.connectionCount).toBe(1);
    let complete!: () => void;
    save.mockImplementationOnce(async (visitors) => {
      await new Promise<void>((resolve) => (complete = resolve));
      await MemoryVisitorRepository.prototype.save.call(repo, visitors);
    });
    const pending = stats.flush();
    stats.record(owner(), "prayerCount", now + 1000);
    complete();
    await pending;
    expect(repo.load()[0]!.prayerCount).toBe(1);
    expect(save).toHaveBeenCalledTimes(3);
  });
  it("restores statistics from disk and rejects corrupt files instead of erasing history", async () => {
    directory = await mkdtemp(join(tmpdir(), "shrine-visitors-"));
    const path = join(directory, "visitors.json");
    const first = new VisitorStatsService(new FileVisitorRepository(path), {
      saveIntervalMs: 0,
    });
    services.push(first);
    first.begin(owner(), "first", "garden", now);
    first.record(owner(), "prayerCount", now + 500);
    first.end("first", now + 1000);
    await first.flush();
    const second = new VisitorStatsService(new FileVisitorRepository(path), {
      saveIntervalMs: 0,
    });
    services.push(second);
    second.begin(owner(), "again", "garden", now + 2000);
    expect(second.summary(owner())).toMatchObject({
      visitorId: first.summary(owner())!.visitorId,
      connectionCount: 2,
      visitCount: 1,
      prayerCount: 1,
      connectedMs: 1000,
    });
    await second.flush();
    await writeFile(
      path,
      '{"version":1,"timezone":"Asia/Tokyo","visitors":[{}]}',
    );
    expect(() => new FileVisitorRepository(path).load()).toThrow(
      /Invalid visitor store/,
    );
  });
});
