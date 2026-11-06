import { afterEach, describe, expect, it } from "vitest";
import { Bone, Box3, Group, Mesh, SkinnedMesh, Vector3 } from "three";
import { createTraveler, restTraveler, TRAVELER_HEAD_PIVOT, type TravelerParts } from "../src/game/character";
import { disposeObject } from "../src/game/geometry";

const roots: Group[] = [];
afterEach(() => roots.splice(0).forEach(root => disposeObject(root, false)));
function traveler() {
  const parts: TravelerParts = {
    torso: new Group(), leftArm: new Group(), rightArm: new Group(),
    legs: [new Group(), new Group()], hands: [new Group(), new Group()],
  };
  const root = createTraveler(parts);
  roots.push(root);
  root.updateMatrixWorld(true);
  return { root, parts };
}
function coordinatesMatch(actual: Vector3, expected: readonly number[]) {
  actual.toArray().forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6));
}

describe("rigid traveler head", () => {
  it("preserves the existing resting hood, face and smile silhouette without extra meshes or a skeleton", () => {
    const { root, parts } = traveler();
    expect(parts.head?.name).toBe("TravelerHead");
    expect(parts.head?.parent).toBe(parts.torso);
    // Bounds captured from the approved character before introducing the neck pivot.
    const bounds = {
      Hood: [[-0.4517360032, 0.9103967965, -0.375], [0.4517360032, 1.7648838878, 0.3249999881]],
      Face: [[-0.3485069543, 0.955, 0.0307251936], [0.3485069543, 1.615, 0.3692748064]],
      Smile: [[-0.0288991649, 1.1952447271, 0.3649549186], [0.0288991649, 1.2137693143, 0.3740000129]],
    } as const;
    for (const [name, [min, max]] of Object.entries(bounds)) {
      const object = root.getObjectByName(name)!;
      expect(object.parent).toBe(parts.head);
      const box = new Box3().setFromObject(object);
      coordinatesMatch(box.min, min);
      coordinatesMatch(box.max, max);
    }
    let meshes = 0;
    root.traverse(object => {
      expect(object).not.toBeInstanceOf(Bone);
      expect(object).not.toBeInstanceOf(SkinnedMesh);
      if (object instanceof Mesh) meshes++;
    });
    expect(meshes).toBe(14);
  });

  it("lowers the mouth around a fixed neck while leaving the cape and sleeves attached, then restores the rest pose", () => {
    const { root, parts } = traveler();
    const head = parts.head!;
    const pivot = head.getWorldPosition(new Vector3());
    const mouth = root.getObjectByName("Smile")!;
    const before = new Box3().setFromObject(mouth).getCenter(new Vector3());
    const still = ["Poncho", "Collar", "ScarfFold", "LeftMitten", "RightMitten"].map(name => {
      const object = root.getObjectByName(name)!;
      return { object, matrix: object.matrixWorld.clone() };
    });
    head.rotation.x = 0.28;
    root.updateMatrixWorld(true);
    expect(head.getWorldPosition(new Vector3()).distanceTo(pivot)).toBeLessThan(1e-9);
    const bowed = new Box3().setFromObject(mouth).getCenter(new Vector3());
    expect(bowed.y).toBeLessThan(before.y - 0.08);
    expect(bowed.z).toBeGreaterThan(before.z);
    for (const { object, matrix } of still) expect(object.matrixWorld.equals(matrix)).toBe(true);
    // Returning to Idle also removes a previous head offset, not just its rotation.
    head.position.y += 0.02;
    restTraveler(parts);
    root.updateMatrixWorld(true);
    coordinatesMatch(head.position, [TRAVELER_HEAD_PIVOT.x, TRAVELER_HEAD_PIVOT.y, TRAVELER_HEAD_PIVOT.z]);
    expect(head.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(new Box3().setFromObject(mouth).getCenter(new Vector3()).distanceTo(before)).toBeLessThan(1e-9);
  });
});
