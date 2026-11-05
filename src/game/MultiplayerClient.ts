import {
  AUTO_ROOM,
  NETWORK_HZ,
  PROTOCOL_VERSION,
  PUBLIC_ROOMS,
  ROOM_CAPACITY,
  isPublicRoom,
  validRoomTarget,
  validVisitor,
} from "../shared/multiplayer";
import { FREE_LANTERN_POLICY, validPublicLantern } from "../shared/lanterns";
import type { LanternState } from "../shared/lanterns";
import {
  validVisitorSummary,
  type VisitorSummary,
} from "../shared/visitorStats";

function visitorKey() {
  try {
    const saved = localStorage.getItem("komorebi.visitor-key");
    if (saved && /^[a-zA-Z0-9_-]{32,128}$/.test(saved)) return saved;
  } catch {
    /* Storage may be unavailable in private browsing. */
  }
  const key = crypto.randomUUID();
  try {
    localStorage.setItem("komorebi.visitor-key", key);
  } catch {
    /* This visit can still hang a lantern. */
  }
  return key;
}
import type {
  ClientMessage,
  Presence,
  RoomSummary,
  ServerMessage,
  Visitor,
} from "../shared/multiplayer";

function roomDirectory(value: unknown): RoomSummary[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > PUBLIC_ROOMS.length) return null;
  const ids = new Set<string>();
  const result: RoomSummary[] = [];
  for (const room of value) {
    const entry = PUBLIC_ROOMS.find(candidate => candidate.id === room?.id);
    if (!entry || ids.has(entry.id) ||
      !Number.isInteger(room.count) || !Number.isInteger(room.capacity) ||
      room.capacity < 1 || room.capacity > ROOM_CAPACITY ||
      room.count < 0 || room.count > room.capacity) return null;
    ids.add(entry.id);
    result.push({ ...entry, count: room.count, capacity: room.capacity });
  }
  return PUBLIC_ROOMS.flatMap(room => result.filter(entry => entry.id === room.id));
}

export interface MultiplayerCallbacks {
  onProfile?: (profile: VisitorSummary) => void;
  onLanterns?: (state: LanternState) => void;
  sample: () => { x: number; z: number; yaw: number; motion: "Idle" | "Walk" };
  onPresence: (presence: Presence) => void;
  onPlayers: (players: Visitor[], time: number) => void;
  onSelf: (
    player: Visitor,
    reason: "welcome" | "snapshot" | "correction",
  ) => void;
  onNotice: (message: string) => void;
}
export class MultiplayerClient {
  private visitorKey = visitorKey();
  private requests = new Map<
    string,
    {
      resolve: (result: { ok: boolean; message: string }) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private socket?: WebSocket;
  private disposed = false;
  private stopped = false;
  private welcomed = false;
  private retry = 0;
  private seq = 0;
  private offset = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private welcomeTimer?: ReturnType<typeof setTimeout>;
  private switchTimer?: ReturnType<typeof setTimeout>;
  private sendTimer?: ReturnType<typeof setInterval>;
  private players: Visitor[] = [];
  private presence: Presence;
  private requestedRoom: string;
  private onPageHide = () => {
    this.socket?.close(1000, "Page hidden");
  };
  private onPageShow = () => {
    if (
      !this.disposed &&
      !this.stopped &&
      this.socket?.readyState !== WebSocket.OPEN
    )
      this.connect();
  };
  constructor(
    private callbacks: MultiplayerCallbacks,
    room = new URLSearchParams(location.search).get("room") ?? AUTO_ROOM,
  ) {
    this.requestedRoom = validRoomTarget(room) ? room : AUTO_ROOM;
    this.presence = {
      state: "connecting",
      room: this.requestedRoom,
      count: 1,
      capacity: ROOM_CAPACITY,
      selfId: null,
      selfName: "旅人",
      peers: [],
      rooms: [],
      switchingTo: null,
    };
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("pageshow", this.onPageShow);
  }
  get connected() {
    return this.welcomed && this.socket?.readyState === WebSocket.OPEN;
  }
  get serverNow() {
    return Date.now() + this.offset;
  }
  connect() {
    if (this.disposed || this.stopped) return;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.welcomeTimer);
    this.clearSwitch();
    clearInterval(this.sendTimer);
    const previous = this.socket;
    if (previous) {
      previous.onclose = null;
      previous.onmessage = null;
      previous.close();
    }
    this.welcomed = false;
    this.seq = 0;
    this.presence.state = this.retry ? "reconnecting" : "connecting";
    this.publish();
    const configured = import.meta.env.VITE_REALTIME_URL as string | undefined;
    const url = configured
      ? new URL(configured, location.href)
      : new URL("realtime", new URL(import.meta.env.BASE_URL, location.href));
    if (url.protocol === "http:") url.protocol = "ws:";
    if (url.protocol === "https:") url.protocol = "wss:";
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.welcomeTimer = setTimeout(() => socket.close(), 8000);
    socket.onopen = () => {
      if (this.socket === socket)
        this.send({
          type: "join",
          version: PROTOCOL_VERSION,
          room: this.requestedRoom,
          visitorKey: this.visitorKey,
        });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || this.disposed) return;
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        socket.close(1008);
        return;
      }
      this.receive(message);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket || this.disposed) return;
      this.welcomed = false;
      this.cancelRequests();
      clearInterval(this.sendTimer);
      clearTimeout(this.welcomeTimer);
      this.clearSwitch();
      this.players = [];
      this.callbacks.onPlayers([], this.serverNow);
      this.presence.count = 1;
      this.presence.selfId = null;
      this.presence.peers = [];
      if (!this.stopped) this.scheduleReconnect();
      else this.publish();
    };
  }
  private receive(data: unknown) {
    if (!data || typeof data !== "object") return;
    const message = data as ServerMessage;
    if (message.type === "rooms") {
      const rooms = roomDirectory(message.rooms);
      if (rooms) {
        this.presence.rooms = rooms;
        this.publish();
      }
      return;
    }
    if (message.type === "profile") {
      if (this.welcomed && validVisitorSummary(message.profile))
        this.callbacks.onProfile?.(message.profile);
      return;
    }
    if (message.type === "lantern-result") {
      const pending = this.requests.get(message.requestId);
      if (
        pending &&
        typeof message.ok === "boolean" &&
        typeof message.message === "string"
      ) {
        clearTimeout(pending.timer);
        this.requests.delete(message.requestId);
        pending.resolve({ ok: message.ok, message: message.message });
      }
      return;
    }
    if (message.type === "lanterns") {
      if (
        !this.welcomed ||
        message.room !== this.presence.room ||
        !Array.isArray(message.lanterns) ||
        message.lanterns.length > 24 ||
        !message.lanterns.every(validPublicLantern) ||
        !Array.isArray(message.mineIds) ||
        !message.mineIds.every(
          (id) =>
            typeof id === "string" &&
            message.lanterns.some((item) => item.id === id),
        ) ||
        !["free", "paid"].includes(message.policy?.mode) ||
        message.policy.capacity !== 24 ||
        !Number.isFinite(message.policy.durationHours) ||
        message.policy.durationHours <= 0 ||
        message.policy.maxPerVisitor !== 1
      )
        return;
      this.callbacks.onLanterns?.({
        room: message.room,
        lanterns: message.lanterns,
        mineIds: message.mineIds,
        policy: message.policy,
      });
      return;
    }
    if (message.type === "error") {
      if (typeof message.message !== "string") return;
      this.callbacks.onNotice(message.message);
      if (this.welcomed && ["room_full", "server_full", "invalid_room", "room_busy"].includes(message.code)) {
        this.clearSwitch();
        this.publish();
        return;
      }
      if (
        ["room_full", "server_full", "invalid_room", "protocol"].includes(
          message.code,
        )
      ) {
        this.stopped = true;
        this.presence.state = ["room_full", "server_full"].includes(message.code) ? "full" : "offline";
        this.publish();
        this.socket?.close();
      }
      return;
    }
    if (!("serverTime" in message) || !Number.isFinite(message.serverTime))
      return;
    const offset = message.serverTime - Date.now();
    this.offset = this.welcomed ? this.offset * 0.9 + offset * 0.1 : offset;
    if (message.type === "correction") {
      if (
        this.welcomed &&
        validVisitor(message.player) &&
        message.player.id === this.presence.selfId
      )
        this.callbacks.onSelf(message.player, "correction");
      return;
    }
    if (
      !("players" in message) ||
      !Array.isArray(message.players) ||
      message.players.length > ROOM_CAPACITY ||
      !message.players.every(validVisitor)
    )
      return;
    let welcomeResetsPlayer = false;
    if (message.type === "welcome") {
      const target = this.welcomed ? this.presence.switchingTo : this.requestedRoom;
      const rooms = roomDirectory(message.rooms);
      if (
        message.version !== PROTOCOL_VERSION ||
        !isPublicRoom(message.room) ||
        !target || (target !== AUTO_ROOM && message.room !== target) ||
        !rooms || !rooms.some(room => room.id === message.room && room.capacity === message.capacity) ||
        (this.welcomed && message.id !== this.presence.selfId) ||
        typeof message.id !== "string" ||
        !message.players.some((player) => player.id === message.id) ||
        !Number.isInteger(message.capacity) ||
        message.capacity < 1 ||
        message.capacity > ROOM_CAPACITY
      )
        return;
      const changedRoom = this.presence.room !== message.room;
      welcomeResetsPlayer = !this.welcomed || changedRoom;
      if (changedRoom) {
        this.seq = 0;
        this.callbacks.onLanterns?.({
          room: message.room,
          lanterns: [],
          mineIds: [],
          policy: { ...FREE_LANTERN_POLICY },
        });
      }
      this.welcomed = true;
      this.retry = 0;
      this.requestedRoom = message.room;
      clearTimeout(this.welcomeTimer);
      this.clearSwitch();
      this.presence = {
        ...this.presence,
        state: "connected",
        selfId: message.id,
        room: message.room,
        capacity: message.capacity,
        rooms,
      };
      clearInterval(this.sendTimer);
      this.sendTimer = setInterval(() => {
        if (!this.connected || this.presence.switchingTo) return;
        const sample = this.callbacks.sample();
        this.send({
          type: "state",
          seq: ++this.seq,
          ...sample,
          motion: document.hidden ? "Idle" : sample.motion,
        });
      }, 1000 / NETWORK_HZ);
    }
    if (!this.welcomed) return;
    this.players = message.players;
    const self = this.players.find((p) => p.id === this.presence.selfId);
    if (!self) return;
    this.presence.selfName = self.name;
    this.presence.count = this.players.length;
    this.presence.peers = this.players
      .filter((p) => p.id !== self.id)
      .map(({ id, name, tint }) => ({ id, name, tint }));
    this.callbacks.onSelf(
      self,
      welcomeResetsPlayer ? "welcome" : "snapshot",
    );
    this.callbacks.onPlayers(
      this.players.filter((p) => p.id !== self.id),
      message.serverTime,
    );
    this.publish();
  }
  private scheduleReconnect() {
    if (this.disposed || this.stopped) return;
    this.presence.state = this.retry >= 2 ? "offline" : "reconnecting";
    this.publish();
    const delay = Math.min(12000, 1000 * 2 ** Math.min(this.retry++, 4));
    this.reconnectTimer = setTimeout(
      () => this.connect(),
      delay + Math.random() * 250,
    );
  }
  private clearSwitch() {
    clearTimeout(this.switchTimer);
    this.switchTimer = undefined;
    this.presence.switchingTo = null;
  }
  private cancelRequests() {
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.resolve({
        ok: false,
        message:
          "接続が変わりました。再接続後に、ご自身の絵馬をご確認ください。",
      });
    }
    this.requests.clear();
  }
  private lanternRequest(
    message:
      | {
          type: "lantern-hang";
          productId: string;
          wish: string;
          signature: string;
          slot: number | null;
        }
      | { type: "lantern-remove" | "lantern-report"; id: string },
  ) {
    if (!this.connected || this.presence.switchingTo)
      return Promise.resolve({
        ok: false,
        message: "境内につながると、絵馬を掛けられます。",
      });
    if (this.requests.size)
      return Promise.resolve({
        ok: false,
        message: "先ほどの操作を受け付けています。少しお待ちください。",
      });
    const requestId = crypto.randomUUID();
    return new Promise<{ ok: boolean; message: string }>((resolve) => {
      const timer = setTimeout(() => {
        this.requests.delete(requestId);
        resolve({
          ok: false,
          message:
            "応答を待っています。ご自身の絵馬を確認してから、もう一度お試しください。",
        });
      }, 10000);
      this.requests.set(requestId, { resolve, timer });
      this.send({ ...message, requestId });
    });
  }
  hangLantern(
    productId: string,
    wish: string,
    signature: string,
    slot: number | null,
  ) {
    return this.lanternRequest({
      type: "lantern-hang",
      productId,
      wish,
      signature,
      slot,
    });
  }
  removeLantern(id: string) {
    return this.lanternRequest({ type: "lantern-remove", id });
  }
  reportLantern(id: string) {
    return this.lanternRequest({ type: "lantern-report", id });
  }
  private publish() {
    this.callbacks.onPresence({
      ...this.presence,
      peers: [...this.presence.peers],
      rooms: this.presence.rooms.map(room => ({ ...room })),
    });
  }
  private send(message: ClientMessage) {
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount < 16384
    ) {
      this.socket.send(JSON.stringify(message));
      return true;
    }
    return false;
  }
  pray() {
    if (!this.connected || this.presence.switchingTo) return false;
    this.send({ type: "pray" });
    return true;
  }
  activity(activity: "fortune" | "ema") {
    if (this.connected && !this.presence.switchingTo) this.send({ type: "activity", activity });
  }
  reset() {
    if (!this.connected || this.presence.switchingTo) return false;
    this.send({ type: "reset" });
    return true;
  }
  joinRoom(room: string) {
    if (this.disposed || !validRoomTarget(room) || this.presence.switchingTo || this.requests.size) return false;
    if (this.connected) {
      if (room === this.presence.room) return false;
      if (!this.send({ type: "switch-room", room })) return false;
      this.presence.switchingTo = room;
      this.switchTimer = setTimeout(() => {
        this.clearSwitch();
        this.callbacks.onNotice("移動を確認できませんでした。元の境内に接続し直します。");
        this.socket?.close();
      }, 8000);
      this.publish();
      return true;
    }
    this.stopped = false;
    this.retry = 0;
    this.requestedRoom = room;
    this.presence.room = room;
    this.presence.selfId = null;
    this.presence.count = 1;
    this.presence.peers = [];
    this.players = [];
    this.cancelRequests();
    this.callbacks.onLanterns?.({
      room,
      lanterns: [],
      mineIds: [],
      policy: { ...FREE_LANTERN_POLICY },
    });
    this.callbacks.onPlayers([], this.serverNow);
    this.connect();
    return true;
  }
  dispose() {
    this.disposed = true;
    this.cancelRequests();
    clearInterval(this.sendTimer);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.welcomeTimer);
    this.clearSwitch();
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("pageshow", this.onPageShow);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onopen = null;
      this.socket.close(1000, "Leaving garden");
    }
  }
}
