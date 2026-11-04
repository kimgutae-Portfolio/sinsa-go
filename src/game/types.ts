import type { Vector2 } from "three";
import type { Presence } from "../shared/multiplayer";
import type { LanternState } from "../shared/lanterns";
import type { VisitorSummary } from "../shared/visitorStats";

export type InteractionId = "temizu" | "offering" | "fortune" | "ema";
export type PlayerState = "Idle" | "Walk" | "Pray" | "Purify";
export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height?: number;
}
export interface InteractionPoint {
  id: InteractionId;
  position: { x: number; z: number };
  radius: number;
  label: string;
}
export interface GameSnapshot {
  nearby: InteractionId | null;
  state: PlayerState;
  ritualStep: number;
  ritualProgress: number;
  player: { x: number; z: number };
  destination: InteractionId | null;
}
export interface SceneLabel {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}
export interface GameCallbacks {
  onProfile?: (profile: VisitorSummary) => void;
  onPurified?: () => void;
  onLanterns?: (state: LanternState) => void;
  onUpdate: (snapshot: GameSnapshot) => void;
  onLabels: (labels: SceneLabel[]) => void;
  onFortune: () => void;
  onEma: () => void;
  onPrayed: () => void;
  onNotice?: (message: string) => void;
  onPresence?: (presence: Presence) => void;
  onVisitors?: (visitors: VisitorLabel[]) => void;
}
export interface VisitorLabel extends SceneLabel {
  name: string;
  tint: string;
}
export interface MovementInput {
  direction: Vector2;
  enabled: boolean;
}
