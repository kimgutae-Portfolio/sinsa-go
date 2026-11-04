import * as THREE from "three";
import { AssetLoader } from "./AssetLoader";
import { CameraController } from "./CameraController";
import { InputController } from "./InputController";
import { InteractionManager } from "./InteractionManager";
import { PlayerController } from "./PlayerController";
import { World, INTERACTIONS } from "./World";
import { disposeObject } from "./geometry";
import type { GameCallbacks } from "./types";
import type { InteractionId } from "./types";
import { PointerController } from "./PointerController";
import { createSky } from "./atmosphere";
import { groundTexture } from "./terrain";
import { HALL_LAYOUT, OFFERING_LAYOUT, LANTERN_LAYOUT } from "./layout";
import { LanternGarden } from "./LanternGarden";
import { MultiplayerClient } from "./MultiplayerClient";
import { RemotePlayer } from "./RemotePlayer";
import type { Visitor } from "../shared/multiplayer";
import { RITUAL_DURATION } from "./ritual";

const APPROACH: Record<InteractionId, THREE.Vector3> = {
  lantern: new THREE.Vector3(
    LANTERN_LAYOUT.approach.x,
    0,
    LANTERN_LAYOUT.approach.z,
  ),
  offering: new THREE.Vector3(
    OFFERING_LAYOUT.ritual.x,
    0,
    OFFERING_LAYOUT.ritual.z,
  ),
  fortune: new THREE.Vector3(-7, 0, -0.2),
  ema: new THREE.Vector3(7, 0, -1.7),
};

export class Game {
  private lanternGarden = new LanternGarden();
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private assets = new AssetLoader();
  private camera = new CameraController();
  private world = new World(this.assets);
  private player = new PlayerController(this.world.colliders, this.camera);
  private interactions = new InteractionManager(INTERACTIONS);
  private input: InputController;
  private pointer: PointerController;
  private pendingVisit: InteractionId | null = null;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private pointerPosition = new THREE.Vector2();
  private groundHit = new THREE.Vector3();
  private destinationMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.37, 32),
    new THREE.MeshBasicMaterial({
      color: "#f2e4b6",
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  private resizeObserver: ResizeObserver;
  private frameId = 0;
  private lastTime = 0;
  private updateTime = 0;
  private disposed = false;
  private paused = false;
  private ready = false;
  private multiplayer?: MultiplayerClient;
  private visitors = new Map<string, RemotePlayer>();
  private synchronizedRitual: number | null = null;
  private awaitingPrayer = 0;
  private marker = new THREE.Vector3();
  private onVisibility = () => {
    this.lastTime = 0;
    this.input.clear();
    this.pointer.clear();
  };
  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.paused = true;
  };
  private onContextRestored = () => {
    this.paused = false;
    this.lastTime = 0;
  };

  constructor(
    private container: HTMLElement,
    private callbacks: GameCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor("#d5daca");
    this.scene.fog = new THREE.Fog("#d5daca", 32, 95);
    this.renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio || 1,
        window.matchMedia("(pointer: coarse)").matches ? 1.5 : 2,
      ),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "旅人の後ろから眺める境内。地面をクリック、またはWASDで移動し、ドラッグして見渡せます。",
    );
    this.renderer.domElement.setAttribute("role", "img");
    container.appendChild(this.renderer.domElement);
    this.scene.add(this.world.root, this.player.root, createSky());
    this.scene.add(this.lanternGarden.root);
    this.scene.add(new THREE.HemisphereLight("#dfebee", "#645e47", 1.65));
    const sun = new THREE.DirectionalLight("#ffeace", 3.1);
    sun.position.set(-12, 24, 10);
    sun.castShadow = true;
    const mapSize = window.matchMedia("(pointer: coarse)").matches
      ? 1024
      : 2048;
    sun.shadow.mapSize.set(mapSize, mapSize);
    Object.assign(sun.shadow.camera, {
      left: -24,
      right: 24,
      top: 24,
      bottom: -24,
      near: 0.5,
      far: 75,
    });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 4;
    this.scene.add(sun);
    const forestFloor = groundTexture();
    forestFloor.repeat.set(80, 80);
    forestFloor.anisotropy = 2;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(300, 300),
      new THREE.MeshStandardMaterial({
        color: "#b0b591",
        map: forestFloor,
        roughness: 1,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.07;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.destinationMarker.rotation.x = -Math.PI / 2;
    this.destinationMarker.visible = false;
    this.scene.add(this.destinationMarker);
    this.input = new InputController(() => this.interact());
    this.pointer = new PointerController(
      this.renderer.domElement,
      (dx, dy) => {
        if (!this.paused) this.camera.rotate(dx, dy);
      },
      (delta) => {
        if (!this.paused) this.zoom(delta);
      },
      (x, y) => this.walkToPointer(x, y),
    );
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.renderer.domElement.addEventListener(
      "webglcontextlost",
      this.onContextLost,
    );
    this.renderer.domElement.addEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    this.resize();
  }

  async init() {
    await Promise.all([this.world.init(), this.player.init(this.assets)]);
    if (this.disposed) return;
    this.player.reset();
    this.camera.update(
      0,
      this.player.root.position,
      this.world.colliders,
      true,
    );
    this.ready = true;
    this.multiplayer = new MultiplayerClient({
      sample: () => ({
        x: this.player.root.position.x,
        z: this.player.root.position.z,
        yaw: this.player.root.rotation.y,
        motion: this.paused || this.player.state !== "Walk" ? "Idle" : "Walk",
      }),
      onPresence: (presence) => this.callbacks.onPresence?.(presence),
      onProfile: (profile) => this.callbacks.onProfile?.(profile),
      onLanterns: (state) => {
        this.lanternGarden.setLanterns(state.lanterns);
        this.callbacks.onLanterns?.(state);
      },
      onSelf: (player, reason) => this.receiveSelf(player, reason),
      onPlayers: (players, time) => {
        const ids = new Set(players.map((player) => player.id));
        for (const [id, visitor] of this.visitors)
          if (!ids.has(id)) {
            visitor.dispose();
            this.visitors.delete(id);
          }
        for (const player of players) {
          const existing = this.visitors.get(player.id);
          if (existing) existing.push(player, time);
          else {
            const visitor = new RemotePlayer(player, time);
            this.visitors.set(player.id, visitor);
            this.scene.add(visitor.root);
          }
        }
      },
      onNotice: (message) => {
        this.awaitingPrayer = 0;
        this.callbacks.onNotice?.(message);
      },
    });
    this.multiplayer.connect();
    this.frameId = requestAnimationFrame(this.tick);
  }

  private receiveSelf(
    player: Visitor,
    reason: "welcome" | "snapshot" | "correction",
  ) {
    if (reason === "welcome") {
      this.player.reset();
      this.player.setPosition(player);
      this.player.setTint(player.tint);
      this.synchronizedRitual = null;
      this.pendingVisit = null;
      this.camera.update(
        0,
        this.player.root.position,
        this.world.colliders,
        true,
      );
    }
    if (
      player.motion === "Pray" &&
      player.ritualStartedAt !== null &&
      player.ritualTarget &&
      player.ritualFrom
    ) {
      this.awaitingPrayer = 0;
      if (this.synchronizedRitual !== player.ritualStartedAt) {
        this.player.reset();
        this.player.setPosition(player);
        this.pendingVisit = null;
        this.synchronizedRitual = player.ritualStartedAt;
        const elapsed = Math.max(
          0,
          ((this.multiplayer?.serverNow ?? Date.now()) -
            player.ritualStartedAt) /
            1000,
        );
        this.player.pray(
          () => this.callbacks.onPrayed(),
          player.ritualTarget,
          elapsed,
          player.ritualFrom,
        );
      }
    } else if (player.motion !== "Pray") {
      if (this.synchronizedRitual !== null)
        this.player.synchronizeRitual(RITUAL_DURATION);
      this.synchronizedRitual = null;
      if (reason === "correction") {
        this.player.reset();
        this.player.setPosition(player);
        this.pendingVisit = null;
      }
    }
  }

  private resize() {
    if (this.disposed) return;
    const { width, height } = this.container.getBoundingClientRect();
    this.renderer.setSize(width, height);
    this.camera.resize(width, height);
  }

  private tick = (now: number) => {
    if (this.disposed) return;
    const dt = this.lastTime ? Math.min((now - this.lastTime) / 1000, 0.05) : 0;
    this.lastTime = now;
    if (!document.hidden) {
      this.lanternGarden.update(dt);
      if (!this.paused) {
        if (this.synchronizedRitual !== null)
          this.player.synchronizeRitual(
            Math.max(
              0,
              ((this.multiplayer?.serverNow ?? Date.now()) -
                this.synchronizedRitual) /
                1000,
            ),
          );
        const movement = this.input.update();
        if (movement.lengthSq() > 0.01) this.pendingVisit = null;
        this.player.update(dt, movement, true);
        this.world.update(dt);
      }
      for (const visitor of this.visitors.values())
        visitor.update(
          dt,
          this.multiplayer?.serverNow ?? Date.now(),
          this.player.root.position,
        );
      this.camera.update(dt, this.player.root.position, this.world.colliders);
      this.destinationMarker.visible = this.player.navigating;
      this.interactions.update(
        this.player.root.position.x,
        this.player.root.position.z,
        !this.paused && this.player.state !== "Pray",
      );
      if (!this.paused && this.pendingVisit && !this.player.navigating) {
        const id = this.pendingVisit;
        this.pendingVisit = null;
        if (
          this.interactions.nearby === id &&
          this.player.root.position.distanceTo(APPROACH[id]) < 0.45
        )
          this.interact();
      }
      this.renderer.render(this.scene, this.camera.camera);
      this.updateTime += dt;
      // Vue HUD and projected labels only need 20 updates per second.
      if (this.updateTime >= 0.05 || dt === 0) {
        this.updateTime = 0;
        this.publish();
      }
    }
    this.frameId = requestAnimationFrame(this.tick);
  };

  private publish() {
    this.callbacks.onUpdate({
      nearby: this.interactions.nearby,
      state: this.player.state,
      ritualStep: this.player.ritualStep,
      ritualProgress: this.player.ritualProgress,
      player: {
        x: this.player.root.position.x,
        z: this.player.root.position.z,
      },
      destination: this.pendingVisit,
    });
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.callbacks.onLabels(
      INTERACTIONS.map((point) => {
        const y =
          point.id === "offering"
            ? 3.5 * HALL_LAYOUT.scale.y
            : point.id === "lantern"
              ? 5.3
              : 4.2;
        this.marker
          .set(point.position.x, y, point.position.z - 0.6)
          .project(this.camera.camera);
        return {
          id: point.id,
          x: ((this.marker.x + 1) * width) / 2,
          y: ((-this.marker.y + 1) * height) / 2,
          visible:
            this.marker.z >= -1 &&
            this.marker.z <= 1 &&
            Math.abs(this.marker.x) < 0.95 &&
            Math.abs(this.marker.y) < 0.9,
        };
      }),
    );
    this.callbacks.onVisitors?.(
      [...this.visitors.values()].map((visitor) => {
        this.marker.copy(visitor.root.position).y += 2.5;
        this.marker.project(this.camera.camera);
        return {
          id: visitor.id,
          name: visitor.name,
          tint: "#d9dfc1",
          x: ((this.marker.x + 1) * width) / 2,
          y: ((-this.marker.y + 1) * height) / 2,
          visible:
            this.marker.z >= -1 &&
            this.marker.z <= 1 &&
            Math.abs(this.marker.x) < 0.95 &&
            Math.abs(this.marker.y) < 0.9,
        };
      }),
    );
  }

  interact() {
    if (!this.ready || this.paused || this.player.state === "Pray") return;
    // Re-evaluate proximity for clicks that arrive between HUD updates.
    this.interactions.update(
      this.player.root.position.x,
      this.player.root.position.z,
      true,
    );
    if (!this.interactions.nearby) return;
    this.pendingVisit = null;
    this.player.cancelNavigation();
    this.input.clear();
    switch (this.interactions.nearby) {
      case "lantern":
        this.callbacks.onLantern?.();
        break;
      case "offering":
        this.input.clear();
        if (this.multiplayer?.connected) {
          if (Date.now() - this.awaitingPrayer > 2000) {
            this.awaitingPrayer = Date.now();
            this.multiplayer.pray();
          }
          break;
        }
        this.player.pray(() => this.callbacks.onPrayed());
        break;
      case "fortune":
        this.multiplayer?.activity("fortune");
        this.callbacks.onFortune();
        break;
      case "ema":
        this.multiplayer?.activity("ema");
        this.callbacks.onEma();
        break;
    }
  }

  private walkToPointer(x: number, y: number) {
    if (!this.ready || this.paused || this.player.state === "Pray") return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerPosition.set(
      ((x - rect.left) / rect.width) * 2 - 1,
      (-(y - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerPosition, this.camera.camera);
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, this.groundHit))
      return;
    // A click on a visible obstacle should not send the player to the floor behind it.
    const occluder = this.raycaster.intersectObject(this.world.root, true)[0];
    if (
      occluder &&
      occluder.point.y > 0.4 &&
      occluder.distance <
        this.groundHit.distanceTo(this.camera.camera.position) - 0.2
    )
      return;
    this.pendingVisit = null;
    if (this.player.navigate(this.groundHit)) {
      this.destinationMarker.position.copy(this.groundHit).y = 0.16;
    } else
      this.callbacks.onNotice?.("石畳や境内の空いている場所を選んでください。");
  }

  visit(id: InteractionId) {
    if (!this.ready || this.paused || this.player.state === "Pray") return;
    this.input.clear();
    this.pendingVisit = null;
    this.player.cancelNavigation();
    if (this.interactions.nearby === id) {
      this.interact();
      return;
    }
    if (this.player.navigate(APPROACH[id])) {
      this.pendingVisit = id;
      this.destinationMarker.position.copy(APPROACH[id]).y = 0.16;
    } else
      this.callbacks.onNotice?.(
        "ここからは道が見つかりません。石畳からもう一度お試しください。",
      );
  }

  setTouch(x: number, y: number) {
    this.input.setTouch(x, y);
  }
  setPaused(value: boolean) {
    this.paused = value;
    this.input.clear();
    this.pointer.clear();
    this.lastTime = 0;
  }
  zoom(delta: number) {
    this.camera.setZoom(delta);
    this.camera.update(0, this.player.root.position, this.world.colliders);
    this.publish();
  }
  reset() {
    this.input.clear();
    this.awaitingPrayer = 0;
    this.player.cancelNavigation();
    if (!this.multiplayer?.reset()) {
      this.synchronizedRitual = null;
      this.player.reset();
    }
    this.pendingVisit = null;
    this.camera.reset(this.player.root.position);
    this.publish();
  }

  joinRoom(room: string) {
    return this.multiplayer?.joinRoom(room) ?? false;
  }
  hangLantern(
    productId: string,
    wish: string,
    signature: string,
    slot: number | null,
  ) {
    return (
      this.multiplayer?.hangLantern(productId, wish, signature, slot) ??
      Promise.resolve({
        ok: false,
        message: "境内につながると、灯籠をかけられます。",
      })
    );
  }
  removeLantern(id: string) {
    return (
      this.multiplayer?.removeLantern(id) ??
      Promise.resolve({
        ok: false,
        message: "境内につながると、ご自身の灯籠を確認できます。",
      })
    );
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.multiplayer?.dispose();
    this.lanternGarden.dispose();
    for (const visitor of this.visitors.values()) visitor.dispose();
    this.visitors.clear();
    cancelAnimationFrame(this.frameId);
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.input.dispose();
    this.pointer.dispose();
    this.assets.dispose();
    this.player.dispose();
    this.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.onContextLost,
    );
    this.renderer.domElement.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    disposeObject(this.scene);
    this.scene.clear();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
