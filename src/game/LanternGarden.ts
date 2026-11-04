import * as THREE from "three";
import { LANTERN_LAYOUT as L } from "./layout";
import { disposeObject } from "./geometry";

/** Decorative 献灯 rack: a handful of instanced draws for 26 hanging chochin. */
export class LanternGarden {
  readonly root = new THREE.Group();
  private body: THREE.InstancedMesh;
  private caps: THREE.InstancedMesh;
  private ribs: THREE.InstancedMesh;
  private cords: THREE.InstancedMesh;
  private seals: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private entries: { slot: number; color: string }[] = [];
  private time = 0;
  constructor() {
    this.root.position.set(L.x, 0, L.z);
    const wood = new THREE.MeshStandardMaterial({
      color: "#76533a",
      roughness: 0.95,
    });
    const frame = (w: number, h: number, d: number, x: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wood);
      mesh.position.set(x, y, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    };
    for (const side of [-1, 1]) {
      frame(0.23, L.height, 0.25, side * (L.width / 2 + 0.14), L.height / 2);
      frame(0.48, 0.18, 0.55, side * (L.width / 2 + 0.14), 0.14);
    }
    for (let row = 0; row < L.rows; row++)
      frame(L.width + 0.72, 0.14, 0.23, 0, 4.65 - row * 1.16);
    frame(L.width + 0.85, 0.18, 0.4, 0, L.height);
    const points = [
      [-0.36, 0.11],
      [-0.31, 0.22],
      [-0.22, 0.29],
      [0, 0.32],
      [0.22, 0.29],
      [0.31, 0.22],
      [0.36, 0.11],
    ].map(([y, r]) => new THREE.Vector2(r!, y!));
    const paper = new THREE.MeshStandardMaterial({
      color: "#fff5e5",
      roughness: 1,
      emissive: "#f4c678",
      emissiveIntensity: 0.38,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: "#72533b",
      roughness: 0.9,
    });
    this.body = new THREE.InstancedMesh(
      new THREE.LatheGeometry(points, 24),
      paper,
      26,
    );
    this.caps = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.135, 0.135, 0.055, 16),
      dark,
      52,
    );
    this.ribs = new THREE.InstancedMesh(
      new THREE.TorusGeometry(1, 0.011, 4, 24),
      new THREE.MeshStandardMaterial({
        color: "#a07c50",
        transparent: true,
        opacity: 0.35,
        roughness: 1,
      }),
      26 * 7,
    );
    this.cords = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.009, 0.009, 0.2, 5),
      dark,
      26,
    );
    const label = new THREE.MeshBasicMaterial({
      color: "#7b5134",
      side: THREE.DoubleSide,
    });
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#765138";
        ctx.font = "76px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("献", 64, 65);
        label.map = new THREE.CanvasTexture(canvas);
        label.transparent = true;
        label.alphaTest = 0.1;
      }
    }
    this.seals = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.25, 0.28),
      label,
      26,
    );
    for (const mesh of [
      this.body,
      this.caps,
      this.ribs,
      this.cords,
      this.seals,
    ]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    // Two welcome lights at the posts plus every slot, alternating white and red.
    this.entries = [
      { slot: -1, color: "#f4e7cf" },
      { slot: -2, color: "#f4e7cf" },
      ...Array.from({ length: L.columns * L.rows }, (_, slot) => ({
        slot,
        color: (slot + Math.floor(slot / L.columns)) % 2 ? "#f4e7cf" : "#e0866a",
      })),
    ];
    this.update(0);
  }
  update(dt: number) {
    this.time += dt;
    const entries = this.entries;
    this.body.count = this.cords.count = this.seals.count = entries.length;
    this.caps.count = entries.length * 2;
    this.ribs.count = entries.length * 7;
    entries.forEach((entry, i) => {
      const row = Math.floor(entry.slot / L.columns),
        column = entry.slot % L.columns;
      const x =
        entry.slot < 0
          ? (entry.slot === -1 ? -1 : 1) * (L.width / 2 + 0.14)
          : -L.width / 2 + 0.42 + (column * (L.width - 0.84)) / (L.columns - 1);
      const y = entry.slot < 0 ? 4.05 : 4.08 - row * 1.16;
      const sway = Math.sin(this.time * 0.9 + i * 1.7) * 0.025;
      this.dummy.rotation.set(0, 0, sway);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.position.set(x, y, 0.03);
      this.dummy.updateMatrix();
      this.body.setMatrixAt(i, this.dummy.matrix);
      this.body.setColorAt(i, this.color.set(entry.color));
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.position.set(x, y + 0.47, 0);
      this.dummy.updateMatrix();
      this.cords.setMatrixAt(i, this.dummy.matrix);
      for (let end = 0; end < 2; end++) {
        this.dummy.position.set(x, y + (end === 0 ? -0.37 : 0.37), 0.03);
        this.dummy.updateMatrix();
        this.caps.setMatrixAt(i * 2 + end, this.dummy.matrix);
      }
      for (let ring = 0; ring < 7; ring++) {
        const ry = (ring - 3) * 0.09;
        const radius = 0.32 - Math.pow(Math.abs(ry) / 0.36, 2) * 0.15;
        this.dummy.position.set(x, y + ry, 0.03);
        this.dummy.rotation.set(Math.PI / 2, 0, 0);
        this.dummy.scale.set(radius, radius, radius);
        this.dummy.updateMatrix();
        this.ribs.setMatrixAt(i * 7 + ring, this.dummy.matrix);
      }
      this.dummy.position.set(x, y, 0.356);
      this.dummy.rotation.set(0, 0, sway);
      this.dummy.scale.set(1, 1, 1);
      this.dummy.updateMatrix();
      this.seals.setMatrixAt(i, this.dummy.matrix);
    });
    for (const mesh of [
      this.body,
      this.caps,
      this.ribs,
      this.cords,
      this.seals,
    ])
      mesh.instanceMatrix.needsUpdate = true;
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true;
  }
  dispose() {
    this.root.removeFromParent();
    disposeObject(this.root, false);
    this.root.clear();
    this.entries = [];
  }
}
