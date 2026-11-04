import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createTraveler, prayTraveler, restTraveler, walkTraveler } from "./character";
import { FORECOURT } from "./layout";
import { ritualFrame } from "./ritual";
import type { Visitor } from "../shared/multiplayer";

export class RemotePlayer {
  readonly root = new THREE.Group();
  private torso = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private legs = [new THREE.Group(), new THREE.Group()];
  private hands = [new THREE.Group(), new THREE.Group()];
  private parts = { torso: this.torso, leftArm: this.leftArm, rightArm: this.rightArm, legs: this.legs, hands: this.hands };
  private visual = new THREE.Group();
  private walkTime = 0;
  private frames: { time: number; player: Visitor }[] = [];
  readonly id: string;
  name: string;
  constructor(player: Visitor, time: number) {
    this.id = player.id;
    this.name = player.name;
    const rig = createTraveler(
      this.parts,
      player.tint,
    );
    this.visual.add(rig);
    this.root.add(this.visual);
    this.root.position.set(player.x, 0, player.z);
    this.root.rotation.y = player.yaw;
    // Plain clay materials belong to this avatar; no image textures are shared.
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
    restTraveler(this.parts);
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
      prayTraveler(this.parts, frame);
    } else if (player.motion === "Walk") {
      this.walkTime += dt * 10;
      const phase = Math.sin(this.walkTime);
      walkTraveler(this.parts, phase);
      this.visual.position.y += Math.abs(phase) * 0.025;
    } else {
      this.walkTime += dt * 2;
      this.torso.position.y += Math.sin(this.walkTime) * 0.01;
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
