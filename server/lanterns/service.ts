import { randomUUID } from "node:crypto";
import {
  FREE_LANTERN_POLICY,
  cleanLanternText,
  lanternProduct,
  MAX_SIGNATURE_LENGTH,
  MAX_WISH_LENGTH,
} from "../../src/shared/lanterns";
import type {
  LanternPolicy,
  LanternState,
  PublicLantern,
} from "../../src/shared/lanterns";
import {
  MemoryLanternRepository,
  type LanternRepository,
  type StoredLantern,
} from "./repository";

type Command =
  | {
      kind: "hang";
      room: string;
      ownerHash: string;
      requestId: string;
      productId: unknown;
      wish: unknown;
      signature: unknown;
      slot: unknown;
    }
  | {
      kind: "remove";
      room: string;
      ownerHash: string;
      requestId: string;
      id: unknown;
    };
export type LanternResult =
  | {
      ok: true;
      lanternId: string;
      message: string;
      change: "created" | "removed" | "none";
    }
  | { ok: false; code: string; message: string };
export class LanternService {
  private records: StoredLantern[];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private repository: LanternRepository = new MemoryLanternRepository(),
    private mode: LanternPolicy["mode"] = "free",
  ) {
    this.records = repository.load();
  }
  state(room: string, ownerHash: string, now: number): LanternState {
    const records = this.records.filter(
      (item) => item.room === room && item.expiresAt > now,
    );
    return {
      room,
      policy: { ...FREE_LANTERN_POLICY, mode: this.mode },
      mineIds: records
        .filter((item) => item.ownerHash === ownerHash)
        .map((item) => item.id),
      lanterns: records.map(
        ({
          id,
          productId,
          slot,
          wish,
          signature,
          createdAt,
          expiresAt,
        }): PublicLantern => ({
          id,
          productId,
          slot,
          wish,
          signature,
          createdAt,
          expiresAt,
        }),
      ),
    };
  }
  execute(command: Command, now: number): Promise<LanternResult> {
    const task = this.queue.then(() => this.commit(command, now));
    this.queue = task.catch(() => {});
    return task;
  }
  async flush() {
    await this.queue;
  }
  administration() {
    return structuredClone(this.records);
  }
  private async commit(command: Command, now: number): Promise<LanternResult> {
    const fail = (code: string, message: string): LanternResult => ({
      ok: false,
      code,
      message,
    });
    if (!/^[a-f0-9]{64}$/.test(command.ownerHash))
      return fail(
        "identity",
        "訪問情報を確認できませんでした。再読み込みしてからお試しください。",
      );
    if (!/^[a-zA-Z0-9_-]{8,64}$/.test(command.requestId))
      return fail(
        "invalid",
        "操作を確認できませんでした。もう一度お試しください。",
      );
    const active = this.records.filter((item) => item.expiresAt > now);
    if (command.kind === "remove") {
      const item = active.find(
        (item) =>
          item.id === command.id &&
          item.room === command.room &&
          item.ownerHash === command.ownerHash,
      );
      if (!item)
        return fail("not_found", "ご自身がかけた灯籠だけを取り下げられます。");
      const next = active.filter((record) => record.id !== item.id);
      try {
        await this.repository.save(next);
      } catch {
        return fail(
          "storage",
          "灯籠を取り下げられませんでした。しばらくしてからお試しください。",
        );
      }
      this.records = next;
      return {
        ok: true,
        lanternId: item.id,
        change: "removed",
        message: "灯籠をそっと取り下げました。",
      };
    }
    const duplicate = active.find(
      (item) =>
        item.room === command.room &&
        item.ownerHash === command.ownerHash &&
        item.requestId === command.requestId,
    );
    if (duplicate)
      return {
        ok: true,
        lanternId: duplicate.id,
        change: "none",
        message: "あなたの願いが、境内に灯りました。",
      };
    const product = lanternProduct(command.productId);
    if (this.mode !== "free")
      return fail(
        "purchase_required",
        "灯籠の無料体験は終了しました。有料での掲灯は準備中です。",
      );
    if (!product || product.availability !== "available")
      return fail(
        "unavailable",
        "この灯籠は準備中です。別の灯籠をお選びください。",
      );
    const wish = cleanLanternText(command.wish, MAX_WISH_LENGTH),
      signature = cleanLanternText(command.signature, MAX_SIGNATURE_LENGTH);
    if (!wish || signature === null)
      return fail(
        "invalid",
        "願いは1〜36文字、お名前は12文字以内でお書きください。",
      );
    const room = active.filter((item) => item.room === command.room);
    if (
      room.filter((item) => item.ownerHash === command.ownerHash).length >=
      FREE_LANTERN_POLICY.maxPerVisitor
    )
      return fail(
        "visitor_limit",
        "このルームには、すでにご自身の灯籠があります。「自分の灯籠」からご確認いただけます。",
      );
    if (room.length >= FREE_LANTERN_POLICY.capacity)
      return fail(
        "full",
        "すべての場所に灯籠がかかっています。しばらくしてからお越しください。",
      );
    const roomNames = new Set(active.map((item) => item.room));
    if (!roomNames.has(command.room) && roomNames.size >= 32)
      return fail(
        "full",
        "ただいま新しい境内に灯籠をかけられません。しばらくしてからお試しください。",
      );
    const occupied = new Set(room.map((item) => item.slot));
    const slot =
      command.slot === null
        ? Array.from(
            { length: FREE_LANTERN_POLICY.capacity },
            (_, i) => i,
          ).find((i) => !occupied.has(i))
        : command.slot;
    if (
      typeof slot !== "number" ||
      !Number.isInteger(slot) ||
      slot < 0 ||
      slot >= FREE_LANTERN_POLICY.capacity ||
      occupied.has(slot)
    )
      return fail(
        "occupied",
        "ほかの方が選んだ場所です。空いている場所をお選びください。",
      );
    const record: StoredLantern = {
      id: randomUUID(),
      room: command.room,
      ownerHash: command.ownerHash,
      requestId: command.requestId,
      issuance: "free",
      productId: product.id,
      slot,
      wish,
      signature: signature || "名無しの旅人",
      createdAt: now,
      expiresAt: now + FREE_LANTERN_POLICY.durationHours * 3600000,
    };
    const next = [...active, record];
    try {
      await this.repository.save(next);
    } catch {
      return fail(
        "storage",
        "灯籠を保存できませんでした。しばらくしてからお試しください。",
      );
    }
    this.records = next;
    return {
      ok: true,
      lanternId: record.id,
      change: "created",
      message: "あなたの願いが、境内に灯りました。",
    };
  }
}
