import { DataTexture, RepeatWrapping, SRGBColorSpace } from "three";

/** Local, seeded gravel: no image downloads and no canvas/DOM dependency. */
export function groundTexture() {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  let seed = 413;
  for (let i = 0; i < size * size; i++) {
    seed = (seed * 16807) % 2147483647;
    const noise = seed / 2147483647;
    const shade = noise < 0.02 ? 0.8 : 0.93 + noise * 0.12;
    data[i * 4] = 194 * shade;
    data[i * 4 + 1] = 185 * shade;
    data[i * 4 + 2] = 158 * shade;
    data[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, size, size);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
