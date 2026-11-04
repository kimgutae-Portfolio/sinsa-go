import {
  HALL_LAYOUT,
  OFFERING_LAYOUT,
  LANTERN_LAYOUT,
  EMA_LAYOUT,
  TEMIZU_LAYOUT,
} from "../game/layout";
import type { LanternState } from "./lanterns";
import type { VisitorSummary } from "./visitorStats";
import { canOccupy } from "../game/collision";
import type { Collider } from "../game/types";

export const PROTOCOL_VERSION = 2;
export const ROOM_CAPACITY = 12;
export const DEFAULT_ROOM = "komorebi";
export const NETWORK_HZ = 10;
export const VISITOR_COLORS = [
  "#85866a",
  "#78856c",
  "#928671",
  "#85818c",
  "#8d9067",
  "#75858b",
  "#9b826e",
  "#7e8980",
  "#967e7a",
  "#888a67",
  "#728a7d",
  "#8c8194",
];
export type VisitorMotion = "Idle" | "Walk" | "Pray";
export interface Position {
  x: number;
  z: number;
  yaw: number;
}
export interface Visitor extends Position {
  id: string;
  name: string;
  tint: string;
  motion: VisitorMotion;
  ritualStartedAt: number | null;
  ritualFrom: Position | null;
  ritualTarget: Position | null;
}
export type ClientMessage =
  | { type: "activity"; activity: "fortune" | "ema" }
  | { type: "join"; version: number; room: string; visitorKey?: string }
  | {
      type: "lantern-hang";
      requestId: string;
      productId: string;
      wish: string;
      signature: string;
      slot: number | null;
    }
  | { type: "lantern-remove"; requestId: string; id: string }
  | { type: "lantern-report"; requestId: string; id: string }
  | {
      type: "state";
      seq: number;
      x: number;
      z: number;
      yaw: number;
      motion: "Idle" | "Walk";
    }
  | { type: "pray" }
  | { type: "reset" };
export type ServerMessage =
  | { type: "profile"; serverTime: number; profile: VisitorSummary }
  | ({ type: "lanterns"; serverTime: number } & LanternState)
  | {
      type: "lantern-result";
      requestId: string;
      ok: boolean;
      message: string;
      code?: string;
      lanternId?: string;
    }
  | {
      type: "welcome";
      version: number;
      id: string;
      room: string;
      capacity: number;
      serverTime: number;
      players: Visitor[];
    }
  | { type: "snapshot"; serverTime: number; players: Visitor[] }
  | { type: "correction"; serverTime: number; player: Visitor }
  | {
      type: "error";
      code:
        | "room_full"
        | "server_full"
        | "invalid_room"
        | "protocol"
        | "ritual_busy"
        | "too_far";
      message: string;
    };
export type ConnectionState =
  "connecting" | "connected" | "reconnecting" | "offline" | "full";
export interface Presence {
  state: ConnectionState;
  room: string;
  count: number;
  capacity: number;
  selfId: string | null;
  selfName: string;
  peers: { id: string; name: string; tint: string }[];
}

export function validRoom(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9_-]{1,32}$/.test(value);
}
export function validPosition(value: unknown): value is Position {
  if (!value || typeof value !== "object") return false;
  const p = value as Position;
  return (
    [p.x, p.z, p.yaw].every(
      (n) => typeof n === "number" && Number.isFinite(n),
    ) &&
    Math.abs(p.x) <= 13.76 &&
    Math.abs(p.z) <= 13.76 &&
    Math.abs(p.yaw) <= 10000
  );
}
export function validVisitor(value: unknown): value is Visitor {
  if (!validPosition(value)) return false;
  const p = value as Visitor;
  return (
    typeof p.id === "string" &&
    p.id.length <= 64 &&
    typeof p.name === "string" &&
    p.name.length <= 32 &&
    /^#[0-9a-f]{6}$/i.test(p.tint) &&
    ["Idle", "Walk", "Pray"].includes(p.motion) &&
    (p.ritualStartedAt === null || Number.isFinite(p.ritualStartedAt)) &&
    (p.ritualFrom === null || validPosition(p.ritualFrom)) &&
    (p.ritualTarget === null || validPosition(p.ritualTarget))
  );
}
const rectangle = (
  x: number,
  z: number,
  width: number,
  depth: number,
): Collider => ({
  minX: x - width / 2,
  maxX: x + width / 2,
  minZ: z - depth / 2,
  maxZ: z + depth / 2,
});
// The relay also checks major fixed obstacles; decorative rocks remain client collisions.
export const STRUCTURAL_COLLIDERS: Collider[] = [
  rectangle(
    HALL_LAYOUT.position.x,
    HALL_LAYOUT.position.z,
    HALL_LAYOUT.footprint.width,
    HALL_LAYOUT.footprint.depth,
  ),
  rectangle(
    HALL_LAYOUT.steps.x,
    HALL_LAYOUT.steps.z,
    HALL_LAYOUT.steps.width,
    HALL_LAYOUT.steps.depth,
  ),
  ...HALL_LAYOUT.porchPosts.map((p) => rectangle(p.x, p.z, 0.72, 0.52)),
  rectangle(
    OFFERING_LAYOUT.position.x,
    OFFERING_LAYOUT.position.z,
    OFFERING_LAYOUT.footprint.width,
    OFFERING_LAYOUT.footprint.depth,
  ),
  rectangle(-7, -2, 3.2, 2),
  rectangle(EMA_LAYOUT.x, EMA_LAYOUT.z, EMA_LAYOUT.width + 0.4, EMA_LAYOUT.depth),
  rectangle(-3.6, 9, 0.65, 0.65),
  rectangle(3.6, 9, 0.65, 0.65),
  rectangle(-4.3, 5.6, 0.95, 0.95),
  rectangle(4.3, 5.6, 0.95, 0.95),
  rectangle(-4.1, -3.3, 0.95, 0.95),
  rectangle(4.1, -3.3, 0.95, 0.95),
  rectangle(
    TEMIZU_LAYOUT.x,
    TEMIZU_LAYOUT.z,
    TEMIZU_LAYOUT.width,
    TEMIZU_LAYOUT.depth,
  ),
  rectangle(-7, 10.8, 2.8, 0.75),
  rectangle(7, 10.8, 2.8, 0.75),
  rectangle(8.7, 6.5, 5.2, 5.2),
  rectangle(
    LANTERN_LAYOUT.x,
    LANTERN_LAYOUT.z,
    LANTERN_LAYOUT.width + 0.4,
    LANTERN_LAYOUT.depth,
  ),
];
export function validTravel(from: Position, to: Position) {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.12),
  );
  for (let i = 1; i <= steps; i++)
    if (
      !canOccupy(
        from.x + ((to.x - from.x) * i) / steps,
        from.z + ((to.z - from.z) * i) / steps,
        0.32,
        STRUCTURAL_COLLIDERS,
      )
    )
      return false;
  return true;
}
export const PRAYER_SPOTS: Position[] = [0, -1.05, 1.05].map((x) => ({
  x: OFFERING_LAYOUT.ritual.x + x,
  z: OFFERING_LAYOUT.ritual.z,
  yaw: Math.PI,
}));
export function spawnPosition(slot: number): Position {
  const columns = [0, 2, -2];
  return {
    x: columns[slot % 3]!,
    z: 1.5 + Math.floor(slot / 3) * 1.5,
    yaw: Math.PI,
  };
}
