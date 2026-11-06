import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { EMA_LAYOUT } from "./layout";

/** Shrine furnishings only: these never occupy a visitor slot or represent a wish. */
export function createEmaScenery() {
  const root = new THREE.Group();
  root.name = "EmaScenery";
  const empty = new THREE.Group();
  empty.name = "EmaEmptyInvitation";
  root.add(empty);
  const straw = new THREE.MeshStandardMaterial({ color: "#b9a47b", roughness: 1 });
  const paper = new THREE.MeshStandardMaterial({ color: "#f0e9d7", roughness: 1, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ color: "#8a6b49", roughness: 0.95 });
  const clay = new THREE.MeshStandardMaterial({ color: "#665b48", roughness: 1 });
  const leaf = new THREE.MeshStandardMaterial({ color: "#4f6449", roughness: 0.92, side: THREE.DoubleSide });

  function mesh(parent: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material, position: [number, number, number]) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  function twig(parent: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, radius: number, material = wood) {
    const object = mesh(parent, new THREE.CylinderGeometry(radius, radius * 1.2, from.distanceTo(to), 5), material,
      from.clone().add(to).multiplyScalar(0.5).toArray() as [number, number, number]);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
  }

  // A small straw rope follows the upper rail; its paper folds leave the ema rows clear.
  const span = EMA_LAYOUT.width / 2 - 0.12;
  for (let strand = 0; strand < 3; strand++) {
    const points = Array.from({ length: 61 }, (_, i) => {
      const t = i / 60, twist = t * Math.PI * 32 + strand * Math.PI * 2 / 3;
      return new THREE.Vector3((t * 2 - 1) * span,
        2.64 - Math.sin(t * Math.PI) * 0.07 + Math.sin(twist) * 0.014,
        0.14 + Math.cos(twist) * 0.014);
    });
    mesh(root, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 96, 0.013, 5, false), straw, [0, 0, 0]);
  }
  const shide = new THREE.Shape();
  shide.moveTo(-0.06, 0);
  shide.lineTo(0.08, -0.05);
  shide.lineTo(-0.005, -0.13);
  shide.lineTo(0.09, -0.19);
  shide.lineTo(-0.025, -0.29);
  shide.lineTo(-0.105, -0.24);
  shide.lineTo(-0.015, -0.17);
  shide.lineTo(-0.1, -0.11);
  shide.closePath();
  for (const x of [-1.64, 1.64]) {
    const fold = mesh(root, new THREE.ShapeGeometry(shide), paper, [x, 2.63, 0.15]);
    fold.rotation.y = x < 0 ? -0.12 : 0.12;
    fold.scale.setScalar(0.72);
  }

  // A hanging house sign welcomes the first wish, then makes way for real ema.
  for (const x of [-0.56, 0.56])
    twig(empty, new THREE.Vector3(x, 2.43, 0.12), new THREE.Vector3(x, 1.86, 0.12), 0.009, straw);
  const sign = new THREE.Group();
  sign.position.set(0, 1.51, 0.14);
  sign.rotation.z = -0.018;
  empty.add(sign);
  mesh(sign, new THREE.BoxGeometry(1.72, 0.69, 0.05), wood, [0, 0, 0]);
  const face = new THREE.MeshStandardMaterial({ color: "#e8ddc0", roughness: 1 });
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#e8ddc0";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#55452f";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = '54px "Yu Mincho", "Hiragino Mincho ProN", serif';
      ctx.fillText("願いを、ここに。", 384, 125);
      ctx.strokeStyle = "#9c4435";
      ctx.lineWidth = 3;
      ctx.strokeRect(665, 176, 35, 35);
      ctx.fillStyle = "#9c4435";
      ctx.font = '23px "Yu Mincho", serif';
      ctx.fillText("結", 682, 195);
      face.color.set("#ffffff");
      face.map = new THREE.CanvasTexture(canvas);
      face.map.colorSpace = THREE.SRGBColorSpace;
    }
  }
  mesh(sign, new THREE.PlaneGeometry(1.6, 0.57), face, [0, 0, 0.027]);

  // Paired sakaki sprigs in earthenware, tucked inside the existing rack footprint.
  const leafGeometry = new THREE.Shape();
  leafGeometry.moveTo(0, 0);
  leafGeometry.quadraticCurveTo(-0.065, 0.09, 0, 0.22);
  leafGeometry.quadraticCurveTo(0.065, 0.09, 0, 0);
  for (const side of [-1, 1]) {
    const greenery = new THREE.Group();
    greenery.position.set(side * (EMA_LAYOUT.width / 2 - 0.27), 0, 0.23);
    root.add(greenery);
    mesh(greenery, new THREE.CylinderGeometry(0.11, 0.075, 0.24, 9), clay, [0, 0.18, 0]);
    mesh(greenery, new THREE.TorusGeometry(0.105, 0.012, 4, 12), clay, [0, 0.3, 0]).rotation.x = Math.PI / 2;
    for (let stem = 0; stem < 3; stem++) {
      const tip = new THREE.Vector3((stem - 1) * 0.09, 0.78 - Math.abs(stem - 1) * 0.05, -0.02);
      twig(greenery, new THREE.Vector3(0, 0.27, 0), tip, 0.006);
      for (let i = 0; i < 4; i++) {
        const direction = i % 2 ? 1 : -1;
        const blade = mesh(greenery, new THREE.ShapeGeometry(leafGeometry), leaf,
          [tip.x * (0.35 + i * 0.15), 0.39 + i * 0.075, 0]);
        blade.rotation.set(0.2, direction * 0.45, direction * (0.55 + stem * 0.12));
        blade.scale.setScalar(0.8 + (i % 2) * 0.12);
      }
    }
  }

  // Static decorations share just a few draw calls, even on mobile.
  for (const group of [root, empty, sign, ...root.children.filter((child): child is THREE.Group => child instanceof THREE.Group && child !== empty)]) {
    const batches = new Map<THREE.Material, THREE.Mesh[]>();
    for (const object of group.children)
      if (object instanceof THREE.Mesh && !Array.isArray(object.material)) {
        const batch = batches.get(object.material) ?? [];
        batch.push(object);
        batches.set(object.material, batch);
      }
    for (const [material, objects] of batches) {
      if (objects.length < 2) continue;
      const geometries = objects.map((object) => {
        object.updateMatrix();
        return (object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone()).applyMatrix4(object.matrix);
      });
      const merged = mergeGeometries(geometries);
      if (merged) {
        mesh(group, merged, material, [0, 0, 0]);
        for (const object of objects) {
          object.removeFromParent();
          object.geometry.dispose();
        }
      }
      geometries.forEach((geometry) => geometry.dispose());
    }
  }
  return { root, empty };
}
