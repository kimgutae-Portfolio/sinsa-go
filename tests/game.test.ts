import { describe, expect, it, vi } from "vitest";
import { Vector2, Vector3 } from "three";
import { canOccupy } from "../src/game/collision";
import { InteractionManager } from "../src/game/InteractionManager";
import { INTERACTIONS, World } from "../src/game/World";
import {
  ALIGN_DURATION,
  ritualFrame,
  RITUAL_DURATION,
  RITUAL_STEPS,
} from "../src/game/ritual";
import { CameraController } from "../src/game/CameraController";
import { PlayerController } from "../src/game/PlayerController";
import { drawFortune, FORTUNES } from "../src/game/fortunes";
import { AssetLoader, ASSET_MANIFEST } from "../src/game/AssetLoader";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from "three";
import { disposeObject } from "../src/game/geometry";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { surface } from "../src/game/surfaces";
import { HALL_LAYOUT, OFFERING_LAYOUT } from "../src/game/layout";

const obstacle = { minX: -1, maxX: 1, minZ: -1, maxZ: 1 };
describe("collision", () => {
  it("blocks an obstacle and map edges, permits tangency and rounded corners", () => {
    expect(canOccupy(0, 0, 0.34, [obstacle])).toBe(false);
    expect(canOccupy(1.35, 0, 0.34, [obstacle])).toBe(true);
    expect(canOccupy(1.3, 1.3, 0.34, [obstacle])).toBe(true);
    expect(canOccupy(14, 0, 0.34, [])).toBe(false);
    expect(canOccupy(0, -14, 0.34, [])).toBe(false);
  });
  it("slides along a wall and cannot tunnel through it", () => {
    const player = new PlayerController([obstacle], new CameraController());
    player.root.position.set(1.5, 0, 0);
    for (let i = 0; i < 30; i++)
      player.update(1 / 60, new Vector2(-1, 0), true);
    expect(
      canOccupy(player.root.position.x, player.root.position.z, 0.34, [
        obstacle,
      ]),
    ).toBe(true);
    player.root.position.set(0, 0, 2);
    player.update(1, new Vector2(0, 1), true);
    expect(
      canOccupy(player.root.position.x, player.root.position.z, 0.34, [
        obstacle,
      ]),
    ).toBe(true);
  });
});
describe("movement", () => {
  it("moves at the same speed at 30 and 120 fps", () => {
    function simulate(fps: number) {
      const player = new PlayerController([], new CameraController());
      for (let i = 0; i < fps; i++)
        player.update(1 / fps, new Vector2(0, 1), true);
      return player.root.position;
    }
    expect(simulate(30).distanceTo(simulate(120))).toBeLessThan(0.00001);
  });
  it("pauses movement and returns to Idle", () => {
    const player = new PlayerController([], new CameraController());
    player.update(0.05, new Vector2(1, 0), false);
    expect(player.state).toBe("Idle");
    expect(player.root.position.x).toBe(0);
    expect(player.root.position.z).toBe(1.5);
    player.update(0.05, new Vector2(1, 0), true);
    expect(player.state).toBe("Walk");
  });
});
describe("interactions", () => {
  it("exposes only nearby facilities and suppresses interaction while paused", () => {
    const manager = new InteractionManager(INTERACTIONS);
    manager.update(0, 6, true);
    expect(manager.nearby).toBe(null);
    manager.update(-7, -0.5, true);
    expect(manager.nearby).toBe("fortune");
    manager.update(OFFERING_LAYOUT.ritual.x, OFFERING_LAYOUT.ritual.z, true);
    expect(manager.nearby).toBe("offering");
    manager.update(OFFERING_LAYOUT.ritual.x, OFFERING_LAYOUT.ritual.z, false);
    expect(manager.nearby).toBe(null);
  });
});
describe("ritual", () => {
  it("plays bow, bow, clap, clap, bow after alignment", () => {
    let elapsed = ALIGN_DURATION;
    const sequence: string[] = [];
    for (const step of RITUAL_STEPS) {
      sequence.push(ritualFrame(elapsed + step.duration / 2).kind);
      elapsed += step.duration;
    }
    expect(sequence).toEqual(["bow", "bow", "clap", "clap", "bow"]);
    expect(ritualFrame(0).kind).toBe("align");
    expect(ritualFrame(RITUAL_DURATION + 0.01).done).toBe(true);
  });
  it("aligns, ignores movement, completes once, then unlocks movement", () => {
    const player = new PlayerController([], new CameraController());
    player.root.position.set(2.5, 0, -3.6);
    let completed = 0;
    player.pray(() => completed++);
    for (let i = 0; i < 60; i++) player.update(1 / 60, new Vector2(1, 1), true);
    expect(player.root.position.x).toBeCloseTo(0);
    expect(player.root.position.z).toBeCloseTo(OFFERING_LAYOUT.ritual.z);
    expect(player.state).toBe("Pray");
    for (let i = 0; i < 600; i++) player.update(1 / 60, new Vector2(), true);
    expect(completed).toBe(1);
    expect(player.state).toBe("Idle");
    player.update(0.05, new Vector2(1, 0), true);
    expect(player.state).toBe("Walk");
  });
});
describe("assets and fortune", () => {
  it("disposes a late GLB without invalidating a new garden's shared textures", async () => {
    const assets = new AssetLoader();
    const lateScene = new Group();
    const geometry = new BoxGeometry();
    lateScene.add(new Mesh(geometry, new MeshStandardMaterial()));
    const released = vi.spyOn(geometry, "dispose");
    let finish!: (value: GLTF) => void;
    const request = vi
      .spyOn(GLTFLoader.prototype, "loadAsync")
      .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    ASSET_MANIFEST.hall = { url: "late-hall.glb" };
    const currentMaterial = surface("wood", "#bda782");
    try {
      const pending = assets.load("hall", () => new Group());
      assets.dispose();
      finish({ scene: lateScene, animations: [] } as unknown as GLTF);
      const result = await pending;
      expect(result.object.children).toHaveLength(0);
      expect(released).toHaveBeenCalledTimes(1);
      expect(surface("wood", "#bda782")).toBe(currentMaterial);
    } finally {
      request.mockRestore();
      delete ASSET_MANIFEST.hall;
      const owner = new Group();
      owner.add(new Mesh(new BoxGeometry(), currentMaterial));
      disposeObject(owner);
    }
  });
  it("uses a geometry fallback without requesting an unconfigured model", async () => {
    const assets = new AssetLoader();
    const group = new Group();
    const loaded = await assets.load("torii", () => group);
    expect(loaded.fallback).toBe(true);
    expect(loaded.object).toBe(group);
    assets.dispose();
  });
  it("uses a fallback if a configured GLB fails to load", async () => {
    const assets = new AssetLoader();
    ASSET_MANIFEST.hall = { url: "invalid://missing.glb" };
    try {
      expect((await assets.load("hall", () => new Group())).fallback).toBe(
        true,
      );
    } finally {
      delete ASSET_MANIFEST.hall;
      assets.dispose();
    }
  });
  it("does not create fallback resources after disposal", async () => {
    const assets = new AssetLoader();
    assets.dispose();
    let created = false;
    await assets.load("tree", () => {
      created = true;
      return new Group();
    });
    expect(created).toBe(false);
  });
  it("batches the static garden and keeps tree collisions", async () => {
    const assets = new AssetLoader();
    const world = new World(assets);
    await world.init();
    let meshes = 0;
    world.root.traverse((object) => {
      if (object instanceof Mesh) meshes++;
    });
    expect(meshes).toBeLessThan(100);
    expect(canOccupy(-12, -11, 0.34, world.colliders)).toBe(false);
    expect(canOccupy(8, HALL_LAYOUT.position.z, 0.34, world.colliders)).toBe(
      false,
    );
    expect(
      canOccupy(
        HALL_LAYOUT.steps.x,
        HALL_LAYOUT.steps.z,
        0.34,
        world.colliders,
      ),
    ).toBe(false);
    expect(
      canOccupy(
        OFFERING_LAYOUT.ritual.x,
        OFFERING_LAYOUT.ritual.z,
        0.34,
        world.colliders,
      ),
    ).toBe(true);
    assets.dispose();
    disposeObject(world.root);
  });
  it("disposes shared geometry, materials and textures once per scene", () => {
    const scene = new Group();
    const geometry = new BoxGeometry();
    const texture = new Texture();
    const material = new MeshStandardMaterial({ map: texture });
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    scene.add(new Mesh(geometry, material), new Mesh(geometry, material));
    disposeObject(scene);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
  it("can draw all fortunes, including the last one", () => {
    FORTUNES.forEach((fortune, i) =>
      expect(drawFortune(() => (i + 0.1) / FORTUNES.length)).toBe(fortune),
    );
    expect(drawFortune(() => 0.9999)).toBe(FORTUNES.at(-1));
  });
});

describe("immersive navigation", () => {
  it("routes around obstacles rather than cutting through them", () => {
    const camera = new CameraController();
    const player = new PlayerController([obstacle], camera);
    player.root.position.set(0, 0, 3);
    expect(player.navigate(new Vector3(0, 0, -3))).toBe(true);
    for (let i = 0; i < 600; i++) {
      player.update(1 / 60, new Vector2(), true);
      expect(
        canOccupy(player.root.position.x, player.root.position.z, 0.34, [
          obstacle,
        ]),
      ).toBe(true);
    }
    expect(player.navigating).toBe(false);
    expect(player.root.position.distanceTo(new Vector3(0, 0, -3))).toBeLessThan(
      0.15,
    );
  });
  it("rejects destinations inside obstacles or outside the garden", () => {
    const player = new PlayerController([obstacle], new CameraController());
    expect(player.navigate(new Vector3(0, 0, 0))).toBe(false);
    expect(player.navigate(new Vector3(20, 0, 0))).toBe(false);
  });
  it("manual input cancels automatic walking", () => {
    const player = new PlayerController([], new CameraController());
    player.navigate(new Vector3(-7, 0, 0));
    expect(player.navigating).toBe(true);
    player.update(1 / 60, new Vector2(1, 0), true);
    expect(player.navigating).toBe(false);
  });
  it("can reach all three experiences from the entrance", async () => {
    const assets = new AssetLoader();
    const world = new World(assets);
    await world.init();
    for (const target of [
      new Vector3(OFFERING_LAYOUT.ritual.x, 0, OFFERING_LAYOUT.ritual.z),
      new Vector3(-7, 0, -0.2),
      new Vector3(7, 0, -1.7),
    ]) {
      const player = new PlayerController(
        world.colliders,
        new CameraController(),
      );
      expect(player.navigate(target)).toBe(true);
      for (let frame = 0; frame < 1200 && player.navigating; frame++)
        player.update(1 / 60, new Vector2(), true);
      expect(player.root.position.distanceTo(target)).toBeLessThan(0.15);
      disposeObject(player.root);
    }
    assets.dispose();
    disposeObject(world.root);
  });
});

describe("third-person camera", () => {
  it("uses perspective and rotates movement with the viewing direction", () => {
    const camera = new CameraController();
    expect(camera.camera.isPerspectiveCamera).toBe(true);
    expect(camera.forward.z).toBeCloseTo(-1);
    camera.rotate(100, 0);
    expect(camera.forward.x).toBeGreaterThan(0.4);
    expect(camera.forward.dot(camera.right)).toBeCloseTo(0);
  });
  it("follows the player and keeps obstacles in front of the camera", () => {
    const camera = new CameraController();
    const position = new Vector3(2, 0, 2);
    camera.update(1, position, [], true);
    expect(camera.camera.position.x).toBeCloseTo(2);
    const freeZ = camera.camera.position.z;
    camera.update(
      1,
      position,
      [{ minX: 0, maxX: 4, minZ: 4, maxZ: 6, height: 6 }],
      true,
    );
    expect(camera.camera.position.z).toBeLessThan(4);
    expect(camera.camera.position.z).toBeLessThan(freeZ);
    camera.resize(390, 844);
    expect(camera.camera.aspect).toBeCloseTo(390 / 844);
  });
});
