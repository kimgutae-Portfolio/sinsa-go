import { readFileSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  validVisitorSummary,
  validVisitorCounters,
  type VisitorCounters,
  type VisitorSummary,
} from "../../src/shared/visitorStats";

export interface StoredVisitor extends VisitorSummary {
  ownerHash: string;
  accountId: string | null;
  daily: Record<string, VisitorCounters>;
}
export interface VisitorRepository {
  load(): StoredVisitor[];
  save(visitors: StoredVisitor[]): Promise<void>;
}
export class MemoryVisitorRepository implements VisitorRepository {
  private visitors: StoredVisitor[] = [];
  load() {
    return structuredClone(this.visitors);
  }
  async save(visitors: StoredVisitor[]) {
    this.visitors = structuredClone(visitors);
  }
}
/** Local single-process persistence. Replace this adapter with a DB for scale. */
export class FileVisitorRepository implements VisitorRepository {
  constructor(readonly path: string) {}
  load(): StoredVisitor[] {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const data = JSON.parse(raw);
    if (
      data.version !== 1 ||
      data.timezone !== "Asia/Tokyo" ||
      !Array.isArray(data.visitors) ||
      !data.visitors.every(
        (item: StoredVisitor) =>
          validVisitorSummary(item) &&
          /^[a-f0-9]{64}$/.test(item.ownerHash) &&
          (item.accountId === null || typeof item.accountId === "string") &&
          item.daily &&
          typeof item.daily === "object" &&
          !Array.isArray(item.daily) &&
          Object.entries(item.daily).every(
            ([day, counters]) =>
              /^\d{4}-\d{2}-\d{2}$/.test(day) && validVisitorCounters(counters),
          ),
      )
    )
      throw new Error(
        "Invalid visitor store; restore a backup before starting the server.",
      );
    if (
      new Set(data.visitors.map((item: StoredVisitor) => item.ownerHash))
        .size !== data.visitors.length ||
      new Set(data.visitors.map((item: StoredVisitor) => item.visitorId))
        .size !== data.visitors.length
    )
      throw new Error("Duplicate visitor in store");
    return data.visitors;
  }
  async save(visitors: StoredVisitor[]) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(
          JSON.stringify({ version: 1, timezone: "Asia/Tokyo", visitors }),
        );
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, this.path);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }
}
