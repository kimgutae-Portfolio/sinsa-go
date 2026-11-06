import { describe, expect, it } from "vitest";
import { Box3, Mesh, Raycaster, Vector2, Vector3 } from "three";
import { CameraController } from "../src/game/CameraController";
import { TEMIZU_LAYOUT } from "../src/game/layout";
import { PlayerController } from "../src/game/PlayerController";
import { AssetLoader } from "../src/game/AssetLoader";
import { World } from "../src/game/World";
import { disposeObject } from "../src/game/geometry";

const player = new Vector3(TEMIZU_LAYOUT.stance.x, 0, TEMIZU_LAYOUT.stance.z);
const basinCollider = {
  minX: TEMIZU_LAYOUT.x - TEMIZU_LAYOUT.width / 2,
  maxX: TEMIZU_LAYOUT.x + TEMIZU_LAYOUT.width / 2,
  minZ: TEMIZU_LAYOUT.z - TEMIZU_LAYOUT.depth / 2,
  maxZ: TEMIZU_LAYOUT.z + TEMIZU_LAYOUT.depth / 2,
  height: 0.86,
};
function settle(camera: CameraController) {
  for (let frame = 0; frame < 180; frame++) camera.update(1 / 60, player, [basinCollider]);
}

describe("the hand-washing camera", () => {
  it.each([[1280, 720], [390, 844], [390, 600]])(
    "shows the hood, both mittens and water above the rim at %sx%s",
    (width, height) => {
      const controller = new CameraController();
      controller.resize(width, height);
      controller.update(0, player, [basinCollider], true);
      controller.setTemizuView(true);
      settle(controller);
      const z = TEMIZU_LAYOUT.stance.z;
      const points = [
        new Vector3(-7, 1.73, z), // top of the hood
        new Vector3(-7.15, 0.88, z + 0.33), // compact receiving palm
        new Vector3(-7.18, 1.08, z + 0.34), // ladle above the palm
        new Vector3(-7.15, 0.87, z + 0.33), // falling water at the near rim
        new Vector3(-6.83, 1.43, z + 0.32), // upright handle rinse
        new Vector3(-6.72, 0.78, z + 0.78), // ladle dipping into the basin
        new Vector3(-7, 0.15, z),
      ];
      const projected = points.map(point => point.clone().project(controller.camera));
      for (const point of projected) {
        expect(Math.abs(point.x)).toBeLessThan(0.92);
        expect(Math.abs(point.y)).toBeLessThan(0.94);
        expect(point.z).toBeGreaterThan(-1);
        expect(point.z).toBeLessThan(1);
      }
      // The ritual should read as a close view, rather than a tiny full garden.
      expect(projected[0]!.distanceTo(projected.at(-1)!)).toBeGreaterThan(0.65);
      // The viewing rays enter between the side posts and under the canopy.
      const eye = controller.camera.position;
      expect(eye.y).toBeLessThan(2.6);
      for (const point of points.slice(0, -1)) {
        const postX = TEMIZU_LAYOUT.x + 1.25;
        const t = (postX - eye.x) / (point.x - eye.x);
        if (t < 0 || t > 1) continue;
        const rayZ = eye.z + (point.z - eye.z) * t;
        for (const postZ of [TEMIZU_LAYOUT.z - 0.75, TEMIZU_LAYOUT.z + 0.75])
          expect(Math.abs(rayZ - postZ)).toBeGreaterThan(0.15);
      }
    },
  );

  it("sees the pouring palm and cup before the solid hood or basin meshes", async () => {
    const assets = new AssetLoader();
    const world = new World(assets);
    const controller = new CameraController();
    const traveler = new PlayerController(world.colliders, controller);
    try {
      await world.init();
      await traveler.init(assets);
      traveler.setPosition({ x: player.x, z: player.z, yaw: 0 });
      traveler.purify(() => {});
      // Middle of the left-hand pour, using the actual character geometry.
      traveler.update(1.55, new Vector2(), true);
      traveler.root.updateMatrixWorld(true);
      world.root.updateMatrixWorld(true);
      const palm = traveler.root.getObjectByName("LeftHandAnchor")!.getObjectByName("Mitten") as Mesh;
      const cup = traveler.root.getObjectByName("LadleCup") as Mesh;
      for (const [width, height] of [[1280, 720], [390, 844]]) {
        controller.resize(width, height);
        controller.setTemizuView(true);
        controller.update(0, player, world.colliders, true);
        // Check the real hood and face extents, not merely their centres.
        // A side view can frame the hands while cutting off half of the hood.
        for (const name of ["Hood", "Face"]) {
          const bounds = new Box3().setFromObject(traveler.root.getObjectByName(name)!, true);
          for (const x of [bounds.min.x, bounds.max.x])
            for (const y of [bounds.min.y, bounds.max.y])
              for (const z of [bounds.min.z, bounds.max.z]) {
                const corner = new Vector3(x, y, z).project(controller.camera);
                expect(Math.abs(corner.x), `${width}px: ${name} width`).toBeLessThan(0.9);
                expect(Math.abs(corner.y), `${width}px: ${name} height`).toBeLessThan(0.9);
              }
        }
        for (const object of [palm, cup]) {
          // The cupped palm turns up with its wrist. Sample the actual rounded
          // surface on all sides instead of the previous fixed forward face.
          const samples = object === palm ? Array.from({ length: 20 }, (_, i) => {
            const y = 1 - 2 * (i + 0.5) / 20, r = Math.sqrt(1 - y * y);
            return new Vector3(Math.cos(i * 2.39996) * r, y, Math.sin(i * 2.39996) * r);
          }) : [
            // The centre of the open bowl is air; sample its solid sides.
            new Vector3(0.086, 0, 0), new Vector3(-0.086, 0, 0),
            new Vector3(0, 0, 0.086), new Vector3(0, 0, -0.086),
          ];
          const visible: boolean[] = [];
          const blockers: string[] = [];
          for (const sample of samples) {
            const target = object.localToWorld(sample.clone());
            const direction = target.clone().sub(controller.camera.position).normalize();
            const ray = new Raycaster(controller.camera.position, direction, 0, target.distanceTo(controller.camera.position) + 0.01);
            const first = ray.intersectObjects([world.root, traveler.root], true).find(hit => {
              if (!(hit.object instanceof Mesh) || !hit.object.visible) return false;
              const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
              return materials.some(material => !material.transparent || material.opacity > 0.95);
            });
            const isPart = first?.object === object || first?.object.parent === object;
            visible.push(isPart);
            blockers.push(`${first?.object.name}/${first?.object.parent?.name}`);
          }
          expect(visible.filter(Boolean).length, `${width}px: ${object.name} blocked by ${blockers.join(",")}`).toBeGreaterThanOrEqual(object === palm ? 6 : 2);
        }
      }
      // Finishing must not collapse the normal camera into a phantom tall
      // basin collider or leave the canopy across the visitor's face. Resting
      // mittens are now beside the body and naturally below the stone rim.
      traveler.update(10, new Vector2(), true);
      traveler.root.updateMatrixWorld(true);
      controller.setTemizuView(false);
      for (let frame = 0; frame < 180; frame++) controller.update(1 / 60, player, world.colliders);
      expect(traveler.state).toBe("Idle");
      expect(controller.camera.position.distanceTo(player)).toBeGreaterThan(7);
      for (const object of [traveler.root.getObjectByName("Face")!]) {
        const target = object.localToWorld(new Vector3(0, -0.2, 0.98));
        const ray = new Raycaster(
          controller.camera.position, target.clone().sub(controller.camera.position).normalize(),
          0, target.distanceTo(controller.camera.position) + 0.01,
        );
        const first = ray.intersectObjects([world.root, traveler.root], true).find(hit => {
          if (!(hit.object instanceof Mesh) || !hit.object.visible) return false;
          const materials = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
          return materials.some(material => !material.transparent || material.opacity > 0.95);
        });
        expect(first?.object.name, `return: ${object.name} blocked by ${first?.object.name}`).toBe(object.name);
      }
    } finally {
      assets.dispose();
      disposeObject(world.root);
      disposeObject(traveler.root);
    }
  });

  it("enters smoothly and restores the visitor's orbit, zoom and field of view", () => {
    const controller = new CameraController();
    controller.resize(1280, 720);
    controller.rotate(105, 35);
    controller.setZoom(0.28);
    controller.update(0, player, [basinCollider], true);
    const originalPosition = controller.camera.position.clone();
    const originalDirection = controller.camera.getWorldDirection(new Vector3());
    const originalRight = controller.right.clone();
    const originalFov = controller.camera.fov;
    controller.setTemizuView(true);
    controller.update(1 / 60, player, [basinCollider]);
    const firstStep = controller.camera.position.distanceTo(originalPosition);
    expect(firstStep).toBeGreaterThan(0);
    expect(firstStep).toBeLessThan(1);
    settle(controller);
    expect(controller.camera.position.distanceTo(originalPosition)).toBeGreaterThan(1);
    controller.rotate(500, 500);
    controller.ease(Math.PI, 1);
    controller.setZoom(100);
    controller.setTemizuView(false);
    settle(controller);
    expect(controller.camera.position.distanceTo(originalPosition)).toBeLessThan(0.001);
    expect(controller.camera.getWorldDirection(new Vector3()).distanceTo(originalDirection)).toBeLessThan(0.001);
    expect(controller.right.distanceTo(originalRight)).toBeLessThan(0.001);
    expect(controller.camera.fov).toBe(originalFov);
    controller.rotate(10, 0);
    expect(controller.right.distanceTo(originalRight)).toBeGreaterThan(0.01);
  });

  it("resets a cancelled experience without leaving a locked or zoomed camera", () => {
    const controller = new CameraController();
    controller.resize(390, 844);
    controller.setTemizuView(true);
    settle(controller);
    controller.reset(player);
    expect(controller.camera.fov).toBe(68);
    const before = controller.right.clone();
    controller.rotate(20, 0);
    expect(controller.right.distanceTo(before)).toBeGreaterThan(0.01);
    controller.update(0, player, [], true);
    expect(controller.camera.position.distanceTo(player)).toBeGreaterThan(7);
  });
});
