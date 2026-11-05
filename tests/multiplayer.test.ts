import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createShrineServer } from "../server/app";
import type { ServerMessage, Visitor } from "../src/shared/multiplayer";
import { PROTOCOL_VERSION, PUBLIC_ROOMS, ROOM_CAPACITY } from "../src/shared/multiplayer";
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
async function join(room = "komorebi") {
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
  it("routes automatic arrivals to the next fixed room once eight visitors gather", async () => {
    const arrivals = [];
    for (let index = 0; index < 17; index++) {
      const guest = await join("auto");
      arrivals.push(guest.messages.find(message => message.type === "welcome"));
    }
    expect(arrivals.slice(0, 8)).toEqual(Array.from({ length: 8 }, () => expect.objectContaining({ room: "komorebi" })));
    expect(arrivals.slice(8, 16)).toEqual(Array.from({ length: 8 }, () => expect.objectContaining({ room: "hinoki" })));
    expect(arrivals[16]).toMatchObject({ room: "sugi", capacity: 15 });
  });
  it("uses the least occupied room when all rooms pass half capacity, and rejects only when all are full", async () => {
    for (const room of PUBLIC_ROOMS)
      for (let index = 0; index < 8; index++) await join(room.id);
    await join("komorebi");
    const balanced = await join("auto");
    expect(balanced.messages.find(message => message.type === "welcome")).toMatchObject({ room: "hinoki" });
    for (const room of PUBLIC_ROOMS) {
      while ((app.rooms.rooms.get(room.id)?.size ?? 0) < ROOM_CAPACITY) await join(room.id);
    }
    const extra = new Guest(url);
    guests.push(extra);
    expect(await extra.join("auto")).toMatchObject({ type: "error", code: "server_full" });
  }, 15000);
  it("publishes all fixed rooms including empty rooms and updates other rooms on arrivals and departures", async () => {
    const observer = new Guest(url);
    guests.push(observer);
    const initial = await observer.wait(message => message.type === "rooms");
    expect(initial).toMatchObject({ type: "rooms", rooms: PUBLIC_ROOMS.map(room => ({ ...room, count: 0, capacity: 15 })) });
    const cursor = observer.messages.length;
    const guest = await join("hinoki");
    const arrived = await observer.wait(message => message.type === "rooms" && message.rooms.find(room => room.id === "hinoki")?.count === 1, cursor);
    expect(JSON.stringify(arrived)).not.toContain("ownerHash");
    const next = observer.messages.length;
    guest.socket.terminate();
    await observer.wait(message => message.type === "rooms" && message.rooms.every(room => room.count === 0), next);
  });
  it("does not create rooms from user-supplied names or accept the previous protocol", async () => {
    const custom = new Guest(url);
    guests.push(custom);
    expect(await custom.join("custom-garden")).toMatchObject({ type: "error", code: "invalid_room" });
    expect(app.rooms.rooms.size).toBe(0);
    const old = new Guest(url);
    guests.push(old);
    await new Promise<void>(resolve => old.socket.once("open", resolve));
    old.send({ type: "join", version: PROTOCOL_VERSION - 1, room: "komorebi" });
    expect(await old.wait(message => message.type === "error")).toMatchObject({ code: "protocol" });
  });
  it("moves on the existing connection with the same identity and without inflating visitor counters", async () => {
    const a = new Guest(url);
    guests.push(a);
    await a.join("komorebi", "moving_owner_abcdefghijklmnopqrstuvwxyz");
    const b = await join("komorebi");
    const c = await join("hinoki");
    const first = await a.wait(message => message.type === "profile");
    if (first.type !== "profile") throw Error("Expected profile");
    const originalId = a.id;
    await move(a, 1, 0.4, 1.5);
    const cursor = a.messages.length;
    const oldCursor = b.messages.length;
    const nextCursor = c.messages.length;
    a.send({ type: "switch-room", room: "hinoki" });
    const welcome = await a.wait(message => message.type === "welcome", cursor);
    expect(welcome).toMatchObject({ id: originalId, room: "hinoki" });
    expect(findPlayer(welcome, a.id)).toMatchObject({ x: 2, z: 1.5, motion: "Idle" });
    await b.wait(message => message.type === "snapshot" && message.players.length === 1 && message.players[0]?.id === b.id, oldCursor);
    await c.wait(message => message.type === "snapshot" && message.players.some(player => player.id === a.id), nextCursor);
    const profile = await a.wait(message => message.type === "profile", cursor);
    expect(profile.type === "profile" && profile.profile).toMatchObject({ visitorId: first.profile.visitorId, lastRoom: "hinoki", connectionCount: 1, visitCount: 1 });
    expect(a.socket.readyState).toBe(WebSocket.OPEN);
    const stateCursor = a.messages.length;
    a.send({ type: "state", seq: 1, x: 2.4, z: 1.5, yaw: Math.PI, motion: "Walk" });
    await a.wait(message => message.type === "snapshot" && message.players.some(player => player.id === a.id && player.x === 2.4), stateCursor);
    const repeatCursor = a.messages.length;
    a.send({ type: "switch-room", room: "sugi" });
    expect(await a.wait(message => message.type === "error", repeatCursor)).toMatchObject({ code: "room_busy" });
    expect([...app.rooms.sessions].find(session => session.player.id === a.id)?.room).toBe("hinoki");
    clock += 1000;
    const laterCursor = a.messages.length;
    a.send({ type: "switch-room", room: "sugi" });
    expect(await a.wait(message => message.type === "welcome", laterCursor)).toMatchObject({ room: "sugi", id: originalId });
  });
  it("keeps a visitor in their current room when a target is full or invalid", async () => {
    await Promise.all(Array.from({ length: ROOM_CAPACITY }, () => join("komorebi")));
    const a = await join("hinoki");
    const before = findPlayer(a.messages.find(message => message.type === "welcome")!, a.id);
    let cursor = a.messages.length;
    a.send({ type: "switch-room", room: "komorebi" });
    expect(await a.wait(message => message.type === "error", cursor)).toMatchObject({ code: "room_full" });
    cursor = a.messages.length;
    a.send({ type: "switch-room", room: "my-private-room" });
    expect(await a.wait(message => message.type === "error", cursor)).toMatchObject({ code: "invalid_room" });
    const session = [...app.rooms.sessions].find(session => session.player.id === a.id)!;
    expect(session.room).toBe("hinoki");
    expect(session.player).toEqual(before);
    expect(a.socket.readyState).toBe(WebSocket.OPEN);
    expect(app.rooms.rooms.get("hinoki")?.size).toBe(1);
    expect(app.rooms.rooms.get("komorebi")?.size).toBe(15);
  });
  it("refuses a room change during prayer but leaves the ritual intact", async () => {
    const a = await join();
    await move(a, 1, 0, 0.5);
    await move(a, 2, 0, -0.5);
    await move(a, 3, 0, -1.5);
    a.send({ type: "pray" });
    const ritual = await a.wait(message => message.type === "correction" && message.player.motion === "Pray");
    const sameCursor = a.messages.length;
    a.send({ type: "switch-room", room: "komorebi" });
    const sameRoom = await a.wait(message => message.type === "welcome", sameCursor);
    expect(findPlayer(sameRoom, a.id).motion).toBe("Pray");
    const cursor = a.messages.length;
    a.send({ type: "switch-room", room: "hinoki" });
    expect(await a.wait(message => message.type === "error", cursor)).toMatchObject({ code: "room_busy" });
    const session = [...app.rooms.sessions].find(session => session.player.id === a.id)!;
    expect(session.room).toBe("komorebi");
    expect(session.player.motion).toBe("Pray");
    expect(session.player.ritualStartedAt).toBe(ritual.type === "correction" && ritual.player.ritualStartedAt);
  });
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
    const a = await join("hinoki");
    const b = await join("sugi");
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
  it("accepts 15 visitors and rejects the sixteenth without silently switching rooms", async () => {
    const all = await Promise.all(
      Array.from({ length: 15 }, () => join("komorebi")),
    );
    expect(app.rooms.rooms.get("komorebi")?.size).toBe(15);
    const extra = new Guest(url);
    guests.push(extra);
    const response = await extra.join("komorebi");
    expect(response.type === "error" && response.code).toBe("room_full");
    const roster = await all[0]!.wait(
      (m) => m.type === "snapshot" && m.players.length === 15,
    );
    expect(
      "players" in roster && new Set(roster.players.map((p) => p.id)).size,
    ).toBe(15);
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
    await abusive.join("hinoki");
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
    await a.join("komorebi", key);
    const b = new Guest(url);
    guests.push(b);
    await b.join("komorebi", "lantern_other_abcdefghijklmnopqrstuvwxyz");
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
    await rejoined.join("komorebi", key);
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
    await a.join("komorebi", key);
    const first = await a.wait((m) => m.type === "profile");
    if (first.type !== "profile") throw Error("Expected profile");
    const b = new Guest(url);
    guests.push(b);
    await b.join("komorebi", "stats_other_abcdefghijklmnopqrstuvwxyz");
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
    await again.join("hinoki", key);
    const restored = await again.wait(
      (m) => m.type === "profile" && m.profile.connectionCount === 2,
    );
    expect(restored.type === "profile" && restored.profile).toMatchObject({
      visitorId: first.profile.visitorId,
      visitCount: 1,
      connectionCount: 2,
      lastRoom: "hinoki",
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
    await a.join("komorebi", "ritual_owner_abcdefghijklmnopqrstuvwxyz");
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
    await a.join("komorebi", "activity_owner_abcdefghijklmnopqrstuvwxyz");
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
