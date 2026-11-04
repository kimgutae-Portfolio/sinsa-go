import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Mesh, Vector3 } from "three";
import {
  MultiplayerClient,
  type MultiplayerCallbacks,
} from "../src/game/MultiplayerClient";
import { RemotePlayer } from "../src/game/RemotePlayer";
import {
  PROTOCOL_VERSION,
  ROOM_CAPACITY,
  type ServerMessage,
  type Visitor,
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
function welcome(
  socket: FakeSocket,
  players = [visitor(), visitor("b", 2)],
  room = "garden",
) {
  socket.receive({
    type: "welcome",
    version: PROTOCOL_VERSION,
    id: "a",
    room,
    capacity: ROOM_CAPACITY,
    serverTime: Date.now() + 500,
    players,
  });
}
let client: MultiplayerClient;
let callbacks: MultiplayerCallbacks;
beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal("location", new URL("http://localhost:4173/?room=garden"));
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
      room: "garden",
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
      policy: FREE_LANTERN_POLICY,
    });
    expect(callbacks.onLanterns).not.toHaveBeenCalled();
    socket.receive({
      type: "lanterns",
      serverTime: Date.now(),
      room: "garden",
      lanterns: [],
      mineIds: [],
      policy: { ...FREE_LANTERN_POLICY, mode: "paid" },
    });
    expect(callbacks.onLanterns).toHaveBeenLastCalledWith(
      expect.objectContaining({
        policy: expect.objectContaining({ mode: "paid" }),
      }),
    );
    expect(vi.getTimerCount()).toBe(1);
  });
  it("settles pending lantern requests when disconnecting and does not send duplicates", async () => {
    client.connect();
    const socket = FakeSocket.instances[0]!;
    socket.open();
    welcome(socket);
    const first = client.hangLantern("paper-warm", "소원", "", null);
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
  it("stops retrying a full room and can enter another room explicitly", () => {
    client.connect();
    const first = FakeSocket.instances[0]!;
    first.open();
    first.receive({ type: "error", code: "room_full", message: "가득 찼어요" });
    vi.advanceTimersByTime(30000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "full" }),
    );
    expect(client.joinRoom("../bad")).toBe(false);
    expect(client.joinRoom("forest")).toBe(true);
    const second = FakeSocket.instances[1]!;
    second.open();
    welcome(second, [visitor()], "forest");
    expect(callbacks.onPresence).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: "connected",
        room: "forest",
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
        object.material.userData.surfaceKind === "fabric"
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
