export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface LabelInput {
  id: string;
  /** Anchor point: the label's bottom-centre sits here (translate(-50%, -100%)). */
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  /** Placed first, e.g. the place the visitor is standing next to. */
  priority?: boolean;
}
export interface LabelPlacement {
  id: string;
  /** Upward shift in px (<= 0); the leader line grows by the same amount. */
  offset: number;
  visible: boolean;
}

const GAP = 4;

function overlaps(a: Box, b: Box) {
  return (
    a.left < b.right + GAP &&
    a.right + GAP > b.left &&
    a.top < b.bottom + GAP &&
    a.bottom + GAP > b.top
  );
}

/**
 * Keeps projected place labels from covering HUD panels or each other.
 * Each label may rise a few steps above its anchor; if it still collides it is hidden
 * for this frame (the bottom menu still offers every place).
 */
export function layoutLabels(
  labels: LabelInput[],
  blockers: Box[],
  step = 30,
  maxSteps = 3,
): LabelPlacement[] {
  const placed: Box[] = [];
  const result = new Map<string, LabelPlacement>();
  // Priority first, then labels lower on screen (nearer the viewer) win.
  const order = [...labels].sort(
    (a, b) => Number(!!b.priority) - Number(!!a.priority) || b.y - a.y,
  );
  for (const label of order) {
    let placement: LabelPlacement = { id: label.id, offset: 0, visible: false };
    if (label.visible)
      for (let k = 0; k <= maxSteps; k++) {
        const offset = k ? -k * step : 0;
        const box = {
          left: label.x - label.width / 2,
          right: label.x + label.width / 2,
          top: label.y - label.height + offset,
          bottom: label.y + offset,
        };
        if (box.top < 0) break;
        if (
          blockers.some((blocker) => overlaps(box, blocker)) ||
          placed.some((other) => overlaps(box, other))
        )
          continue;
        placed.push(box);
        placement = { id: label.id, offset, visible: true };
        break;
      }
    result.set(label.id, placement);
  }
  return labels.map((label) => result.get(label.id)!);
}
