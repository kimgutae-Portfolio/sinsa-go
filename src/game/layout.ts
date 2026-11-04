/** Shared dimensions keep the enlarged building, collisions and ritual in sync. */
export const HALL_LAYOUT = {
  position: { x: 0, z: -9.35 },
  scale: { x: 2, y: 1.4, z: 1.3 },
  footprint: { width: 19.6, depth: 9.36, height: 8.7 },
  steps: { x: 0, z: -4.54, width: 9.6, depth: 1.04, height: 1.05 },
  porchPosts: [
    { x: -2.9, z: -3.63 },
    { x: 2.9, z: -3.63 },
  ],
} as const;

export const OFFERING_LAYOUT = {
  position: { x: 0, z: -3.15 },
  scale: { x: 1.3, y: 1.05, z: 1.15 },
  footprint: { width: 3.77, depth: 1.265, height: 1.4 },
  interaction: { x: 0, z: -2.45 },
  ritual: { x: 0, z: -1.55 },
} as const;

export const FORECOURT = {
  minX: -6.5,
  maxX: 6.5,
  minZ: -4.46,
  maxZ: 1.075,
} as const;

export const LANTERN_LAYOUT = {
  x: 7.4,
  z: 1.6,
  width: 6.2,
  depth: 0.7,
  height: 4.9,
  approach: { x: 7.4, z: 3.2 },
  columns: 8,
  rows: 3,
} as const;
