import { Box3, MathUtils, PerspectiveCamera, Ray, Vector3 } from "three";
import type { Collider } from "./types";
import { PLAYER_SPAWN } from "./config";
import { TEMIZU_LAYOUT } from "./layout";

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
  private normalPosition = new Vector3();
  private lookTarget = new Vector3();
  private temizuTarget = new Vector3(TEMIZU_LAYOUT.x, 1.05, TEMIZU_LAYOUT.stance.z + 0.6);
  private temizuPosition = new Vector3();
  private temizuActive = false;
  private temizuBlend = 0;
  private portrait = false;
  private normalFov = 58;

  constructor() {
    this.reset();
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / Math.max(height, 1);
    this.portrait = width < height;
    this.normalFov = this.portrait ? 68 : 58;
    this.camera.fov = MathUtils.lerp(this.normalFov, 43, this.temizuBlend);
    this.camera.updateProjectionMatrix();
  }

  rotate(dx: number, dy: number) {
    if (this.temizuActive || this.temizuBlend > 0) return;
    this.yaw -= dx * 0.005;
    this.pitch = MathUtils.clamp(
      this.pitch + dy * 0.004,
      MathUtils.degToRad(12),
      MathUtils.degToRad(52),
    );
    this.updateBasis();
  }

  /** Smoothly swing the view around the player toward a given yaw. */
  ease(targetYaw: number, dt: number) {
    if (this.temizuActive || this.temizuBlend > 0) return;
    const diff = Math.atan2(
      Math.sin(targetYaw - this.yaw),
      Math.cos(targetYaw - this.yaw),
    );
    this.yaw += diff * (1 - Math.exp(-3.5 * dt));
    this.updateBasis();
  }

  /** A close, open-side view keeps the mittens and ladle below the canopy. */
  setTemizuView(active: boolean) {
    this.temizuActive = active;
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
    const basinDistance = Math.hypot(
      player.x - TEMIZU_LAYOUT.approach.x,
      player.z - TEMIZU_LAYOUT.approach.z,
    );
    const nearBasin = 1 - MathUtils.smoothstep(basinDistance, 2, 3.5);
    this.desired.copy(player).y += MathUtils.lerp(2.15, 1.1, nearBasin);
    this.target.lerp(this.desired, snap ? 1 : 1 - Math.exp(-10 * dt));
    // A lower aim and shallow angle let the normal orbit see under the canopy
    // after the ritual. Keep the visitor's chosen pitch for the rest of the map.
    const pitch = MathUtils.lerp(this.pitch, Math.min(this.pitch, MathUtils.degToRad(19)), nearBasin);
    this.offset.set(
      Math.sin(this.yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(this.yaw) * Math.cos(pitch),
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
    this.normalPosition
      .copy(this.target)
      .addScaledVector(this.offset, distance);
    const destination = this.temizuActive ? 1 : 0;
    this.temizuBlend = snap ? destination : MathUtils.lerp(
      this.temizuBlend, destination, 1 - Math.exp(-6 * Math.max(0, dt)),
    );
    if (Math.abs(this.temizuBlend - destination) < 0.001) this.temizuBlend = destination;
    // Look back across the basin toward the visitor's face. The line enters
    // between the two side posts, keeping the hood behind the working hands.
    // Portrait looks more frontally so the hood's full width remains inside
    // the narrow frame and neither side post cuts across the character.
    if (this.portrait) this.temizuPosition.set(1.2, 1.2, 5.15);
    else this.temizuPosition.set(1.8, 0.9, 2.8);
    this.temizuPosition.add(this.temizuTarget);
    this.camera.position.copy(this.normalPosition).lerp(this.temizuPosition, this.temizuBlend);
    this.lookTarget.copy(this.target).lerp(this.temizuTarget, this.temizuBlend);
    const fov = MathUtils.lerp(this.normalFov, 43, this.temizuBlend);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(this.lookTarget);
    this.camera.updateMatrixWorld();
  }

  setZoom(delta: number) {
    if (this.temizuActive || this.temizuBlend > 0) return;
    this.distance = MathUtils.clamp(this.distance - delta * 8, 3.5, 13);
  }

  reset(player = new Vector3(PLAYER_SPAWN.x, 0, PLAYER_SPAWN.z)) {
    this.temizuActive = false;
    this.temizuBlend = 0;
    this.yaw = 0;
    this.pitch = MathUtils.degToRad(19);
    this.distance = 7.8;
    this.updateBasis();
    this.update(0, player, [], true);
  }
}
