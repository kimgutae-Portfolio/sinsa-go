import { createHash, randomUUID } from "node:crypto";
import { LanternService } from "./lanterns/service";
import { VisitorStatsService } from "./visitors/service";
import { LANTERN_LAYOUT } from "../src/game/layout";
import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  ROOM_CAPACITY,
  VISITOR_COLORS,
  PRAYER_SPOTS,
  spawnPosition,
  validPosition,
  validRoom,
  validTravel,
} from "../src/shared/multiplayer";
import type {
  Position,
  ServerMessage,
  Visitor,
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
  private now: () => number;
  private tickTimer: ReturnType<typeof setInterval>;
  private heartbeat: ReturnType<typeof setInterval>;
  constructor(private options: RoomOptions = {}) {
    this.stats = options.stats ?? new VisitorStatsService();
    this.lanterns = options.lanterns ?? new LanternService();
    this.capacity = options.capacity ?? ROOM_CAPACITY;
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
    });
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
      if (!validRoom(data.room)) {
        this.error(
          session.socket,
          "invalid_room",
          "ルーム名は半角英小文字・数字・_・-の1〜32文字で入力してください。",
        );
        session.socket.close(1008);
        return;
      }
      let room = this.rooms.get(data.room);
      if (!room && this.rooms.size >= (this.options.maxRooms ?? 32)) {
        this.error(
          session.socket,
          "server_full",
          "ただいま新しいルームをひらけません。しばらくしてからお試しください。",
        );
        session.socket.close(1013);
        return;
      }
      if (room && room.size >= this.capacity) {
        this.error(
          session.socket,
          "room_full",
          "このルームは満員です。別のルーム名でお入りください。",
        );
        session.socket.close(1008);
        return;
      }
      if (!room) {
        room = new Set();
        this.rooms.set(data.room, room);
      }
      session.room = data.room;
      if (
        typeof data.visitorKey === "string" &&
        /^[a-zA-Z0-9_-]{32,128}$/.test(data.visitorKey)
      )
        session.ownerHash = createHash("sha256")
          .update(data.visitorKey)
          .digest("hex");
      const used = new Set([...room].map((p) => p.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      session.slot = slot;
      session.player = {
        ...session.player,
        ...spawnPosition(slot),
        name: `旅人 ${String(slot + 1).padStart(2, "0")}`,
        tint: VISITOR_COLORS[slot % VISITOR_COLORS.length]!,
      };
      room.add(session);
      this.stats.begin(session.ownerHash, session.player.id, session.room, now);
      clearTimeout(session.joinTimer);
      this.send(session.socket, {
        type: "welcome",
        version: PROTOCOL_VERSION,
        id: session.player.id,
        room: session.room,
        capacity: this.capacity,
        serverTime: now,
        players: this.players(session.room),
      });
      this.broadcast(session.room);
      this.sendLanterns(session);
      this.publishProfile(session.ownerHash);
      return;
    }
    this.advance(session, now);
    if (data.type === "lantern-hang" || data.type === "lantern-remove") {
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
          session.player.x - LANTERN_LAYOUT.approach.x,
          session.player.z - LANTERN_LAYOUT.approach.z,
        ) > 2.8)
    ) {
      reply("too_far", "灯籠をかける場所にもう少し近づいてください。");
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
          : { ...shared, kind: "remove", id: data.id },
        now,
      );
      if (session.room === room)
        this.send(session.socket, {
          type: "lantern-result",
          requestId,
          ...result,
        });
      if (result.ok) {
        if (result.change !== "none")
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
        "灯籠を保存できませんでした。しばらくしてからお試しください。",
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
