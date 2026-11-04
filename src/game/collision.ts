import type { Collider } from "./types";

/** Circle against AABB, allowing sliding along corners instead of a square player hull. */
export function canOccupy(
  x: number,
  z: number,
  radius: number,
  colliders: readonly Collider[],
  halfMap = 14.1,
) {
  if (Math.abs(x) > halfMap - radius || Math.abs(z) > halfMap - radius)
    return false;
  return !colliders.some((box) => {
    const closestX = Math.max(box.minX, Math.min(x, box.maxX));
    const closestZ = Math.max(box.minZ, Math.min(z, box.maxZ));
    return (x - closestX) ** 2 + (z - closestZ) ** 2 < radius ** 2;
  });
}
