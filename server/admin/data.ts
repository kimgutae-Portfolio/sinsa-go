import type {
  AdminLantern,
  AdminOverview,
  AdminPage,
  AdminUser,
  AdminUserDetail,
} from "../../src/shared/admin";
import type { ShrineRooms } from "../rooms";
import { visitorDay } from "../visitors/service";

export function adminSnapshot(rooms: ShrineRooms, now: number) {
  rooms.stats.pulse(now);
  const profiles = rooms.stats.administration();
  const owners = new Map(
    profiles.map((profile) => [profile.ownerHash, profile.visitorId]),
  );
  const lanterns: AdminLantern[] = rooms.lanterns
    .administration()
    .map(
      ({
        id,
        productId,
        slot,
        wish,
        signature,
        createdAt,
        expiresAt,
        room,
        ownerHash,
      }) => ({
        id,
        productId,
        slot,
        wish,
        signature,
        createdAt,
        expiresAt,
        room,
        visitorId: owners.get(ownerHash) ?? null,
        status: expiresAt > now ? "active" : "expired",
        reports: rooms.lanterns.reportCount(id),
      }),
    );
  const activeCounts = new Map<string, number>(),
    expiredCounts = new Map<string, number>();
  for (const lantern of lanterns)
    if (lantern.visitorId) {
      const counts = lantern.status === "active" ? activeCounts : expiredCounts;
      counts.set(lantern.visitorId, (counts.get(lantern.visitorId) ?? 0) + 1);
    }
  const users: AdminUser[] = profiles.map(
    ({ ownerHash: _owner, daily: _daily, ...profile }) => ({
      ...profile,
      activeLanternCount: activeCounts.get(profile.visitorId) ?? 0,
      expiredLanternCount: expiredCounts.get(profile.visitorId) ?? 0,
    }),
  );
  const daily: AdminOverview["daily"] = Array.from({ length: 7 }, (_, i) => ({
    day: visitorDay(now - (6 - i) * 86400000),
    connections: 0,
    visits: 0,
    prayers: 0,
    lanterns: 0,
  }));
  for (const profile of profiles)
    for (const day of daily) {
      const value = profile.daily[day.day];
      if (value) {
        day.connections += value.connectionCount;
        day.visits += value.visitCount;
        day.prayers += value.prayerCount;
        day.lanterns += value.lanternHangCount;
      }
    }
  const overview: AdminOverview = {
    asOf: now,
    totals: {
      users: users.length,
      onlineUsers: users.filter((user) => user.online).length,
      connections: users.reduce((sum, user) => sum + user.connectionCount, 0),
      visits: users.reduce((sum, user) => sum + user.visitCount, 0),
      prayers: users.reduce((sum, user) => sum + user.prayerCount, 0),
      activeLanterns: lanterns.filter((item) => item.status === "active")
        .length,
      retainedExpiredLanterns: lanterns.filter(
        (item) => item.status === "expired",
      ).length,
      lanternsHung: users.reduce((sum, user) => sum + user.lanternHangCount, 0),
    },
    daily,
  };
  return {
    users,
    lanterns,
    overview,
    detail(id: string): AdminUserDetail | null {
      const user = users.find((item) => item.visitorId === id);
      if (!user) return null;
      const profile = profiles.find((item) => item.visitorId === id)!;
      return {
        user,
        lanterns: lanterns.filter((item) => item.visitorId === id),
        daily: Object.entries(profile.daily)
          .sort(([a], [b]) => b.localeCompare(a))
          .slice(0, 30)
          .map(([day, counters]) => ({ day, counters })),
      };
    },
  };
}
export function userRows(users: AdminUser[], params: URLSearchParams) {
  const query = (params.get("q") ?? "").slice(0, 100).trim().toLowerCase();
  const presence = params.get("presence");
  const active = params.get("lanterns") === "active";
  const rows = users.filter(
    (user) =>
      (!query ||
        `${user.visitorId} ${user.lastRoom}`.toLowerCase().includes(query)) &&
      (presence !== "online" || user.online) &&
      (presence !== "offline" || !user.online) &&
      (!active || user.activeLanternCount > 0),
  );
  const keys = {
    connections: "connectionCount",
    prayers: "prayerCount",
    lanterns: "activeLanternCount",
    lastSeen: "lastSeenAt",
  } as const;
  const key = keys[params.get("sort") as keyof typeof keys] ?? "lastSeenAt";
  const direction = params.get("direction") === "asc" ? 1 : -1;
  return rows.sort(
    (a, b) =>
      (a[key] - b[key]) * direction || a.visitorId.localeCompare(b.visitorId),
  );
}
export function lanternRows(lanterns: AdminLantern[], params: URLSearchParams) {
  const query = (params.get("q") ?? "").slice(0, 100).trim().toLowerCase();
  const status = params.get("status") ?? "active";
  return lanterns
    .filter(
      (item) =>
        (status === "all" || item.status === status) &&
        (!query ||
          `${item.wish} ${item.signature} ${item.room} ${item.visitorId ?? ""}`
            .toLowerCase()
            .includes(query)),
    )
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}
export function paginate<T>(
  items: T[],
  params: URLSearchParams,
  now: number,
): AdminPage<T> {
  const requested = Number(params.get("page") ?? 1),
    size = Number(params.get("pageSize") ?? 20);
  const pageSize = Number.isSafeInteger(size)
    ? Math.min(100, Math.max(1, size))
    : 20;
  const page = Math.min(
    Math.max(1, Math.ceil(items.length / pageSize)),
    Number.isSafeInteger(requested) ? Math.max(1, requested) : 1,
  );
  return {
    items: items.slice((page - 1) * pageSize, page * pageSize),
    total: items.length,
    page,
    pageSize,
    asOf: now,
  };
}
export function usersCsv(users: AdminUser[]) {
  const cell = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const headers = [
    "ユーザーID",
    "接続回数",
    "訪問回数",
    "参拝回数",
    "掲示中の絵馬",
    "累計掲示数",
    "おみくじ回数",
    "絵馬閲覧回数",
    "滞在時間（分）",
    "最終ルーム",
    "初回訪問（日本時間）",
    "最終訪問（日本時間）",
  ];
  const date = (time: number) =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
      dateStyle: "short",
      timeStyle: "medium",
    }).format(time);
  return (
    "\uFEFF" +
    [
      headers.map(cell).join(","),
      ...users.map((user) =>
        [
          user.visitorId,
          user.connectionCount,
          user.visitCount,
          user.prayerCount,
          user.activeLanternCount,
          user.lanternHangCount,
          user.fortuneCount,
          user.emaViewCount,
          Math.floor(user.connectedMs / 60000),
          user.lastRoom,
          date(user.firstSeenAt),
          date(user.lastSeenAt),
        ]
          .map(cell)
          .join(","),
      ),
    ].join("\r\n")
  );
}
