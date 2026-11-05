import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { AssetLoader } from "./AssetLoader";
import { beam, box, cylinder, material, roof, sphere } from "./geometry";
import type { Collider, InteractionPoint } from "./types";
import { groundTexture } from "./terrain";
import { createNaturalTree, createGroundPlants } from "./vegetation";
import { loadNaturalTextures, surface, updateBreeze } from "./surfaces";
import { roundedBox, inscription, braidedRope } from "./architecture";
import {
  HALL_LAYOUT,
  OFFERING_LAYOUT,
  FORECOURT,
  LANTERN_LAYOUT,
  EMA_LAYOUT,
  TEMIZU_LAYOUT,
} from "./layout";
import { EMA_ROW_BARS } from "./EmaBoard";

export const MAP_SIZE = 30;
export const INTERACTIONS: InteractionPoint[] = [
  {
    id: "temizu",
    position: TEMIZU_LAYOUT.interaction,
    radius: 2.3,
    label: "手水で清める",
  },
  {
    id: "offering",
    position: OFFERING_LAYOUT.interaction,
    radius: 2.5,
    label: "参拝する",
  },
  {
    id: "fortune",
    position: { x: -7, z: -0.8 },
    radius: 2.7,
    label: "おみくじを引く",
  },
  {
    id: "ema",
    position: EMA_LAYOUT.interaction,
    radius: 2.5,
    label: "絵馬を書く",
  },
];
const C = {
  red: "#9f4b34",
  redLight: "#b65c3b",
  wood: "#98714b",
  dark: "#654c36",
  stone: "#b4b3a2",
};
function group() {
  return new THREE.Group();
}

export class World {
  readonly root = group();
  readonly colliders: Collider[] = [];
  private petals: THREE.InstancedMesh;
  private petalData: { x: number; z: number; y: number; speed: number }[] = [];
  private dummy = new THREE.Object3D();
  private elapsed = 0;
  private seed = 73;
  private basinRipples: THREE.Mesh[] = [];
  private basinStream?: THREE.Mesh;

  constructor(private assets: AssetLoader) {
    this.ground();
    this.path();
    this.boundaries();
    this.garden();
    this.surroundings();
    const leaf = new THREE.Shape();
    leaf.moveTo(0, -0.06);
    leaf.bezierCurveTo(0.05, -0.03, 0.05, 0.04, 0, 0.065);
    leaf.bezierCurveTo(-0.05, 0.04, -0.05, -0.03, 0, -0.06);
    this.petals = new THREE.InstancedMesh(
      new THREE.ShapeGeometry(leaf, 4),
      new THREE.MeshStandardMaterial({
        color: "#e8bea5",
        side: THREE.DoubleSide,
      }),
      48,
    );
    this.petals.frustumCulled = false;
    for (let i = 0; i < 48; i++)
      this.petalData.push({
        x: this.random() * 28 - 14,
        z: this.random() * 28 - 14,
        y: this.random() * 7,
        speed: 0.3 + this.random() * 0.4,
      });
    this.root.add(this.petals);
  }

  async init() {
    await Promise.all([
      loadNaturalTextures(),
      this.place("torii", () => this.torii(), 0, 9),
      this.place(
        "hall",
        () => this.hall(),
        HALL_LAYOUT.position.x,
        HALL_LAYOUT.position.z,
        HALL_LAYOUT.scale,
      ),
      this.place(
        "offering",
        () => this.offering(),
        OFFERING_LAYOUT.position.x,
        OFFERING_LAYOUT.position.z,
        OFFERING_LAYOUT.scale,
      ),
      this.place("fortune", () => this.fortune(), -7, -2),
      this.place("ema", () => this.ema(), EMA_LAYOUT.x, EMA_LAYOUT.z),
      ...[
        [-12, -11],
        [-12.5, -7],
        [11, -11],
        [12, -6],
        [-12, 0],
        [12.8, 3.6],
        [-10, 7],
        [12.7, 11.6],
        [-12, 12],
      ].map(([x, z], index) =>
        this.place(
          "tree",
          () =>
            createNaturalTree(172 + index * 121, index % 3 === 0 ? 6.9 : 7.6),
          x!,
          z!,
        ),
      ),
    ]);
    this.collide(
      HALL_LAYOUT.position.x,
      HALL_LAYOUT.position.z,
      HALL_LAYOUT.footprint.width,
      HALL_LAYOUT.footprint.depth,
      HALL_LAYOUT.footprint.height,
    );
    this.collide(
      HALL_LAYOUT.steps.x,
      HALL_LAYOUT.steps.z,
      HALL_LAYOUT.steps.width,
      HALL_LAYOUT.steps.depth,
      HALL_LAYOUT.steps.height,
    );
    for (const post of HALL_LAYOUT.porchPosts)
      this.collide(post.x, post.z, 0.72, 0.52, 5.5);
    this.collide(
      OFFERING_LAYOUT.position.x,
      OFFERING_LAYOUT.position.z,
      OFFERING_LAYOUT.footprint.width,
      OFFERING_LAYOUT.footprint.depth,
      OFFERING_LAYOUT.footprint.height,
    );
    this.collide(-7, -2, 3.2, 2, 3.5);
    this.collide(
      EMA_LAYOUT.x,
      EMA_LAYOUT.z,
      EMA_LAYOUT.width + 0.4,
      EMA_LAYOUT.depth,
      EMA_LAYOUT.height,
    );
    this.collide(-3.6, 9, 0.65, 0.65, 5.5);
    this.collide(3.6, 9, 0.65, 0.65, 5.5);
    this.collide(
      LANTERN_LAYOUT.x,
      LANTERN_LAYOUT.z,
      LANTERN_LAYOUT.width + 0.4,
      LANTERN_LAYOUT.depth,
      LANTERN_LAYOUT.height,
    );
    this.batchStaticGeometry();
  }

  private async place(
    id: Parameters<AssetLoader["load"]>[0],
    fallback: () => THREE.Group,
    x: number,
    z: number,
    scale?: { readonly x: number; readonly y: number; readonly z: number },
  ) {
    const { object, fallback: isFallback } = await this.assets.load(
      id,
      fallback,
    );
    if (!isFallback)
      object.traverse((child) => {
        child.userData.keepSeparate = true;
      });
    const anchor = group();
    anchor.position.set(x, 0, z);
    if (scale) anchor.scale.set(scale.x, scale.y, scale.z);
    anchor.add(object);
    this.root.add(anchor);
    if (id === "tree") this.collide(x, z, 0.85, 0.85);
  }

  /** Batch the static fallback garden by material; keep GLBs and instances intact. */
  private batchStaticGeometry() {
    this.root.updateMatrixWorld(true);
    const batches = new Map<
      THREE.Material,
      { geometries: THREE.BufferGeometry[]; meshes: THREE.Mesh[] }
    >();
    this.root.traverse((object) => {
      if (
        !(object instanceof THREE.Mesh) ||
        object instanceof THREE.InstancedMesh ||
        object.userData.keepSeparate ||
        Array.isArray(object.material)
      )
        return;
      let batch = batches.get(object.material);
      if (!batch) {
        batch = { geometries: [], meshes: [] };
        batches.set(object.material, batch);
      }
      const geometry = object.geometry.index
        ? object.geometry.toNonIndexed()
        : object.geometry.clone();
      geometry.applyMatrix4(object.matrixWorld);
      batch.geometries.push(geometry);
      batch.meshes.push(object);
    });
    for (const [mat, batch] of batches) {
      const geometry = mergeGeometries(batch.geometries);
      if (geometry) {
        const combined = new THREE.Mesh(geometry, mat);
        combined.castShadow = true;
        combined.receiveShadow = true;
        this.root.add(combined);
        batch.meshes.forEach((mesh) => {
          mesh.removeFromParent();
          mesh.geometry.dispose();
        });
      }
      batch.geometries.forEach((geometry) => geometry.dispose());
    }
  }

  private random() {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
  private collide(x: number, z: number, w: number, d: number, height = 2.8) {
    this.colliders.push({
      minX: x - w / 2,
      maxX: x + w / 2,
      minZ: z - d / 2,
      maxZ: z + d / 2,
      height,
    });
  }

  private ground() {
    const slab = box(this.root, [30, 0.6, 30], [0, -0.4, 0], "#c1c3a0");
    slab.receiveShadow = true;
    box(this.root, [29.9, 0.1, 29.9], [0, -0.05, 0], "#c9cfaa");
    const courtyard = box(
      this.root,
      [20.8, 0.04, 23],
      [0, 0.015, -0.3],
      "#dedbc5",
    );
    courtyard.material = new THREE.MeshStandardMaterial({
      map: groundTexture(),
      roughness: 1,
    });
    // Gravel is instanced to keep detail inexpensive.
    const gravel = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.035, 0),
      material("#bebca7"),
      850,
    );
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 850; i++) {
      dummy.position.set(
        this.random() * 20 - 10,
        0.045,
        this.random() * 22 - 11,
      );
      dummy.scale.setScalar(0.6 + this.random());
      dummy.updateMatrix();
      gravel.setMatrixAt(i, dummy.matrix);
    }
    this.root.add(gravel);
  }

  private path() {
    for (let z = -4; z < 15; z += 1.05) {
      for (let x = -1; x <= 1; x++) {
        const paving = roundedBox(
          this.root,
          [0.98, 0.085, 1.01],
          [x * 1.01, 0.055, z],
          surface(
            "stone",
            (Math.round(z * 3) + x) % 3 === 0 ? "#aaa99c" : "#bebcb0",
          ),
          0.025,
        );
        paving.rotation.y = (this.random() - 0.5) * 0.018;
      }
    }
    for (const side of [-1, 1]) {
      for (let x = 2; x <= FORECOURT.maxX - 0.5; x++) {
        for (const z of [-3.95, -2.9, -1.85, -0.8]) {
          roundedBox(
            this.root,
            [0.98, 0.085, 1.01],
            [side * x, 0.055, z],
            surface("stone", (x + Math.round(z)) % 2 ? "#aaa99c" : "#bebcb0"),
            0.025,
          );
        }
      }
    }
    for (const side of [-1, 1]) {
      for (let x = 2.2; x < 8.4; x += 1.04)
        roundedBox(
          this.root,
          [0.95, 0.06, 1.35],
          [side * x, 0.055, 0.4],
          surface("stone", "#bebcb0"),
          0.02,
        );
      for (let z = 3; z < 13; z += 2.6) {
        const moss = sphere(
          this.root,
          0.17 + this.random() * 0.15,
          [side * (2.1 + this.random() * 0.7), 0.04, z],
          "#9cae7b",
          2,
        );
        moss.scale.set(1.3, 0.65, 1);
        moss.material = surface("stone", "#969f79");
      }
    }
  }

  private surroundings() {
    // The garden sits inside a forest, with no floating platform or empty backdrop.
    for (let i = 0; i < 32; i++) {
      const angle = i * 2.39996;
      const radius = 22 + this.random() * 21;
      const tree = createNaturalTree(502 + i * 83, 8 + this.random() * 5, true);
      tree.position.set(
        Math.cos(angle) * radius,
        -0.1,
        Math.sin(angle) * radius,
      );
      this.root.add(tree);
    }
    this.root.add(createGroundPlants());
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5;
      const hill = sphere(
        this.root,
        1,
        [Math.cos(angle) * 76, -2.8, Math.sin(angle) * 76],
        i % 2 ? "#8b9a7d" : "#9eaa8b",
        2,
      );
      hill.scale.set(35, 10 + this.random() * 6, 27);
    }
    // Small stepping stones and a quiet pond, visible from the character's height.
    const pond = cylinder(
      this.root,
      2.2,
      2.2,
      0.04,
      [8.7, 0.05, 6.5],
      "#89a99b",
      32,
    );
    pond.material = new THREE.MeshStandardMaterial({
      color: "#86a69b",
      roughness: 0.3,
      metalness: 0.1,
    });
    for (let i = 0; i < 15; i++) {
      const angle = (i * Math.PI * 2) / 15;
      const rock = sphere(
        this.root,
        0.4,
        [8.7 + Math.cos(angle) * 2.3, 0.14, 6.5 + Math.sin(angle) * 2.3],
        "#939b81",
        2,
      );
      rock.scale.set(1.3, 0.65, 0.9);
    }
    this.collide(8.7, 6.5, 5.2, 5.2, 0.6);
  }

  private boundaries() {
    for (const side of [-1, 1]) {
      for (let z = -14; z <= 14; z += 2) {
        box(this.root, [0.25, 0.85, 0.25], [side * 14.5, 0.4, z], "#9e987b");
        if (z < 14)
          for (const y of [0.35, 0.65])
            box(this.root, [0.12, 0.12, 2], [side * 14.5, y, z + 1], "#b7a98a");
      }
      for (let x = -14; x <= 14; x += 2) {
        if (side === 1 && Math.abs(x) < 3) continue;
        box(this.root, [0.25, 0.85, 0.25], [x, 0.4, side * 14.5], "#9e987b");
        if (x < 14 && !(side === 1 && x >= -4 && x < 2))
          for (const y of [0.35, 0.65])
            box(this.root, [2, 0.12, 0.12], [x + 1, y, side * 14.5], "#b7a98a");
      }
    }
  }

  private garden() {
    for (const [x, z] of [
      [-4.3, 5.6],
      [4.3, 5.6],
      [-4.1, -3.3],
      [4.1, -3.3],
    ]) {
      const lantern = this.lantern();
      lantern.position.set(x!, 0, z!);
      this.root.add(lantern);
      this.collide(x!, z!, 0.95, 0.95);
    }
    for (let i = 0; i < 36; i++) {
      const x = (this.random() > 0.5 ? 1 : -1) * (10.7 + this.random() * 3);
      const z = this.random() * 26 - 13;
      const radius = 0.25 + this.random() * 0.6;
      const rock = sphere(
        this.root,
        radius,
        [x, radius * 0.25, z],
        i % 3 === 0 ? "#a1ac84" : "#a4aa97",
        2,
      );
      rock.scale.set(1.2, 0.55, 1);
      rock.material = surface("stone", i % 3 === 0 ? "#899575" : "#9b9e8e");
      rock.rotation.y = this.random() * Math.PI;
      if (radius > 0.65) this.collide(x, z, radius * 1.7, radius * 1.7);
    }
    // Hand-washing basin to the left of the entrance.
    const basin = group();
    basin.name = "TemizuBasin";
    const basinStone = surface("stone", "#a6aea0");
    // An open stone bowl lets the ladle reach water rather than pass through a solid block.
    roundedBox(basin, [2.3, 0.19, 1.3], [0, 0.22, 0], basinStone, 0.045);
    for (const z of [-0.56, 0.56])
      roundedBox(basin, [2.3, 0.53, 0.18], [0, 0.54, z], basinStone, 0.035);
    for (const x of [-1.06, 1.06])
      roundedBox(basin, [0.18, 0.53, 0.96], [x, 0.54, 0], basinStone, 0.035);
    for (const z of [-0.56, 0.56])
      roundedBox(basin, [2.37, 0.08, 0.22], [0, 0.82, z], basinStone, 0.028);
    for (const x of [-1.075, 1.075])
      roundedBox(basin, [0.22, 0.08, 0.96], [x, 0.82, 0], basinStone, 0.028);
    const basinWater = new THREE.Mesh(new THREE.PlaneGeometry(1.94, 0.94), new THREE.MeshStandardMaterial({
      color: "#759e93", emissive: "#476c61", emissiveIntensity: 0.12,
      roughness: 0.17, metalness: 0.12, transparent: true, opacity: 0.91,
    }));
    basinWater.name = "TemizuBasinWater";
    basinWater.userData.keepSeparate = true;
    basinWater.rotation.x = -Math.PI / 2;
    basinWater.position.y = 0.775;
    basin.add(basinWater);
    box(basin, [2.6, 0.1, 0.16], [0, 0.98, 0.2], "#ac9b6a");
    cylinder(basin, 0.14, 0.14, 0.08, [0.6, 1.07, 0.2], "#d6bf8a");
    const spout = cylinder(basin, 0.038, 0.042, 0.43, [0.55, 1.01, -0.035], "#aa9b67", 12);
    spout.rotation.x = Math.PI / 2;
    this.basinStream = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.014, 0.22, 8), new THREE.MeshBasicMaterial({
      color: "#cbe3d6", transparent: true, opacity: 0.58, depthWrite: false,
    }));
    this.basinStream.name = "TemizuFreshWater";
    this.basinStream.userData.keepSeparate = true;
    this.basinStream.position.set(0.55, 0.89, -0.245);
    basin.add(this.basinStream);
    const rippleGeometry = new THREE.RingGeometry(0.045, 0.049, 28);
    for (let i = 0; i < 3; i++) {
      const ripple = new THREE.Mesh(rippleGeometry, new THREE.MeshBasicMaterial({
        color: "#d4e9dc", transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false,
      }));
      ripple.name = "TemizuBasinRipple";
      ripple.userData.keepSeparate = true;
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.set(0.55, 0.779 + i * 0.0005, -0.245);
      this.basinRipples.push(ripple);
      basin.add(ripple);
    }
    // 手水舎: four posts and a small roof over the basin.
    for (const x of [-1.25, 1.25])
      for (const z of [-0.75, 0.75]) {
        const post = cylinder(basin, 0.09, 0.1, 2.6, [x, 1.3, z], C.dark, 12);
        post.material = surface("wood", "#8d6f52");
      }
    for (const z of [-0.75, 0.75])
      box(basin, [2.8, 0.14, 0.16], [0, 2.55, z], C.dark);
    roof(basin, 3.4, 2.4, 2.6);
    inscription(basin, "手水舎", [0, 2.42, 0.86], 0.9, 0.22);
    basin.position.set(TEMIZU_LAYOUT.x, 0, TEMIZU_LAYOUT.z);
    this.root.add(basin);
    this.collide(
      TEMIZU_LAYOUT.x,
      TEMIZU_LAYOUT.z,
      TEMIZU_LAYOUT.width,
      TEMIZU_LAYOUT.depth,
    );
    for (const side of [-1, 1]) {
      const bench = group();
      box(bench, [2.8, 0.16, 0.75], [0, 0.65, 0], "#a18a60");
      for (const x of [-1, 1])
        box(bench, [0.2, 0.65, 0.55], [x, 0.32, 0], "#76694f");
      bench.position.set(side * 7, 0, 10.8);
      this.root.add(bench);
      this.collide(side * 7, 10.8, 2.8, 0.75);
    }
  }

  private torii() {
    const g = group();
    for (const x of [-3.6, 3.6]) {
      cylinder(g, 0.24, 0.34, 5.2, [x, 2.6, 0], C.red, 24);
      cylinder(g, 0.35, 0.4, 0.65, [x, 0.32, 0], "#555d50", 24);
      box(g, [0.75, 0.14, 0.75], [x, 0.04, 0], C.stone);
    }
    box(g, [8.5, 0.33, 0.45], [0, 4.2, 0], C.redLight);
    box(g, [9, 0.38, 0.7], [0, 5.12, 0], C.red);
    box(g, [9.6, 0.16, 0.85], [0, 5.4, 0], "#43574d");
    for (const x of [-4.65, 4.65]) {
      const end = box(g, [0.95, 0.17, 0.85], [x, 5.47, 0], "#43574d");
      end.rotation.z = Math.sign(x) * 0.15;
    }
    box(g, [0.3, 1, 0.35], [0, 4.65, 0], C.red);
    box(g, [0.7, 0.9, 0.12], [0, 4.65, 0.35], "#c5a65f");
    box(g, [0.5, 0.7, 0.05], [0, 4.65, 0.43], "#45564a");
    return g;
  }

  private hall() {
    const g = group();
    box(g, [9.6, 0.45, 6.7], [0, 0.25, 0], "#b4b4a0");
    box(g, [8.7, 0.28, 5.9], [0, 0.65, 0], C.dark);
    box(g, [7.8, 2.8, 0.2], [0, 2.1, -2.5], "#9c8058");
    for (const side of [-1, 1])
      box(g, [0.2, 2.8, 4.5], [side * 3.8, 2.1, -0.35], "#b39466");
    box(g, [2.5, 1.6, 0.15], [0, 2.3, -2.3], "#4e4735");
    const mirror = cylinder(
      g,
      0.55,
      0.55,
      0.08,
      [0, 2.35, -2.13],
      "#d3ba79",
      32,
    );
    mirror.rotation.x = Math.PI / 2;
    for (const x of [-3.9, -1.4, 1.4, 3.9]) {
      const column = cylinder(g, 0.14, 0.17, 3.7, [x, 2.4, 2.5], C.dark, 20);
      column.material = surface("wood", "#9c8063");
      roundedBox(
        g,
        [0.42, 0.16, 0.42],
        [x, 0.72, 2.5],
        surface("stone", "#aaa999"),
      );
      for (const side of [-1, 1])
        beam(
          g,
          new THREE.Vector3(x, 3.45, 2.5),
          new THREE.Vector3(x + side * 0.55, 3.9, 2.5),
          0.055,
          C.dark,
        );
      box(g, [0.35, 3, 0.25], [x, 2.1, -2.6], C.red);
    }
    for (let x = -3.6; x <= 3.6; x += 0.4)
      if (Math.abs(x) > 1.45)
        box(g, [0.09, 2.25, 0.13], [x, 2.1, 1.95], "#866341");
    for (const x of [-2.6, 2.6]) {
      const lamp = box(g, [0.4, 0.6, 0.4], [x, 2.75, 1.5], "#e8d6a5");
      lamp.material = new THREE.MeshStandardMaterial({
        color: "#f0d9a8",
        emissive: "#bc873d",
        emissiveIntensity: 0.35,
      });
      cylinder(g, 0.025, 0.025, 0.6, [x, 3.3, 1.5], "#68523a", 8);
      const glow = new THREE.PointLight("#ffdb9c", 1.8, 5, 2);
      glow.position.set(x, 2.6, 1.5);
      g.add(glow);
    }
    box(g, [8.3, 0.3, 0.4], [0, 3.7, 2.5], C.redLight);
    box(g, [8.3, 0.2, 0.3], [0, 1, 2.8], C.red);
    for (const x of [-3.8, 3.8]) box(g, [0.15, 0.7, 5.7], [x, 1.2, 0], C.red);
    // Four broad stone treads connect the enlarged veranda to its courtyard.
    for (let step = 0; step < 4; step++) {
      const height = (step + 1) * 0.18;
      roundedBox(
        g,
        [4.8, height, 0.8],
        [0, height / 2, 3.7 - step * 0.24],
        surface("stone", step % 2 ? "#b8b6a4" : "#c7c4af"),
        0.025,
      );
    }
    // Real plank joints, rear panel lattice, foot rails and exposed beam joinery.
    for (let x = -3.65; x < 3.8; x += 0.27)
      box(g, [0.24, 0.045, 5.5], [x, 0.815, 0], "#98714b");
    for (const x of [-3.75, 3.75])
      for (let z = -2.3; z <= 2.7; z += 0.65) {
        cylinder(g, 0.045, 0.05, 0.7, [x, 1.25, z], C.dark);
      }
    for (const y of [1.1, 1.55])
      for (const x of [-3.75, 3.75])
        box(g, [0.1, 0.1, 5.4], [x, y, 0.2], C.dark);
    for (let y = 1.2; y < 3.2; y += 0.32)
      for (const x of [-2.5, 2.5])
        box(g, [2, 0.035, 0.04], [x, y, 1.99], "#654c36");
    roof(g, 10.5, 7.4, 4.35);
    // Entrance canopy and a ceremonial rope with shide paper streamers.
    const canopy = group();
    roof(canopy, 4.8, 4.2, 3.8);
    canopy.position.z = 2.6;
    g.add(canopy);
    for (const post of HALL_LAYOUT.porchPosts) {
      const x = (post.x - HALL_LAYOUT.position.x) / HALL_LAYOUT.scale.x;
      const z = (post.z - HALL_LAYOUT.position.z) / HALL_LAYOUT.scale.z;
      cylinder(g, 0.14, 0.16, 3.7, [x, 1.9, z], C.dark, 20);
      roundedBox(
        g,
        [0.4, 0.16, 0.4],
        [x, 0.08, z],
        surface("stone", "#aaa999"),
      );
      for (const side of [-1, 1])
        beam(
          g,
          new THREE.Vector3(x, 3.2, z),
          new THREE.Vector3(x + side * 0.45, 3.8, z),
          0.055,
          C.dark,
        );
    }
    braidedRope(g, 5.8, 3.35, 2.9);
    roundedBox(
      g,
      [2.55, 0.62, 0.16],
      [0, 3.93, 4.73],
      surface("wood", "#7a6248"),
      0.025,
    );
    inscription(g, "木漏日神社", [0, 3.93, 4.82], 2.38, 0.51);
    for (const x of [-2, -0.7, 0.7, 2]) {
      for (let i = 0; i < 3; i++) {
        const paper = box(
          g,
          [0.18, 0.25, 0.025],
          [x + (i % 2) * 0.1, 2.95 - i * 0.18, 2.8],
          "#f4f0dd",
        );
        paper.rotation.z = i % 2 ? -0.4 : 0.4;
      }
    }
    for (const x of [-0.82, 0.82]) {
      box(g, [0.06, 2.2, 0.08], [x, 1.95, -1.9], C.dark);
      const boss = sphere(g, 0.045, [x, 1.9, -1.83], "#c1a56a", 2);
      boss.scale.z = 0.35;
    }
    return g;
  }

  private offering() {
    const g = group();
    box(g, [2.6, 0.95, 1], [0, 0.6, 0], C.wood);
    box(g, [2.85, 0.15, 1.2], [0, 1.15, 0], "#c49b65");
    for (let x = -1.2; x <= 1.2; x += 0.22)
      box(g, [0.1, 0.08, 1.1], [x, 1.26, 0], "#634e36");
    for (const x of [-1.15, 1.15]) box(g, [0.16, 1, 1], [x, 0.6, 0], "#79583b");
    box(g, [0.6, 0.48, 0.04], [0, 0.65, 0.52], "#d6b875");
    for (let x = -1; x <= 1; x += 0.25)
      box(g, [0.035, 0.72, 0.02], [x, 0.63, 0.514], "#654c36");
    inscription(g, "奉 納", [0, 0.65, 0.552], 0.49, 0.33, false);
    for (const x of [-1.17, 1.17])
      for (const y of [0.28, 0.95])
        sphere(g, 0.035, [x, y, 0.525], "#9e8a5b", 2);
    // Hanging bell rope.
    cylinder(g, 0.045, 0.045, 3.3, [0, 3.2, -0.1], "#d6c8a2", 10);
    sphere(g, 0.16, [0, 4.94, -0.1], "#a18b4f", 2);
    cylinder(g, 0.018, 0.018, 1.12, [0, 5.56, -0.1], "#a18b4f", 8);
    return g;
  }

  private fortune() {
    const g = group();
    box(g, [2.9, 0.18, 1.5], [0, 0.2, 0], C.dark);
    for (const x of [-1.3, 1.3])
      box(g, [0.16, 2.3, 0.16], [x, 1.4, -0.4], C.red);
    box(g, [2.7, 0.9, 1.25], [0, 0.9, 0], "#b58a59");
    box(g, [3, 0.13, 1.5], [0, 1.42, 0], "#d1af79");
    for (const x of [-0.8, 0, 0.8]) {
      cylinder(g, 0.23, 0.23, 0.55, [x, 1.75, 0], "#b4553d", 6);
      box(g, [0.18, 0.25, 0.03], [x, 1.75, 0.23], "#f0e4c6");
    }
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 7; col++) {
        const x = -1.08 + col * 0.36,
          y = 0.58 + row * 0.25;
        roundedBox(
          g,
          [0.33, 0.21, 0.035],
          [x, y, 0.646],
          surface("wood", "#c8ad86"),
          0.009,
        );
        sphere(g, 0.022, [x, y, 0.675], "#655d48", 2);
      }
    inscription(g, "おみくじ", [0, 2.32, 0.63], 1.9, 0.42);
    roof(g, 3.6, 2.2, 2.9);
    return g;
  }

  /** Ema board frame. Visitor plaques are instanced by EmaBoard on the top rows. */
  private ema() {
    const g = group();
    const half = EMA_LAYOUT.width / 2 + 0.1;
    for (const x of [-half, half]) {
      box(g, [0.2, 2.9, 0.22], [x, 1.45, 0], C.dark);
      box(g, [0.42, 0.16, 0.5], [x, 0.08, 0], "#5b4632");
    }
    for (const y of [...EMA_ROW_BARS, 0.68])
      box(g, [EMA_LAYOUT.width + 0.3, 0.07, 0.1], [0, y, 0], C.wood);
    // A crowded lower row of offered ema keeps the board lively.
    const wishes = ["心願成就", "家内安全", "学業成就", "無病息災", "良縁祈願"];
    for (let i = 0; i < 9; i++) {
      const x = -EMA_LAYOUT.width / 2 + 0.3 + i * ((EMA_LAYOUT.width - 0.6) / 8);
      const y = 0.45;
      const tilt = (this.random() - 0.5) * 0.24;
      const plaque = box(g, [0.38, 0.3, 0.025], [x, y, 0.06], i % 3 ? "#d8b987" : "#caa575");
      plaque.rotation.z = tilt;
      const wish = inscription(g, wishes[i % wishes.length]!, [x, y, 0.08], 0.3, 0.17, false);
      wish.rotation.z = tilt;
    }
    roundedBox(g, [1.7, 0.36, 0.08], [0, 2.82, 0.08], surface("wood", "#7a6248"), 0.02);
    inscription(g, "絵馬掛所", [0, 2.82, 0.13], 1.5, 0.28);
    roof(g, EMA_LAYOUT.width + 1, 1.6, 3.05);
    return g;
  }

  private lantern() {
    const g = group();
    const stone = surface("stone", "#a1a694");
    roundedBox(g, [0.92, 0.16, 0.92], [0, 0.1, 0], stone, 0.045);
    cylinder(g, 0.18, 0.27, 0.94, [0, 0.63, 0], "#b5baa7", 16);
    roundedBox(g, [0.6, 0.13, 0.6], [0, 1.12, 0], stone);
    roundedBox(g, [0.68, 0.09, 0.68], [0, 1.27, 0], stone);
    for (const x of [-0.27, 0.27])
      for (const z of [-0.27, 0.27])
        roundedBox(g, [0.095, 0.52, 0.095], [x, 1.55, z], stone, 0.012);
    const paper = new THREE.MeshStandardMaterial({
      color: "#d4c9a6",
      emissive: "#b59b60",
      emissiveIntensity: 0.12,
      roughness: 1,
    });
    roundedBox(g, [0.42, 0.38, 0.42], [0, 1.54, 0], paper, 0.02);
    for (const z of [-0.325, 0.325]) {
      box(g, [0.045, 0.45, 0.035], [0, 1.55, z], "#929e8a");
      box(g, [0.5, 0.04, 0.035], [0, 1.55, z], "#929e8a");
    }
    roundedBox(g, [0.76, 0.12, 0.76], [0, 1.84, 0], stone);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.67, 0.37, 4), stone);
    cap.position.y = 2.05;
    cap.rotation.y = Math.PI / 4;
    cap.castShadow = true;
    g.add(cap);
    roundedBox(g, [0.96, 0.075, 0.96], [0, 1.88, 0], stone, 0.03);
    cylinder(g, 0.09, 0.15, 0.16, [0, 2.29, 0], "#a3ac94", 16);
    sphere(g, 0.1, [0, 2.42, 0], "#a3ac94", 2).scale.y = 1.3;
    return g;
  }

  update(dt: number) {
    this.elapsed += dt;
    updateBreeze(this.elapsed);
    if (this.basinStream) {
      const width = 0.94 + Math.sin(this.elapsed * 11) * 0.06;
      this.basinStream.scale.set(width, 1, width);
    }
    this.basinRipples.forEach((ripple, i) => {
      const phase = (this.elapsed * 0.65 + i / this.basinRipples.length) % 1;
      ripple.scale.setScalar(0.5 + phase * 3.2);
      (ripple.material as THREE.MeshBasicMaterial).opacity = (1 - phase) * 0.24;
    });
    this.petalData.forEach((petal, i) => {
      petal.y -= dt * petal.speed;
      if (petal.y < 0.1) petal.y = 7;
      this.dummy.position.set(
        petal.x + Math.sin(this.elapsed * 0.3 + i) * 0.9,
        petal.y,
        petal.z + Math.cos(this.elapsed * 0.25 + i) * 0.5,
      );
      this.dummy.rotation.set(this.elapsed * 0.6 + i, this.elapsed * 0.4, i);
      this.dummy.updateMatrix();
      this.petals.setMatrixAt(i, this.dummy.matrix);
    });
    this.petals.instanceMatrix.needsUpdate = true;
  }
}
