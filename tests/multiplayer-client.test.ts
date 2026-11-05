import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mesh, Vector3 } from "three";
import {
  MultiplayerClient,
  type MultiplayerCallbacks,
} from "../src/game/MultiplayerClient";
import { RemotePlayer } from "../src/game/RemotePlayer";
import {
  PROTOCOL_VERSION,
  PUBLIC_ROOMS,
  ROOM_CAPACITY,
  type ServerMessage,
  type Visitor,
  type RoomSummary,
} from "../src/shared/multiplayer";
import { FREE_LANTERN_POLICY } from "../src/shared/lanterns";
import { surface } from "../src/game/surfaces";

const visitor = (id = "a", x = 0): Visitor => ({
  id,
  name: `나그네 ${id}`,
  tint: "#b9c9b1",
  x,
  z: 1.5,
  yaw: Math.PI,
  motion: "Idle",
  ritualStartedAt: null,
  ritualFrom: null,
  ritualTarget: null,
});
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  constructor(readonly url: URL) {
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(value: string) {
    this.sent.push(value);
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.();
  }
  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}
const directory = (occupiedRoom = "komorebi", count = 2): RoomSummary[] =>
  PUBLIC_ROOMS.map(room => ({ ...room, count: room.id === occupiedRoom ? count : 0, capacity: ROOM_CAPACITY }));
function welcome(
  socket: FakeSocket,
  players = [visitor(), visitor("b", 2)],
  room = "komorebi",
) {
  socket.receive({
    type: "welcome",
    version: PROTOCOL_VERSION,
    id: "a",
    room,
    capacity: ROOM_CAPACITY,
    serverTime: Date.now() + 500,
    players,
    rooms: directory(room, players.length),
  });
}
let client: MultiplayerClient;
let callbacks: MultiplayerCallbacks;
beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal("location", new URL("http://localhost:4173/?room=komorebi"));
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("WebSocket", FakeSocket);
  callbacks = {
    sample: () => ({ x: 0.4, z: 1.5, yaw: 0, motion: "Walk" }),
    onPresence: vi.fn(),
    onPlayers: vi.fn(),
    onSelf: vi.fn(),
    onNotice: vi.fn(),
    onLanterns: vi.fn(),
  };
  client = new MultiplayerClient(callbacks);
});
afterEach(() => {
  client.dispose();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("multiplayer client lifecycle", () => {
  it("joins before streaming, publishes peers, corrects only self, and releases all timers and page listeners", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    client.connect();
    const socket = FakeSocket.instances[0]!;
    expect(socket.url.toString()).toBe("ws://localhost:4173/realtime");
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: "join",
      version: PROTOCOL_VERSION,
      room: "komorebi",
      visitorKey: expect.any(String),
    });
    vi.advanceTimersByTime(200);
    expect(socket.sent).toHaveLength(1);
    welcome(socket);
    expect(client.connected).toBe(true);
    expect(callbacks.onPlayers).toHaveBeenLastCalledWith(
      [visitor("b", 2)],
      expect.any(Number),
    );
    vi.advanceTimersByTime(100);
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({
      type: "state",
      seq: 1,
      x: 0.4,
      motion: "Walk",
    });
    const before = vi.mocked(callbacks.onSelf).mock.calls.length;
    socket.receive({
      type: "correction",
      serverTime: Date.now(),
      player: visitor("b"),
    });
    expect(callbacks.onSelf).toHaveBeenCalledTimes(before);
    socket.receive({
      type: "correction",
      serverTime: Date.now(),
      player: visitor("a", 1),
    });
    expect(callbacks.onSelf).toHaveBeenLastCalledWith(
      visitor("a", 1),
      "correction",
    );
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("pageshow"));
    vi.advanceTimersByTime(30000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
  it("removes ghosts on disconnect and reconnects with a fresh sequence", () => {
    client.connect();
    const first = FakeSocket.instances[0]!;
    first.open();
    welcome(first);
    vi.advanceTimersByTime(200);
    first.close();
    expect(client.connected).toBe(false);
    expect(callbacks.onPlayers).toHaveBeenLastCalledWith(
      [],
      expect.any(Number),
    );
    vi.advanceTimersByTime(1300);
    const second = FakeSocket.instances[1]!;
    expect(second).toBeDefined();
    second.open();
    welcome(second);
    vi.advanceTimersByTime(100);
    expect(JSON.parse(second.sent.at(-1)!)).toMatchObject({
      type: "state",
      seq: 1,
    });
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "connected", count: 2 }),
    );
  });
  it("handles lantern results and ignores snapshots from a different room", async () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    welcome(socket);
    const pending = client.hangLantern("paper-warm", "평온하기를", "", 3);
    const message = JSON.parse(socket.sent.at(-1)!);
    expect(message).toMatchObject({ type: "lantern-hang", slot: 3 });
    socket.receive({
      type: "lantern-result",
      requestId: message.requestId,
      ok: true,
      message: "소원을 밝혔습니다.",
    });
    expect(await pending).toEqual({ ok: true, message: "소원을 밝혔습니다." });
    socket.receive({
      type: "lanterns",
      serverTime: Date.now(),
      room: "other",
      lanterns: [],
      mineIds: [],
      ownLantern: null,
      policy: FREE_LANTERN_POLICY,
    });
    expect(callbacks.onLanterns).not.toHaveBeenCalled();
    socket.receive({
      type: "lanterns",
      serverTime: Date.now(),
      room: "komorebi",
      lanterns: [],
      mineIds: [],
      ownLantern: null,
      policy: { ...FREE_LANTERN_POLICY, mode: "paid" },
    });
    expect(callbacks.onLanterns).toHaveBeenLastCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ mode: "paid" }),
      }),
    );
    expect(vi.getTimerCount()).toBe(1);
  });
  it("keeps another room's own-ema notice private and carries its quota through a room change", async () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    welcome(socket);
    const own = { id: "my-ema", room: "sugi", expiresAt: Date.now() + 3600000 };
    socket.receive({ type: "lanterns", room: "komorebi", serverTime: Date.now(),
      lanterns: [], mineIds: [], ownLantern: own, policy: FREE_LANTERN_POLICY });
    expect(callbacks.onLanterns).toHaveBeenLastCalledWith({ room: "komorebi",
      lanterns: [], mineIds: [], ownLantern: own, policy: FREE_LANTERN_POLICY });
    const before = socket.sent.length;
    expect(await client.hangLantern("paper-warm", "新しい願い", "", 0)).toMatchObject({ ok: false });
    expect(socket.sent).toHaveLength(before);
    expect(client.joinRoom("hinoki")).toBe(true);
    welcome(socket, [visitor()], "hinoki");
    expect(callbacks.onLanterns).toHaveBeenLastCalledWith(expect.objectContaining({
      room: "hinoki", lanterns: [], mineIds: [], ownLantern: own,
    }));
    socket.receive({ type: "lanterns", room: "hinoki", serverTime: Date.now(),
      lanterns: [], mineIds: [], ownLantern: null, policy: FREE_LANTERN_POLICY });
    const pending = client.hangLantern("paper-warm", "新しい願い", "", 0);
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: "lantern-hang" });
    socket.close();
    expect(await pending).toMatchObject({ ok: false });
    expect(callbacks.onLanterns).toHaveBeenLastCalledWith(expect.objectContaining({
      ownLantern: null, mineIds: [], lanterns: [],
    }));
  });
  it("rejects malformed or contradictory ownership metadata and copies only its public fields", () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    welcome(socket);
    const base = { type: "lanterns" as const, room: "komorebi", serverTime: Date.now(),
      lanterns: [], mineIds: [], policy: FREE_LANTERN_POLICY };
    const before = vi.mocked(callbacks.onLanterns!).mock.calls.length;
    for (const ownLantern of [
      undefined,
      { id: "", room: "sugi", expiresAt: Date.now() + 1000 },
      { id: "my-ema", room: "../bad", expiresAt: Date.now() + 1000 },
      { id: "my-ema", room: "sugi", expiresAt: Infinity },
      { id: "my-ema", room: "komorebi", expiresAt: Date.now() + 1000 },
    ]) socket.receive({ ...base, ownLantern } as unknown as ServerMessage);
    expect(callbacks.onLanterns).toHaveBeenCalledTimes(before);
    socket.receive({ ...base, ownLantern: { id: "my-ema", room: "sugi",
      expiresAt: Date.now() + 1000, wish: "other-room private wish", ownerHash: "private-owner" } } as unknown as ServerMessage);
    const state = vi.mocked(callbacks.onLanterns!).mock.calls.at(-1)![0];
    expect(state.ownLantern).toEqual({ id: "my-ema", room: "sugi", expiresAt: Date.now() + 1000 });
    expect(JSON.stringify(state)).not.toContain("private");
  });
  it("accepts ownership in the current room only when it matches the room's own ema", () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    welcome(socket);
    const ema = { id: "my-ema", productId: "paper-warm" as const, slot: 0, wish: "穏やかな一日を",
      signature: "旅人", createdAt: Date.now(), expiresAt: Date.now() + 3600000 };
    const own = { id: ema.id, room: "komorebi", expiresAt: ema.expiresAt };
    socket.receive({ type: "lanterns", room: "komorebi", serverTime: Date.now(),
      lanterns: [ema], mineIds: [ema.id], ownLantern: own, policy: FREE_LANTERN_POLICY });
    expect(callbacks.onLanterns).toHaveBeenLastCalledWith(expect.objectContaining({ mineIds: [ema.id], ownLantern: own }));
    const before = vi.mocked(callbacks.onLanterns!).mock.calls.length;
    for (const ownLantern of [null, { ...own, room: "sugi" }, { ...own, id: "different-ema" }])
      socket.receive({ type: "lanterns", room: "komorebi", serverTime: Date.now(),
        lanterns: [ema], mineIds: [ema.id], ownLantern, policy: FREE_LANTERN_POLICY });
    expect(callbacks.onLanterns).toHaveBeenCalledTimes(before);
  });
  it("settles pending lantern requests when disconnecting and does not send duplicates", async () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    welcome(socket);
    const first = client.hangLantern("paper-warm", "소원", "", null);
    expect(client.joinRoom("hinoki")).toBe(false);
    expect(
      await client.hangLantern("paper-warm", "소원", "", null),
    ).toMatchObject({ ok: false });
    expect(
      socket.sent
        .map((item) => JSON.parse(item))
        .filter((item) => item.type === "lantern-hang"),
    ).toHaveLength(1);
    socket.close();
    expect(await first).toMatchObject({ ok: false });
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["room_full", "server_full"] as const)("stops retrying after %s and can enter another room explicitly", (code) => {
    client.connect();
    const first = FakeSocket.instances[0]!;
    first.open();
    first.receive({ type: "error", code, message: "가득 찼어요" });
    vi.advanceTimersByTime(30000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "full" }),
    );
    expect(client.joinRoom("../bad")).toBe(false);
    expect(client.joinRoom("hinoki")).toBe(true);
    const second = FakeSocket.instances[1]!;
    second.open();
    welcome(second, [visitor()], "hinoki");
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: "connected",
        room: "hinoki",
        count: 1,
        peers: [],
      }),
    );
  });
  it("rejects a welcome missing its own player and times out into reconnect", () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    welcome(socket, [visitor("b")]);
    expect(client.connected).toBe(false);
    vi.advanceTimersByTime(8000);
    expect(socket.readyState).toBe(3);
    vi.advanceTimersByTime(1300);
    expect(FakeSocket.instances).toHaveLength(2);
  });
  it("requests automatic admission for a plain URL or legacy custom link and reconnects to the assigned public room", () => {
    client.dispose();
    vi.stubGlobal("location", new URL("http://localhost:4173/"));
    client = new MultiplayerClient(callbacks);
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ type: "join", room: "auto" });
    welcome(socket, [visitor()], "hinoki");
    expect(client.connected).toBe(true);
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(expect.objectContaining({ room: "hinoki", state: "connected" }));
    socket.close();
    vi.advanceTimersByTime(1300);
    const reconnected = FakeSocket.instances[1]!;
    reconnected.open();
    expect(JSON.parse(reconnected.sent[0]!)).toMatchObject({ type: "join", room: "hinoki" });
    client.dispose();
    vi.stubGlobal("location", new URL("http://localhost:4173/?room=old-custom-room"));
    client = new MultiplayerClient(callbacks);
    client.connect();
    const legacy = FakeSocket.instances.at(-1)!;
    legacy.open();
    expect(JSON.parse(legacy.sent[0]!)).toMatchObject({ room: "auto" });
  });
  it("publishes bounded live room counts using catalog names and ignores invalid directories", () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ type: "rooms", rooms: directory().map(room => ({ ...room, name: "untrusted display name" })) });
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(expect.objectContaining({
      rooms: directory(),
    }));
    const before = vi.mocked(callbacks.onPresence).mock.calls.length;
    for (const rooms of [
      [{ ...directory()[0]!, count: 16 }],
      [{ ...directory()[0]!, count: -1 }],
      [{ ...directory()[0]!, capacity: 16 }],
      [directory()[0]!, directory()[0]!],
      [{ ...directory()[0]!, id: "made-up" }],
    ]) socket.receive({ type: "rooms", rooms });
    expect(callbacks.onPresence).toHaveBeenCalledTimes(before);
    socket.receive({ type: "rooms", rooms: directory("sugi", 8) });
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(expect.objectContaining({ rooms: directory("sugi", 8) }));
  });
  it("moves on the same connection only after confirmation, preserving peers and ema until then", () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    welcome(socket);
    expect(client.joinRoom("custom-room")).toBe(false);
    expect(client.joinRoom("komorebi")).toBe(false);
    expect(client.joinRoom("hinoki")).toBe(true);
    expect(client.joinRoom("sugi")).toBe(false);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({ type: "switch-room", room: "hinoki" });
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(expect.objectContaining({
      room: "komorebi", switchingTo: "hinoki", count: 2, peers: [expect.objectContaining({ id: "b" })],
    }));
    expect(callbacks.onLanterns).not.toHaveBeenCalled();
    const sentBefore = socket.sent.length;
    vi.advanceTimersByTime(200);
    expect(client.pray()).toBe(false);
    expect(client.reset()).toBe(false);
    expect(socket.sent).toHaveLength(sentBefore);
    welcome(socket, [visitor("a", -2), visitor("c", 2)], "hinoki");
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(expect.objectContaining({
      room: "hinoki", switchingTo: null, state: "connected", peers: [expect.objectContaining({ id: "c" })],
    }));
    expect(callbacks.onSelf).toHaveBeenLastCalledWith(visitor("a", -2), "welcome");
    expect(callbacks.onLanterns).toHaveBeenLastCalledWith(expect.objectContaining({ room: "hinoki", lanterns: [] }));
    vi.advanceTimersByTime(100);
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: "state", seq: 1 });
    expect(vi.getTimerCount()).toBe(1);
  });
  it("retains the current room when a manual move is rejected and ignores unsolicited welcomes", () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    welcome(socket);
    const selfCalls = vi.mocked(callbacks.onSelf).mock.calls.length;
    welcome(socket, [visitor()], "sugi");
    expect(callbacks.onSelf).toHaveBeenCalledTimes(selfCalls);
    expect(client.joinRoom("hinoki")).toBe(true);
    welcome(socket, [visitor()], "sugi");
    expect(callbacks.onSelf).toHaveBeenCalledTimes(selfCalls);
    socket.receive({ type: "error", code: "room_full", message: "この境内は満員です。" });
    expect(client.connected).toBe(true);
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(expect.objectContaining({ room: "komorebi", state: "connected", switchingTo: null, count: 2 }));
    expect(callbacks.onLanterns).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    expect(client.joinRoom("sugi")).toBe(true);
    socket.receive({ type: "error", code: "room_busy", message: "参拝を終えてから移動してください。" });
    expect(client.connected).toBe(true);
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(expect.objectContaining({ room: "komorebi", switchingTo: null }));
  });
  it("times out a pending move into the last confirmed room and clears all move timers on disposal", () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    welcome(socket);
    client.joinRoom("hinoki");
    vi.advanceTimersByTime(8000);
    expect(socket.readyState).toBe(3);
    expect(client.connected).toBe(false);
    vi.advanceTimersByTime(1300);
    const reconnect = FakeSocket.instances[1]!;
    reconnect.open();
    expect(JSON.parse(reconnect.sent[0]!)).toMatchObject({ type: "join", room: "komorebi" });
    welcome(reconnect);
    client.joinRoom("sugi");
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps automatic selection of the current room from resetting the avatar or sequence", () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    welcome(socket);
    vi.advanceTimersByTime(200);
    expect(client.joinRoom("auto")).toBe(true);
    welcome(socket);
    expect(callbacks.onSelf).toHaveBeenLastCalledWith(visitor(), "snapshot");
    vi.advanceTimersByTime(100);
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: "state", seq: 3 });
  });
});

describe("remote avatar", () => {
  it("interpolates movement and wraps heading across the shortest angle", () => {
    const remote = new RemotePlayer({ ...visitor(), yaw: 3.1 }, 1000);
    remote.push({ ...visitor("a", 1), yaw: -3.1, motion: "Walk" }, 1100);
    remote.update(0.016, 1160, new Vector3());
    expect(remote.root.position.x).toBeCloseTo(0.5);
    expect(Math.abs(remote.root.rotation.y)).toBeCloseTo(Math.PI);
    remote.dispose();
  });
  it("releases avatar geometry and materials without disposing shared fabric textures", () => {
    const shared = surface("fabric", "#b9c9b1");
    const texture = vi.spyOn(shared.map!, "dispose");
    const material = vi.spyOn(shared, "dispose");
    const remote = new RemotePlayer(visitor(), 0);
    let owned: Mesh | undefined;
    remote.root.traverse((object) => {
      if (
        object instanceof Mesh &&
        object.material.userData.role === "jacket"
      )
        owned = object;
    });
    expect(owned).toBeDefined();
    const ownedMaterial = owned!.material;
    if (Array.isArray(ownedMaterial))
      throw new Error("Expected one avatar material");
    const ownMaterial = vi.spyOn(ownedMaterial, "dispose");
    const geometry = vi.spyOn(owned!.geometry, "dispose");
    remote.dispose();
    expect(ownMaterial).toHaveBeenCalledOnce();
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).not.toHaveBeenCalled();
    expect(texture).not.toHaveBeenCalled();
    expect(remote.root.children).toHaveLength(0);
  });
});
