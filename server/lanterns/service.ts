import { randomUUID } from "node:crypto";
import {
  FREE_LANTERN_POLICY,
  cleanLanternText,
  lanternProduct,
  MAX_SIGNATURE_LENGTH,
  MAX_WISH_LENGTH,
} from "../../src/shared/lanterns";
import { REPORT_THRESHOLD, wishProblem } from "../../src/shared/moderation";
import { ShrineDatabaseError } from "../storage/supabase";
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
    }
  | {
      kind: "report";
      room: string;
      ownerHash: string;
      requestId: string;
      id: unknown;
    }
  | {
      kind: "moderate";
      id: string;
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
  /** Reporter hashes per ema. Kept in memory; a restart simply resets the tally. */
  private reports = new Map<string, Set<string>>();
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
  reportCount(id: string) {
    return this.reports.get(id)?.size ?? 0;
  }
  private reportStorageError(error: unknown) {
    console.error(
      "Ema storage operation failed.",
      error instanceof ShrineDatabaseError ? error.message : "Storage operation failed.",
    );
  }
  private async commit(command: Command, now: number): Promise<LanternResult> {
    const fail = (code: string, message: string): LanternResult => ({
      ok: false,
      code,
      message,
    });
    const active = this.records.filter((item) => item.expiresAt > now);
    const takeDown = async (
      item: StoredLantern,
      message: string,
    ): Promise<LanternResult> => {
      const next = active.filter((record) => record.id !== item.id);
      try {
        await this.repository.save(next);
      } catch (error) {
        this.reportStorageError(error);
        return fail(
          "storage",
          "絵馬を外せませんでした。しばらくしてからお試しください。",
        );
      }
      this.records = next;
      this.reports.delete(item.id);
      return { ok: true, lanternId: item.id, change: "removed", message };
    };
    if (command.kind === "moderate") {
      const item = active.find((record) => record.id === command.id);
      if (!item) return fail("not_found", "絵馬が見つかりませんでした。");
      return takeDown(item, "絵馬を外しました。");
    }
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
    if (command.kind === "report") {
      const item = active.find(
        (record) => record.id === command.id && record.room === command.room,
      );
      if (!item) return fail("not_found", "絵馬が見つかりませんでした。");
      if (item.ownerHash === command.ownerHash)
        return fail("own", "ご自身の絵馬は「絵馬を外す」から外せます。");
      const reporters = this.reports.get(item.id) ?? new Set<string>();
      if (reporters.has(command.ownerHash))
        return {
          ok: true,
          lanternId: item.id,
          change: "none",
          message: "すでにお知らせいただいています。ありがとうございます。",
        };
      reporters.add(command.ownerHash);
      this.reports.set(item.id, reporters);
      const thanks = "お知らせありがとうございます。内容を確認いたします。";
      if (reporters.size >= REPORT_THRESHOLD) return takeDown(item, thanks);
      return { ok: true, lanternId: item.id, change: "none", message: thanks };
    }
    if (command.kind === "remove") {
      const item = active.find(
        (item) =>
          item.id === command.id &&
          item.room === command.room &&
          item.ownerHash === command.ownerHash,
      );
      if (!item)
        return fail("not_found", "ご自身が掛けた絵馬だけを外せます。");
      return takeDown(item, "絵馬をそっと外しました。");
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
        message: "あなたの絵馬を、絵馬掛けに結びました。",
      };
    const product = lanternProduct(command.productId);
    if (this.mode !== "free")
      return fail(
        "purchase_required",
        "ただいま絵馬の奉納をお休みしています。しばらくしてからお越しください。",
      );
    if (!product || product.availability !== "available")
      return fail(
        "unavailable",
        "この絵馬はお選びいただけません。別の絵馬をお選びください。",
      );
    const wish = cleanLanternText(command.wish, MAX_WISH_LENGTH),
      signature = cleanLanternText(command.signature, MAX_SIGNATURE_LENGTH);
    if (!wish || signature === null)
      return fail(
        "invalid",
        "願いは1〜36文字、お名前は12文字以内でお書きください。",
      );
    const problem = wishProblem(wish) ?? wishProblem(signature);
    if (problem) return fail("moderation", problem);
    const room = active.filter((item) => item.room === command.room);
    if (
      room.filter((item) => item.ownerHash === command.ownerHash).length >=
      FREE_LANTERN_POLICY.maxPerVisitor
    )
      return fail(
        "visitor_limit",
        "このルームには、すでにご自身の絵馬があります。「自分の絵馬」からご確認いただけます。",
      );
    if (room.length >= FREE_LANTERN_POLICY.capacity)
      return fail(
        "full",
        "絵馬掛けがいっぱいです。しばらくしてからお越しください。",
      );
    const roomNames = new Set(active.map((item) => item.room));
    if (!roomNames.has(command.room) && roomNames.size >= 32)
      return fail(
        "full",
        "ただいま新しい境内に絵馬を掛けられません。しばらくしてからお試しください。",
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
    } catch (error) {
      this.reportStorageError(error);
      return fail(
        "storage",
        "絵馬を保存できませんでした。しばらくしてからお試しください。",
      );
    }
    this.records = next;
    return {
      ok: true,
      lanternId: record.id,
      change: "created",
      message: "あなたの絵馬を、絵馬掛けに結びました。",
    };
  }
}
