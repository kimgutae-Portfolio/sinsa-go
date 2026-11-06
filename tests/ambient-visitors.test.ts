import { afterEach, describe, expect, it, vi } from "vitest";
import { Bone, Mesh, MeshStandardMaterial, SkinnedMesh, Vector3 } from "three";
import { AmbientVisitors } from "../src/game/AmbientVisitors";
import { AssetLoader } from "../src/game/AssetLoader";
import { World } from "../src/game/World";
import { canOccupy } from "../src/game/collision";
import { disposeObject } from "../src/game/geometry";
import { EMA_LAYOUT, OFFERING_LAYOUT, TEMIZU_LAYOUT } from "../src/game/layout";

const scenes: AmbientVisitors[] = [];
afterEach(() => scenes.splice(0).forEach(scene => scene.dispose()));
const far = new Vector3(0, 0, 12);
function create(reducedMotion = false) {
  const scene = new AmbientVisitors({ reducedMotion });
  scenes.push(scene);
  return scene;
}
function advance(scene: AmbientVisitors, seconds: number, local = far, peers: Vector3[] = []) {
  for (let i = 0; i < seconds * 60; i++) scene.update(1 / 60, local, peers);
}
function visibleCount(scene: AmbientVisitors) {
  return scene.root.children.filter(child => child.visible).length;
}
function firstMaterial(scene: AmbientVisitors) {
  let result: MeshStandardMaterial | undefined;
  scene.root.children[0]!.traverse(object => {
    if (!result && object instanceof Mesh) result = object.material as MeshStandardMaterial;
  });
  return result!;
}

describe("quiet courtyard scenery", () => {
  it("leaves the spawn, all experience approaches and actual world obstacles clear", async () => {
    const scene = create();
    const assets = new AssetLoader();
    const world = new World(assets);
    try {
      await world.init();
      const approaches = [
        OFFERING_LAYOUT.ritual, EMA_LAYOUT.approach, TEMIZU_LAYOUT.approach,
        { x: -7, z: -0.2 }, { x: 0, z: 1.5 },
      ];
      for (const child of scene.root.children) {
        expect(canOccupy(child.position.x, child.position.z, 0.55, world.colliders)).toBe(true);
        for (const approach of approaches)
          expect(Math.hypot(child.position.x - approach.x, child.position.z - approach.z)).toBeGreaterThan(1.8);
      }
    } finally {
      assets.dispose();
      disposeObject(world.root, false);
    }
  });

  it("yields to real visitors without an abrupt opacity change and stays capped at three", () => {
    const scene = create();
    expect(visibleCount(scene)).toBe(3);
    const peers = [new Vector3(-12, 0, 12), new Vector3(12, 0, 12), new Vector3(0, 0, 13)];
    const material = firstMaterial(scene);
    scene.update(1 / 60, far, peers);
    expect(material.opacity).toBeGreaterThan(0);
    expect(material.opacity).toBeLessThan(1);
    advance(scene, 1, far, peers.slice(0, 1));
    expect(visibleCount(scene)).toBe(2);
    advance(scene, 1, far, peers);
    expect(visibleCount(scene)).toBe(0);
    advance(scene, 2);
    expect(visibleCount(scene)).toBe(3);
    expect(scene.root.children).toHaveLength(3);
  });

  it("gives local and remote visitors space with a stable clearance boundary", () => {
    const scene = create();
    const figure = scene.root.children[0]!;
    const near = figure.position.clone();
    advance(scene, 0.5, near);
    expect(figure.visible).toBe(false);
    // A small move at the edge does not repeatedly reveal the same figure.
    const boundary = near.clone().add(new Vector3(2.1, 0, 0));
    advance(scene, 2, boundary);
    expect(figure.visible).toBe(false);
    advance(scene, 2);
    expect(figure.visible).toBe(true);
    advance(scene, 0.5, far, [near]);
    expect(figure.visible).toBe(false);
  });

  it("keeps reduced-motion poses still and limits geometry, materials and render batches", () => {
    const scene = create(true);
    const torso = scene.root.children[0]!.children.find(child => child.type === "Group")!;
    const position = torso.position.clone();
    const rotation = torso.quaternion.clone();
    advance(scene, 5);
    expect(torso.position.equals(position)).toBe(true);
    expect(torso.quaternion.equals(rotation)).toBe(true);
    let meshes = 0, triangles = 0;
    scene.root.traverse(object => {
      expect(object).not.toBeInstanceOf(Bone);
      expect(object).not.toBeInstanceOf(SkinnedMesh);
      if (!(object instanceof Mesh)) return;
      meshes++;
      triangles += (object.geometry.index?.count ?? object.geometry.getAttribute("position").count) / 3;
      expect((object.material as MeshStandardMaterial).map).toBeNull();
    });
    expect(meshes).toBeLessThanOrEqual(33);
    expect(triangles).toBeLessThan(24000);
  });

  it("releases every owned geometry and material once, with no timers or global cache cleanup", () => {
    const scene = create();
    const geometries = new Set<Mesh["geometry"]>();
    const materials = new Set<MeshStandardMaterial>();
    scene.root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      geometries.add(object.geometry);
      materials.add(object.material as MeshStandardMaterial);
    });
    const spies = [...geometries, ...materials].map(item => vi.spyOn(item, "dispose"));
    scene.dispose();
    scene.dispose();
    scene.update(1, far, []);
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    expect(scene.root.children).toHaveLength(0);
  });
});
