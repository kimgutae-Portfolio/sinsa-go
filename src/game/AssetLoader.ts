import { AnimationClip, Group, Mesh } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { disposeObject } from "./geometry";

export type AssetId =
  "torii" | "hall" | "offering" | "fortune" | "ema" | "tree" | "player";
export interface AssetDefinition {
  url: string;
  scale?: number;
  rotationY?: number;
}
/** Add a model URL here to replace a fallback. Ground pivot at y=0; front faces +Z. */
export const ASSET_MANIFEST: Partial<Record<AssetId, AssetDefinition>> = {
  // hall: { url: `${import.meta.env.BASE_URL}models/hall.glb`, scale: 1, rotationY: 0 },
  // player: { url: `${import.meta.env.BASE_URL}models/player.glb`, scale: 1 },
};
export interface LoadedAsset {
  object: Group;
  clips: AnimationClip[];
  fallback: boolean;
}

export class AssetLoader {
  private loader = new GLTFLoader();
  private disposed = false;

  async load(id: AssetId, createFallback: () => Group): Promise<LoadedAsset> {
    const definition = ASSET_MANIFEST[id];
    if (definition) {
      try {
        const gltf = await this.loader.loadAsync(definition.url);
        if (this.disposed) {
          // A late model belongs to the old load, not a newly mounted garden.
          disposeObject(gltf.scene, false);
          return { object: new Group(), clips: [], fallback: false };
        }
        gltf.scene.scale.setScalar(definition.scale ?? 1);
        gltf.scene.rotation.y = definition.rotationY ?? 0;
        gltf.scene.traverse((object) => {
          if (object instanceof Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        return { object: gltf.scene, clips: gltf.animations, fallback: false };
      } catch (error) {
        if (!this.disposed)
          console.warn(
            `[AssetLoader] ${id}: using procedural fallback.`,
            error,
          );
      }
    }
    return {
      object: this.disposed ? new Group() : createFallback(),
      clips: [],
      fallback: true,
    };
  }

  dispose() {
    this.disposed = true;
  }
}
