import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createTraveler, restTraveler, type TravelerParts } from "./character";
import { FORECOURT } from "./layout";

type GroundPosition = Readonly<{ x: number; z: number }>;

/** Scenery, never connected users: these positions leave all four approaches open. */
const PLACEMENTS = [
  { x: -2.55, z: -1.8, yaw: Math.PI - 0.18, tint: "#9b9078", phase: 0 },
  { x: 2.9, z: -1.2, yaw: Math.PI + 0.3, tint: "#8d9b91", phase: 11 },
  { x: 9.7, z: -1.15, yaw: -Math.PI / 2 - 0.2, tint: "#b09885", phase: 23 },
] as const;

interface QuietVisitor {
  root: THREE.Group;
  parts: TravelerParts;
  meshes: THREE.Mesh[];
  materials: THREE.MeshStandardMaterial[];
  opacity: number;
  givingSpace: boolean;
  yaw: number;
  phase: number;
}

function makeParts(): TravelerParts {
  return {
    torso: new THREE.Group(),
    leftArm: new THREE.Group(),
    rightArm: new THREE.Group(),
    legs: [new THREE.Group(), new THREE.Group()],
    hands: [new THREE.Group(), new THREE.Group()],
  };
}

/** Merge rigid details without merging across the mitten/foot animation pivots. */
function batchDetails(root: THREE.Group) {
  const groups: THREE.Group[] = [];
  root.traverse(object => { if (object instanceof THREE.Group) groups.push(object); });
  for (const group of groups) {
    const batches = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
      const batch = batches.get(child.material) ?? [];
      batch.push(child);
      batches.set(child.material, batch);
    }
    for (const [material, meshes] of batches) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map(mesh => {
        mesh.updateMatrix();
        const geometry = mesh.geometry.index
          ? mesh.geometry.toNonIndexed()
          : mesh.geometry.clone();
        return geometry.applyMatrix4(mesh.matrix);
      });
      const merged = mergeGeometries(geometries);
      if (merged) {
        const mesh = new THREE.Mesh(merged, material);
        mesh.name = "AmbientTravelerDetails";
        group.add(mesh);
        for (const original of meshes) {
          original.removeFromParent();
          original.geometry.dispose();
        }
      }
      for (const geometry of geometries) geometry.dispose();
    }
  }
}

function distanceSquared(a: GroundPosition, b: GroundPosition) {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

/**
 * A few quiet, anonymous figures for an otherwise empty courtyard.
 * Entirely visual: no IDs, presence labels, network messages or activity records.
 */
export class AmbientVisitors {
  readonly root = new THREE.Group();
  private visitors: QuietVisitor[] = [];
  private elapsed = 0;
  private disposed = false;
  private reducedMotion: boolean;

  constructor(options: { reducedMotion?: boolean } = {}) {
    this.reducedMotion = options.reducedMotion ?? false;
    this.root.name = "AmbientVisitors";
    for (const [index, placement] of PLACEMENTS.entries()) {
      const parts = makeParts();
      const root = createTraveler(parts, placement.tint);
      root.name = `AmbientTraveler${index + 1}`;
      const paved = placement.x >= FORECOURT.minX && placement.x <= FORECOURT.maxX
        && placement.z >= FORECOURT.minZ && placement.z <= FORECOURT.maxZ;
      root.position.set(placement.x, paved ? 0.105 : 0.045, placement.z);
      root.rotation.y = placement.yaw;
      batchDetails(root);
      const meshes: THREE.Mesh[] = [];
      const materials = new Set<THREE.MeshStandardMaterial>();
      root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        meshes.push(object);
        if (object.material instanceof THREE.MeshStandardMaterial) {
          object.material.transparent = true;
          materials.add(object.material);
        }
      });
      this.visitors.push({ root, parts, meshes, materials: [...materials],
        opacity: 1, givingSpace: false, yaw: placement.yaw, phase: placement.phase });
      this.root.add(root);
    }
  }

  update(dt: number, localPosition: GroundPosition, remotePositions: readonly GroundPosition[]) {
    if (this.disposed) return;
    // A returning/background tab cannot fast-forward the quiet poses or fades.
    const step = Math.max(0, Math.min(dt, 0.1));
    this.elapsed += step;
    const desiredCount = Math.max(0, PLACEMENTS.length - remotePositions.length);
    for (let i = 0; i < this.visitors.length; i++) {
      const visitor = this.visitors[i]!;
      // Hysteresis keeps someone standing near a figure from making it flicker.
      const clearance = visitor.givingSpace ? 2.3 : 1.8;
      const clearanceSquared = clearance ** 2;
      let occupied = distanceSquared(visitor.root.position, localPosition) < clearanceSquared;
      if (!occupied) {
        for (const position of remotePositions) {
          if (distanceSquared(visitor.root.position, position) < clearanceSquared) {
            occupied = true;
            break;
          }
        }
      }
      visitor.givingSpace = occupied;
      const target = i < desiredCount && !occupied ? 1 : 0;
      const fade = step * (target ? 0.8 : 3.6);
      visitor.opacity = target > visitor.opacity
        ? Math.min(target, visitor.opacity + fade)
        : Math.max(target, visitor.opacity - fade);
      visitor.root.visible = visitor.opacity > 0.001;
      for (const material of visitor.materials) {
        material.opacity = visitor.opacity;
        material.depthWrite = visitor.opacity > 0.98;
      }
      const shadow = visitor.opacity > 0.9
        && distanceSquared(visitor.root.position, localPosition) < 100;
      for (const mesh of visitor.meshes) mesh.castShadow = shadow;
      if (!visitor.root.visible) continue;
      restTraveler(visitor.parts);
      if (this.reducedMotion) continue;
      const time = this.elapsed + visitor.phase;
      visitor.parts.torso.position.y += Math.sin(time * 1.3) * 0.008;
      visitor.parts.torso.rotation.y = Math.sin(time * 0.22) * 0.07;
      visitor.root.rotation.y = visitor.yaw + Math.sin(time * 0.12) * 0.045;
      // One unhurried nod every 36 seconds, staggered between the figures.
      const bowTime = time % 36;
      if (bowTime > 27 && bowTime < 31)
        visitor.parts.torso.rotation.x = Math.sin((bowTime - 27) / 4 * Math.PI) ** 2 * 0.28;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    for (const visitor of this.visitors) {
      for (const mesh of visitor.meshes) geometries.add(mesh.geometry);
      for (const material of visitor.materials) materials.add(material);
    }
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.root.removeFromParent();
    this.root.clear();
    this.visitors = [];
  }
}
