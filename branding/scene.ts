// Offline art direction preview, served only by Vite's dev server.
// Uses the actual game world; no multiplayer, visitor keys, wishes, audio or analytics.
import * as THREE from "three";
import { AssetLoader } from "../src/game/AssetLoader";
import { World } from "../src/game/World";
import { PlayerController } from "../src/game/PlayerController";
import { CameraController } from "../src/game/CameraController";
import { LanternGarden } from "../src/game/LanternGarden";
import { createSky } from "../src/game/atmosphere";
import { groundTexture } from "../src/game/terrain";
import { disposeObject } from "../src/game/geometry";

const host = document.querySelector<HTMLElement>(".scene")!;
const state = document.querySelector<HTMLElement>(".state")!;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setSize(846, 630);
renderer.setPixelRatio(1);
renderer.setClearColor("#d5daca");
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
host.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog("#d5daca", 32, 95);
const assets = new AssetLoader();
const world = new World(assets);
const player = new PlayerController([], new CameraController());
const lanterns = new LanternGarden();
scene.add(world.root, player.root, lanterns.root, createSky());
scene.add(new THREE.HemisphereLight("#dfebee", "#645e47", 1.65));
const sun = new THREE.DirectionalLight("#ffeace", 3.1);
sun.position.set(-12, 24, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: .5, far: 75 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun);
const texture = groundTexture();
texture.repeat.set(80, 80);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(300, 300),
  new THREE.MeshStandardMaterial({ color: "#b0b591", map: texture, roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.07;
floor.receiveShadow = true;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(44, 846 / 630, 0.1, 180);
camera.position.set(18, 21, 23);
camera.lookAt(0, 1, -2.8);
let disposed = false;
window.addEventListener("pagehide", () => {
  disposed = true;
  assets.dispose();
  player.dispose();
  lanterns.dispose();
  disposeObject(scene);
  renderer.dispose();
  renderer.forceContextLoss();
}, { once: true });

try {
  await Promise.all([world.init(), player.init(assets), document.fonts.ready]);
  if (!disposed) {
    player.setPosition({ x: -0.6, z: 1.8, yaw: .65 });
    player.update(0, new THREE.Vector2(), true);
    await renderer.compileAsync(scene, camera);
    if (!disposed) {
      renderer.render(scene, camera);
      state.hidden = true;
      document.title = "共有画像の準備完了 · こもれび神社";
    }
  }
} catch (error) {
  console.error(error);
  state.textContent = "境内を準備できませんでした。コンソールをご確認ください。";
}
