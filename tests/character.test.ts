import { afterEach, describe, expect, it, vi } from "vitest";
import { Bone, Box3, Group, Mesh, MeshStandardMaterial, SkinnedMesh, Vector2, Vector3 } from "three";
import { createTraveler, prayTraveler, restTraveler, walkTraveler, type TravelerParts } from "../src/game/character";
import { AssetLoader } from "../src/game/AssetLoader";
import { PlayerController } from "../src/game/PlayerController";
import { RemotePlayer } from "../src/game/RemotePlayer";
import { CameraController } from "../src/game/CameraController";
import { disposeObject } from "../src/game/geometry";
import { ALIGN_DURATION, RITUAL_STEPS, ritualFrame, TEMIZU_DURATION, TEMIZU_STEPS } from "../src/game/ritual";
import { OFFERING_LAYOUT } from "../src/game/layout";

const roots: Group[] = [];
afterEach(() => { roots.splice(0).forEach(root => disposeObject(root, false)); });
function traveler() {
  const parts: TravelerParts = { torso: new Group(), leftArm: new Group(), rightArm: new Group(),
    legs: [new Group(), new Group()], hands: [new Group(), new Group()] };
  const root = createTraveler(parts);
  roots.push(root);
  return { root, parts };
}
async function player() {
  const assets = new AssetLoader();
  const controller = new PlayerController([], new CameraController());
  await controller.init(assets);
  assets.dispose();
  roots.push(controller.root);
  return controller;
}
const clapMidpoint = ALIGN_DURATION + RITUAL_STEPS[0].duration + RITUAL_STEPS[1].duration + RITUAL_STEPS[2].duration / 2;

describe("rounded shrine traveler", () => {
  it("fits the scene with no bones, texture downloads, or excessive geometry", () => {
    const { root } = traveler();
    let meshes = 0, triangles = 0;
    root.traverse(object => {
      expect(object).not.toBeInstanceOf(Bone);
      expect(object).not.toBeInstanceOf(SkinnedMesh);
      if (object instanceof Mesh) {
        meshes++;
        triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
        expect(object.material.map).toBeNull();
        expect(object.material.bumpMap).toBeNull();
      }
    });
    expect(meshes).toBeLessThanOrEqual(16);
    expect(triangles).toBeLessThan(8000);
    const bounds = new Box3().setFromObject(root);
    expect(bounds.min.y).toBeCloseTo(0, 2);
    expect(bounds.max.y).toBeGreaterThan(1.65);
    expect(bounds.max.y).toBeLessThan(1.85);
  });
  it("brings the actual mitten meshes together for each clap, then restores their rest positions", () => {
    const { root, parts } = traveler();
    for (const time of [clapMidpoint, clapMidpoint + RITUAL_STEPS[2].duration]) {
      prayTraveler(parts, ritualFrame(time));
      root.updateMatrixWorld(true);
      const left = new Box3().setFromObject(parts.hands[0]!);
      const right = new Box3().setFromObject(parts.hands[1]!);
      expect(left.intersectsBox(right)).toBe(true);
      expect(left.min.z).toBeGreaterThan(0.25);
    }
    restTraveler(parts);
    expect(parts.leftArm.position.distanceTo(parts.rightArm.position)).toBeGreaterThan(0.6);
    expect(parts.leftArm.scale.x).toBe(1);
  });
  it("keeps all vertices finite throughout walking and the complete prayer sequence", () => {
    const { root, parts } = traveler();
    for (let time = 0; time <= 7; time += 0.1) {
      walkTraveler(parts, Math.sin(time * 10));
      let bounds = new Box3().setFromObject(root);
      expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
      prayTraveler(parts, ritualFrame(time));
      bounds = new Box3().setFromObject(root);
      expect(bounds.min.y).toBeGreaterThan(-0.05);
      expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
    }
  });
  it("owns its colors so changing one visitor never recolors another", async () => {
    const first = await player(), second = await player();
    const coats = (root: Group) => {
      const materials = new Set<MeshStandardMaterial>();
      root.traverse(object => { if (object instanceof Mesh && object.material.userData.role === 'jacket') materials.add(object.material); });
      return [...materials];
    };
    const material = coats(first.root)[0]!;
    const disposed = vi.spyOn(material, 'dispose');
    const other = coats(second.root)[0]!;
    const before = other.color.getHexString();
    first.setTint('#b0c8bb');
    expect(coats(first.root)[0]).toBe(material);
    expect(material.color.getHexString()).toBe('b0c8bb');
    expect(other.color.getHexString()).toBe(before);
    expect(other).not.toBe(material);
    expect(disposed).not.toHaveBeenCalled();
    first.dispose(); second.dispose();
  });
  it("keeps the ladle pour over the receiving mitten and can lift that mitten to the mouth", async () => {
    const controller = await player();
    controller.purify(() => {});
    const firstTime = ALIGN_DURATION + TEMIZU_STEPS[0].duration * 0.45;
    controller.update(firstTime, new Vector2(), true);
    for (const handName of ['LeftHandAnchor', 'RightHandAnchor']) {
      controller.root.updateMatrixWorld(true);
      const hand = controller.root.getObjectByName(handName)!.getWorldPosition(new Vector3());
      const water = controller.root.getObjectByName('PurificationWater')!;
      const stream = water.getWorldPosition(new Vector3());
      expect(water.visible).toBe(true);
      expect(Math.hypot(hand.x - stream.x, hand.z - stream.z)).toBeLessThan(0.15);
      if (handName === 'LeftHandAnchor') controller.update(TEMIZU_STEPS[0].duration, new Vector2(), true);
    }
    const mouthTime = ALIGN_DURATION + TEMIZU_STEPS[0].duration + TEMIZU_STEPS[1].duration + TEMIZU_STEPS[2].duration * 0.625;
    controller.update(mouthTime - firstTime - TEMIZU_STEPS[0].duration, new Vector2(), true);
    controller.root.updateMatrixWorld(true);
    const hand = controller.root.getObjectByName('LeftHandAnchor')!.getWorldPosition(new Vector3());
    const mouth = new Box3().setFromObject(controller.root.getObjectByName('Smile')!).getCenter(new Vector3());
    expect(hand.distanceTo(mouth)).toBeLessThan(0.21);
    expect(controller.root.getObjectByName('PurificationWater')!.visible).toBe(false);
    controller.reset();
    expect(controller.root.getObjectByName('TemizuLadle')!.visible).toBe(false);
    expect(controller.state).toBe('Idle');
    controller.dispose();
  });
  it("shows the same synchronized clap for the local traveler and other visitors", async () => {
    const local = await player();
    const position = { ...OFFERING_LAYOUT.ritual, yaw: Math.PI };
    local.pray(() => {}, position, clapMidpoint);
    local.update(0, new Vector2(), true);
    const remote = new RemotePlayer({ ...position, id: 'other', name: '旅人', tint: '#b9c9b1',
      motion: 'Pray', ritualStartedAt: 1000, ritualFrom: position, ritualTarget: position }, 1000);
    remote.update(0, 1000 + clapMidpoint * 1000 + 110, new Vector3());
    for (const name of ['LeftMitten', 'RightMitten']) {
      const a = local.root.getObjectByName(name)!.getWorldPosition(new Vector3());
      const b = remote.root.getObjectByName(name)!.getWorldPosition(new Vector3());
      expect(a.distanceTo(b)).toBeLessThan(0.00001);
    }
    local.dispose(); remote.dispose();
  });
  it("still finishes the full purification exactly once with the visible character loaded", async () => {
    const controller = await player();
    const done = vi.fn();
    controller.purify(done);
    for (let time = 0; time < TEMIZU_DURATION + 0.2; time += 1 / 60)
      controller.update(1 / 60, new Vector2(), true);
    expect(done).toHaveBeenCalledOnce();
    expect(controller.busy).toBe(false);
    expect(controller.root.getObjectByName('TemizuLadle')!.visible).toBe(false);
    expect(controller.root.getObjectByName('PurificationWater')!.visible).toBe(false);
    controller.dispose();
  });
  it("keeps the unused ladle owned by the scene so leaving before purification releases its geometry", () => {
    const controller = new PlayerController([], new CameraController());
    const ladle = controller.root.getObjectByName('TemizuLadle')!;
    expect(ladle.visible).toBe(false);
    const cup = controller.root.getObjectByName('LadleCup') as Mesh;
    const released = vi.spyOn(cup.geometry, 'dispose');
    controller.dispose();
    disposeObject(controller.root, false);
    expect(released).toHaveBeenCalledOnce();
  });
});
