import type { InteractionId, InteractionPoint } from "./types";

export class InteractionManager {
  nearby: InteractionId | null = null;
  constructor(readonly points: readonly InteractionPoint[]) {}

  update(x: number, z: number, enabled: boolean) {
    let closest = Infinity;
    this.nearby = null;
    if (!enabled) return;
    for (const point of this.points) {
      const distance = Math.hypot(x - point.position.x, z - point.position.z);
      if (distance <= point.radius && distance < closest) {
        closest = distance;
        this.nearby = point.id;
      }
    }
  }
}
