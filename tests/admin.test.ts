import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createShrineServer } from "../server/app";
import { hashAdminPassword, type AdminCredential } from "../server/admin/auth";
import { VisitorStatsService } from "../server/visitors/service";
import { MemoryVisitorRepository } from "../server/visitors/repository";
import { LanternService } from "../server/lanterns/service";
import { MemoryLanternRepository } from "../server/lanterns/repository";
import { usersCsv, adminSnapshot } from "../server/admin/data";
import type {
  AdminLantern,
  AdminOverview,
  AdminPage,
  AdminSession,
  AdminUser,
  AdminUserDetail,
} from "../src/shared/admin";
const password = "test-only-admin-password-12345";
const credential = hashAdminPassword(password);
const owner = (key: string) => createHash("sha256").update(key).digest("hex");
let app: ReturnType<typeof createShrineServer>,
  base: string,
  clock: number,
  configured: AdminCredential | null;
let aId: string, bId: string;
beforeEach(async () => {
  clock = Date.UTC(2026, 10, 4, 3);
  configured = credential;
  const stats = new VisitorStatsService(new MemoryVisitorRepository(), {
    saveIntervalMs: 0,
  });
  stats.begin(owner("a"), "a-first", "forest", clock - 4000);
  stats.end("a-first", clock - 3000);
  stats.begin(owner("a"), "a-second", "forest", clock - 1000);
  stats.begin(owner("b"), "b-first", "pond", clock - 5000);
  stats.end("b-first", clock - 1000);
  for (let i = 0; i < 2; i++) stats.record(owner("a"), "prayerCount", clock);
  for (let i = 0; i < 4; i++) stats.record(owner("b"), "prayerCount", clock);
  stats.record(owner("a"), "lanternHangCount", clock);
  stats.record(owner("b"), "lanternHangCount", clock - 1000);
  aId = stats.summary(owner("a"))!.visitorId;
  bId = stats.summary(owner("b"))!.visitorId;
  const repo = new MemoryLanternRepository();
  const seed = new LanternService(repo);
  await seed.execute(
    {
      kind: "hang",
      room: "forest",
      ownerHash: owner("a"),
      requestId: "request-admin-seed",
      productId: "paper-sakura",
      wish: "穏やかな一日になりますように。",
      signature: "旅人",
      slot: 3,
    },
    clock,
  );
  await repo.save([
    ...repo.load(),
    {
      id: "expired-lantern",
      ownerHash: owner("b"),
      room: "pond",
      requestId: "request-old-seed",
      issuance: "free",
      productId: "paper-warm",
      slot: 2,
      wish: "元気でありますように。",
      signature: "名無しの旅人",
      createdAt: clock - 25 * 3600000,
      expiresAt: clock - 3600000,
    },
  ]);
  app = createShrineServer({
    stats,
    lanterns: new LanternService(repo),
    adminCredential: () => configured,
    now: () => clock,
  });
  await new Promise<void>((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  const address = app.server.address();
  if (!address || typeof address === "string") throw Error("No port");
  base = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await app.close();
});
async function login() {
  const response = await fetch(base + "/api/admin/login", {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  expect(response.status).toBe(200);
  return {
    cookie: response.headers.get("set-cookie")!.split(";")[0]!,
    session: (await response.json()) as AdminSession,
    response,
  };
}
async function get<T>(path: string, cookie: string) {
  const response = await fetch(base + "/api/admin/" + path, {
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

describe("authenticated administrator API", () => {
  it("does not expose visitor or lantern data without authentication", async () => {
    for (const path of [
      "overview",
      "users",
      "lanterns",
      "users.csv",
      "users/" + aId,
    ]) {
      const response = await fetch(base + "/api/admin/" + path);
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).not.toContain(aId);
      expect(text).not.toContain(owner("a"));
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const redirect = await fetch(base + "/admin/?view=users", {
      redirect: "manual",
    });
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get("location")).toBe("/admin?view=users");
    expect(await get<AdminSession>("session", "")).toMatchObject({
      configured: true,
      authenticated: false,
    });
  });
  it("authenticates using a private strict cookie and returns no password material", async () => {
    const { session, response, cookie } = await login();
    expect(session).toMatchObject({ authenticated: true, configured: true });
    expect(session.csrfToken).toBeTruthy();
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("set-cookie")).toContain("Path=/api/admin");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(session)).not.toContain(password);
    expect(JSON.stringify(session)).not.toContain(credential.hash);
    expect(await get<AdminSession>("session", cookie)).toMatchObject({
      authenticated: true,
    });
  });
  it("rejects missing or foreign origins and invalid or oversized login payloads", async () => {
    for (const origin of ["", "https://untrusted.example"]) {
      const response = await fetch(base + "/api/admin/login", {
        method: "POST",
        headers: {
          ...(origin ? { Origin: origin } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      expect(response.status).toBe(403);
    }
    expect(
      (
        await fetch(base + "/api/admin/login", {
          method: "POST",
          headers: { Origin: base, "Content-Type": "application/json" },
          body: "{bad",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(base + "/api/admin/login", {
          method: "POST",
          headers: { Origin: base, "Content-Type": "text/plain" },
          body: password,
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await fetch(base + "/api/admin/login", {
          method: "POST",
          headers: { Origin: base, "Content-Type": "application/json" },
          body: JSON.stringify({ password: "x".repeat(3000) }),
        })
      ).status,
    ).toBe(413);
  });
  it("rate limits failed logins and allows retry after the cooldown", async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (
          await fetch(base + "/api/admin/login", {
            method: "POST",
            headers: { Origin: base, "Content-Type": "application/json" },
            body: JSON.stringify({ password: "wrong" }),
          })
        ).status,
      ).toBe(401);
    const blocked = await fetch(base + "/api/admin/login", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("900");
    clock += 15 * 60000;
    await login();
  });
  it("aggregates visits, prayers, online users, and active versus retained expired lanterns", async () => {
    const { cookie } = await login();
    const overview = await get<AdminOverview>("overview", cookie);
    expect(overview.totals).toEqual({
      users: 2,
      onlineUsers: 1,
      connections: 3,
      visits: 2,
      prayers: 6,
      activeLanterns: 1,
      retainedExpiredLanterns: 1,
      lanternsHung: 2,
    });
    expect(overview.daily).toHaveLength(7);
    expect(overview.daily.at(-1)).toMatchObject({ connections: 3, prayers: 6 });
  });
  it("searches, sorts, filters and paginates users while excluding ownership secrets", async () => {
    const { cookie } = await login();
    const first = await get<AdminPage<AdminUser>>(
      "users?sort=prayers&pageSize=1",
      cookie,
    );
    expect(first.total).toBe(2);
    expect(first.items[0]!.visitorId).toBe(bId);
    expect(
      (
        await get<AdminPage<AdminUser>>(
          "users?sort=connections&direction=desc",
          cookie,
        )
      ).items[0]!.visitorId,
    ).toBe(aId);
    expect(
      (
        await get<AdminPage<AdminUser>>("users?presence=online", cookie)
      ).items.map((item) => item.visitorId),
    ).toEqual([aId]);
    expect(
      (
        await get<AdminPage<AdminUser>>("users?lanterns=active", cookie)
      ).items.map((item) => item.visitorId),
    ).toEqual([aId]);
    expect(
      (await get<AdminPage<AdminUser>>("users?q=pond", cookie)).items.map(
        (item) => item.visitorId,
      ),
    ).toEqual([bId]);
    const second = await get<AdminPage<AdminUser>>(
      "users?sort=prayers&pageSize=1&page=2",
      cookie,
    );
    expect(second.items[0]!.visitorId).toBe(aId);
    expect(JSON.stringify(second)).not.toContain("ownerHash");
    expect(JSON.stringify(second)).not.toContain("accountId");
    expect(JSON.stringify(second)).not.toContain(owner("a"));
  });
  it("joins lanterns to their visitor and returns user details and daily records", async () => {
    const { cookie } = await login();
    const active = await get<AdminPage<AdminLantern>>("lanterns", cookie);
    expect(active.total).toBe(1);
    expect(active.items[0]).toMatchObject({
      visitorId: aId,
      room: "forest",
      status: "active",
    });
    const expired = await get<AdminPage<AdminLantern>>(
      "lanterns?status=expired",
      cookie,
    );
    expect(expired.items[0]).toMatchObject({
      visitorId: bId,
      status: "expired",
    });
    expect(
      (await get<AdminPage<AdminLantern>>("lanterns?status=all&q=元気", cookie))
        .total,
    ).toBe(1);
    const detail = await get<AdminUserDetail>("users/" + aId, cookie);
    expect(detail.user.prayerCount).toBe(2);
    expect(detail.lanterns).toHaveLength(1);
    expect(detail.daily[0]!.counters.connectionCount).toBe(2);
    expect(JSON.stringify(detail)).not.toContain("ownerHash");
    expect(
      (
        await fetch(base + "/api/admin/users/missing", {
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(404);
  });
  it("exports authenticated CSV and neutralizes spreadsheet formulas", async () => {
    const { cookie } = await login();
    const response = await fetch(base + "/api/admin/users.csv?q=forest", {
      headers: { Cookie: cookie },
    });
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    const body = await response.text();
    expect(body).toContain("接続回数");
    expect(body).toContain(aId);
    expect(body).not.toContain(bId);
    expect(body).not.toContain(owner("a"));
    const snapshot = adminSnapshot(app.rooms, clock);
    expect(usersCsv([{ ...snapshot.users[0]!, lastRoom: "=1+1" }])).toContain(
      "'=1+1",
    );
  });
  it("requires a CSRF token for logout and invalidates the cookie after logout", async () => {
    const { cookie, session } = await login();
    expect(
      (
        await fetch(base + "/api/admin/logout", {
          method: "POST",
          headers: { Cookie: cookie, Origin: base },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(base + "/api/admin/logout", {
          method: "POST",
          headers: {
            Cookie: cookie,
            Origin: "https://evil.example",
            "X-CSRF-Token": session.csrfToken!,
          },
        })
      ).status,
    ).toBe(403);
    const out = await fetch(base + "/api/admin/logout", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: base,
        "X-CSRF-Token": session.csrfToken!,
      },
    });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(
      (await fetch(base + "/api/admin/users", { headers: { Cookie: cookie } }))
        .status,
    ).toBe(401);
  });
  it("expires inactive sessions and uses Secure cookies when served through HTTPS", async () => {
    const { cookie } = await login();
    clock += 30 * 60000;
    expect(
      (await fetch(base + "/api/admin/users", { headers: { Cookie: cookie } }))
        .status,
    ).toBe(401);
    const secure = await fetch(base + "/api/admin/login", {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({ password }),
    });
    expect(secure.status).toBe(200);
    expect(secure.headers.get("set-cookie")).toContain("; Secure");
  });
  it("revokes existing sessions if credentials are disabled or changed", async () => {
    const first = await login();
    configured = null;
    expect(
      (
        await fetch(base + "/api/admin/users", {
          headers: { Cookie: first.cookie },
        })
      ).status,
    ).toBe(401);
    configured = credential;
    const second = await login();
    configured = hashAdminPassword("another-test-only-password-67890");
    expect(
      (
        await fetch(base + "/api/admin/users", {
          headers: { Cookie: second.cookie },
        })
      ).status,
    ).toBe(401);
  });
  it("enforces the eight-hour maximum even while the session is being used", async () => {
    const { cookie } = await login();
    for (let i = 0; i < 23; i++) {
      clock += 20 * 60000;
      expect(await get<AdminSession>("session", cookie)).toMatchObject({
        authenticated: true,
      });
    }
    clock += 20 * 60000;
    expect(await get<AdminSession>("session", cookie)).toMatchObject({
      authenticated: false,
    });
  });
  it("leaves the dashboard locked until an administrator credential is configured", async () => {
    configured = null;
    expect(await get<AdminSession>("session", "")).toEqual({
      configured: false,
      authenticated: false,
    });
    const response = await fetch(base + "/api/admin/login", {
      method: "POST",
      headers: { Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    expect(response.status).toBe(503);
    expect(
      (await fetch(base + "/data/admin-password.txt")).headers.get(
        "content-type",
      ),
    ).not.toContain("text/plain");
  });
});
