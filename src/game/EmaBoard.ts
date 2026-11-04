import * as THREE from "three";
import { EMA_LAYOUT as L } from "./layout";
import { lanternProduct, type PublicLantern } from "../shared/lanterns";
import { disposeObject } from "./geometry";

/** Height of each slot row's hanging bar, top row first. */
export const EMA_ROW_BARS = [2.45, 1.85, 1.25] as const;

export function emaSlotPosition(slot: number) {
  const row = Math.floor(slot / L.columns),
    column = slot % L.columns;
  return {
    x: -L.width / 2 + 0.3 + (column * (L.width - 0.6)) / (L.columns - 1),
    y: EMA_ROW_BARS[row]! - 0.25,
  };
}

/** Instanced wooden ema plaques that visitors hang on the board in World.ema(). */
export class EmaBoard {
  readonly root = new THREE.Group();
  private plaques: THREE.InstancedMesh;
  private faces: THREE.InstancedMesh;
  private cords: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private items: PublicLantern[] = [];
  private time = 0;

  constructor() {
    this.root.position.set(L.x, 0, L.z);
    const shape = new THREE.Shape();
    shape.moveTo(-0.22, -0.17);
    shape.lineTo(0.22, -0.17);
    shape.lineTo(0.22, 0.08);
    shape.lineTo(0, 0.18);
    shape.lineTo(-0.22, 0.08);
    shape.closePath();
    const body = new THREE.ExtrudeGeometry(shape, {
      depth: 0.028,
      bevelEnabled: false,
    });
    this.plaques = new THREE.InstancedMesh(
      body,
      new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.9 }),
      L.columns * L.rows,
    );
    const face = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 0.95,
    });
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 96;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 128, 96);
        ctx.fillStyle = "#3b2a1d";
        ctx.font = "bold 64px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("願", 64, 52);
        face.map = new THREE.CanvasTexture(canvas);
        face.map.colorSpace = THREE.SRGBColorSpace;
      }
    }
    // The painted field is tinted per design; the ink stays dark.
    this.faces = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.32, 0.2),
      face,
      L.columns * L.rows,
    );
    this.cords = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.12, 5),
      new THREE.MeshStandardMaterial({ color: "#b63a2a", roughness: 0.8 }),
      L.columns * L.rows,
    );
    for (const mesh of [this.plaques, this.faces, this.cords]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = mesh === this.plaques;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    this.setEma([]);
  }

  setEma(items: PublicLantern[]) {
    this.items = items.filter((item) => item.slot >= 0 && item.slot < 24);
    this.update(0);
  }

  update(dt: number) {
    this.time += dt;
    const count = this.items.length;
    this.plaques.count = this.faces.count = this.cords.count = count;
    this.items.forEach((item, i) => {
      const { x, y } = emaSlotPosition(item.slot);
      const sway = Math.sin(this.time * 0.8 + item.slot * 1.9) * 0.03;
      const tilt = ((item.slot * 37) % 9) / 9 - 0.5;
      this.dummy.position.set(x, y, 0.06);
      this.dummy.rotation.set(0, 0, sway + tilt * 0.12);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.plaques.setMatrixAt(i, this.dummy.matrix);
      // Natural wood with slight variation between plaques.
      this.plaques.setColorAt(
        i,
        this.color.setHSL(0.09, 0.42, 0.7 + (((item.slot * 13) % 7) - 3) * 0.012),
      );
      this.dummy.translateZ(0.03);
      this.dummy.translateY(-0.02);
      this.dummy.updateMatrix();
      this.faces.setMatrixAt(i, this.dummy.matrix);
      this.faces.setColorAt(
        i,
        this.color.set(lanternProduct(item.productId)?.color ?? "#e2b45c"),
      );
      this.dummy.position.set(x, y + 0.22, 0.07);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.cords.setMatrixAt(i, this.dummy.matrix);
    });
    for (const mesh of [this.plaques, this.faces, this.cords]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.root.removeFromParent();
    disposeObject(this.root, false);
    this.root.clear();
    this.items = [];
  }
}
