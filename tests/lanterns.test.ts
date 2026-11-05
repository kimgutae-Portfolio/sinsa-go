import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { LanternService } from "../server/lanterns/service";
import { ShrineDatabaseError } from "../server/storage/supabase";
import {
  FileLanternRepository,
  MemoryLanternRepository,
} from "../server/lanterns/repository";
import { MAX_WISH_LENGTH, cleanLanternText } from "../src/shared/lanterns";
import { validTravel, spawnPosition } from "../src/shared/multiplayer";
import { Vector2, Vector3 } from "three";
import { AssetLoader } from "../src/game/AssetLoader";
import { World } from "../src/game/World";
import { PlayerController } from "../src/game/PlayerController";
import { CameraController } from "../src/game/CameraController";
import { EMA_LAYOUT, TEMIZU_LAYOUT } from "../src/game/layout";
import { EmaBoard } from "../src/game/EmaBoard";
import { LanternGarden } from "../src/game/LanternGarden";
import { REPORT_THRESHOLD, wishProblem } from "../src/shared/moderation";
import { TEMIZU_DURATION } from "../src/game/ritual";
import { disposeObject } from "../src/game/geometry";
const owner = (name: string) => createHash("sha256").update(name).digest("hex");
const hang = (
  key = "a",
  requestId = "request_0001",
  slot: number | null = null,
) => ({
  kind: "hang" as const,
  room: "garden",
  ownerHash: owner(key),
  requestId,
  productId: "paper-warm",
  wish: "소중한 사람들이 건강하기를.",
  signature: "",
  slot,
});
const now = 1700000000000;
let directory: string | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (directory) {
    await rm(directory, { recursive: true, force: true });
    directory = undefined;
  }
});

describe("lantern issuance and future paid phase", () => {
  it("assigns duration and free issuance on the server and never broadcasts ownership secrets", async () => {
    const service = new LanternService();
    const result = await service.execute(
      {
        ...hang(),
        expiresAt: now + 9999999999,
        paid: true,
        price: 0,
      } as ReturnType<typeof hang>,
      now,
    );
    expect(result.ok).toBe(true);
    const state = service.state("garden", owner("a"), now);
    expect(state.lanterns[0]!.expiresAt).toBe(now + 24 * 3600000);
    expect(state.mineIds).toEqual([state.lanterns[0]!.id]);
    expect(JSON.stringify(state)).not.toContain(owner("a"));
    expect(state.lanterns[0]!.signature).toBe("名無しの旅人");
    expect(service.state("garden", owner("b"), now).mineIds).toEqual([]);
  });
  it("replays the same request once, bounds each visitor, and serializes competing slots", async () => {
    const service = new LanternService();
    const result = await service.execute(hang(), now);
    expect(await service.execute(hang(), now)).toEqual({
      ...result,
      change: "none",
    });
    expect(await service.execute(hang("a", "request_0002"), now)).toMatchObject(
      { ok: false, code: "visitor_limit" },
    );
    const competing = await Promise.all([
      service.execute(hang("b", "request_0003", 3), now),
      service.execute(hang("c", "request_0004", 3), now),
    ]);
    expect(competing.filter((item) => item.ok)).toHaveLength(1);
    expect(competing[1]).toMatchObject({ ok: false, code: "occupied" });
  });
  it("shares one visitor quota across rooms while exposing only the owner's room metadata", async () => {
    const service = new LanternService();
    const results = await Promise.all([
      service.execute({ ...hang(), room: "komorebi", wish: "大切な願い" }, now),
      service.execute({ ...hang("a", "request_0002"), room: "hinoki" }, now),
    ]);
    expect(results.map(result => result.ok)).toEqual([true, false]);
    expect(results[1]).toMatchObject({ code: "visitor_limit", message: expect.stringContaining("第一境内") });
    const id = service.state("komorebi", owner("a"), now).mineIds[0]!;
    const elsewhere = service.state("hinoki", owner("a"), now);
    expect(elsewhere).toMatchObject({ lanterns: [], mineIds: [], ownLantern: { id, room: "komorebi", expiresAt: now + 24 * 3600000 } });
    expect(JSON.stringify(elsewhere)).not.toContain("大切な願い");
    expect(JSON.stringify(elsewhere)).not.toContain(owner("a"));
    expect(service.state("hinoki", owner("b"), now).ownLantern).toBeNull();
    expect(await service.execute({ ...hang("b"), room: "hinoki" }, now)).toMatchObject({ ok: true });
    expect(await service.execute({ kind: "remove", room: "hinoki", ownerHash: owner("a"), requestId: "remove_0001", id }, now)).toMatchObject({ ok: false, code: "not_found" });
    expect(await service.execute({ kind: "remove", room: "komorebi", ownerHash: owner("a"), requestId: "remove_0002", id }, now)).toMatchObject({ ok: true });
    expect(service.state("hinoki", owner("a"), now).ownLantern).toBeNull();
    expect(await service.execute({ ...hang("a", "request_0003"), room: "hinoki" }, now)).toMatchObject({ ok: true });
  });
  it("releases the global quota on expiry and administrator removal", async () => {
    const service = new LanternService();
    const initial = await service.execute({ ...hang(), room: "komorebi" }, now);
    if (!initial.ok) throw Error(initial.message);
    expect(service.activeSignature(now)).toContain(initial.lanternId);
    const expired = now + 24 * 3600000;
    expect(service.state("hinoki", owner("a"), expired).ownLantern).toBeNull();
    expect(service.activeSignature(expired)).toBe("");
    const replacement = await service.execute({ ...hang("a", "request_0002"), room: "hinoki" }, expired);
    if (!replacement.ok) throw Error(replacement.message);
    expect(await service.execute({ kind: "moderate", id: replacement.lanternId }, expired)).toMatchObject({ ok: true });
    expect(await service.execute({ ...hang("a", "request_0003"), room: "sugi" }, expired)).toMatchObject({ ok: true });
  });
  it("blocks every new lantern in paid mode even when a client claims payment or uses an old free product", async () => {
    const repo = new MemoryLanternRepository();
    const free = new LanternService(repo);
    await free.execute(hang(), now);
    const paid = new LanternService(repo, "paid");
    expect(paid.state("garden", owner("a"), now).policy.mode).toBe("paid");
    expect(
      await paid.execute(
        {
          ...hang("b"),
          paymentStatus: "paid",
          amount: 0,
          issuance: "free",
        } as ReturnType<typeof hang>,
        now,
      ),
    ).toMatchObject({ ok: false, code: "purchase_required" });
    const id = paid.state("garden", owner("a"), now).mineIds[0]!;
    expect(
      await paid.execute(
        {
          kind: "remove",
          room: "garden",
          ownerHash: owner("a"),
          requestId: "remove_0001",
          id,
        },
        now,
      ),
    ).toMatchObject({ ok: true });
  });
  it("does not issue planned designs, long wishes, invalid slots, or anonymous requests without a key", async () => {
    const service = new LanternService();
    expect(
      await service.execute({ ...hang(), productId: "festival-gold" }, now),
    ).toMatchObject({ ok: false, code: "unavailable" });
    expect(
      await service.execute(
        { ...hang(), wish: "願".repeat(MAX_WISH_LENGTH + 1) },
        now,
      ),
    ).toMatchObject({ ok: false, code: "invalid" });
    expect(await service.execute({ ...hang(), slot: 24 }, now)).toMatchObject({
      ok: false,
      code: "occupied",
    });
    expect(
      await service.execute({ ...hang(), ownerHash: "" }, now),
    ).toMatchObject({ ok: false, code: "identity" });
    expect(cleanLanternText("  작은\n\u202E소원  ", 36)).toBe("작은 소원");
    expect(cleanLanternText("🌸".repeat(36), 36)).toHaveLength(72);
  });
  it("allows only the owner to remove a lantern, keeps rooms separate, and releases expired slots and quota", async () => {
    const service = new LanternService();
    const result = await service.execute(hang("a", "request_0001", 0), now);
    if (!result.ok) throw Error(result.message);
    expect(
      await service.execute(
        {
          kind: "remove",
          room: "garden",
          ownerHash: owner("b"),
          requestId: "remove_0001",
          id: result.lanternId,
        },
        now,
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    expect(service.state("other", owner("a"), now).lanterns).toHaveLength(0);
    expect(
      service.state("garden", owner("a"), now + 24 * 3600000).lanterns,
    ).toHaveLength(0);
    expect(
      await service.execute(hang("a", "request_0002", 0), now + 24 * 3600000),
    ).toMatchObject({ ok: true });
  });
  it("does not publish or consume a slot when persistence fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = new MemoryLanternRepository();
    const save = vi
      .spyOn(repo, "save")
      .mockRejectedValueOnce(new Error("Disk full"));
    const service = new LanternService(repo);
    expect(await service.execute(hang(), now)).toMatchObject({
      ok: false,
      code: "storage",
    });
    expect(service.state("garden", owner("a"), now).lanterns).toHaveLength(0);
    expect(await service.execute(hang(), now)).toMatchObject({ ok: true });
    expect(save).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("Ema storage operation failed.", "Storage operation failed.");
  });
  it("logs only safe storage diagnostics while keeping browser errors and wishes private", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const repo = new MemoryLanternRepository();
    vi.spyOn(repo, "save")
      .mockRejectedValueOnce(new ShrineDatabaseError(400, "23514"))
      .mockRejectedValueOnce(new Error("private wish private signature secret-key"));
    const service = new LanternService(repo);
    const command = { ...hang(), wish: "private wish", signature: "private name" };
    for (let index = 0; index < 2; index++) {
      expect(await service.execute(command, now)).toEqual({ ok: false, code: "storage",
        message: "絵馬を保存できませんでした。しばらくしてからお試しください。" });
    }
    expect(log.mock.calls[0]).toEqual(["Ema storage operation failed.", expect.stringContaining("HTTP 400 (23514)")]);
    expect(log.mock.calls[1]).toEqual(["Ema storage operation failed.", "Storage operation failed."]);
    for (const secret of [command.wish, command.signature, "private signature", "secret-key"])
      expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
  });
  it("retains lanterns and private ownership across server restarts and fails closed on a corrupt store", async () => {
    directory = await mkdtemp(join(tmpdir(), "shrine-lanterns-"));
    const path = join(directory, "lanterns.json");
    const first = new LanternService(new FileLanternRepository(path));
    await first.execute(hang(), now);
    const second = new LanternService(new FileLanternRepository(path));
    expect(second.state("garden", owner("a"), now)).toEqual(
      first.state("garden", owner("a"), now),
    );
    await writeFile(path, '{"version":1,"lanterns":[{"id":"corrupt"}]}');
    expect(() => new LanternService(new FileLanternRepository(path))).toThrow(
      /Invalid lantern store/,
    );
  });
});
describe("ema board rendering and navigation", () => {
  it("can reach the ema board from the entrance without crossing its frame", async () => {
    const assets = new AssetLoader();
    const world = new World(assets);
    await world.init();
    const player = new PlayerController(
      world.colliders,
      new CameraController(),
    );
    const target = new Vector3(
      EMA_LAYOUT.approach.x,
      0,
      EMA_LAYOUT.approach.z,
    );
    expect(player.navigate(target)).toBe(true);
    for (let i = 0; i < 1200 && player.navigating; i++)
      player.update(1 / 60, new Vector2(), true);
    expect(player.root.position.distanceTo(target)).toBeLessThan(0.15);
    assets.dispose();
    disposeObject(player.root);
    disposeObject(world.root);
  });
  it("accepts 10Hz client navigation samples from every multiplayer spawn", async () => {
    const assets = new AssetLoader();
    const world = new World(assets);
    await world.init();
    const blocked: unknown[] = [];
    for (let slot = 0; slot < 12; slot++) {
      const player = new PlayerController(
        world.colliders,
        new CameraController(),
      );
      player.setPosition(spawnPosition(slot));
      let previous = {
        x: player.root.position.x,
        z: player.root.position.z,
        yaw: 0,
      };
      player.navigate(
        new Vector3(EMA_LAYOUT.approach.x, 0, EMA_LAYOUT.approach.z),
      );
      for (let frame = 0; frame < 1200 && player.navigating; frame++) {
        player.update(1 / 60, new Vector2(), true);
        if (frame % 6 === 5 || !player.navigating) {
          const next = {
            x: player.root.position.x,
            z: player.root.position.z,
            yaw: 0,
          };
          if (!validTravel(previous, next))
            blocked.push({ slot, previous, next });
          previous = next;
        }
      }
      disposeObject(player.root);
    }
    assets.dispose();
    disposeObject(world.root);
    expect(blocked).toEqual([]);
  });
  it("reuses instances as ema change and releases its own scene resources", () => {
    const board = new EmaBoard();
    const children = board.root.children.length;
    board.setEma([
      {
        id: "test",
        productId: "paper-sakura",
        slot: 2,
        wish: "건강하기를",
        signature: "나그네",
        createdAt: now,
        expiresAt: now + 10000,
      },
    ]);
    board.update(1 / 60);
    board.setEma([]);
    expect(board.root.children.length).toBe(children);
    board.dispose();
    expect(board.root.children).toHaveLength(0);
    const rack = new LanternGarden();
    rack.update(1 / 60);
    rack.dispose();
    expect(rack.root.children).toHaveLength(0);
  });
  it("walks to the basin and plays the four temizu steps before finishing", async () => {
    const assets = new AssetLoader();
    const world = new World(assets);
    await world.init();
    const player = new PlayerController(world.colliders, new CameraController());
    const target = new Vector3(TEMIZU_LAYOUT.approach.x, 0, TEMIZU_LAYOUT.approach.z);
    expect(player.navigate(target)).toBe(true);
    for (let i = 0; i < 1200 && player.navigating; i++)
      player.update(1 / 60, new Vector2(), true);
    expect(player.root.position.distanceTo(target)).toBeLessThan(0.15);
    const done = vi.fn();
    player.purify(done);
    expect(player.busy).toBe(true);
    expect(player.navigate(new Vector3(0, 0, 5))).toBe(false);
    const steps = new Set<number>();
    for (let t = 0; t < TEMIZU_DURATION + 0.2; t += 1 / 30) {
      player.update(1 / 30, player.busy ? new Vector2(1, 0) : new Vector2(), true);
      steps.add(player.ritualStep);
    }
    expect([...steps].filter((step) => step >= 0)).toEqual([0, 1, 2, 3]);
    expect(done).toHaveBeenCalledOnce();
    expect(player.state).toBe("Idle");
    expect(player.root.position.distanceTo(target)).toBeLessThan(0.01);
    assets.dispose();
    disposeObject(player.root);
    disposeObject(world.root);
  });
});
describe("ema moderation", () => {
  it("blocks contact details and abusive words but keeps ordinary wishes", () => {
    for (const ok of [
      "こころすこやかに過ごせますように",
      "ほしねがい、叶いますように",
      "2026年 合格しますように",
      "부자 되게 해주세요",
      "grape juice every day",
    ])
      expect(wishProblem(ok)).toBeNull();
    for (const bad of ["死ね", "シネ", "line id: abc", "090-1234-5678", "www.example.com", "씨발", "f u c k"])
      expect(wishProblem(bad)).not.toBeNull();
  });
  it("rejects filtered wishes on the server", async () => {
    const service = new LanternService();
    expect(
      await service.execute({ ...hang(), wish: "連絡は www.example.com まで" }, now),
    ).toMatchObject({ ok: false, code: "moderation" });
  });
  it("takes an ema down after enough distinct visitors report it", async () => {
    const service = new LanternService();
    await service.execute(hang("owner"), now);
    const id = service.state("garden", owner("owner"), now).lanterns[0]!.id;
    const report = (key: string) =>
      service.execute(
        { kind: "report", room: "garden", ownerHash: owner(key), requestId: `report_${key}_01`, id },
        now,
      );
    expect(await report("owner")).toMatchObject({ ok: false, code: "own" });
    for (let i = 1; i < REPORT_THRESHOLD; i++) {
      expect(await report(`r${i}`)).toMatchObject({ ok: true, change: "none" });
      expect(await report(`r${i}`)).toMatchObject({ ok: true, change: "none" });
    }
    expect(service.state("garden", "", now).lanterns).toHaveLength(1);
    expect(service.reportCount(id)).toBe(REPORT_THRESHOLD - 1);
    expect(await report("last")).toMatchObject({ ok: true, change: "removed" });
    expect(service.state("garden", "", now).lanterns).toHaveLength(0);
  });
  it("lets the administrator take any ema down", async () => {
    const service = new LanternService();
    await service.execute(hang(), now);
    const id = service.state("garden", "", now).lanterns[0]!.id;
    expect(await service.execute({ kind: "moderate", id }, now)).toMatchObject({
      ok: true,
      change: "removed",
    });
    expect(await service.execute({ kind: "moderate", id }, now)).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});
