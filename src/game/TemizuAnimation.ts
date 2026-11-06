import * as THREE from "three";
import { restTraveler, TRAVELER_BODY_Y, TRAVELER_REST_HAND, type TravelerParts } from "./character";
import { ALIGN_DURATION, TEMIZU_DURATION, temizuFrame } from "./ritual";

type Point = readonly [number, number, number];
interface Pose {
  time: number;
  left: Point;
  right: Point;
  aim: Point;
  grip: number;
  lean: number;
  reach: number;
  nod: number;
}
const restLeft: Point = [-TRAVELER_REST_HAND.x, TRAVELER_REST_HAND.y, TRAVELER_REST_HAND.z];
const restRight: Point = [TRAVELER_REST_HAND.x, TRAVELER_REST_HAND.y, TRAVELER_REST_HAND.z];
const meetLeft: Point = [-0.06, 0.31, 0.20];
const meetRight: Point = [0.06, 0.31, 0.20];
const receiveLeft: Point = [-0.15, 0.29, 0.25];
const receiveRight: Point = [0.15, 0.29, 0.25];
const holdLeft: Point = [-0.17, 0.42, 0.26];
const holdRight: Point = [0.17, 0.42, 0.26];
function pose(time: number, left: Point, right: Point, aim: Point, grip: number,
  lean = 0, reach = 0, nod = 0): Pose {
  return { time, left, right, aim, grip, lean, reach, nod };
}

// One continuous sequence: the arms do not fall to rest between each wash.
// Transfers happen while the two mittens meet around the same handle.
const POSES: readonly Pose[] = [
  pose(0, restLeft, restRight, [0, 0.2, 1], 1),
  pose(0.60, [-0.24, 0.25, 0.22], [0.28, 0.34, 0.26], [0, -0.1, 1], 1, 0.08, 0.04),
  pose(0.82, [-0.20, 0.28, 0.22], [0.28, 0.37, 0.29], [0, -0.48, 1], 1, 0.12, 0.13),
  pose(1.14, receiveLeft, holdRight, [-1, -0.03, -0.05], 1, 0.06, 0.06),
  pose(1.98, receiveLeft, holdRight, [-1, -0.03, -0.05], 1, 0.06, 0.06),
  pose(2.35, meetLeft, meetRight, [0, 0.1, 1], 1, 0.03, 0.02),
  pose(2.60, meetLeft, meetRight, [0, 0.1, 1], 0.5, 0.03, 0.02),
  pose(2.82, meetLeft, meetRight, [0, 0.1, 1], 0, 0.03, 0.02),
  pose(3.08, holdLeft, receiveRight, [1, -0.03, -0.05], 0, 0.06, 0.06),
  pose(3.98, holdLeft, receiveRight, [1, -0.03, -0.05], 0, 0.06, 0.06),
  pose(4.35, meetLeft, meetRight, [0, 0.1, 1], 0, 0.03, 0.02),
  pose(4.60, meetLeft, meetRight, [0, 0.1, 1], 0.5, 0.03, 0.02),
  pose(4.78, meetLeft, meetRight, [0, 0.1, 1], 1, 0.03, 0.02),
  pose(5.08, receiveLeft, holdRight, [-1, -0.03, -0.05], 1, 0.06, 0.06),
  pose(5.60, receiveLeft, holdRight, [-1, -0.03, -0.05], 1, 0.06, 0.06),
  pose(6.10, [-0.14, 0.44, 0.25], [0.30, 0.30, 0.18], [0, 0, 1], 1, 0.08, 0.035, 0.52),
  pose(6.45, [-0.14, 0.44, 0.25], [0.30, 0.30, 0.18], [0, 0, 1], 1, 0.08, 0.035, 0.52),
  pose(6.85, receiveLeft, holdRight, [0, 0.2, 1], 1, 0.04, 0.04),
  pose(7.00, [-0.20, 0.25, 0.22], [0.16, 0.48, 0.25], [0, 0.35, 1], 1, 0.04, 0.04),
  pose(7.45, [-0.25, 0.22, 0.20], [0.17, 0.50, 0.26], [0, 1, 0.06], 1, 0.04, 0.04),
  pose(8.35, [-0.25, 0.22, 0.20], [0.17, 0.50, 0.26], [0, 1, 0.06], 1, 0.04, 0.04),
  pose(8.60, [-0.24, 0.25, 0.22], [0.28, 0.34, 0.26], [0, -0.48, 1], 1, 0.08, 0.10),
  pose(TEMIZU_DURATION, restLeft, restRight, [0, 0.2, 1], 1),
];

/** Fixed cloth attachment on the existing rigid sleeve; no skeleton or stretching. */
export function temizuSleeveAttachment(side: -1 | 1, target: THREE.Vector3) {
  return target.set(-side * (0.01 + Math.sin(0.38) * 0.265),
    0.01 + Math.cos(0.38) * 0.265, -0.025);
}

export class TemizuAnimation {
  readonly ladleDirection = new THREE.Vector3();
  grip = 1;
  pouring = 0;
  receiving: 0 | 1 = 0;
  ladleVisible = false;
  private target = new THREE.Vector3();
  private attachment = new THREE.Vector3();
  private shoulder = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private restDirection = new THREE.Vector3();
  private rotatedAttachment = new THREE.Vector3();
  private wrist = new THREE.Quaternion();
  private wristEuler = new THREE.Euler();

  constructor(private parts: TravelerParts) {}

  update(elapsed: number) {
    const time = THREE.MathUtils.clamp(elapsed, 0, TEMIZU_DURATION);
    let index = 0;
    while (index < POSES.length - 2 && time > POSES[index + 1]!.time) index++;
    const a = POSES[index]!, b = POSES[index + 1]!;
    const t = THREE.MathUtils.smoothstep(time, a.time, b.time);
    const lerp = (start: number, end: number) => THREE.MathUtils.lerp(start, end, t);
    restTraveler(this.parts);
    this.parts.torso.position.y = TRAVELER_BODY_Y - lerp(a.lean, b.lean) * 0.08;
    this.parts.torso.position.z = lerp(a.reach, b.reach);
    this.parts.torso.rotation.x = lerp(a.lean, b.lean);
    if (this.parts.head) {
      this.parts.head.rotation.x = lerp(a.nod, b.nod);
      this.parts.head.rotation.y = -lerp(a.nod, b.nod) * 0.12;
    }
    this.grip = lerp(a.grip, b.grip);
    this.ladleDirection.set(lerp(a.aim[0], b.aim[0]), lerp(a.aim[1], b.aim[1]),
      lerp(a.aim[2], b.aim[2])).normalize();
    for (const side of [-1, 1] as const) {
      const start = side < 0 ? a.left : a.right;
      const end = side < 0 ? b.left : b.right;
      this.target.set(lerp(start[0], end[0]), lerp(start[1], end[1]), lerp(start[2], end[2]));
      this.arm(side, this.target, side < 0 ? this.grip : 1 - this.grip);
    }
    this.ladleVisible = time >= ALIGN_DURATION * 0.7 && time < 8.62;
    const frame = temizuFrame(time);
    this.receiving = frame.kind === "right" || frame.kind === "handle" ? 1 : 0;
    const p = frame.phase;
    const flow = (start: number, end: number) =>
      THREE.MathUtils.smoothstep(p, start, start + 0.07) *
      (1 - THREE.MathUtils.smoothstep(p, end - 0.08, end));
    this.pouring = frame.kind === "left" || frame.kind === "right" ? flow(0.27, 0.69)
      : frame.kind === "mouth" ? flow(0.20, 0.42)
      : frame.kind === "handle" && !frame.done ? flow(0.25, 0.76) : 0;
  }

  private arm(side: -1 | 1, target: THREE.Vector3, receiving: number) {
    const arm = side < 0 ? this.parts.leftArm : this.parts.rightArm;
    temizuSleeveAttachment(side, this.attachment);
    this.shoulder.copy(this.attachment).add(this.restDirection.set(
      side * TRAVELER_REST_HAND.x, TRAVELER_REST_HAND.y, TRAVELER_REST_HAND.z));
    this.restDirection.copy(this.attachment).negate().normalize();
    this.direction.subVectors(target, this.shoulder).normalize();
    arm.quaternion.setFromUnitVectors(this.restDirection, this.direction);
    this.rotatedAttachment.copy(this.attachment).applyQuaternion(arm.quaternion);
    arm.position.copy(this.shoulder).sub(this.rotatedAttachment);
    // Keep the small cupped mitten turned up independently of the sleeve swing.
    this.wrist.setFromEuler(this.wristEuler.set(receiving * 1.1, 0, side * receiving * 0.08));
    this.parts.hands[side < 0 ? 0 : 1]!.quaternion.copy(arm.quaternion).invert().multiply(this.wrist);
  }
}
