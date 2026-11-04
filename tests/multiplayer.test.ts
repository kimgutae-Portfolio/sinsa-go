import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createShrineServer } from "../server/app";
import type { ServerMessage, Visitor } from "../src/shared/multiplayer";
import { PROTOCOL_VERSION } from "../src/shared/multiplayer";
import { RITUAL_DURATION } from "../src/game/ritual";

class Guest {
  readonly socket: WebSocket;
  messages: ServerMessage[] = [];
  private listeners = new Set<() => void>();
  id = "";
  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on("message", (data) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage);
      this.listeners.forEach((fn) => fn());
    });
    this.socket.on("error", () => {});
  }
  wait(
    predicate: (message: ServerMessage) => boolean,
    after = 0,
  ): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const message = this.messages.slice(after).find(predicate);
        if (message) {
          clearTimeout(timer);
          this.listeners.delete(check);
          resolve(message);
        }
      };
      const timer = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error("Timed out waiting for room packet"));
      }, 3500);
      this.listeners.add(check);
      check();
    });
  }
  async join(room: string, visitorKey?: string) {
    await new Promise<void>((done, reject) => {
      if (this.socket.readyState === WebSocket.OPEN) {
        done();
        return;
      }
      this.socket.once("open", done);
      this.socket.once("error", reject);
    });
    this.send({ type: "join", version: PROTOCOL_VERSION, room, visitorKey });
    const welcome = await this.wait(
      (m) => m.type === "welcome" || m.type === "error",
    );
    if (welcome.type === "welcome") this.id = welcome.id;
    return welcome;
  }
  send(message: unknown) {
    this.socket.send(JSON.stringify(message));
  }
}
let app: ReturnType<typeof createShrineServer>;
let url: string;
let clock: number;
let guests: Guest[] = [];
beforeEach(async () => {
  clock = 10000;
  app = createShrineServer({ now: () => clock });
  await new Promise<void>((done, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", done);
  });
  const address = app.server.address();
  if (!address || typeof address === "string")
    throw new Error("No server address");
  url = `ws://127.0.0.1:${address.port}/realtime`;
});
afterEach(async () => {
  guests.forEach((g) => g.socket.terminate());
  guests = [];
  await app.close();
});
async function join(room = "test") {
  const guest = new Guest(url);
  guests.push(guest);
  expect((await guest.join(room)).type).toBe("welcome");
  return guest;
}
async function move(guest: Guest, seq: number, x: number, z: number) {
  clock += 1000;
  const cursor = guest.messages.length;
  guest.send({ type: "state", seq, x, z, yaw: Math.PI, motion: "Walk" });
  await guest.wait(
    (m) =>
      m.type === "snapshot" &&
      m.players.some(
        (p) =>
          p.id === guest.id &&
          Math.abs(p.x - x) < 0.001 &&
          Math.abs(p.z - z) < 0.001,
      ),
    cursor,
  );
}
function findPlayer(message: ServerMessage, id: string): Visitor {
  if (!("players" in message)) throw new Error("Expected snapshot");
  return message.players.find((p) => p.id === id)!;
}

describe("real WebSocket multiplayer", () => {
  it("shows new and late visitors in the same room with distinct identities and spawns", async () => {
    const a = await join();
    const b = await join();
    const roster = await a.wait(
      (m) => m.type === "snapshot" && m.players.length === 2,
    );
    const welcome = b.messages.find((m) => m.type === "welcome")!;
    expect(findPlayer(roster, a.id).name).not.toBe(
      findPlayer(roster, b.id).name,
    );
    expect(findPlayer(welcome, a.id).x).toBe(0);
    expect(findPlayer(welcome, b.id).x).toBe(2);
    expect(findPlayer(welcome, a.id).tint).not.toBe(
      findPlayer(welcome, b.id).tint,
    );
  });
  it("relays movement, direction and walking state", async () => {
    const a = await join();
    const b = await join();
    const cursor = b.messages.length;
    a.send({ type: "state", seq: 1, x: 0.5, z: 1.5, yaw: 0.7, motion: "Walk" });
    const packet = await b.wait(
      (m) =>
        m.type === "snapshot" &&
        m.players.some((p) => p.id === a.id && p.x === 0.5),
      cursor,
    );
    expect(findPlayer(packet, a.id).yaw).toBeCloseTo(0.7);
    expect(findPlayer(packet, a.id).motion).toBe("Walk");
  });
  it("keeps different rooms isolated", async () => {
    const a = await join("forest");
    const b = await join("courtyard");
    expect(
      findPlayer(
        b.messages.find((m) => m.type === "welcome")!,
        a.id,
      ),
    ).toBeUndefined();
    const cursor = a.messages.length;
    app.rooms.tick();
    const packet = await a.wait((m) => m.type === "snapshot", cursor);
    expect("players" in packet && packet.players.map((p) => p.id)).toEqual([
      a.id,
    ]);
    b.send({ type: "state", seq: 1, x: 0.4, z: 1.5, yaw: 0, motion: "Walk" });
    expect(app.rooms.rooms.size).toBe(2);
  });
  it("accepts 12 visitors and rejects the thirteenth without silently switching rooms", async () => {
    const all = await Promise.all(
      Array.from({ length: 12 }, () => join("busy")),
    );
    expect(app.rooms.rooms.get("busy")?.size).toBe(12);
    const extra = new Guest(url);
    guests.push(extra);
    const response = await extra.join("busy");
    expect(response.type === "error" && response.code).toBe("room_full");
    const roster = await all[0]!.wait(
      (m) => m.type === "snapshot" && m.players.length === 12,
    );
    expect(
      "players" in roster && new Set(roster.players.map((p) => p.id)).size,
    ).toBe(12);
  });
  it("removes a disconnected visitor and reuses only their vacant spawn", async () => {
    const a = await join();
    const b = await join();
    const cursor = a.messages.length;
    b.socket.terminate();
    const left = await a.wait(
      (m) => m.type === "snapshot" && m.players.length === 1,
      cursor,
    );
    expect(findPlayer(left, a.id)).toBeDefined();
    const c = await join();
    const welcome = c.messages.find((m) => m.type === "welcome")!;
    expect(c.id).not.toBe(b.id);
    expect(findPlayer(welcome, c.id).x).toBe(2);
  });
  it("rejects teleports and ignores attempts to spoof another visitor", async () => {
    const a = await join();
    const b = await join();
    a.send({
      type: "state",
      seq: 1,
      id: b.id,
      x: 12,
      z: 13,
      yaw: 0,
      motion: "Walk",
    });
    const correction = await a.wait((m) => m.type === "correction");
    expect(correction.type === "correction" && correction.player.x).toBe(0);
    expect(
      [...app.rooms.sessions].find((s) => s.player.id === b.id)?.player.x,
    ).toBe(2);
  });
  it("rejects movement through the offering box and discards stale sequence numbers", async () => {
    const a = await join();
    await move(a, 1, 0, 0.5);
    await move(a, 2, 0, -0.5);
    await move(a, 3, 0, -1.5);
    clock += 1000;
    a.send({
      type: "state",
      seq: 4,
      x: 0,
      z: -2.8,
      yaw: Math.PI,
      motion: "Walk",
    });
    const response = await a.wait((m) => m.type === "correction");
    expect(response.type === "correction" && response.player.z).toBe(-1.5);
    a.send({ type: "state", seq: 2, x: 1, z: -1.5, yaw: 0, motion: "Walk" });
    const cursor = a.messages.length;
    app.rooms.tick();
    const packet = await a.wait((m) => m.type === "snapshot", cursor);
    expect(findPlayer(packet, a.id).x).toBe(0);
  });
  it("requires proximity for prayer and shares its server timestamp and completion", async () => {
    const a = await join();
    const b = await join();
    a.send({ type: "pray" });
    expect((await a.wait((m) => m.type === "error")).type).toBe("error");
    await move(a, 1, 0, 0.5);
    await move(a, 2, 0, -0.5);
    await move(a, 3, 0, -1.5);
    const cursor = b.messages.length;
    a.send({ type: "pray" });
    const packet = await b.wait(
      (m) =>
        m.type === "snapshot" &&
        m.players.some((p) => p.id === a.id && p.motion === "Pray"),
      cursor,
    );
    const player = findPlayer(packet, a.id);
    expect(player.ritualStartedAt).toBe(clock);
    expect(player.ritualTarget?.z).toBe(-1.55);
    clock += 100;
    a.send({ type: "state", seq: 4, x: 0, z: 0, yaw: 0, motion: "Walk" });
    clock += RITUAL_DURATION * 1000;
    const next = b.messages.length;
    app.rooms.tick();
    const done = await b.wait(
      (m) =>
        m.type === "snapshot" &&
        m.players.some((p) => p.id === a.id && p.motion === "Idle"),
      next,
    );
    expect(findPlayer(done, a.id).z).toBe(-1.55);
    expect(findPlayer(done, a.id).ritualStartedAt).toBeNull();
  });
  it("assigns separate prayer spots and releases a spot when its owner resets", async () => {
    const all = await Promise.all(Array.from({ length: 4 }, () => join()));
    for (let i = 0; i < all.length; i++) {
      const g = all[i]!;
      const x = [0, 2, -2, 0][i]!;
      if (i === 3) {
        await move(g, 1, x, 1.5);
        await move(g, 2, x, 0.5);
        await move(g, 3, x, -0.2);
      } else {
        await move(g, 2, x, 0.5);
        await move(g, 3, x, -0.5);
        await move(g, 4, x, -1.5);
      }
    }
    for (const g of all.slice(0, 3)) {
      g.send({ type: "pray" });
      await g.wait(
        (m) => m.type === "correction" && m.player.motion === "Pray",
      );
    }
    const targets = [...app.rooms.sessions]
      .filter((s) => s.player.motion === "Pray")
      .map((s) => s.player.ritualTarget!.x);
    expect(new Set(targets).size).toBe(3);
    const fourth = all[3]!;
    fourth.send({ type: "pray" });
    expect(
      (await fourth.wait((m) => m.type === "error" && m.code === "ritual_busy"))
        .type,
    ).toBe("error");
    const first = all[0]!;
    const cursor = first.messages.length;
    first.send({ type: "reset" });
    await first.wait(
      (m) => m.type === "correction" && m.player.motion === "Idle",
      cursor,
    );
    const next = fourth.messages.length;
    fourth.send({ type: "pray" });
    expect(
      (
        await fourth.wait(
          (m) => m.type === "correction" && m.player.motion === "Pray",
          next,
        )
      ).type,
    ).toBe("correction");
  });
  it("bounds room names and handles malformed packets without affecting other guests", async () => {
    const bad = new Guest(url);
    guests.push(bad);
    expect((await bad.join("../private")).type).toBe("error");
    const good = await join();
    const abusive = new Guest(url);
    guests.push(abusive);
    await abusive.join("other");
    const closed = new Promise<void>((done) =>
      abusive.socket.once("close", () => done()),
    );
    abusive.socket.send("{oops");
    await closed;
    const cursor = good.messages.length;
    app.rooms.tick();
    expect((await good.wait((m) => m.type === "snapshot", cursor)).type).toBe(
      "snapshot",
    );
  });
  it("broadcasts a saved lantern to peers and restores ownership after reconnecting", async () => {
    const key = "lantern_owner_abcdefghijklmnopqrstuvwxyz";
    const a = new Guest(url);
    guests.push(a);
    await a.join("lights", key);
    const b = new Guest(url);
    guests.push(b);
    await b.join("lights", "lantern_other_abcdefghijklmnopqrstuvwxyz");
    a.send({
      type: "lantern-hang",
      requestId: "request_far",
      productId: "paper-warm",
      wish: "건강하기를",
      signature: "",
      slot: null,
    });
    expect(
      await a.wait(
        (m) => m.type === "lantern-result" && m.requestId === "request_far",
      ),
    ).toMatchObject({ ok: false, code: "too_far" });
    await move(a, 1, 0, 0.5);
    let seq = 2;
    for (const x of [1.2, 2.4, 3.6, 4.8, 6, 7]) await move(a, seq++, x, 0.5);
    for (const z of [-0.6, -1.7]) await move(a, seq++, 7, z);
    const cursor = b.messages.length;
    a.send({
      type: "lantern-hang",
      requestId: "request_light",
      productId: "paper-sakura",
      wish: "모두의 하루가 평온하기를.",
      signature: "나그네",
      slot: 0,
    });
    expect(
      await a.wait(
        (m) => m.type === "lantern-result" && m.requestId === "request_light",
      ),
    ).toMatchObject({ ok: true });
    const shared = await b.wait(
      (m) => m.type === "lanterns" && m.lanterns.length === 1,
      cursor,
    );
    await a.wait(
      (m) => m.type === "profile" && m.profile.lanternHangCount === 1,
    );
    const repeat = a.messages.length;
    a.send({
      type: "lantern-hang",
      requestId: "request_light",
      productId: "paper-sakura",
      wish: "모두의 하루가 평온하기를.",
      signature: "나그네",
      slot: 0,
    });
    await a.wait(
      (m) => m.type === "lantern-result" && m.requestId === "request_light",
      repeat,
    );
    const counted = await a.wait((m) => m.type === "profile", repeat);
    expect(counted.type === "profile" && counted.profile.lanternHangCount).toBe(
      1,
    );

    if (shared.type !== "lanterns") throw Error("Expected lanterns");
    expect(shared.mineIds).toEqual([]);
    expect(shared.lanterns[0]!.wish).toBe("모두의 하루가 평온하기를.");
    expect(JSON.stringify(shared)).not.toContain("ownerHash");
    expect(JSON.stringify(shared)).not.toContain(key);
    b.send({
      type: "lantern-remove",
      requestId: "request_delete",
      id: shared.lanterns[0]!.id,
    });
    expect(
      await b.wait(
        (m) => m.type === "lantern-result" && m.requestId === "request_delete",
      ),
    ).toMatchObject({ ok: false, code: "not_found" });
    const departed = new Promise<void>((resolve) =>
      a.socket.once("close", () => resolve()),
    );
    a.socket.terminate();
    await departed;
    const rejoined = new Guest(url);
    guests.push(rejoined);
    await rejoined.join("lights", key);
    const restored = await rejoined.wait(
      (m) => m.type === "lanterns" && m.mineIds.length === 1,
    );
    expect(restored.type === "lanterns" && restored.mineIds).toEqual([
      shared.lanterns[0]!.id,
    ]);
    rejoined.send({
      type: "lantern-remove",
      requestId: "request_remove",
      id: shared.lanterns[0]!.id,
    });
    const next = b.messages.length;
    expect(
      await rejoined.wait(
        (m) => m.type === "lantern-result" && m.requestId === "request_remove",
      ),
    ).toMatchObject({ ok: true });
    expect(
      await b.wait(
        (m) => m.type === "lanterns" && m.lanterns.length === 0,
        next,
      ),
    ).toMatchObject({ lanterns: [] });
  });
  it("restores private visitor statistics after reconnecting and does not share them with other visitors", async () => {
    const key = "stats_owner_abcdefghijklmnopqrstuvwxyz";
    const a = new Guest(url);
    guests.push(a);
    await a.join("history", key);
    const first = await a.wait((m) => m.type === "profile");
    if (first.type !== "profile") throw Error("Expected profile");
    const b = new Guest(url);
    guests.push(b);
    await b.join("history", "stats_other_abcdefghijklmnopqrstuvwxyz");
    await b.wait((m) => m.type === "profile");
    expect(
      b.messages.some(
        (m) =>
          m.type === "profile" &&
          m.profile.visitorId === first.profile.visitorId,
      ),
    ).toBe(false);
    expect(first.profile).toMatchObject({
      connectionCount: 1,
      visitCount: 1,
      prayerCount: 0,
    });
    expect(JSON.stringify(first)).not.toContain("ownerHash");
    const closed = new Promise<void>((resolve) =>
      a.socket.once("close", () => resolve()),
    );
    a.socket.terminate();
    await closed;
    clock += 1000;
    const again = new Guest(url);
    guests.push(again);
    await again.join("other-history", key);
    const restored = await again.wait(
      (m) => m.type === "profile" && m.profile.connectionCount === 2,
    );
    expect(restored.type === "profile" && restored.profile).toMatchObject({
      visitorId: first.profile.visitorId,
      visitCount: 1,
      connectionCount: 2,
      lastRoom: "other-history",
    });
    again.send({ type: "profile", profile: { prayerCount: 9999 } });
    clock += 10000;
    const cursor = again.messages.length;
    app.rooms.tick();
    const verified = await again.wait((m) => m.type === "profile", cursor);
    expect(verified.type === "profile" && verified.profile.prayerCount).toBe(0);
  });
  it("counts only completed server rituals once and excludes cancelled or remote prayers", async () => {
    const a = new Guest(url);
    guests.push(a);
    await a.join("ritual-records", "ritual_owner_abcdefghijklmnopqrstuvwxyz");
    a.send({ type: "pray" });
    await a.wait((m) => m.type === "error");
    await move(a, 1, 0, 0.5);
    await move(a, 2, 0, -0.5);
    await move(a, 3, 0, -1.5);
    a.send({ type: "pray" });
    await a.wait((m) => m.type === "correction" && m.player.motion === "Pray");
    a.send({ type: "pray" });
    clock += RITUAL_DURATION * 1000;
    app.rooms.tick();
    const completed = await a.wait(
      (m) => m.type === "profile" && m.profile.prayerCount === 1,
    );
    expect(completed.type === "profile" && completed.profile.prayerCount).toBe(
      1,
    );
    app.rooms.tick();
    const cursor = a.messages.length;
    a.send({ type: "pray" });
    await a.wait(
      (m) => m.type === "correction" && m.player.motion === "Pray",
      cursor,
    );
    clock += 1000;
    a.send({ type: "reset" });
    await a.wait(
      (m) => m.type === "correction" && m.player.motion === "Idle",
      cursor,
    );
    clock += RITUAL_DURATION * 1000;
    app.rooms.tick();
    const owner = [...app.rooms.sessions].find(
      (session) => session.player.id === a.id,
    )!.ownerHash;
    expect(app.rooms.stats.summary(owner)!.prayerCount).toBe(1);
  });
  it("validates proximity and cooldown for fortune and ema statistics instead of accepting client totals", async () => {
    const a = new Guest(url);
    guests.push(a);
    await a.join("activities", "activity_owner_abcdefghijklmnopqrstuvwxyz");
    a.send({ type: "activity", activity: "fortune", count: 999 });
    await move(a, 1, -1.3, 1.5);
    await move(a, 2, -2.6, 1.5);
    await move(a, 3, -3.9, 1.5);
    await move(a, 4, -5.2, 1.5);
    await move(a, 5, -6.5, 1.5);
    await move(a, 6, -6.5, 0.2);
    const cursor = a.messages.length;
    a.send({ type: "activity", activity: "fortune", count: 999 });
    a.send({ type: "activity", activity: "fortune" });
    a.send({ type: "activity", activity: "ema" });
    const profile = await a.wait(
      (m) => m.type === "profile" && m.profile.fortuneCount === 1,
      cursor,
    );
    expect(profile.type === "profile" && profile.profile).toMatchObject({
      fortuneCount: 1,
      emaViewCount: 0,
    });
    const next = a.messages.length;
    clock += 2000;
    a.send({ type: "activity", activity: "fortune" });
    expect(
      await a.wait(
        (m) => m.type === "profile" && m.profile.fortuneCount === 2,
        next,
      ),
    ).toMatchObject({ type: "profile" });
  });
  it("refuses cross-origin websocket upgrades and exposes a health endpoint", async () => {
    await join();
    const health = await fetch(
      url.replace("ws:", "http:").replace("/realtime", "/health"),
    ).then((r) => r.json());
    expect(health).toMatchObject({ ok: true, rooms: 1, visitors: 1 });
    const denied = new WebSocket(url, { origin: "https://unrelated.example" });
    denied.on("error", () => {});
    const status = await new Promise<number>((done) =>
      denied.on("unexpected-response", (_req, res) => {
        done(res.statusCode!);
        res.resume();
        denied.terminate();
      }),
    );
    expect(status).toBe(403);
  });
});
