import { Box3, MathUtils, PerspectiveCamera, Ray, Vector3 } from "three";
import type { Collider } from "./types";
import { PLAYER_SPAWN } from "./config";

/** A low, third-person camera: drag to look around; the character stays in view. */
export class CameraController {
  readonly camera = new PerspectiveCamera(58, 1, 0.08, 180);
  readonly right = new Vector3();
  readonly forward = new Vector3();
  private yaw = 0;
  private pitch = MathUtils.degToRad(19);
  private distance = 7.8;
  private target = new Vector3(PLAYER_SPAWN.x, 2.15, PLAYER_SPAWN.z);
  private desired = new Vector3();
  private offset = new Vector3();
  private ray = new Ray();
  private bounds = new Box3();
  private hit = new Vector3();

  constructor() {
    this.reset();
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.fov = width < height ? 68 : 58;
    this.camera.updateProjectionMatrix();
  }

  rotate(dx: number, dy: number) {
    this.yaw -= dx * 0.005;
    this.pitch = MathUtils.clamp(
      this.pitch + dy * 0.004,
      MathUtils.degToRad(12),
      MathUtils.degToRad(52),
    );
    this.updateBasis();
  }

  private updateBasis() {
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  update(
    dt: number,
    player: Vector3,
    colliders: readonly Collider[] = [],
    snap = false,
  ) {
    this.desired.copy(player).y += 2.15;
    this.target.lerp(this.desired, snap ? 1 : 1 - Math.exp(-10 * dt));
    this.offset.set(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    this.ray.set(this.target, this.offset);
    let distance = this.distance;
    for (const collider of colliders) {
      this.bounds.min.set(collider.minX - 0.2, 0, collider.minZ - 0.2);
      this.bounds.max.set(
        collider.maxX + 0.2,
        collider.height ?? 2.8,
        collider.maxZ + 0.2,
      );
      if (this.ray.intersectBox(this.bounds, this.hit))
        distance = Math.min(
          distance,
          Math.max(1, this.hit.distanceTo(this.target) - 0.3),
        );
    }
    this.camera.position
      .copy(this.target)
      .addScaledVector(this.offset, distance);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  setZoom(delta: number) {
    this.distance = MathUtils.clamp(this.distance - delta * 8, 3.5, 13);
  }

  reset(player = new Vector3(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z)) {
    this.yaw = 0;
    this.pitch = MathUtils.degToRad(19);
    this.distance = 7.8;
    this.updateBasis();
    this.update(0, player, [], true);
  }
}
