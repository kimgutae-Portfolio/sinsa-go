import * as THREE from "three";
import type { ritualFrame } from "./ritual";

/** Rigid rounded pieces; no Bones, skeleton, skin weights or elbow/knee chains. */
export interface TravelerParts {
  torso: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  legs: THREE.Group[];
  hands: THREE.Group[];
}
export const TRAVELER_BODY_Y = 0.56;
export const TRAVELER_REST_HAND = { x: 0.365, y: 0.13, z: 0.04 } as const;
const HAND_X = TRAVELER_REST_HAND.x;

function clay(color: string) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0 });
}
function pebble(
  parent: THREE.Object3D, name: string,
  size: [number, number, number], position: [number, number, number],
  material: THREE.Material, segments = 18,
) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, segments, Math.round(segments * 0.7)), material);
  mesh.name = name;
  mesh.scale.set(...size);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** A rounded cloth profile, closed at both ends and flattened slightly front to back. */
function cloth(
  parent: THREE.Object3D, name: string, profile: [number, number][],
  material: THREE.Material, depth: number, segments = 28,
) {
  const geometry = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  geometry.scale(1, 1, depth);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** One continuous shell: recessed opening, rolled rim, soft pointed crown and closed back. */
function hoodGeometry() {
  // x/y are the ring radii; z is its depth. Interpolation rounds the cloth's edge.
  const profile = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.301, 0.274, 0.160),
    new THREE.Vector3(0.315, 0.287, 0.280),
    new THREE.Vector3(0.405, 0.363, 0.325),
    new THREE.Vector3(0.450, 0.410, 0.200),
    new THREE.Vector3(0.443, 0.410, -0.040),
    new THREE.Vector3(0.382, 0.350, -0.230),
    new THREE.Vector3(0.245, 0.250, -0.330),
    new THREE.Vector3(0.080, 0.100, -0.370),
    new THREE.Vector3(0, 0, -0.375),
  ], false, "catmullrom", 0.35).getPoints(20);
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  const segments = 48;
  for (const [ring, p] of profile.entries()) {
    const outer = THREE.MathUtils.smoothstep(ring / 20, 0, 0.16);
    for (let i = 0; i <= segments; i++) {
      const angle = i / segments * Math.PI * 2;
      const top = Math.max(0, Math.cos(angle));
      positions.push(
        Math.sin(angle) * p.x * (1 - 0.28 * top * outer) - 0.025 * top ** 3 * outer * p.y / 0.41,
        Math.cos(angle) * p.y - 0.04 * (1 - outer) + 0.025 * top ** 4 * outer * p.y / 0.41,
        p.z,
      );
      const shade = ring === 0 ? 0.86 : ring === 1 ? 0.96 : 1;
      colors.push(shade, shade, shade);
      if (ring < profile.length - 1 && i < segments) {
        const a = ring * (segments + 1) + i, b = a + 1, c = a + segments + 1;
        indices.push(a, b, c, b, c + 1, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal");
  const normal = new THREE.Vector3(), seam = new THREE.Vector3();
  for (let ring = 0; ring < profile.length; ring++) {
    const first = ring * (segments + 1), last = first + segments;
    normal.fromBufferAttribute(normals, first);
    seam.fromBufferAttribute(normals, last);
    normal.add(seam).normalize();
    normals.setXYZ(first, normal.x, normal.y, normal.z);
    normals.setXYZ(last, normal.x, normal.y, normal.z);
  }
  return geometry;
}

/** Concept 01: cream hood, moss bell-shaped cape, folded scarf and little pebble feet. */
export function createTraveler(parts: TravelerParts, tint = "#85866a") {
  const root = new THREE.Group();
  root.name = "Traveler";
  const { torso, leftArm, rightArm, legs, hands } = parts;
  const coat = clay(tint);
  coat.userData.role = "jacket";
  const hoodMaterial = clay("#dfcbaa");
  hoodMaterial.vertexColors = true;
  const ivory = clay("#f1e2ca");
  const ink = clay("#493e32");
  const scarf = clay("#996f55");
  const sole = clay("#716354");
  root.add(torso);
  cloth(torso, "Poncho", [
    [0, -0.302], [0.32, -0.302], [0.414, -0.315], [0.441, -0.302],
    [0.444, -0.280], [0.429, -0.185], [0.405, -0.070], [0.374, 0.065],
    [0.339, 0.190], [0.297, 0.295], [0.248, 0.365], [0.187, 0.402], [0, 0.405],
  ], coat, 0.73, 32);
  const hood = new THREE.Mesh(hoodGeometry(), hoodMaterial);
  hood.name = "Hood";
  hood.position.y = 0.765;
  hood.castShadow = true;
  hood.receiveShadow = true;
  torso.add(hood);
  pebble(torso, "Face", [0.350, 0.330, 0.170], [0, 0.725, 0.20], ivory, 24);
  for (const side of [-1, 1]) {
    pebble(torso, "Eye", [0.018, 0.026, 0.012], [side * 0.101, 0.752, 0.367], ink, 12);
  }
  const smile = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.026, 0.650, 0.369),
    new THREE.Vector3(0, 0.630, 0.369),
    new THREE.Vector3(0.026, 0.650, 0.369),
  ), 8, 0.005, 5, false), ink);
  smile.name = "Smile";
  torso.add(smile);
  // Two quiet folds wrap around the neck; the back keeps the same simple silhouette.
  for (const [index, y] of [0.378, 0.431].entries()) {
    const fold = new THREE.Mesh(new THREE.TorusGeometry(index ? 0.233 : 0.244, 0.055, 6, 28), scarf);
    fold.name = index ? "ScarfFold" : "Collar";
    fold.rotation.x = Math.PI / 2;
    fold.rotation.y = index ? -0.035 : 0.035;
    fold.scale.set(1.13, 0.88, 0.72);
    fold.position.set(index ? -0.008 : 0.005, y, 0.015);
    fold.castShadow = true;
    fold.receiveShadow = true;
    torso.add(fold);
  }
  for (const [index, side] of [-1, 1].entries()) {
    const arm = side < 0 ? leftArm : rightArm;
    arm.name = side < 0 ? "LeftMitten" : "RightMitten";
    torso.add(arm);
    const sleeve = cloth(arm, "CapeSleeve", [
      [0, -0.003], [0.10, -0.003], [0.142, 0], [0.148, 0.018],
      [0.136, 0.080], [0.116, 0.165], [0.090, 0.231], [0.052, 0.261], [0, 0.265],
    ], coat, 0.9, 20);
    sleeve.position.set(-side * 0.01, 0.01, -0.025);
    sleeve.rotation.z = side * 0.38;
    const hand = hands[index]!;
    hand.name = side < 0 ? "LeftHandAnchor" : "RightHandAnchor";
    arm.add(hand);
    pebble(hand, "Mitten", [0.090, 0.125, 0.10], [0, -0.025, 0.018], ivory);
    const foot = legs[index]!;
    foot.name = side < 0 ? "LeftFoot" : "RightFoot";
    root.add(foot);
    foot.position.set(side * 0.145, 0.12, 0.025);
    pebble(foot, "PebbleShoe", [0.131, 0.12, 0.166], [0, 0, 0.035], sole);
  }
  restTraveler(parts);
  return root;
}

export function restTraveler(parts: TravelerParts) {
  parts.torso.rotation.set(0, 0, 0);
  parts.torso.position.y = TRAVELER_BODY_Y;
  parts.leftArm.position.set(-HAND_X, TRAVELER_REST_HAND.y, TRAVELER_REST_HAND.z);
  parts.rightArm.position.set(HAND_X, TRAVELER_REST_HAND.y, TRAVELER_REST_HAND.z);
  for (const arm of [parts.leftArm, parts.rightArm]) {
    arm.rotation.set(0, 0, 0);
    arm.scale.setScalar(1);
  }
  parts.hands.forEach(hand => hand.rotation.set(0, 0, 0));
  parts.legs.forEach(foot => { foot.rotation.set(0, 0, 0); foot.position.y = 0.12; });
}

/** Small steps and a restrained sway, shared with remote visitors. */
export function walkTraveler(parts: TravelerParts, phase: number) {
  restTraveler(parts);
  parts.legs[0]!.rotation.x = phase * 0.30;
  parts.legs[1]!.rotation.x = -phase * 0.30;
  parts.legs[0]!.position.y += Math.max(0, phase) * 0.055;
  parts.legs[1]!.position.y += Math.max(0, -phase) * 0.055;
  parts.leftArm.position.z -= phase * 0.075;
  parts.rightArm.position.z += phase * 0.075;
  parts.leftArm.rotation.z = -0.08 - phase * 0.08;
  parts.rightArm.rotation.z = 0.08 - phase * 0.08;
  parts.torso.rotation.z = phase * 0.025;
}

export function prayTraveler(parts: TravelerParts, frame: ReturnType<typeof ritualFrame>) {
  restTraveler(parts);
  if (frame.kind === "bow") {
    parts.torso.rotation.x = Math.sin(frame.phase * Math.PI) ** 1.4 * 0.68;
  } else if (frame.kind === "clap") {
    const lift = Math.sin(Math.PI * frame.phase) ** 0.6;
    const contact = Math.sin(Math.PI * frame.phase) ** 2;
    const x = HAND_X + (0.075 - HAND_X) * contact;
    parts.leftArm.position.set(-x, 0.13 + 0.22 * lift, 0.04 + 0.35 * lift);
    parts.rightArm.position.set(x, 0.13 + 0.22 * lift, 0.04 + 0.35 * lift);
    for (const arm of [parts.leftArm, parts.rightArm]) arm.scale.set(1 - contact * 0.10, 1, 1);
  }
}
