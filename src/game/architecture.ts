import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { surface } from "./surfaces";

export function roundedBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  radius = 0.03,
) {
  const mesh = new THREE.Mesh(
    new RoundedBoxGeometry(
      ...size,
      2,
      Math.min(radius, ...size.map((n) => n / 3)),
    ),
    material,
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function tube(
  parent: THREE.Object3D,
  points: THREE.Vector3[],
  radius: number,
  mat: THREE.Material,
) {
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points),
      Math.max(20, Math.min(100, points.length)),
      radius,
      6,
      false,
    ),
    mat,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Curved eaves, individual barrel tiles, exposed rafters and ridge end ornaments. */
export function detailedRoof(
  parent: THREE.Object3D,
  width: number,
  depth: number,
  baseY: number,
) {
  const half = width / 2;
  const rise = width * 0.17;
  const profile = (u: number) =>
    baseY + rise * (1 - u) - width * 0.025 * u + width * 0.025 * u ** 7;
  const roofColors = ["#596360", "#626b66", "#6b716a"];
  const timber = surface("wood", "#8e775d");
  const rows = Math.ceil(depth / 0.29);
  const rowDepth = depth / rows;
  for (const side of [-1, 1]) {
    for (let row = 0; row < rows; row++) {
      const positions: number[] = [],
        uvs: number[] = [],
        indices: number[] = [];
      const segments = 14;
      for (let x = 0; x <= segments; x++)
        for (let z = 0; z <= 4; z++) {
          const u = x / segments,
            v = z / 4;
          positions.push(
            side * u * half,
            profile(u) + Math.sin(v * Math.PI) * 0.055,
            -depth / 2 + (row + v) * rowDepth,
          );
          uvs.push(u * half, v);
        }
      for (let x = 0; x < segments; x++)
        for (let z = 0; z < 4; z++) {
          const a = x * 5 + z,
            b = a + 5;
          if (side > 0) indices.push(a, a + 1, b, b, a + 1, b + 1);
          else indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      const mat = surface("roof", roofColors[row % roofColors.length]!);
      mat.side = THREE.DoubleSide;
      const tiles = new THREE.Mesh(geometry, mat);
      tiles.castShadow = true;
      tiles.receiveShadow = true;
      parent.add(tiles);
    }
    for (const z of [-depth / 2 - 0.035, depth / 2 + 0.035]) {
      const edge = Array.from(
        { length: 15 },
        (_, i) =>
          new THREE.Vector3(
            ((side * i) / 14) * half,
            profile(i / 14) - 0.08,
            z,
          ),
      );
      tube(parent, edge, 0.085, timber);
    }
    for (let z = -depth / 2 + 0.15; z <= depth / 2; z += 0.55) {
      const rafter = Array.from(
        { length: 9 },
        (_, i) =>
          new THREE.Vector3(((side * i) / 8) * half, profile(i / 8) - 0.13, z),
      );
      tube(parent, rafter, 0.045, timber);
    }
    tube(
      parent,
      [
        new THREE.Vector3(side * half, baseY - 0.08, -depth / 2),
        new THREE.Vector3(side * half, baseY - 0.08, depth / 2),
      ],
      0.1,
      timber,
    );
  }
  const ridgeMat = surface("roof", "#48534f");
  // Close the gables with lime plaster and timber framing; low eye-level views
  // should see a finished roof facade, rather than the sky through the attic.
  for (const end of [-1, 1]) {
    const shape = new THREE.Shape();
    shape.moveTo(-half + 0.1, baseY - 0.14);
    for (let i = 0; i <= 28; i++) {
      const x = -half + (i / 28) * width;
      shape.lineTo(x, profile(Math.abs(x) / half) - 0.09);
    }
    shape.lineTo(half - 0.1, baseY - 0.14);
    shape.closePath();
    const plaster = surface("plaster", "#d1c9b1");
    plaster.side = THREE.DoubleSide;
    const face = new THREE.Mesh(new THREE.ShapeGeometry(shape), plaster);
    face.position.z = end * (depth / 2 - 0.02);
    face.castShadow = true;
    face.receiveShadow = true;
    parent.add(face);
    for (let x = -half + 0.6; x < half; x += 0.6) {
      const top = profile(Math.abs(x) / half) - 0.13;
      if (top <= baseY) continue;
      roundedBox(
        parent,
        [0.05, top - baseY + 0.1, 0.055],
        [x, (top + baseY - 0.1) / 2, end * (depth / 2 + 0.015)],
        timber,
        0.01,
      );
    }
    roundedBox(
      parent,
      [width - 0.1, 0.14, 0.13],
      [0, baseY - 0.12, end * (depth / 2 + 0.025)],
      timber,
      0.02,
    );
  }
  tube(
    parent,
    [
      new THREE.Vector3(0, baseY + rise + 0.04, -depth / 2 - 0.14),
      new THREE.Vector3(0, baseY + rise + 0.04, depth / 2 + 0.14),
    ],
    0.12,
    ridgeMat,
  );
  for (const side of [-1, 1]) {
    const end = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.09, 20),
      ridgeMat,
    );
    end.rotation.x = Math.PI / 2;
    end.position.set(0, baseY + rise + 0.04, side * (depth / 2 + 0.14));
    parent.add(end);
    const crest = new THREE.Mesh(
      new THREE.TorusGeometry(0.09, 0.014, 6, 24),
      surface("wood", "#d1b47c"),
    );
    crest.position.set(0, baseY + rise + 0.04, side * (depth / 2 + 0.2));
    parent.add(crest);
  }
}

const signMaterials = new Map<string, THREE.MeshStandardMaterial>();
export function inscription(
  parent: THREE.Object3D,
  text: string,
  position: [number, number, number],
  width: number,
  height: number,
  dark = true,
) {
  const key = `${text}:${dark}`;
  let mat = signMaterials.get(key);
  if (!mat) {
    let map: THREE.CanvasTexture | undefined;
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = 768;
      canvas.height = 256;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = dark ? "#433d2c" : "#d7bf91";
      ctx.fillRect(0, 0, 768, 256);
      ctx.strokeStyle = dark ? "#b6a16c" : "#93794c";
      ctx.lineWidth = 10;
      ctx.strokeRect(14, 14, 740, 228);
      ctx.font = `500 ${text.length > 8 ? 62 : 104}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = dark ? "#dec890" : "#5c4c36";
      ctx.fillText(text, 384, 133, 700);
      map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 4;
    }
    mat = new THREE.MeshStandardMaterial({
      color: map ? "#ffffff" : "#a99268",
      map,
      roughness: 0.88,
    });
    signMaterials.set(key, mat);
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}
export function clearInscriptionCache() {
  signMaterials.clear();
}

export function braidedRope(
  parent: THREE.Object3D,
  width: number,
  y: number,
  z: number,
) {
  for (let strand = 0; strand < 3; strand++) {
    const points = Array.from({ length: 100 }, (_, i) => {
      const t = i / 99;
      const twist = t * width * 10 + (strand * Math.PI * 2) / 3;
      return new THREE.Vector3(
        (t - 0.5) * width,
        y - Math.sin(t * Math.PI) * 0.29 + Math.sin(twist) * 0.034,
        z + Math.cos(twist) * 0.034,
      );
    });
    tube(
      parent,
      points,
      0.048,
      surface("fabric", strand % 2 ? "#b39a62" : "#d1bc86"),
    );
  }
}
