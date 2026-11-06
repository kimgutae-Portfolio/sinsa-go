import * as THREE from "three";
import type { AssetLoader } from "./AssetLoader";
import type { CameraController } from "./CameraController";
import { createTraveler, prayTraveler, restTraveler, walkTraveler, TRAVELER_BODY_Y, type TravelerParts } from "./character";
import { TemizuAnimation } from "./TemizuAnimation";
import type { Collider, PlayerState } from "./types";
import { canOccupy } from "./collision";
import {
  ALIGN_DURATION,
  ritualFrame,
  RITUAL_DURATION,
  temizuFrame,
  TEMIZU_DURATION,
} from "./ritual";
import { findPath } from "./navigation";
import { PLAYER_SPAWN } from "./config";
import { FORECOURT, OFFERING_LAYOUT, TEMIZU_LAYOUT } from "./layout";
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
  private hands = [new THREE.Group(), new THREE.Group()];
  private parts: TravelerParts = { torso: this.torso, leftArm: this.leftArm, rightArm: this.rightArm, legs: this.legs, hands: this.hands };
  private temizuAnimation = new TemizuAnimation(this.parts);
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
  private onPurifyComplete?: () => void;
  private purifyTime = 0;
  private ladle = new THREE.Group();
  private water: THREE.Mesh;
  private splash: THREE.Mesh;
  private droplets: THREE.InstancedMesh;
  private dropletDummy = new THREE.Object3D();
  private cupPosition = new THREE.Vector3();
  private receivingPosition = new THREE.Vector3();
  private streamDirection = new THREE.Vector3();
  private cupNormal = new THREE.Vector3();
  private cupRimDirection = new THREE.Vector3();
  private inverseRoot = new THREE.Quaternion();
  private readonly streamUp = new THREE.Vector3(0, 1, 0);
  private otherGrip = new THREE.Vector3();
  private ladleX = new THREE.Vector3();
  private ladleY = new THREE.Vector3();
  private ladleZ = new THREE.Vector3();
  private ladleBasis = new THREE.Matrix4();

  /** Praying or purifying: movement and other experiences wait. */
  get busy() {
    return this.state === "Pray" || this.state === "Purify";
  }

  setTint(color: string) {
    if (!this.tintMaterials.length) {
      const owned = new Set<THREE.MeshStandardMaterial>();
      this.visual.traverse((object) => {
        if (
          !(object instanceof THREE.Mesh) ||
          !(object.material instanceof THREE.MeshStandardMaterial) ||
          object.material.userData.role !== "jacket"
        )
          return;
        owned.add(object.material);
      });
      this.tintMaterials.push(...owned);
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
    if (this.busy) return false;
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
    // A readable bamboo ladle, held by the mascot's rigid mitten pieces.
    this.ladle.name = "TemizuLadle";
    const bamboo = new THREE.MeshStandardMaterial({
      color: "#c9b27a",
      roughness: 0.8,
    });
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.019, 0.42, 10),
      bamboo,
    );
    handle.position.y = -0.20;
    const cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.092, 0.083, 0.105, 20, 1, true),
      new THREE.MeshStandardMaterial({
        color: "#d8c18a",
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
    );
    cup.name = "LadleCup";
    cup.rotation.x = Math.PI / 2;
    cup.position.set(0, -0.41, 0.035);
    const cupRim = new THREE.Mesh(new THREE.TorusGeometry(0.089, 0.008, 6, 24), bamboo);
    cupRim.rotation.x = Math.PI / 2;
    cupRim.position.y = 0.052;
    const cupBottom = new THREE.Mesh(new THREE.CircleGeometry(0.083, 20), bamboo);
    cupBottom.rotation.x = Math.PI / 2;
    cupBottom.position.y = -0.052;
    const cupWater = new THREE.Mesh(new THREE.CircleGeometry(0.080, 20), new THREE.MeshStandardMaterial({
      color: "#9dc4bc", roughness: 0.16, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    }));
    cupWater.name = "LadleWater";
    cupWater.rotation.x = -Math.PI / 2;
    cupWater.position.y = 0.033;
    cup.add(cupRim, cupBottom, cupWater);
    this.ladle.add(handle, cup);
    this.ladle.visible = false;
    // Keep unused props in the owned scene so unmount can release them too.
    this.root.add(this.ladle);
    this.water = new THREE.Mesh(
      new THREE.CylinderGeometry(0.010, 0.018, 1, 10, 1, true),
      new THREE.MeshBasicMaterial({
        color: "#d6e8df",
        transparent: true,
        opacity: 0.70,
        depthWrite: false,
      }),
    );
    this.water.visible = false;
    this.water.name = "PurificationWater";
    this.root.add(this.water);
    const splashMaterial = new THREE.MeshBasicMaterial({
      color: "#d9eee3", transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
    });
    this.splash = new THREE.Mesh(new THREE.RingGeometry(0.028, 0.041, 24), splashMaterial);
    this.splash.name = "PurificationSplash";
    this.splash.rotation.x = -Math.PI / 2;
    this.splash.visible = false;
    this.root.add(this.splash);
    this.droplets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 8, 6), splashMaterial, 10);
    this.droplets.name = "PurificationDroplets";
    this.droplets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.droplets.frustumCulled = false;
    this.droplets.visible = false;
    this.root.add(this.droplets);
  }

  purify(onComplete: () => void) {
    if (this.busy) return;
    this.state = "Purify";
    this.cancelNavigation();
    this.purifyTime = 0;
    this.startPosition.copy(this.root.position).setY(0);
    this.startRotation = this.root.rotation.y;
    this.onPurifyComplete = onComplete;
    this.playAction("idle");
    this.resetPose();
  }

  private placeLadle() {
    this.ladle.visible = !this.imported && this.temizuAnimation.ladleVisible;
    if (!this.ladle.visible) return;
    this.root.updateMatrixWorld(true);
    this.hands[0]!.getWorldPosition(this.ladle.position);
    this.root.worldToLocal(this.ladle.position);
    this.hands[1]!.getWorldPosition(this.otherGrip);
    this.root.worldToLocal(this.otherGrip);
    // The handle crosses between touching mittens, never snapping to a new parent.
    this.ladle.position.lerp(this.otherGrip, this.temizuAnimation.grip);
    this.ladle.position.y -= 0.015;
    this.ladleY.copy(this.temizuAnimation.ladleDirection)
      .applyQuaternion(this.torso.quaternion).negate().normalize();
    this.ladleZ.set(0, 1, 0).addScaledVector(this.ladleY, -this.ladleY.y);
    if (this.ladleZ.lengthSq() < 0.000001) this.ladleZ.set(0, 0, -1);
    this.ladleZ.normalize();
    this.ladleX.crossVectors(this.ladleY, this.ladleZ).normalize();
    this.ladleZ.crossVectors(this.ladleX, this.ladleY);
    this.ladle.quaternion.setFromRotationMatrix(this.ladleBasis.makeBasis(this.ladleX, this.ladleY, this.ladleZ));
    if (this.temizuAnimation.ladleDirection.y < 0.8)
      this.ladle.rotateY((this.temizuAnimation.grip - 0.5) * this.temizuAnimation.pouring * 0.8);
  }

  private pour(amount: number, receiving: 0 | 1) {
    const cup = this.ladle.getObjectByName("LadleCup");
    if (!cup || amount < 0.02 || !this.ladle.visible) {
      this.water.visible = false;
      this.splash.visible = false;
      this.droplets.visible = false;
      return;
    }
    this.root.updateMatrixWorld(true);
    cup.getWorldPosition(this.cupPosition);
    this.root.worldToLocal(this.cupPosition);
    this.hands[receiving]!.getWorldPosition(this.receivingPosition);
    this.root.worldToLocal(this.receivingPosition);
    this.receivingPosition.y += 0.035;
    // Water leaves the rim nearest the palm, rather than the bowl's bottom.
    this.cupNormal.set(0, 1, 0).transformDirection(cup.matrixWorld)
      .applyQuaternion(this.inverseRoot.copy(this.root.quaternion).invert());
    this.cupRimDirection.subVectors(this.receivingPosition, this.cupPosition);
    this.cupRimDirection.addScaledVector(this.cupNormal, -this.cupRimDirection.dot(this.cupNormal));
    if (this.cupRimDirection.lengthSq() > 0.000001)
      this.cupRimDirection.normalize().multiplyScalar(0.075);
    this.cupPosition.addScaledVector(this.cupNormal, 0.04).add(this.cupRimDirection);
    this.streamDirection.subVectors(this.cupPosition, this.receivingPosition);
    const length = Math.max(0.025, this.streamDirection.length());
    this.water.visible = true;
    this.water.position.copy(this.cupPosition).add(this.receivingPosition).multiplyScalar(0.5);
    this.water.quaternion.setFromUnitVectors(this.streamUp, this.streamDirection.normalize());
    this.water.scale.set(0.65 + amount * 0.35, length, 0.65 + amount * 0.35);
    this.splash.visible = true;
    this.splash.position.copy(this.receivingPosition);
    this.splash.scale.setScalar(0.7 + (Math.sin(this.purifyTime * 24) + 1) * 0.35);
    this.droplets.visible = true;
    for (let i = 0; i < this.droplets.count; i++) {
      const phase = (this.purifyTime * 2.8 + i / this.droplets.count) % 1;
      const angle = i * 2.39996;
      const radius = Math.sin(phase * Math.PI) * 0.075;
      this.dropletDummy.position.set(
        this.receivingPosition.x + Math.cos(angle) * radius,
        this.receivingPosition.y + Math.sin(phase * Math.PI) * 0.055 - phase * phase * 0.36,
        this.receivingPosition.z + 0.025 + phase * 0.08 + Math.sin(angle) * radius,
      );
      this.dropletDummy.scale.setScalar((1 - phase) * amount);
      this.dropletDummy.updateMatrix();
      this.droplets.setMatrixAt(i, this.dropletDummy.matrix);
    }
    this.droplets.instanceMatrix.needsUpdate = true;
  }

  private updatePurify(dt: number) {
    this.purifyTime += dt;
    this.ritualProgress = Math.min(1, this.purifyTime / TEMIZU_DURATION);
    const frame = temizuFrame(this.purifyTime);
    this.ritualStep = frame.index;
    const target = TEMIZU_LAYOUT.stance;
    if (frame.kind === "align") {
      const t = THREE.MathUtils.smoothstep(
        this.purifyTime / ALIGN_DURATION,
        0,
        1,
      );
      this.root.position.set(
        THREE.MathUtils.lerp(this.startPosition.x, target.x, t),
        0,
        THREE.MathUtils.lerp(this.startPosition.z, target.z, t),
      );
      const turn = Math.atan2(
        Math.sin(-this.startRotation),
        Math.cos(-this.startRotation),
      );
      this.root.rotation.y = this.startRotation + turn * t;
    } else {
      this.root.position.set(target.x, 0, target.z);
      this.root.rotation.y = 0;
    }
    this.resetPose();
    this.temizuAnimation.update(this.purifyTime);
    this.placeLadle();
    this.pour(this.temizuAnimation.pouring, this.temizuAnimation.receiving);
    if (frame.done) this.finishPurify(true);
  }

  private finishPurify(completed: boolean) {
    this.ladle.visible = false;
    this.water.visible = false;
    this.splash.visible = false;
    this.droplets.visible = false;
    if (this.state === "Purify") this.state = "Idle";
    this.ritualStep = -1;
    this.ritualProgress = 0;
    this.resetPose();
    const done = this.onPurifyComplete;
    this.onPurifyComplete = undefined;
    if (completed) done?.();
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
    return createTraveler(this.parts);
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
    if (this.busy) return;
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
    if (this.state === "Purify") {
      this.updatePurify(dt);
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
      walkTraveler(this.parts, Math.sin(this.walkTime));
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
      this.torso.position.y = TRAVELER_BODY_Y + Math.sin(this.walkTime) * 0.01;
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
      prayTraveler(this.parts, frame);
      if (this.imported) {
        if (frame.kind === "bow") this.imported.rotation.x = Math.sin(frame.phase * Math.PI) ** 1.4 * 0.65;
        else this.imported.rotation.x = Math.sin(frame.phase * Math.PI * 2) * 0.04;
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
    restTraveler(this.parts);
    this.visual.position.y = this.standingHeight;
    if (this.imported) this.imported.rotation.x = 0;
  }

  reset() {
    this.cancelNavigation();
    this.finishPurify(false);
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
