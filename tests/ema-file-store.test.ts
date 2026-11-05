import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileLanternRepository, type StoredLantern } from "../server/lanterns/repository";

describe("global ema ownership in file storage", () => {
  it("refuses legacy cross-room duplicates without changing the source file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "shrine-global-ema-"));
    try {
      const path = join(directory, "lanterns.json");
      const original: StoredLantern = {
        id: "ema-first", room: "komorebi", ownerHash: "a".repeat(64),
        productId: "paper-warm", slot: 0, wish: "穏やかな一日を", signature: "旅人",
        createdAt: 1000, expiresAt: 100000, issuance: "free", requestId: "request_0001",
      };
      const source = JSON.stringify({ version: 1, lanterns: [original,
        { ...original, id: "ema-second", room: "hinoki", requestId: "request_0002" },
      ] });
      await writeFile(path, source);
      expect(() => new FileLanternRepository(path).load()).toThrow("Duplicate lantern");
      expect(await readFile(path, "utf8")).toBe(source);

      await writeFile(path, JSON.stringify({ version: 1, lanterns: [original,
        { ...original, id: "ema-other-owner", room: "hinoki", ownerHash: "b".repeat(64) },
      ] }));
      expect(new FileLanternRepository(path).load()).toHaveLength(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
