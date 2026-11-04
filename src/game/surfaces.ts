import * as THREE from "three";

export type SurfaceKind =
  "wood" | "bark" | "stone" | "roof" | "fabric" | "foliage" | "plaster";
const library = new Map<string, THREE.MeshStandardMaterial>();
const textures = new Map<SurfaceKind, THREE.Texture>();
const breezeUniforms = new Set<{ value: number }>();
let generation = 0;

function noiseTexture(kind: SurfaceKind) {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let seed = 3397;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      seed = (seed * 16807) % 2147483647;
      const n = seed / 2147483647;
      const grain = Math.sin(x * 0.65 + Math.sin(y * 0.08) * 0.4) * 0.13;
      let shade =
        kind === "wood" || kind === "bark"
          ? 0.77 + grain + n * 0.14
          : kind === "fabric"
            ? 0.86 + ((x + y) % 2) * 0.08
            : 0.78 + n * 0.22;
      if (kind === "stone")
        shade -= Math.max(0, Math.sin(x * 0.11 + y * 0.17) - 0.85) * 0.4;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = shade * 255;
      data[i + 3] =
        kind === "foliage"
          ? Math.sin(x * 0.19) * Math.sin(y * 0.21) > -0.1
            ? 255
            : 0
          : 255;
    }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = texture.wrapT =
    kind === "foliage" ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function textureFor(kind: SurfaceKind) {
  let texture = textures.get(kind);
  if (!texture) {
    texture = noiseTexture(kind);
    textures.set(kind, texture);
  }
  return texture;
}

export function surface(kind: SurfaceKind, color: string) {
  const key = `${kind}:${color}`;
  let mat = library.get(key);
  if (mat) return mat;
  mat = new THREE.MeshStandardMaterial({
    color,
    map: textureFor(kind),
    roughness: kind === "roof" ? 0.8 : 0.94,
    bumpMap: kind === "foliage" ? null : textureFor(kind),
    bumpScale:
      kind === "bark"
        ? 0.11
        : kind === "stone"
          ? 0.055
          : kind === "wood"
            ? 0.035
            : 0.012,
  });
  mat.userData.surfaceKind = kind;
  if (kind === "foliage") {
    mat.side = THREE.DoubleSide;
    mat.alphaTest = 0.45;
    mat.alphaToCoverage = true;
    mat.roughness = 0.84;
    mat.onBeforeCompile = (shader) => {
      const time = { value: 0 };
      shader.uniforms.uBreeze = time;
      breezeUniforms.add(time);
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform float uBreeze;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nfloat wind = sin(position.x * 0.6 + uBreeze * 0.8) + cos(position.z * 0.45 + uBreeze * 0.6);\ntransformed.x += wind * 0.022 * uv.y;\ntransformed.z += sin(uBreeze * 0.6 + position.x) * 0.016 * uv.y;",
        );
    };
    mat.customProgramCacheKey = () => "shrine-leaf-breeze-v1";
  }
  library.set(key, mat);
  return mat;
}

/** Color-only old Geometry also gets tactile materials without changing the GLB path. */
export function architecturalMaterial(
  color: string,
): THREE.MeshStandardMaterial | undefined {
  const woodColors = [
    "#98714b",
    "#654c36",
    "#9c8058",
    "#b39466",
    "#866341",
    "#79583b",
    "#c49b65",
    "#b58a59",
    "#d1af79",
    "#c18c5d",
    "#d4b27a",
    "#9e987b",
    "#b7a98a",
    "#a18a60",
    "#76694f",
    "#634e36",
    "#4e4735",
  ];
  const stoneColors = [
    "#b4b3a2",
    "#a6aea0",
    "#b4b4a0",
    "#b8b6a4",
    "#c7c4af",
    "#a1a796",
    "#b5baa7",
    "#b9bdac",
    "#929e8a",
    "#a3ac94",
    "#939b81",
    "#a4aa97",
  ];
  if (woodColors.includes(color)) return surface("wood", "#d0b58f");
  if (stoneColors.includes(color)) return surface("stone", color);
  return undefined;
}

export async function loadNaturalTextures() {
  const version = generation;
  if (typeof document === "undefined") return;
  const loader = new THREE.TextureLoader();
  await Promise.allSettled(
    (
      [
        ["wood", "cedar-albedo.webp"],
        ["foliage", "evergreen-foliage.webp"],
      ] as const
    ).map(async ([kind, file]) => {
      try {
        const texture = await loader.loadAsync(
          `${import.meta.env.BASE_URL}textures/${file}`,
        );
        if (version !== generation) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT =
          kind === "foliage" ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        texture.anisotropy = 4;
        const previous = textures.get(kind);
        textures.set(kind, texture);
        for (const mat of library.values())
          if (mat.userData.surfaceKind === kind) {
            mat.map = texture;
            if (kind !== "foliage") mat.bumpMap = texture;
            mat.needsUpdate = true;
          }
        previous?.dispose();
      } catch (error) {
        console.warn(`[Shrine textures] ${file}: using local fallback`, error);
      }
    }),
  );
}

export function updateBreeze(time: number) {
  breezeUniforms.forEach((uniform) => (uniform.value = time));
}
export function clearSurfaceLibrary(
  alreadyDisposed = new Set<THREE.Texture>(),
) {
  generation++;
  // disposeObject releases textures in use; also release unused fallback textures.
  textures.forEach((texture) => {
    if (!alreadyDisposed.has(texture)) texture.dispose();
  });
  library.clear();
  textures.clear();
  breezeUniforms.clear();
}
