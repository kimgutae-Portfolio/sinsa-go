import { Vector3 } from "three";
import { canOccupy } from "./collision";
import type { Collider } from "./types";

const STEP = 0.5;
const EDGE = 13.5;
const WIDTH = EDGE * 4 + 1;
const toCell = (value: number) =>
  Math.max(0, Math.min(WIDTH - 1, Math.round((value + EDGE) / STEP)));
const toWorld = (cell: number) => cell * STEP - EDGE;
const key = (x: number, z: number) => z * WIDTH + x;

/** A* over the collision map. Ground clicks and facility shortcuts share this route. */
export function findPath(
  start: Vector3,
  end: Vector3,
  colliders: readonly Collider[],
): Vector3[] {
  if (!canOccupy(end.x, end.z, 0.36, colliders)) return [];
  const sx = toCell(start.x),
    sz = toCell(start.z),
    ex = toCell(end.x),
    ez = toCell(end.z);
  const first = key(sx, sz),
    last = key(ex, ez);
  const open = new Set([first]);
  const parent = new Map<number, number>();
  const cost = new Map([[first, 0]]);
  const score = new Map([[first, Math.hypot(ex - sx, ez - sz)]]);
  const walkable = (x: number, z: number) =>
    x >= 0 &&
    z >= 0 &&
    x < WIDTH &&
    z < WIDTH &&
    canOccupy(toWorld(x), toWorld(z), 0.4, colliders);
  if (!walkable(ex, ez)) return [];
  while (open.size) {
    let current = first,
      lowest = Infinity;
    for (const candidate of open)
      if ((score.get(candidate) ?? Infinity) < lowest) {
        lowest = score.get(candidate)!;
        current = candidate;
      }
    if (current === last) {
      const route = [end.clone()];
      while (current !== first) {
        route.unshift(
          new Vector3(
            toWorld(current % WIDTH),
            0,
            toWorld(Math.floor(current / WIDTH)),
          ),
        );
        current = parent.get(current)!;
      }
      return route;
    }
    open.delete(current);
    const x = current % WIDTH,
      z = Math.floor(current / WIDTH);
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if ((!dx && !dz) || !walkable(x + dx, z + dz)) continue;
        if (dx && dz && (!walkable(x + dx, z) || !walkable(x, z + dz)))
          continue;
        const next = key(x + dx, z + dz);
        const nextCost = cost.get(current)! + Math.hypot(dx, dz);
        if (nextCost >= (cost.get(next) ?? Infinity)) continue;
        parent.set(next, current);
        cost.set(next, nextCost);
        score.set(next, nextCost + Math.hypot(ex - x - dx, ez - z - dz));
        open.add(next);
      }
  }
  return [];
}
