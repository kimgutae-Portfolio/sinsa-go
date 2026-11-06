import { describe, expect, it, vi } from "vitest";
import { Group, InstancedMesh, Material, Mesh } from "three";
import { EmaBoard } from "../src/game/EmaBoard";
import type { PublicLantern } from "../src/shared/lanterns";

const ema: PublicLantern = {
  id: "a-real-wish",
  productId: "paper-warm",
  slot: 0,
  wish: "心おだやかに過ごせますように",
  signature: "旅人",
  createdAt: 1,
  expiresAt: 2,
};

describe("ema rack furnishings", () => {
  it("welcomes an empty rack without inventing visitor ema and clears the invitation for every occupied slot", () => {
    const board = new EmaBoard();
    const invitation = board.root.getObjectByName("EmaEmptyInvitation") as Group;
    const instances = board.root.children.filter((object): object is InstancedMesh => object instanceof InstancedMesh);
    expect(invitation.visible).toBe(true);
    expect(instances).toHaveLength(3);
    expect(instances.every((object) => object.count === 0)).toBe(true);
    const decorations = board.root.getObjectByName("EmaScenery")!;
    for (let slot = 0; slot < 24; slot++) {
      board.setEma([{ ...ema, slot }]);
      expect(invitation.visible).toBe(false);
      expect(decorations.visible).toBe(true);
      expect(instances.every((object) => object.count === 1)).toBe(true);
    }
    board.setEma([]);
    expect(invitation.visible).toBe(true);
    expect(instances.every((object) => object.count === 0)).toBe(true);
    board.dispose();
  });

  it("retains its scenery across updates and releases the decorations with the board", () => {
    const board = new EmaBoard();
    const scenery = board.root.getObjectByName("EmaScenery")!;
    const geometries = new Set<Mesh["geometry"]>();
    const materials = new Set<Material>();
    scenery.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    });
    const disposal = [...geometries, ...materials].map((resource) => vi.spyOn(resource, "dispose"));
    board.setEma([ema]);
    for (let i = 0; i < 120; i++) board.update(1 / 60);
    expect(board.root.getObjectByName("EmaScenery")).toBe(scenery);
    board.dispose();
    for (const dispose of disposal) expect(dispose).toHaveBeenCalledOnce();
    expect(board.root.children).toHaveLength(0);
  });
});
