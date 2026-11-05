import { createHash, randomUUID } from "node:crypto";
import { LanternService } from "./lanterns/service";
import { VisitorStatsService } from "./visitors/service";
import { EMA_LAYOUT } from "../src/game/layout";
import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  ROOM_CAPACITY,
  AUTO_ROOM,
  PUBLIC_ROOMS,
  VISITOR_COLORS,
  PRAYER_SPOTS,
  spawnPosition,
  validPosition,
  validRoomTarget,
  validTravel,
} from "../src/shared/multiplayer";
import type {
  Position,
  ServerMessage,
  Visitor,
  RoomSummary,
} from "../src/shared/multiplayer";
import { ALIGN_DURATION, RITUAL_DURATION } from "../src/game/ritual";
import { OFFERING_LAYOUT } from "../src/game/layout";

interface Session {
  lastActivities: Partial<Record<"fortune" | "ema", number>>;
  ownerHash: string;
  lanternPending: boolean;
  socket: WebSocket;
  player: Visitor;
  room: string;
  slot: number;
  seq: number;
  lastUpdate: number;
  moveBudget: number;
  tokens: number;
  tokenTime: number;
  lastReset: number;
  lastRoomChange: number;
  alive: boolean;
  joinTimer?: ReturnType<typeof setTimeout>;
}
export interface RoomOptions {
  stats?: VisitorStatsService;
  lanterns?: LanternService;
  capacity?: number;
  maxRooms?: number;
  maxConnections?: number;
  heartbeatMs?: number;
  now?: () => number;
}
export class ShrineRooms {
  readonly stats: VisitorStatsService;
  private lastStatsPulse = 0;
  private lastStatsPublish = 0;
  private closing = false;
  private pendingChanges = new Set<Promise<void>>();
  readonly lanterns: LanternService;
  private lanternSignatures = new Map<string, string>();
  readonly rooms = new Map<string, Set<Session>>();
  readonly sessions = new Set<Session>();
  readonly capacity: number;
  private catalog: typeof PUBLIC_ROOMS[number][];
  private now: () => number;
  private tickTimer: ReturnType<typeof setInterval>;
  private heartbeat: ReturnType<typeof setInterval>;
  constructor(private options: RoomOptions = {}) {
    this.stats = options.stats ?? new VisitorStatsService();
    this.lanterns = options.lanterns ?? new LanternService();
    this.capacity = Math.min(ROOM_CAPACITY, Math.max(1, Math.floor(options.capacity ?? ROOM_CAPACITY)));
    this.catalog = PUBLIC_ROOMS.slice(0, Math.max(1, Math.min(PUBLIC_ROOMS.length, Math.floor(options.maxRooms ?? PUBLIC_ROOMS.length))));
    this.now = options.now ?? Date.now;
    this.tickTimer = setInterval(() => this.tick(), 100);
    this.heartbeat = setInterval(() => {
      for (const session of this.sessions) {
        if (!session.alive) session.socket.terminate();
        else {
          session.alive = false;
          session.socket.ping();
        }
      }
    }, options.heartbeatMs ?? 20000);
    this.tickTimer.unref();
    this.heartbeat.unref();
  }
  private send(socket: WebSocket, message: ServerMessage) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 256 * 1024) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(message));
  }
  private error(
    socket: WebSocket,
    code: Extract<ServerMessage, { type: "error" }>["code"],
    message: string,
  ) {
    this.send(socket, { type: "error", code, message });
  }
  directory(): RoomSummary[] {
    return this.catalog.map(room => ({
      ...room,
      count: this.rooms.get(room.id)?.size ?? 0,
      capacity: this.capacity,
    }));
  }
  private broadcastDirectory() {
    if (this.closing) return;
    const message: ServerMessage = { type: "rooms", rooms: this.directory() };
    for (const session of this.sessions) this.send(session.socket, message);
  }
  private resolveRoom(target: string) {
    if (target !== AUTO_ROOM) return target;
    const available = this.directory().filter(room => room.count < room.capacity);
    return (
      available.find(room => room.count < Math.ceil(this.capacity / 2)) ??
      available.reduce<RoomSummary | undefined>((best, room) => !best || room.count < best.count ? room : best, undefined)
    )?.id;
  }
  private welcome(session: Session, now: number) {
    this.send(session.socket, {
      type: "welcome",
      version: PROTOCOL_VERSION,
      id: session.player.id,
      room: session.room,
      capacity: this.capacity,
      serverTime: now,
      players: this.players(session.room),
      rooms: this.directory(),
    });
  }
  private enterRoom(session: Session, target: unknown, now: number) {
    const initial = !session.room;
    if (!validRoomTarget(target) || (target !== AUTO_ROOM && !this.catalog.some(room => room.id === target))) {
      this.error(session.socket, "invalid_room", "境内の一覧からお選びください。");
      if (initial) session.socket.close(1008);
      return;
    }
    const id = this.resolveRoom(target);
    if (!id) {
      this.error(session.socket, "server_full", "ただいま、すべての境内が満員です。少しお待ちください。");
      if (initial) session.socket.close(1013);
      return;
    }
    if (id === session.room) {
      this.welcome(session, now);
      return;
    }
    const next = this.rooms.get(id) ?? new Set<Session>();
    if (next.size >= this.capacity) {
      this.error(session.socket, "room_full", "この境内は満員です。別の境内をお選びください。");
      if (initial) session.socket.close(1008);
      return;
    }
    if (!initial && (session.player.motion === "Pray" || session.lanternPending)) {
      this.error(session.socket, "room_busy", "参拝や絵馬の操作を終えてから、境内をお移りください。");
      return;
    }
    if (!initial && now - session.lastRoomChange < 1000) {
      this.error(session.socket, "room_busy", "少し間をおいてから、次の境内をお選びください。");
      return;
    }
    // Reserve and validate the destination before removing the current membership.
    const previous = session.room;
    const oldRoom = this.rooms.get(previous);
    oldRoom?.delete(session);
    if (oldRoom?.size === 0) {
      this.rooms.delete(previous);
      this.lanternSignatures.delete(previous);
    }
    this.rooms.set(id, next);
    session.room = id;
    const used = new Set([...next].map(player => player.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    session.slot = slot;
    session.seq = -1;
    session.lastUpdate = now;
    session.moveBudget = 1.5;
    session.lastReset = 0;
    session.lastActivities = {};
    session.player = {
      ...session.player,
      ...spawnPosition(slot),
      name: `旅人 ${String(slot + 1).padStart(2, "0")}`,
      tint: VISITOR_COLORS[slot % VISITOR_COLORS.length]!,
      motion: "Idle",
      ritualStartedAt: null,
      ritualFrom: null,
      ritualTarget: null,
    };
    next.add(session);
    if (initial) this.stats.begin(session.ownerHash, session.player.id, id, now);
    else {
      session.lastRoomChange = now;
      this.stats.moveRoom(session.player.id, id, now);
    }
    clearTimeout(session.joinTimer);
    this.welcome(session, now);
    if (previous) this.broadcast(previous);
    this.broadcast(id);
    this.broadcastDirectory();
    this.sendLanterns(session);
    this.publishProfile(session.ownerHash);
  }
  connect(socket: WebSocket) {
    if (this.sessions.size >= (this.options.maxConnections ?? 256)) {
      this.error(
        socket,
        "server_full",
        "ただいま多くの方が訪れています。しばらくしてからお入りください。",
      );
      socket.close(1013);
      return;
    }
    const time = this.now();
    const session: Session = {
      lastActivities: {},
      ownerHash: "",
      lanternPending: false,
      socket,
      room: "",
      slot: 0,
      seq: -1,
      lastUpdate: time,
      moveBudget: 1.5,
      tokens: 40,
      tokenTime: time,
      lastReset: 0,
      lastRoomChange: -Infinity,
      alive: true,
      player: {
        ...spawnPosition(0),
        id: randomUUID(),
        name: "",
        tint: VISITOR_COLORS[0]!,
        motion: "Idle",
        ritualStartedAt: null,
        ritualFrom: null,
        ritualTarget: null,
      },
    };
    this.sessions.add(session);
    session.joinTimer = setTimeout(() => {
      if (!session.room) socket.close(1008, "Join timeout");
    }, 5000);
    session.joinTimer.unref();
    socket.on("pong", () => (session.alive = true));
    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        socket.close(1003, "Text messages only");
        return;
      }
      const now = this.now();
      session.tokens = Math.min(
        40,
        session.tokens + (now - session.tokenTime) * 0.03,
      );
      session.tokenTime = now;
      if (--session.tokens < 0) {
        socket.close(1008, "Rate limit");
        return;
      }
      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        socket.close(1008, "Invalid JSON");
        return;
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        socket.close(1008, "Invalid message");
        return;
      }
      this.receive(session, data as Record<string, unknown>, now);
    });
    socket.on("error", () => socket.terminate());
    socket.on("close", () => {
      this.advance(session, this.now());
      this.stats.end(session.player.id, this.now());
      clearTimeout(session.joinTimer);
      this.sessions.delete(session);
      const room = this.rooms.get(session.room);
      room?.delete(session);
      if (room?.size === 0) this.rooms.delete(session.room);
      if (!this.rooms.has(session.room))
        this.lanternSignatures.delete(session.room);
      else if (room) this.broadcast(session.room);
      this.broadcastDirectory();
    });
    this.send(socket, { type: "rooms", rooms: this.directory() });
  }
  private receive(
    session: Session,
    data: Record<string, unknown>,
    now: number,
  ) {
    if (this.closing) return;
    if (!session.room) {
      if (data.type !== "join" || data.version !== PROTOCOL_VERSION) {
        this.error(
          session.socket,
          "protocol",
          "新しい境内をご用意しました。ページを再読み込みしてください。",
        );
        session.socket.close(1008);
        return;
      }
      if (
        typeof data.visitorKey === "string" &&
        /^[a-zA-Z0-9_-]{32,128}$/.test(data.visitorKey)
      )
        session.ownerHash = createHash("sha256")
          .update(data.visitorKey)
          .digest("hex");
      this.enterRoom(session, data.room, now);
      return;
    }
    this.advance(session, now);
    if (data.type === "switch-room") {
      this.enterRoom(session, data.room, now);
      return;
    }
    if (
      data.type === "lantern-hang" ||
      data.type === "lantern-remove" ||
      data.type === "lantern-report"
    ) {
      const task = this.changeLantern(session, data, now);
      this.pendingChanges.add(task);
      void task.finally(() => this.pendingChanges.delete(task));
      return;
    }
    if (data.type === "activity") {
      if (
        (data.activity !== "fortune" && data.activity !== "ema") ||
        session.player.motion === "Pray"
      )
        return;
      const point =
        data.activity === "fortune" ? { x: -7, z: -0.8 } : { x: 7, z: -2.2 };
      if (
        Math.hypot(session.player.x - point.x, session.player.z - point.z) >
          2.9 ||
        now - (session.lastActivities[data.activity] ?? -Infinity) < 2000
      )
        return;
      session.lastActivities[data.activity] = now;
      this.stats.record(
        session.ownerHash,
        data.activity === "fortune" ? "fortuneCount" : "emaViewCount",
        now,
      );
      this.publishProfile(session.ownerHash);
      return;
    }
    if (data.type === "state") {
      if (
        !Number.isSafeInteger(data.seq) ||
        Number(data.seq) <= session.seq ||
        !validPosition(data) ||
        (data.motion !== "Idle" && data.motion !== "Walk")
      )
        return;
      session.seq = Number(data.seq);
      if (session.player.motion === "Pray") return;
      const position = data as unknown as Position;
      session.moveBudget = Math.min(
        1.5,
        session.moveBudget + Math.max(0, now - session.lastUpdate) * 0.0052,
      );
      session.lastUpdate = now;
      const distance = Math.hypot(
        position.x - session.player.x,
        position.z - session.player.z,
      );
      if (
        distance > session.moveBudget + 0.05 ||
        !validTravel(session.player, position)
      ) {
        this.correct(session, now);
        return;
      }
      session.moveBudget = Math.max(0, session.moveBudget - distance);
      session.player.x = position.x;
      session.player.z = position.z;
      session.player.yaw = Math.atan2(
        Math.sin(position.yaw),
        Math.cos(position.yaw),
      );
      session.player.motion = data.motion;
    } else if (data.type === "pray") {
      if (session.player.motion === "Pray") {
        this.correct(session, now);
        return;
      }
      if (
        Math.hypot(
          session.player.x - OFFERING_LAYOUT.interaction.x,
          session.player.z - OFFERING_LAYOUT.interaction.z,
        ) > 2.8
      ) {
        this.error(
          session.socket,
          "too_far",
          "お賽銭箱にもう少し近づいてください。",
        );
        return;
      }
      const others = [...(this.rooms.get(session.room) ?? [])].filter(
        (s) => s !== session,
      );
      const target = PRAYER_SPOTS.find(
        (spot) =>
          !others.some(
            (other) =>
              Math.hypot(
                (other.player.ritualTarget?.x ?? other.player.x) - spot.x,
                (other.player.ritualTarget?.z ?? other.player.z) - spot.z,
              ) < 0.7,
          ),
      );
      if (!target) {
        this.error(
          session.socket,
          "ritual_busy",
          "参拝場所はただいま3か所とも使用中です。少しお待ちください。",
        );
        return;
      }
      session.player.ritualFrom = {
        x: session.player.x,
        z: session.player.z,
        yaw: session.player.yaw,
      };
      session.player.ritualTarget = { ...target };
      session.player.ritualStartedAt = now;
      session.player.motion = "Pray";
      this.correct(session, now);
      this.broadcast(session.room);
    } else if (data.type === "reset") {
      if (now - session.lastReset < 1500) return;
      session.lastReset = now;
      Object.assign(session.player, spawnPosition(session.slot), {
        motion: "Idle",
        ritualStartedAt: null,
        ritualFrom: null,
        ritualTarget: null,
      });
      session.lastUpdate = now;
      session.moveBudget = 1.5;
      this.correct(session, now);
      this.broadcast(session.room);
    }
  }
  private correct(session: Session, time: number) {
    this.send(session.socket, {
      type: "correction",
      serverTime: time,
      player: { ...session.player },
    });
  }
  /** Administrator take-down; refreshes every visitor in the ema's room. */
  async moderateLantern(id: string) {
    const record = this.lanterns.administration().find((item) => item.id === id);
    const result = await this.lanterns.execute(
      { kind: "moderate", id },
      this.now(),
    );
    if (result.ok && record) this.broadcastLanterns(record.room);
    return result;
  }
  private sendLanterns(session: Session) {
    this.send(session.socket, {
      type: "lanterns",
      serverTime: this.now(),
      ...this.lanterns.state(session.room, session.ownerHash, this.now()),
    });
  }
  private broadcastLanterns(room: string) {
    for (const session of this.rooms.get(room) ?? [])
      this.sendLanterns(session);
    this.lanternSignatures.set(
      room,
      this.lanterns
        .state(room, "", this.now())
        .lanterns.map((item) => item.id)
        .join(","),
    );
  }
  private async changeLantern(
    session: Session,
    data: Record<string, unknown>,
    now: number,
  ) {
    const requestId =
      typeof data.requestId === "string" ? data.requestId.slice(0, 64) : "";
    const reply = (code: string, message: string) =>
      this.send(session.socket, {
        type: "lantern-result",
        requestId,
        ok: false,
        code,
        message,
      });
    if (session.lanternPending) {
      reply("pending", "先ほどの操作を受け付けています。少しお待ちください。");
      return;
    }
    if (
      data.type === "lantern-hang" &&
      (session.player.motion === "Pray" ||
        Math.hypot(
          session.player.x - EMA_LAYOUT.approach.x,
          session.player.z - EMA_LAYOUT.approach.z,
        ) > 2.8)
    ) {
      reply("too_far", "絵馬掛けにもう少し近づいてください。");
      return;
    }
    const room = session.room;
    session.lanternPending = true;
    try {
      const shared = { room, ownerHash: session.ownerHash, requestId };
      const result = await this.lanterns.execute(
        data.type === "lantern-hang"
          ? {
              ...shared,
              kind: "hang",
              productId: data.productId,
              wish: data.wish,
              signature: data.signature,
              slot: data.slot,
            }
          : {
              ...shared,
              kind: data.type === "lantern-report" ? "report" : "remove",
              id: data.id,
            },
        now,
      );
      if (session.room === room)
        this.send(session.socket, {
          type: "lantern-result",
          requestId,
          ...result,
        });
      if (result.ok) {
        if (result.change !== "none" && data.type !== "lantern-report")
          this.stats.record(
            session.ownerHash,
            result.change === "created"
              ? "lanternHangCount"
              : "lanternRemoveCount",
            this.now(),
          );
        this.publishProfile(session.ownerHash);
        this.broadcastLanterns(room);
      }
    } catch {
      reply(
        "storage",
        "絵馬を保存できませんでした。しばらくしてからお試しください。",
      );
    } finally {
      session.lanternPending = false;
    }
  }
  private advance(session: Session, now: number) {
    const p = session.player;
    if (p.motion === "Walk" && now - session.lastUpdate > 1500)
      p.motion = "Idle";
    if (
      p.motion !== "Pray" ||
      p.ritualStartedAt === null ||
      !p.ritualFrom ||
      !p.ritualTarget
    )
      return;
    const elapsed = (now - p.ritualStartedAt) / 1000;
    const linear = Math.max(0, Math.min(1, elapsed / ALIGN_DURATION));
    const t = linear * linear * (3 - 2 * linear);
    p.x =
      p.ritualFrom.x +
      (p.ritualTarget.x - p.ritualFrom.x) * Math.max(0, t * 2 - 1);
    p.z =
      p.ritualFrom.z + (p.ritualTarget.z - p.ritualFrom.z) * Math.min(1, t * 2);
    p.yaw =
      p.ritualFrom.yaw +
      Math.atan2(
        Math.sin(Math.PI - p.ritualFrom.yaw),
        Math.cos(Math.PI - p.ritualFrom.yaw),
      ) *
        t;
    if (elapsed >= RITUAL_DURATION) {
      Object.assign(p, p.ritualTarget, {
        motion: "Idle",
        ritualStartedAt: null,
        ritualFrom: null,
        ritualTarget: null,
      });
      session.lastUpdate = now;
      session.moveBudget = 1.5;
      this.stats.record(session.ownerHash, "prayerCount", now);
      this.publishProfile(session.ownerHash);
    }
  }
  private players(room: string) {
    return [...(this.rooms.get(room) ?? [])].map((s) => ({ ...s.player }));
  }
  private broadcast(room: string) {
    const message: ServerMessage = {
      type: "snapshot",
      serverTime: this.now(),
      players: this.players(room),
    };
    for (const s of this.rooms.get(room) ?? []) this.send(s.socket, message);
  }
  tick() {
    const now = this.now();
    if (now - this.lastStatsPulse >= 1000) {
      this.stats.pulse(now);
      this.lastStatsPulse = now;
    }
    if (now - this.lastStatsPublish >= 10000) {
      for (const owner of new Set(
        [...this.sessions]
          .filter((session) => session.room)
          .map((session) => session.ownerHash),
      ))
        this.publishProfile(owner);
      this.lastStatsPublish = now;
    }
    for (const s of this.sessions) this.advance(s, now);
    for (const room of this.rooms.keys()) this.broadcast(room);
    for (const room of this.rooms.keys()) {
      const signature = this.lanterns
        .state(room, "", now)
        .lanterns.map((item) => item.id)
        .join(",");
      if (this.lanternSignatures.get(room) !== signature)
        this.broadcastLanterns(room);
    }
  }
  dispose() {
    this.closing = true;
    clearInterval(this.tickTimer);
    clearInterval(this.heartbeat);
    for (const s of this.sessions) {
      this.advance(s, this.now());
      this.stats.end(s.player.id, this.now());
      clearTimeout(s.joinTimer);
      s.socket.terminate();
    }
    this.sessions.clear();
    this.rooms.clear();
    this.lanternSignatures.clear();
  }
  private publishProfile(ownerHash: string) {
    if (this.closing || !ownerHash) return;
    const profile = this.stats.summary(ownerHash);
    if (!profile) return;
    for (const session of this.sessions)
      if (session.room && session.ownerHash === ownerHash)
        this.send(session.socket, {
          type: "profile",
          serverTime: this.now(),
          profile,
        });
  }
  async flush() {
    await Promise.allSettled([...this.pendingChanges]);
    await this.lanterns.flush();
    await this.stats.dispose();
  }
}
