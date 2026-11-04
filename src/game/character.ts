import * as THREE from "three";
import { roundedBox } from "./architecture";
import { surface } from "./surfaces";

export interface TravelerRig {
  torso: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  legs: THREE.Group[];
  elbows: THREE.Group[];
  knees: THREE.Group[];
}
function ellipsoid(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  mat: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat);
  mesh.scale.set(...size);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function capsule(
  parent: THREE.Object3D,
  radius: number,
  length: number,
  position: [number, number, number],
  mat: THREE.Material,
) {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, length, 5, 12),
    mat,
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function seam(
  parent: THREE.Object3D,
  points: THREE.Vector3[],
  radius: number,
  mat: THREE.Material,
) {
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(points),
      12,
      radius,
      5,
      false,
    ),
    mat,
  );
  parent.add(mesh);
  return mesh;
}

/** A rounded, clothed traveler with shoulder/elbow/hip/knee joints and sewn details. */
export function createTraveler(rig: TravelerRig, tint = "#d5d0bc") {
  const root = new THREE.Group();
  root.name = "Traveler";
  const { torso, leftArm, rightArm, legs, elbows, knees } = rig;
  const jacket = surface("fabric", tint);
  jacket.userData.role = "jacket";
  const trim = surface("fabric", "#b6b29d");
  const trousers = surface("fabric", "#657367");
  const bag = surface("fabric", "#997452");
  const bagTrim = surface("fabric", "#735a40");
  const skin = new THREE.MeshStandardMaterial({
    color: "#dcb38f",
    roughness: 0.78,
  });
  const hair = new THREE.MeshStandardMaterial({
    color: "#40392f",
    roughness: 0.94,
  });
  const shoe = new THREE.MeshStandardMaterial({
    color: "#726452",
    roughness: 0.85,
  });
  const sole = new THREE.MeshStandardMaterial({
    color: "#c4bc9f",
    roughness: 1,
  });
  const eye = new THREE.MeshStandardMaterial({
    color: "#37352d",
    roughness: 0.5,
  });
  torso.position.y = 0.82;
  root.add(torso);
  const outline = [
    new THREE.Vector2(0.23, 0.015),
    new THREE.Vector2(0.27, 0.04),
    new THREE.Vector2(0.265, 0.17),
    new THREE.Vector2(0.25, 0.3),
    new THREE.Vector2(0.295, 0.52),
    new THREE.Vector2(0.24, 0.63),
    new THREE.Vector2(0.1, 0.65),
  ];
  const body = new THREE.Mesh(new THREE.LatheGeometry(outline, 24), jacket);
  body.scale.z = 0.72;
  body.castShadow = true;
  body.receiveShadow = true;
  torso.add(body);
  capsule(torso, 0.08, 0.09, [0, 0.72, 0], skin);
  ellipsoid(torso, [0.245, 0.28, 0.23], [0, 0.98, 0.01], skin);
  for (const side of [-1, 1]) {
    ellipsoid(torso, [0.045, 0.072, 0.043], [side * 0.238, 0.97, 0], skin);
    ellipsoid(torso, [0.023, 0.028, 0.015], [side * 0.08, 0.99, 0.226], eye);
    seam(
      torso,
      [
        new THREE.Vector3(side * 0.05, 1.05, 0.219),
        new THREE.Vector3(side * 0.09, 1.055, 0.217),
        new THREE.Vector3(side * 0.12, 1.04, 0.215),
      ],
      0.009,
      hair,
    );
  }
  ellipsoid(torso, [0.035, 0.043, 0.057], [0, 0.94, 0.235], skin);
  seam(
    torso,
    [
      new THREE.Vector3(-0.045, 0.858, 0.208),
      new THREE.Vector3(0, 0.85, 0.224),
      new THREE.Vector3(0.045, 0.858, 0.208),
    ],
    0.005,
    shoe,
  );
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.254, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.49),
    hair,
  );
  cap.position.set(0, 1.01, -0.01);
  cap.scale.z = 0.96;
  cap.castShadow = true;
  torso.add(cap);
  ellipsoid(torso, [0.235, 0.21, 0.12], [0, 1.005, -0.14], hair);
  for (let strand = 0; strand < 8; strand++) {
    const x = -0.2 + strand * 0.052;
    seam(
      torso,
      [
        new THREE.Vector3(x, 1.16, 0.11),
        new THREE.Vector3(x + 0.025, 1.1, 0.19),
        new THREE.Vector3(x + 0.018, 1.065 - Math.abs(x) * 0.1, 0.215),
      ],
      0.018,
      hair,
    );
  }
  // Folded hood, hem, zip and slanted pocket seams.
  ellipsoid(torso, [0.21, 0.13, 0.11], [0, 0.57, -0.16], trim);
  for (const side of [-1, 1]) {
    const collar = roundedBox(
      torso,
      [0.13, 0.16, 0.055],
      [side * 0.084, 0.62, 0.12],
      trim,
      0.025,
    );
    collar.rotation.z = side * 0.38;
    seam(
      torso,
      [
        new THREE.Vector3(side * 0.12, 0.28, 0.178),
        new THREE.Vector3(side * 0.21, 0.18, 0.14),
      ],
      0.008,
      trim,
    );
  }
  seam(
    torso,
    [
      new THREE.Vector3(0, 0.07, 0.194),
      new THREE.Vector3(0, 0.35, 0.183),
      new THREE.Vector3(0, 0.59, 0.14),
    ],
    0.009,
    shoe,
  );
  ellipsoid(torso, [0.02, 0.031, 0.01], [0, 0.48, 0.195], sole);
  roundedBox(torso, [0.4, 0.44, 0.17], [0, 0.32, -0.27], bag, 0.065);
  roundedBox(torso, [0.32, 0.17, 0.045], [0, 0.2, -0.373], bagTrim, 0.025);
  roundedBox(torso, [0.33, 0.08, 0.03], [0, 0.5, -0.37], bagTrim, 0.02);
  for (const side of [-1, 1]) {
    seam(
      torso,
      [
        new THREE.Vector3(side * 0.14, 0.54, -0.3),
        new THREE.Vector3(side * 0.21, 0.61, -0.05),
        new THREE.Vector3(side * 0.23, 0.4, 0.16),
        new THREE.Vector3(side * 0.2, 0.1, 0.08),
      ],
      0.022,
      bagTrim,
    );
    roundedBox(
      torso,
      [0.018, 0.24, 0.012],
      [side * 0.09, 0.35, -0.37],
      trim,
      0.005,
    );
    roundedBox(
      torso,
      [0.045, 0.045, 0.015],
      [side * 0.09, 0.3, -0.385],
      shoe,
      0.006,
    );
  }
  for (const [index, side] of [-1, 1].entries()) {
    const arm = side < 0 ? leftArm : rightArm;
    arm.name = side < 0 ? "LeftShoulder" : "RightShoulder";
    arm.position.set(side * 0.305, 0.55, 0);
    torso.add(arm);
    capsule(arm, 0.095, 0.18, [0, -0.12, 0], jacket);
    const elbow = elbows[index]!;
    elbow.position.y = -0.26;
    arm.add(elbow);
    capsule(elbow, 0.081, 0.16, [0, -0.11, 0], jacket);
    capsule(elbow, 0.083, 0.03, [0, -0.23, 0], trim);
    ellipsoid(elbow, [0.072, 0.095, 0.048], [0, -0.31, 0.012], skin);
    ellipsoid(
      elbow,
      [0.034, 0.06, 0.034],
      [-side * 0.059, -0.296, 0.027],
      skin,
    );
    const leg = legs[index]!;
    leg.name = side < 0 ? "LeftHip" : "RightHip";
    leg.position.set(side * 0.14, 0.82, 0);
    root.add(leg);
    capsule(leg, 0.113, 0.2, [0, -0.18, 0], trousers);
    const knee = knees[index]!;
    knee.position.y = -0.36;
    leg.add(knee);
    capsule(knee, 0.089, 0.21, [0, -0.17, 0], trousers);
    capsule(knee, 0.09, 0.025, [0, -0.31, 0], trousers);
    roundedBox(knee, [0.205, 0.14, 0.33], [0, -0.38, 0.054], shoe, 0.05);
    roundedBox(knee, [0.21, 0.045, 0.345], [0, -0.445, 0.054], sole, 0.018);
    for (let lace = 0; lace < 3; lace++)
      roundedBox(
        knee,
        [0.11, 0.009, 0.012],
        [0, -0.308, 0.055 + lace * 0.028],
        trim,
        0.003,
      );
  }
  return root;
}
