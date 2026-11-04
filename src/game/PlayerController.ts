import * as THREE from "three";
import type { AssetLoader } from "./AssetLoader";
import type { CameraController } from "./CameraController";
import { createTraveler } from "./character";
import type { Collider, PlayerState } from "./types";
import { canOccupy } from "./collision";
import { ALIGN_DURATION, ritualFrame, RITUAL_DURATION } from "./ritual";
import { findPath } from "./navigation";
import { PLAYER_SPAWN } from "./config";
import { FORECOURT, OFFERING_LAYOUT } from "./layout";
import type { Position } from "../shared/multiplayer";

export class PlayerController {
  readonly root = new THREE.Group();
  state: PlayerState = "Idle";
  ritualStep = -1;
  ritualProgress = 0;
  private torso = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private legs = [new THREE.Group(), new THREE.Group()];
  private elbows = [new THREE.Group(), new THREE.Group()];
  private knees = [new THREE.Group(), new THREE.Group()];
  private visual = new THREE.Group();
  private imported?: THREE.Group;
  private mixer?: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private activeAction?: THREE.AnimationAction;
  private walkTime = 0;
  private ritualTime = 0;
  private startPosition = new THREE.Vector3();
  private startRotation = 0;
  private onRitualComplete?: () => void;
  private move = new THREE.Vector3();
  private route: THREE.Vector3[] = [];
  private steering = new THREE.Vector2();
  private previousPosition = new THREE.Vector3();
  private stalled = 0;
  private ritualTarget: Position = { ...OFFERING_LAYOUT.ritual, yaw: Math.PI };
  private tintMaterials: THREE.MeshStandardMaterial[] = [];

  setTint(color: string) {
    if (!this.tintMaterials.length) {
      const clones = new Map<
        THREE.MeshStandardMaterial,
        THREE.MeshStandardMaterial
      >();
      this.visual.traverse((object) => {
        if (
          !(object instanceof THREE.Mesh) ||
          !(object.material instanceof THREE.MeshStandardMaterial) ||
          object.material.userData.role !== "jacket"
        )
          return;
        const original = object.material;
        let clone = clones.get(original);
        if (!clone) {
          clone = original.clone();
          clones.set(original, clone);
          this.tintMaterials.push(clone);
        }
        object.material = clone;
      });
    }
    this.tintMaterials.forEach((mat) => mat.color.set(color));
  }
  setPosition(position: Position) {
    this.cancelNavigation();
    this.root.position.set(position.x, 0, position.z);
    this.root.rotation.y = position.yaw;
  }
  synchronizeRitual(elapsed: number) {
    if (this.state === "Pray") {
      this.ritualTime = Math.max(0, elapsed);
      this.updateRitual(0);
    }
  }

  private get standingHeight() {
    const { x, z } = this.root.position;
    const paving =
      (Math.abs(x) < 1.53 && z > -4.6) ||
      (Math.abs(x) < 8.8 && Math.abs(z - 0.4) < 0.7) ||
      (x >= FORECOURT.minX &&
        x <= FORECOURT.maxX &&
        z >= FORECOURT.minZ &&
        z <= FORECOURT.maxZ);
    return paving ? 0.105 : 0.045;
  }

  get navigating() {
    return this.route.length > 0;
  }
  navigate(destination: THREE.Vector3) {
    if (this.state === "Pray") return false;
    this.route = findPath(this.root.position, destination, this.colliders);
    this.stalled = 0;
    return this.navigating;
  }
  cancelNavigation() {
    this.route = [];
    this.stalled = 0;
  }

  constructor(
    private colliders: Collider[],
    private camera: CameraController,
  ) {
    this.root.position.set(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z);
    this.root.add(this.visual);
    this.visual.position.y = this.standingHeight;
    // Grounded selection ring remains visible even when a GLB is used.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.57, 40),
      new THREE.MeshBasicMaterial({
        color: "#ede0b3",
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.13;
    this.root.add(ring);
  }

  async init(assets: AssetLoader) {
    const result = await assets.load("player", () => this.createCharacter());
    this.visual.add(result.object);
    if (!result.fallback) this.imported = result.object;
    if (result.clips.length) {
      this.mixer = new THREE.AnimationMixer(result.object);
      result.clips.forEach((clip) =>
        this.actions.set(clip.name.toLowerCase(), this.mixer!.clipAction(clip)),
      );
      this.playAction("idle");
    }
  }

  private createCharacter() {
    return createTraveler({
      torso: this.torso,
      leftArm: this.leftArm,
      rightArm: this.rightArm,
      legs: this.legs,
      elbows: this.elbows,
      knees: this.knees,
    });
  }

  private playAction(name: string) {
    const next = this.actions.get(name);
    if (!next || next === this.activeAction) return;
    this.activeAction?.fadeOut(0.18);
    next.reset().fadeIn(0.18).play();
    this.activeAction = next;
  }

  pray(
    onComplete: () => void,
    target: Position = { ...OFFERING_LAYOUT.ritual, yaw: Math.PI },
    elapsed = 0,
    from?: Position,
  ) {
    if (this.state === "Pray") return;
    this.state = "Pray";
    this.cancelNavigation();
    this.ritualTime = elapsed;
    this.ritualTarget = target;
    this.startPosition.set(
      from?.x ?? this.root.position.x,
      0,
      from?.z ?? this.root.position.z,
    );
    this.startRotation = from?.yaw ?? this.root.rotation.y;
    this.onRitualComplete = onComplete;
    this.playAction("idle");
    this.resetPose();
  }

  update(dt: number, input: THREE.Vector2, enabled: boolean) {
    this.mixer?.update(dt);
    if (this.state === "Pray") {
      this.updateRitual(dt);
      return;
    }
    if (input.lengthSq() > 0.01) this.cancelNavigation();
    this.steering.copy(input);
    if (enabled && this.navigating) {
      while (
        this.route[0] &&
        this.root.position.distanceTo(this.route[0]) < 0.14
      )
        this.route.shift();
      const next = this.route[0];
      if (next) {
        this.move.copy(next).sub(this.root.position).setY(0);
        const speed = Math.min(
          1,
          this.move.length() / Math.max(4.3 * dt, 0.001),
        );
        this.move.normalize();
        this.steering
          .set(
            this.move.dot(this.camera.right),
            this.move.dot(this.camera.forward),
          )
          .multiplyScalar(speed);
      }
    }
    this.previousPosition.copy(this.root.position);
    this.move
      .copy(this.camera.right)
      .multiplyScalar(this.steering.x)
      .addScaledVector(this.camera.forward, this.steering.y)
      .clampLength(0, 1);
    if (!enabled) this.move.set(0, 0, 0);
    const moving = this.move.lengthSq() > 0.01;
    this.state = moving ? "Walk" : "Idle";
    this.playAction(moving ? "walk" : "idle");
    if (moving) {
      // Substep long frames and move each axis separately for wall sliding.
      const distance = 4.3 * dt;
      const steps = Math.max(1, Math.ceil(distance / 0.12));
      for (let i = 0; i < steps; i++) {
        const nextX = this.root.position.x + (this.move.x * distance) / steps;
        if (canOccupy(nextX, this.root.position.z, 0.34, this.colliders))
          this.root.position.x = nextX;
        const nextZ = this.root.position.z + (this.move.z * distance) / steps;
        if (canOccupy(this.root.position.x, nextZ, 0.34, this.colliders))
          this.root.position.z = nextZ;
      }
      const angle = Math.atan2(this.move.x, this.move.z);
      this.root.rotation.y +=
        Math.atan2(
          Math.sin(angle - this.root.rotation.y),
          Math.cos(angle - this.root.rotation.y),
        ) * Math.min(1, dt * 14);
      this.walkTime += dt * 10;
      this.legs[0]!.rotation.x = Math.sin(this.walkTime) * 0.5;
      this.legs[1]!.rotation.x = -Math.sin(this.walkTime) * 0.5;
      this.leftArm.rotation.x = -Math.sin(this.walkTime) * 0.35;
      this.rightArm.rotation.x = Math.sin(this.walkTime) * 0.35;
      this.knees[0]!.rotation.x = -Math.max(0, Math.sin(this.walkTime)) * 0.45;
      this.knees[1]!.rotation.x = -Math.max(0, -Math.sin(this.walkTime)) * 0.45;
      this.elbows[0]!.rotation.x =
        -0.12 - Math.max(0, -Math.sin(this.walkTime)) * 0.2;
      this.elbows[1]!.rotation.x =
        -0.12 - Math.max(0, Math.sin(this.walkTime)) * 0.2;
      this.torso.rotation.z = Math.sin(this.walkTime) * 0.018;
      this.visual.position.y =
        this.standingHeight + Math.abs(Math.sin(this.walkTime)) * 0.025;
      if (this.navigating) {
        this.stalled =
          this.previousPosition.distanceTo(this.root.position) < 0.001
            ? this.stalled + dt
            : 0;
        if (this.stalled > 0.6) this.cancelNavigation();
      }
    } else {
      this.resetPose();
      this.walkTime += dt * 2;
      this.torso.position.y = 0.82 + Math.sin(this.walkTime) * 0.015;
    }
  }

  private updateRitual(dt: number) {
    this.ritualTime += dt;
    this.ritualProgress = Math.min(1, this.ritualTime / RITUAL_DURATION);
    const frame = ritualFrame(this.ritualTime);
    this.ritualStep = frame.index;
    if (frame.kind === "align") {
      const t = THREE.MathUtils.smoothstep(
        this.ritualTime / ALIGN_DURATION,
        0,
        1,
      );
      // This staging point is outside both the hall and offering-box collision bounds.
      // Clear the front of the box first, then move sideways to avoid cutting through it.
      this.root.position.set(
        THREE.MathUtils.lerp(
          this.startPosition.x,
          this.ritualTarget.x,
          Math.max(0, t * 2 - 1),
        ),
        0,
        THREE.MathUtils.lerp(
          this.startPosition.z,
          this.ritualTarget.z,
          Math.min(1, t * 2),
        ),
      );
      const turn = Math.atan2(
        Math.sin(Math.PI - this.startRotation),
        Math.cos(Math.PI - this.startRotation),
      );
      this.root.rotation.y = this.startRotation + turn * t;
    } else {
      this.root.position.set(this.ritualTarget.x, 0, this.ritualTarget.z);
      this.root.rotation.y = Math.PI;
      this.resetPose();
      if (frame.kind === "bow") {
        const amount = Math.sin(frame.phase * Math.PI) ** 1.4;
        this.torso.rotation.x = amount * 0.95;
        if (this.imported) this.imported.rotation.x = amount * 0.65;
        this.leftArm.rotation.x = -amount * 0.15;
        this.rightArm.rotation.x = -amount * 0.15;
      } else {
        const lift = Math.sin(Math.PI * frame.phase) ** 0.4;
        this.elbows.forEach((elbow) => (elbow.rotation.x = -lift * 0.35));
        this.leftArm.rotation.x = -lift * 1.1;
        this.rightArm.rotation.x = -lift * 1.1;
        this.leftArm.rotation.z = lift * 0.6;
        this.rightArm.rotation.z = -lift * 0.6;
        // GLBs without a compatible skeleton get a subtle procedural clap pulse.
        if (this.imported)
          this.imported.rotation.x = Math.sin(frame.phase * Math.PI * 2) * 0.04;
      }
    }
    if (frame.done) {
      this.resetPose();
      this.state = "Idle";
      this.ritualStep = -1;
      this.onRitualComplete?.();
      this.onRitualComplete = undefined;
    }
  }

  private resetPose() {
    this.torso.rotation.set(0, 0, 0);
    this.torso.position.y = 0.82;
    this.visual.position.y = this.standingHeight;
    this.leftArm.rotation.set(0, 0, 0);
    this.rightArm.rotation.set(0, 0, 0);
    this.legs.forEach((leg) => leg.rotation.set(0, 0, 0));
    this.knees.forEach((knee) => knee.rotation.set(0, 0, 0));
    this.elbows.forEach((elbow) => elbow.rotation.set(-0.12, 0, 0));
    if (this.imported) this.imported.rotation.x = 0;
  }

  reset() {
    this.cancelNavigation();
    this.state = "Idle";
    this.ritualStep = -1;
    this.ritualProgress = 0;
    this.root.position.set(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z);
    this.root.rotation.y = Math.PI;
    this.onRitualComplete = undefined;
    this.resetPose();
  }

  dispose() {
    this.mixer?.stopAllAction();
    if (this.mixer && this.imported) this.mixer.uncacheRoot(this.imported);
    this.actions.clear();
  }
}
