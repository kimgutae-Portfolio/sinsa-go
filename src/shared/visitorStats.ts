export const VISITOR_COUNTERS = [
  "connectionCount",
  "visitCount",
  "prayerCount",
  "fortuneCount",
  "emaViewCount",
  "lanternHangCount",
  "lanternRemoveCount",
  "connectedMs",
] as const;
export type VisitorCounter = (typeof VISITOR_COUNTERS)[number];
export type VisitorCounters = Record<VisitorCounter, number>;
/** Sent only to the visitor owning the browser key, never to the room. */
export interface VisitorSummary extends VisitorCounters {
  visitorId: string;
  firstSeenAt: number;
  lastSeenAt: number;
  lastRoom: string;
}
export function emptyVisitorCounters(): VisitorCounters {
  return {
    connectionCount: 0,
    visitCount: 0,
    prayerCount: 0,
    fortuneCount: 0,
    emaViewCount: 0,
    lanternHangCount: 0,
    lanternRemoveCount: 0,
    connectedMs: 0,
  };
}
export function validVisitorCounters(value: unknown): value is VisitorCounters {
  if (!value || typeof value !== "object") return false;
  return VISITOR_COUNTERS.every(
    (key) =>
      Number.isSafeInteger((value as VisitorCounters)[key]) &&
      (value as VisitorCounters)[key] >= 0,
  );
}
export function validVisitorSummary(value: unknown): value is VisitorSummary {
  if (!validVisitorCounters(value)) return false;
  const item = value as VisitorSummary;
  return (
    typeof item.visitorId === "string" &&
    item.visitorId.length > 0 &&
    item.visitorId.length <= 64 &&
    Number.isSafeInteger(item.firstSeenAt) &&
    item.firstSeenAt >= 0 &&
    Number.isSafeInteger(item.lastSeenAt) &&
    item.lastSeenAt >= item.firstSeenAt &&
    typeof item.lastRoom === "string" &&
    /^[a-z0-9_-]{1,32}$/.test(item.lastRoom)
  );
}
