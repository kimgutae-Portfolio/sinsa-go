import * as THREE from "three";
import { architecturalMaterial, clearSurfaceLibrary } from "./surfaces";
import { detailedRoof, clearInscriptionCache } from "./architecture";

const materials = new Map<string, THREE.MeshStandardMaterial>();
export function material(color: string, roughness = 0.88) {
  const natural = architecturalMaterial(color);
  if (natural) return natural;
  const key = `${color}:${roughness}`;
  let mat = materials.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      roughness,
      flatShading: false,
    });
    materials.set(key, mat);
  }
  return mat;
}
export function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  color: string,
) {
  const mat = material(color);
  const geometry = new THREE.BoxGeometry(...size);
  if (
    mat.userData.surfaceKind === "wood" &&
    size[0] > size[1] * 2 &&
    size[0] > size[2]
  ) {
    const uv = geometry.attributes.uv!;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      uv.setXY(i, uv.getY(i), u);
    }
  }
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function cylinder(
  parent: THREE.Object3D,
  top: number,
  bottom: number,
  height: number,
  position: [number, number, number],
  color: string,
  segments = 16,
) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(top, bottom, height, segments),
    material(color),
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function sphere(
  parent: THREE.Object3D,
  radius: number,
  position: [number, number, number],
  color: string,
  detail = 1,
) {
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(radius, detail),
    material(color),
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function beam(
  parent: THREE.Object3D,
  from: THREE.Vector3,
  to: THREE.Vector3,
  width: number,
  color: string,
) {
  const center = from.clone().add(to).multiplyScalar(0.5);
  const mesh = cylinder(
    parent,
    width,
    width,
    from.distanceTo(to),
    [center.x, center.y, center.z],
    color,
  );
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    to.clone().sub(from).normalize(),
  );
  return mesh;
}
// A pitched roof with projecting eaves, shared by the hall and little stalls.
export function roof(
  parent: THREE.Object3D,
  width: number,
  depth: number,
  y: number,
  color = "#536760",
) {
  void color;
  detailedRoof(parent, width, depth, y);
}

export function disposeObject(root: THREE.Object3D, clearCaches = true) {
  const geometries = new Set<THREE.BufferGeometry>();
  const mats = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh) object.dispose();
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    if (
      object instanceof THREE.DirectionalLight ||
      object instanceof THREE.SpotLight
    )
      object.shadow.dispose();
    if (!(
      object instanceof THREE.Mesh ||
      object instanceof THREE.Points ||
      object instanceof THREE.Line
    ))
      return;
    geometries.add(object.geometry);
    const list = Array.isArray(object.material)
      ? object.material
      : [object.material];
    list.forEach((mat) => {
      mats.add(mat);
      for (const value of Object.values(mat))
        if (value instanceof THREE.Texture) textures.add(value);
    });
  });
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
  mats.forEach((mat) => mat.dispose());
  // Each Game owns the procedural scene; clear disposed material references on teardown.
  if (clearCaches) {
    materials.clear();
    clearSurfaceLibrary(textures);
    clearInscriptionCache();
  }
}
