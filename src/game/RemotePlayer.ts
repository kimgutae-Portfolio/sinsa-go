import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createTraveler } from "./character";
import { FORECOURT } from "./layout";
import { ritualFrame } from "./ritual";
import type { Visitor } from "../shared/multiplayer";

export class RemotePlayer {
  readonly root = new THREE.Group();
  private torso = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private legs = [new THREE.Group(), new THREE.Group()];
  private elbows = [new THREE.Group(), new THREE.Group()];
  private knees = [new THREE.Group(), new THREE.Group()];
  private visual = new THREE.Group();
  private walkTime = 0;
  private frames: { time: number; player: Visitor }[] = [];
  readonly id: string;
  name: string;
  constructor(player: Visitor, time: number) {
    this.id = player.id;
    this.name = player.name;
    const rig = createTraveler(
      {
        torso: this.torso,
        leftArm: this.leftArm,
        rightArm: this.rightArm,
        legs: this.legs,
        elbows: this.elbows,
        knees: this.knees,
      },
      player.tint,
    );
    this.visual.add(rig);
    this.root.add(this.visual);
    this.root.position.set(player.x, 0, player.z);
    this.root.rotation.y = player.yaw;
    // Each remote owns its materials, while fabric image textures remain shared.
    const clones = new Map<THREE.Material, THREE.Material>();
    this.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || Array.isArray(object.material))
        return;
      const mat = object.material;
      if (mat.userData.surfaceKind) {
        const copy: THREE.Material = clones.get(mat) ?? mat.clone();
        clones.set(mat, copy);
        object.material = copy;
      }
    });
    const groups: THREE.Group[] = [];
    this.root.traverse((object) => {
      if (object instanceof THREE.Group) groups.push(object);
    });
    for (const group of groups) {
      const batches = new Map<THREE.Material, THREE.Mesh[]>();
      for (const child of group.children)
        if (child instanceof THREE.Mesh && !Array.isArray(child.material)) {
          const batch = batches.get(child.material) ?? [];
          batch.push(child);
          batches.set(child.material, batch);
        }
      for (const [mat, meshes] of batches)
        if (meshes.length > 1) {
          const geometries = meshes.map((mesh) => {
            mesh.updateMatrix();
            const g = mesh.geometry.index
              ? mesh.geometry.toNonIndexed()
              : mesh.geometry.clone();
            return g.applyMatrix4(mesh.matrix);
          });
          const merged = mergeGeometries(geometries);
          if (merged) {
            const mesh = new THREE.Mesh(merged, mat);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
            meshes.forEach((old) => {
              group.remove(old);
              old.geometry.dispose();
            });
          }
          geometries.forEach((g) => g.dispose());
        }
    }
    this.push(player, time);
  }
  push(player: Visitor, time: number) {
    this.name = player.name;
    if (time <= (this.frames.at(-1)?.time ?? -Infinity)) return;
    this.frames.push({ time, player });
    if (this.frames.length > 6) this.frames.shift();
  }
  update(dt: number, serverNow: number, local: THREE.Vector3) {
    const renderTime = serverNow - 110;
    while (this.frames.length > 2 && this.frames[1]!.time <= renderTime)
      this.frames.shift();
    const a = this.frames[0],
      b = this.frames[1] ?? a;
    if (!a || !b) return;
    const t = THREE.MathUtils.clamp(
      (renderTime - a.time) / Math.max(1, b.time - a.time),
      0,
      1,
    );
    const player = renderTime >= b.time ? b.player : a.player;
    this.root.position.set(
      THREE.MathUtils.lerp(a.player.x, b.player.x, t),
      0,
      THREE.MathUtils.lerp(a.player.z, b.player.z, t),
    );
    const turn = Math.atan2(
      Math.sin(b.player.yaw - a.player.yaw),
      Math.cos(b.player.yaw - a.player.yaw),
    );
    this.root.rotation.y = a.player.yaw + turn * t;
    this.torso.rotation.set(0, 0, 0);
    this.torso.position.y = 0.82;
    this.leftArm.rotation.set(0, 0, 0);
    this.rightArm.rotation.set(0, 0, 0);
    this.legs.forEach((leg) => leg.rotation.set(0, 0, 0));
    this.elbows.forEach((arm) => arm.rotation.set(-0.12, 0, 0));
    this.knees.forEach((knee) => knee.rotation.set(0, 0, 0));
    const { x, z } = this.root.position;
    const paved =
      (Math.abs(x) < 1.53 && z > -4.6) ||
      (Math.abs(x) < 8.8 && Math.abs(z - 0.4) < 0.7) ||
      (x >= FORECOURT.minX &&
        x <= FORECOURT.maxX &&
        z >= FORECOURT.minZ &&
        z <= FORECOURT.maxZ);
    this.visual.position.y = paved ? 0.105 : 0.045;
    if (player.motion === "Pray" && player.ritualStartedAt !== null) {
      const frame = ritualFrame(
        Math.max(0, (renderTime - player.ritualStartedAt) / 1000),
      );
      if (frame.kind === "bow")
        this.torso.rotation.x = Math.sin(frame.phase * Math.PI) ** 1.4 * 0.95;
      else if (frame.kind === "clap") {
        const lift = Math.sin(frame.phase * Math.PI) ** 0.4;
        this.leftArm.rotation.set(-lift * 1.1, 0, lift * 0.6);
        this.rightArm.rotation.set(-lift * 1.1, 0, -lift * 0.6);
        this.elbows.forEach((elbow) => (elbow.rotation.x = -lift * 0.35));
      }
    } else if (player.motion === "Walk") {
      this.walkTime += dt * 10;
      const phase = Math.sin(this.walkTime);
      this.legs[0]!.rotation.x = phase * 0.5;
      this.legs[1]!.rotation.x = -phase * 0.5;
      this.leftArm.rotation.x = -phase * 0.35;
      this.rightArm.rotation.x = phase * 0.35;
      this.knees[0]!.rotation.x = -Math.max(0, phase) * 0.45;
      this.knees[1]!.rotation.x = -Math.max(0, -phase) * 0.45;
      this.visual.position.y += Math.abs(phase) * 0.025;
    } else {
      this.walkTime += dt * 2;
      this.torso.position.y += Math.sin(this.walkTime) * 0.015;
    }
    const cast = this.root.position.distanceToSquared(local) < 100;
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = cast;
    });
  }
  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        geometries.add(object.geometry);
        (Array.isArray(object.material)
          ? object.material
          : [object.material]
        ).forEach((mat) => materials.add(mat));
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    this.root.removeFromParent();
    this.root.clear();
    this.frames = [];
  }
}
