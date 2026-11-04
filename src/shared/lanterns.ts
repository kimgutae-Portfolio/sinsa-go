/** Public product descriptions. Availability and issuance are enforced on the server. */
export const LANTERN_PRODUCTS = [
  {
    id: "paper-warm",
    name: "こもれびの灯",
    color: "#edbc78",
    subtitle: "あたたかな想いを込めて",
    availability: "available",
  },
  {
    id: "paper-sakura",
    name: "さくらの灯",
    color: "#dfa6a0",
    subtitle: "やさしい願いを込めて",
    availability: "available",
  },
  {
    id: "paper-leaf",
    name: "若葉の灯",
    color: "#b1c197",
    subtitle: "穏やかな一日を願って",
    availability: "available",
  },
  {
    id: "festival-gold",
    name: "祭りの灯",
    color: "#dbb65e",
    subtitle: "特別な灯籠は準備中です",
    availability: "planned",
  },
] as const;
export type LanternProductId = (typeof LANTERN_PRODUCTS)[number]["id"];
export interface PublicLantern {
  id: string;
  productId: LanternProductId;
  slot: number;
  wish: string;
  signature: string;
  createdAt: number;
  expiresAt: number;
}
export interface LanternPolicy {
  mode: "free" | "paid";
  durationHours: number;
  maxPerVisitor: number;
  capacity: number;
}
export interface LanternState {
  room: string;
  lanterns: PublicLantern[];
  mineIds: string[];
  policy: LanternPolicy;
}
export const FREE_LANTERN_POLICY: LanternPolicy = {
  mode: "free",
  durationHours: 24,
  maxPerVisitor: 1,
  capacity: 24,
};
export const MAX_WISH_LENGTH = 36;
export const MAX_SIGNATURE_LENGTH = 12;
export function lanternProduct(id: unknown) {
  return LANTERN_PRODUCTS.find((product) => product.id === id);
}
export function cleanLanternText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(text).length <= max ? text : null;
}
export function validPublicLantern(value: unknown): value is PublicLantern {
  if (!value || typeof value !== "object") return false;
  const item = value as PublicLantern;
  return (
    typeof item.id === "string" &&
    item.id.length <= 64 &&
    Boolean(lanternProduct(item.productId)) &&
    Number.isInteger(item.slot) &&
    item.slot >= 0 &&
    item.slot < 24 &&
    typeof item.wish === "string" &&
    Array.from(item.wish).length <= MAX_WISH_LENGTH &&
    typeof item.signature === "string" &&
    Array.from(item.signature).length <= MAX_SIGNATURE_LENGTH &&
    Number.isFinite(item.createdAt) &&
    Number.isFinite(item.expiresAt) &&
    item.expiresAt > item.createdAt
  );
}
