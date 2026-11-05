import { readFileSync } from "node:fs";
import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { PublicLantern } from "../../src/shared/lanterns";
import { validPublicLantern } from "../../src/shared/lanterns";
import { validRoom } from "../../src/shared/multiplayer";

/** Private ownership and issuance never travel in a room broadcast. */
export interface StoredLantern extends PublicLantern {
  room: string;
  ownerHash: string;
  issuance: "free";
  requestId: string;
}
export interface LanternRepository {
  load(): StoredLantern[];
  save(records: StoredLantern[]): Promise<void>;
}
export class MemoryLanternRepository implements LanternRepository {
  private records: StoredLantern[] = [];
  load() {
    return structuredClone(this.records);
  }
  async save(records: StoredLantern[]) {
    this.records = structuredClone(records);
  }
}
/** One process only. Atomic replace prevents half-written saves after a crash. */
export class FileLanternRepository implements LanternRepository {
  constructor(readonly path: string) {}
  load(): StoredLantern[] {
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
      !Array.isArray(data.lanterns) ||
      data.lanterns.length > 768 ||
      !data.lanterns.every(
        (item: StoredLantern) =>
          validPublicLantern(item) &&
          validRoom(item.room) &&
          /^[a-f0-9]{64}$/.test(item.ownerHash) &&
          item.issuance === "free" &&
          typeof item.requestId === "string" &&
          item.requestId.length <= 64,
      )
    )
      throw new Error(
        "Invalid lantern store; restore a backup before starting the server.",
      );
    const ids = new Set<string>(),
      slots = new Set<string>(),
      owners = new Set<string>();
    for (const item of data.lanterns) {
      const slot = `${item.room}:${item.slot}`;
      if (ids.has(item.id) || slots.has(slot) || owners.has(item.ownerHash))
        throw new Error("Duplicate lantern in store");
      ids.add(item.id);
      slots.add(slot);
      owners.add(item.ownerHash);
    }
    return data.lanterns;
  }
  async save(records: StoredLantern[]) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(JSON.stringify({ version: 1, lanterns: records }));
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
