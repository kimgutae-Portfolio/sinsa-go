import * as THREE from "three";
import { surface } from "./surfaces";

function randomGenerator(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}
function branch(
  parent: THREE.Object3D,
  points: THREE.Vector3[],
  radius: number,
) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(
    curve,
    points.length * 4,
    radius,
    7,
    false,
  );
  // Taper the tube along its curve, keeping the curved bark silhouette.
  const positions = geometry.attributes.position!;
  for (let i = 0; i < positions.count; i++) {
    const t = Math.floor(i / 8) / (points.length * 4);
    const center = curve.getPointAt(Math.min(1, t));
    const factor = 1 - t * 0.72;
    positions.setXYZ(
      i,
      center.x + (positions.getX(i) - center.x) * factor,
      center.y + (positions.getY(i) - center.y) * factor,
      center.z + (positions.getZ(i) - center.z) * factor,
    );
  }
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, surface("bark", "#736955"));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
}

/** Branches and intersecting alpha foliage cards form real gaps, rather than solid blobs. */
export function createNaturalTree(seed: number, height = 7, distant = false) {
  const random = randomGenerator(seed);
  const root = new THREE.Group();
  const lean = (random() - 0.5) * 0.6;
  branch(
    root,
    [
      new THREE.Vector3(),
      new THREE.Vector3(lean * 0.3, height * 0.3, 0.05),
      new THREE.Vector3(lean, height * 0.62, -0.12),
      new THREE.Vector3(lean * 1.2, height * 0.86, 0),
    ],
    height * 0.044,
  );
  if (!distant)
    for (let i = 0; i < 5; i++) {
      const angle = i * Math.PI * 0.4 + random();
      branch(
        root,
        [
          new THREE.Vector3(0, 0.24, 0),
          new THREE.Vector3(
            Math.cos(angle) * 0.48,
            0.1,
            Math.sin(angle) * 0.48,
          ),
          new THREE.Vector3(
            Math.cos(angle) * 0.8,
            0.035,
            Math.sin(angle) * 0.8,
          ),
        ],
        0.13,
      );
    }
  const leafGeometry = new THREE.PlaneGeometry(1, 1);
  const count = distant ? 10 : 14;
  for (let i = 0; i < count; i++) {
    const angle = i * 2.39996 + random() * 0.6;
    const tier = i / count;
    const y = height * (0.43 + tier * 0.48);
    const spread =
      height *
      (0.22 + Math.sin(tier * Math.PI) * 0.11) *
      (0.8 + random() * 0.35);
    const tip = new THREE.Vector3(
      Math.cos(angle) * spread + lean,
      y + 0.2,
      Math.sin(angle) * spread,
    );
    branch(
      root,
      [
        new THREE.Vector3(lean * tier, y - height * 0.16, 0),
        new THREE.Vector3(tip.x * 0.55, y - 0.12, tip.z * 0.6),
        tip,
      ],
      height * (0.012 - tier * 0.005),
    );
    const clusters = distant ? 1 : 2;
    for (let c = 0; c < clusters; c++) {
      const center = tip
        .clone()
        .add(
          new THREE.Vector3(
            (random() - 0.5) * 1.4,
            (random() - 0.35) * 0.8,
            (random() - 0.5) * 1.4,
          ),
        );
      for (let plane = 0; plane < 3; plane++) {
        const color =
          i % 3 === 0 ? "#e4e7ca" : i % 3 === 1 ? "#d5dfbe" : "#bdcfa8";
        const leaf = new THREE.Mesh(leafGeometry, surface("foliage", color));
        leaf.position.copy(center);
        leaf.rotation.set(
          plane === 2 ? -Math.PI * 0.45 : (random() - 0.5) * 0.8,
          angle + (plane * Math.PI) / 2.3,
          (random() - 0.5) * 0.4,
        );
        const size = height * (distant ? 0.38 : 0.35) * (0.8 + random() * 0.35);
        leaf.scale.set(size, size * 0.85, 1);
        leaf.castShadow = true;
        leaf.receiveShadow = true;
        root.add(leaf);
      }
    }
  }
  return root;
}

export function createGroundPlants() {
  const positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [];
  for (let blade = 0; blade < 4; blade++) {
    const angle = blade * 2.4,
      h = 0.13 + blade * 0.035;
    const right = new THREE.Vector3(
      Math.cos(angle) * 0.025,
      0,
      Math.sin(angle) * 0.025,
    );
    const tip = new THREE.Vector3(
      Math.sin(angle) * 0.08,
      h,
      Math.cos(angle) * 0.08,
    );
    for (const p of [right.clone().negate(), right, tip]) {
      positions.push(p.x, p.y, p.z);
      normals.push(0, 1, 0);
      uvs.push(p.x, p.y);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  const mat = new THREE.MeshStandardMaterial({
    color: "#d3d5b8",
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, mat, 1900);
  const random = randomGenerator(987);
  const dummy = new THREE.Object3D();
  let count = 0;
  for (let i = 0; i < 15000 && count < 1900; i++) {
    const x = random() * 28 - 14,
      z = random() * 28 - 14;
    const perimeter = Math.abs(x) > 10.6 || (z > 10.2 && Math.abs(x) > 2.1);
    const pathEdge =
      Math.abs(x) > 1.7 && Math.abs(x) < 2.6 && z > 2 && random() > 0.65;
    if (!perimeter && !pathEdge) continue;
    if (Math.hypot(x - 8.7, z - 6.5) < 2.8) continue;
    dummy.position.set(x, 0.035, z);
    dummy.rotation.y = random() * Math.PI * 2;
    dummy.scale.setScalar(0.6 + random() * 0.8);
    dummy.updateMatrix();
    mesh.setMatrixAt(count, dummy.matrix);
    mesh.setColorAt(
      count,
      new THREE.Color().setHSL(
        0.19 + random() * 0.06,
        0.22,
        0.4 + random() * 0.15,
      ),
    );
    count++;
  }
  mesh.count = count;
  mesh.receiveShadow = true;
  return mesh;
}
