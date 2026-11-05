import { afterEach, describe, expect, it, vi } from "vitest";
import { Box3, Group, InstancedMesh, Mesh, Raycaster, Vector2, Vector3 } from "three";
import { AssetLoader } from "../src/game/AssetLoader";
import { CameraController } from "../src/game/CameraController";
import { PlayerController } from "../src/game/PlayerController";
import { World } from "../src/game/World";
import { TEMIZU_LAYOUT } from "../src/game/layout";
import { ALIGN_DURATION, TEMIZU_DURATION, TEMIZU_STEPS } from "../src/game/ritual";
import { disposeObject } from "../src/game/geometry";

const roots: Group[] = [];
afterEach(() => roots.splice(0).forEach(root => disposeObject(root, false)));
async function traveler() {
  const assets = new AssetLoader();
  const player = new PlayerController([], new CameraController());
  await player.init(assets);
  assets.dispose();
  roots.push(player.root);
  return player;
}
function midpoint(index: number) {
  return ALIGN_DURATION + TEMIZU_STEPS.slice(0, index).reduce((sum, step) => sum + step.duration, 0)
    + TEMIZU_STEPS[index]!.duration * 0.45;
}

describe("visible purification at the stone basin", () => {
  it.each([[0, "LeftHandAnchor"], [1, "RightHandAnchor"]] as const)(
    "holds the %s receiving palm above the basin rim with a visible pour and droplets",
    async (index, handName) => {
      const player = await traveler();
      player.purify(() => {});
      player.update(midpoint(index), new Vector2(), true);
      player.root.updateMatrixWorld(true);
      const hand = player.root.getObjectByName(handName)!.getWorldPosition(new Vector3());
      const cup = player.root.getObjectByName("LadleCup")!.getWorldPosition(new Vector3());
      const holding = player.root.getObjectByName(index === 0 ? "RightHandAnchor" : "LeftHandAnchor")!;
      const eye = player.root.getObjectByName("Eye")!.getWorldPosition(new Vector3());
      expect(holding.getWorldPosition(new Vector3()).y).toBeLessThan(eye.y - 0.15);
      const sleeve = player.root.getObjectByName(handName)!.parent!.getObjectByName("CapeSleeve")!;
      const cuff = new Box3().setFromObject(sleeve).getCenter(new Vector3());
      expect(cuff.z).toBeLessThan(hand.z - 0.08);
      expect(hand.y).toBeGreaterThan(0.86);
      expect(cup.y - hand.y).toBeGreaterThan(0.15);
      expect(Math.abs(cup.x - hand.x)).toBeLessThan(0.12);
      expect(Math.abs(cup.z - hand.z)).toBeLessThan(0.12);
      const stream = player.root.getObjectByName("PurificationWater") as Mesh;
      expect(stream.visible).toBe(true);
      expect(stream.scale.y).toBeGreaterThan(0.15);
      const droplets = player.root.getObjectByName("PurificationDroplets") as InstancedMesh;
      expect(droplets.visible).toBe(true);
      expect(droplets.count).toBe(10);
      const geometry = stream.geometry;
      player.update(0.05, new Vector2(), true);
      expect(stream.geometry).toBe(geometry);
      player.reset();
      for (const name of ["TemizuLadle", "PurificationWater", "PurificationSplash", "PurificationDroplets"])
        expect(player.root.getObjectByName(name)!.visible).toBe(false);
      player.dispose();
    },
  );

  it("rinses the raised ladle handle and removes all water when the ritual completes", async () => {
    const player = await traveler();
    const done = vi.fn();
    player.purify(done);
    player.update(midpoint(3), new Vector2(), true);
    player.root.updateMatrixWorld(true);
    const cup = player.root.getObjectByName("LadleCup")!.getWorldPosition(new Vector3());
    const grip = player.root.getObjectByName("RightHandAnchor")!.getWorldPosition(new Vector3());
    expect(cup.y - grip.y).toBeGreaterThan(0.25);
    expect(player.root.getObjectByName("PurificationWater")!.visible).toBe(true);
    player.update(TEMIZU_DURATION, new Vector2(), true);
    expect(done).toHaveBeenCalledOnce();
    expect(player.busy).toBe(false);
    for (const name of ["TemizuLadle", "PurificationWater", "PurificationSplash", "PurificationDroplets"])
      expect(player.root.getObjectByName(name)!.visible).toBe(false);
    player.dispose();
  });

  it("has reachable water inside an open bowl and animates preallocated ripple geometry", () => {
    const assets = new AssetLoader();
    const world = new World(assets);
    roots.push(world.root);
    world.root.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(TEMIZU_LAYOUT.x, 1.3, TEMIZU_LAYOUT.z), new Vector3(0, -1, 0));
    const first = ray.intersectObject(world.root, true)[0]!;
    expect(first.object.name).toBe("TemizuBasinWater");
    expect(first.point.y).toBeCloseTo(0.775);
    const ripple = world.root.getObjectByName("TemizuBasinRipple") as Mesh;
    const geometry = ripple.geometry;
    const scale = ripple.scale.x;
    world.update(0.3);
    expect(ripple.scale.x).not.toBe(scale);
    expect(ripple.geometry).toBe(geometry);
    expect(world.root.getObjectByName("TemizuFreshWater")!.visible).toBe(true);
    assets.dispose();
  });
});
