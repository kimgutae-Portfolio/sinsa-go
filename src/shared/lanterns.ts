/**
 * Public ema designs. Internal ids keep the original "lantern" names so stored
 * records stay compatible. Availability and issuance are enforced on the server.
 */
export const LANTERN_PRODUCTS = [
  {
    id: "paper-warm",
    name: "木漏れ日",
    color: "#e2b45c",
    subtitle: "あたたかな想いを込めて",
    availability: "available" as "available" | "planned",
  },
  {
    id: "paper-sakura",
    name: "桜",
    color: "#d98d8b",
    subtitle: "やさしい願いを込めて",
    availability: "available" as "available" | "planned",
  },
  {
    id: "paper-leaf",
    name: "若葉",
    color: "#8fa874",
    subtitle: "穏やかな一日を願って",
    availability: "available" as "available" | "planned",
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
