import { afterEach, describe, expect, it, vi } from "vitest";
import { Group, Mesh, Vector2, Vector3 } from "three";
import { AssetLoader } from "../src/game/AssetLoader";
import { CameraController } from "../src/game/CameraController";
import { PlayerController } from "../src/game/PlayerController";
import { World } from "../src/game/World";
import { temizuSleeveAttachment } from "../src/game/TemizuAnimation";
import { TRAVELER_BODY_Y, TRAVELER_HEAD_PIVOT, TRAVELER_REST_HAND } from "../src/game/character";
import { canOccupy } from "../src/game/collision";
import { PLAYER_SPAWN } from "../src/game/config";
import { disposeObject } from "../src/game/geometry";
import { TEMIZU_LAYOUT } from "../src/game/layout";
import { ALIGN_DURATION, TEMIZU_DURATION } from "../src/game/ritual";

const players: PlayerController[] = [];
afterEach(() => players.splice(0).forEach(player => {
  player.dispose();
  disposeObject(player.root, false);
}));
const basin = {
  minX: TEMIZU_LAYOUT.x - TEMIZU_LAYOUT.width / 2,
  maxX: TEMIZU_LAYOUT.x + TEMIZU_LAYOUT.width / 2,
  minZ: TEMIZU_LAYOUT.z - TEMIZU_LAYOUT.depth / 2,
  maxZ: TEMIZU_LAYOUT.z + TEMIZU_LAYOUT.depth / 2,
};
async function traveler() {
  const assets = new AssetLoader();
  const player = new PlayerController([basin], new CameraController());
  await player.init(assets);
  assets.dispose();
  players.push(player);
  player.setPosition({ ...TEMIZU_LAYOUT.approach, yaw: 0 });
  return player;
}
function capture(player: PlayerController) {
  player.root.updateMatrixWorld(true);
  return ["LeftHandAnchor", "RightHandAnchor", "LadleCup"].map(name =>
    player.root.getObjectByName(name)!.getWorldPosition(new Vector3()));
}

describe("attached, continuous handwashing", () => {
  it("walks from the entrance to the basin shortcut before taking a safe final step into the washing stance", async () => {
    const assets = new AssetLoader();
    const world = new World(assets);
    const player = new PlayerController(world.colliders, new CameraController());
    players.push(player);
    try {
      await world.init();
      await player.init(assets);
      player.setPosition({ ...PLAYER_SPAWN, yaw: Math.PI });
      const destination = new Vector3(TEMIZU_LAYOUT.approach.x, 0, TEMIZU_LAYOUT.approach.z);
      // A point can be outside the basin yet fail the pathfinder's wider 0.5m grid.
      // Keep the menu destination routable; the final closer stance belongs to alignment.
      expect(player.navigate(destination)).toBe(true);
      for (let frame = 0; frame < 600 && player.navigating; frame++) {
        player.update(1 / 60, new Vector2(), true);
        expect(canOccupy(player.root.position.x, player.root.position.z, 0.34, world.colliders)).toBe(true);
      }
      expect(player.navigating).toBe(false);
      expect(player.root.position.distanceTo(destination)).toBeLessThan(0.2);
      player.purify(() => {});
      for (let frame = 0; frame < Math.ceil(ALIGN_DURATION * 60) + 2; frame++) {
        player.update(1 / 60, new Vector2(), true);
        expect(canOccupy(player.root.position.x, player.root.position.z, 0.34, world.colliders)).toBe(true);
      }
      expect(player.root.position.x).toBeCloseTo(TEMIZU_LAYOUT.stance.x, 6);
      expect(player.root.position.z).toBeCloseTo(TEMIZU_LAYOUT.stance.z, 6);
      expect(player.root.rotation.y).toBe(0);
      expect(player.state).toBe("Purify");
    } finally {
      assets.dispose();
      disposeObject(world.root, false);
    }
  });

  it("keeps the real sleeve tips attached to the cape throughout the full ritual without stretching the arms", async () => {
    const player = await traveler();
    const done = vi.fn();
    player.purify(done);
    const armData = ([-1, 1] as const).map(side => {
      const arm = player.root.getObjectByName(side < 0 ? "LeftMitten" : "RightMitten") as Group;
      const attachment = temizuSleeveAttachment(side, new Vector3());
      const shoulder = attachment.clone().add(new Vector3(
        side * TRAVELER_REST_HAND.x, TRAVELER_REST_HAND.y, TRAVELER_REST_HAND.z));
      return { side, arm, attachment, shoulder, sleeve: arm.getObjectByName("CapeSleeve")! };
    });
    const actual = new Vector3(), expected = new Vector3(), hand = new Vector3();
    const streamAxis = new Vector3(), streamTop = new Vector3(), streamBottom = new Vector3();
    for (let frame = 0; frame < Math.ceil(TEMIZU_DURATION * 60); frame++) {
      player.update(1 / 60, new Vector2(), true);
      player.root.updateMatrixWorld(true);
      for (const { arm, attachment, shoulder, sleeve } of armData) {
        const torso = arm.parent!;
        expected.copy(shoulder);
        torso.localToWorld(expected);
        // This is the top of the actual tapered sleeve geometry, not a spare joint.
        actual.set(0, 0.265, 0);
        sleeve.localToWorld(actual);
        expect(actual.distanceTo(expected)).toBeLessThan(1e-6);
        expect(arm.scale.toArray()).toEqual([1, 1, 1]);
        arm.getWorldPosition(hand);
        expect(hand.distanceTo(expected)).toBeCloseTo(attachment.length(), 6);
        expect(hand.distanceTo(expected)).toBeLessThan(0.29);
      }
      expect(canOccupy(player.root.position.x, player.root.position.z, 0.34, [basin])).toBe(true);
      const ladle = player.root.getObjectByName("TemizuLadle")!;
      if (ladle.visible) {
        ladle.getWorldPosition(actual);
        const left = player.root.getObjectByName("LeftHandAnchor")!.getWorldPosition(expected);
        const leftDistance = actual.distanceTo(left);
        const right = player.root.getObjectByName("RightHandAnchor")!.getWorldPosition(hand);
        expect(Math.min(leftDistance, actual.distanceTo(right))).toBeLessThan(0.10);
      }
      const stream = player.root.getObjectByName("PurificationWater") as Mesh;
      if (stream.visible) {
        stream.getWorldPosition(streamTop);
        streamBottom.copy(streamTop);
        streamAxis.set(0, 1, 0).applyQuaternion(stream.quaternion).multiplyScalar(stream.scale.y / 2);
        streamTop.add(streamAxis);
        streamBottom.sub(streamAxis);
        expect(streamTop.y - streamBottom.y).toBeGreaterThan(0.04);
        player.root.getObjectByName("LadleCup")!.getWorldPosition(actual);
        expect(streamTop.distanceTo(actual)).toBeLessThan(0.10);
        player.root.getObjectByName(player.ritualStep === 1 || player.ritualStep === 3
          ? "RightHandAnchor" : "LeftHandAnchor")!.getWorldPosition(actual);
        expect(streamBottom.distanceTo(actual)).toBeLessThan(0.05);
      }
    }
    player.update(1 / 60, new Vector2(), true);
    expect(done).toHaveBeenCalledOnce();
    expect(player.state).toBe("Idle");
  });

  it.each([2.6, 4.6, 7.0])("does not teleport either hand or the ladle cup across the %ss stage boundary", async boundary => {
    const player = await traveler();
    player.purify(() => {});
    const epsilon = 0.001;
    player.update(boundary - epsilon, new Vector2(), true);
    const before = capture(player);
    player.update(epsilon * 2, new Vector2(), true);
    const after = capture(player);
    for (let i = 0; i < before.length; i++) expect(before[i]!.distanceTo(after[i]!)).toBeLessThan(0.006);
  });

  it.each([1.5, 2.6, 6.2, 8.0])("restores a connected resting pose and hides the props when cancelled at %ss", async elapsed => {
    const player = await traveler();
    const done = vi.fn();
    player.purify(done);
    player.update(elapsed, new Vector2(), true);
    player.reset();
    const arm = player.root.getObjectByName("LeftMitten") as Group;
    const torso = arm.parent!;
    const head = player.root.getObjectByName("TravelerHead")!;
    expect(torso.position.toArray()).toEqual([0, TRAVELER_BODY_Y, 0]);
    expect(torso.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(head.position.toArray()).toEqual([TRAVELER_HEAD_PIVOT.x, TRAVELER_HEAD_PIVOT.y, TRAVELER_HEAD_PIVOT.z]);
    expect(head.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(arm.position.toArray()).toEqual([-TRAVELER_REST_HAND.x, TRAVELER_REST_HAND.y, TRAVELER_REST_HAND.z]);
    for (const name of ["TemizuLadle", "PurificationWater", "PurificationSplash", "PurificationDroplets"])
      expect(player.root.getObjectByName(name)!.visible).toBe(false);
    player.update(10, new Vector2(), true);
    expect(done).not.toHaveBeenCalled();
    expect(player.busy).toBe(false);
  });
});
