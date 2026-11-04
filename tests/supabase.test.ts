import { describe, expect, it, vi } from "vitest";
import { ShrineDatabase, supabaseConfig, openSupabaseRepositories, encodeRecord } from "../server/storage/supabase";
import { emptyVisitorCounters } from "../src/shared/visitorStats";
import type { StoredVisitor } from "../server/visitors/repository";
import type { StoredLantern } from "../server/lanterns/repository";
import { VisitorStatsService } from "../server/visitors/service";
import { LanternService } from "../server/lanterns/service";

const config = { url: "https://example.supabase.co", key: "sb_secret_private_test" };
const visitor = (index = 1): StoredVisitor => ({
  visitorId: `visitor-${index}`, ownerHash: index.toString(16).padStart(64, '0'), accountId: null,
  firstSeenAt: 1000, lastSeenAt: 1000, lastRoom: "garden", ...emptyVisitorCounters(), daily: {},
});
const lantern: StoredLantern = { id: "lantern-1", room: "garden", ownerHash: visitor().ownerHash,
  productId: "paper-warm", slot: 0, wish: "よい一日を", signature: "旅人", createdAt: 1000,
  expiresAt: 100000, issuance: "free", requestId: "request_0001" };
function setup(visitors: StoredVisitor[] = [], lanterns: StoredLantern[] = [], pageSize = 500) {
  const rows = { visitors: visitors.map(encodeRecord), lanterns: lanterns.map(encodeRecord) };
  const revisions = { visitors: 0, lanterns: 0 };
  const writes = new Map<string, number>();
  let failAfterCommit = false;
  const fetcher = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/shrine_save_state')) {
      const body = JSON.parse(options!.body as string);
      const kind = body.p_kind as "visitors" | "lanterns";
      if (writes.has(body.p_write_id)) return Response.json(writes.get(body.p_write_id));
      if (body.p_expected_revision !== revisions[kind]) return new Response(null, { status: 409 });
      rows[kind] = body.p_records;
      revisions[kind]++;
      writes.set(body.p_write_id, revisions[kind]);
      if (failAfterCommit) { failAfterCommit = false; throw new Error('socket lost with private payload'); }
      return Response.json(revisions[kind]);
    }
    if (url.pathname.endsWith('/shrine_storage_state')) {
      const kind = url.searchParams.get('kind')!.slice(3) as "visitors" | "lanterns";
      return Response.json([{ revision: revisions[kind] }]);
    }
    const kind = url.pathname.endsWith('/shrine_visitors') ? "visitors" : "lanterns";
    const offset = Number(url.searchParams.get('offset'));
    return Response.json(rows[kind].slice(offset, offset + pageSize), {
      headers: { "Content-Range": `${offset}-${Math.max(offset, offset + pageSize - 1)}/${rows[kind].length}` },
    });
  });
  const database = new ShrineDatabase(config, fetcher as typeof fetch);
  return { database, fetcher, rows, revisions, ambiguous: () => { failAfterCommit = true; } };
}

describe("Supabase shrine persistence", () => {
  it("accepts the existing Next public URL alias, keeping credentials server-only", () => {
    expect(supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: config.url, SUPABASE_SERVICE_ROLE_KEY: config.key })).toEqual(config);
    const token = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
    expect(supabaseConfig({ SUPABASE_URL: config.url, SUPABASE_SERVICE_ROLE_KEY: token }).key).toBe(token);
    expect(() => supabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: config.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public" })).toThrow('server-only');
    expect(() => supabaseConfig({ SUPABASE_URL: config.url, SUPABASE_SERVICE_ROLE_KEY: "public" })).toThrow('publishable');
    expect(() => supabaseConfig({ SUPABASE_URL: "http://example.com", SUPABASE_SERVICE_ROLE_KEY: config.key })).toThrow('HTTPS');
  });
  it("restricts database operations to game objects and does not use secret keys as bearer JWTs", async () => {
    const s = setup();
    await expect(s.database.request('users?select=*')).rejects.toThrow('Unsupported');
    expect(s.fetcher).not.toHaveBeenCalled();
    await s.database.revision('visitors');
    const headers = s.fetcher.mock.calls[0]![1]!.headers as Headers;
    expect(headers.get('apikey')).toBe(config.key);
    expect(headers.get('Authorization')).toBeNull();
  });
  it("loads every visitor even when the API caps pages below the requested size", async () => {
    const s = setup(Array.from({ length: 1105 }, (_, i) => visitor(i + 1)), [], 100);
    const repositories = await openSupabaseRepositories(s.database);
    expect(repositories.visitors.load()).toHaveLength(1105);
    expect(s.fetcher.mock.calls.filter(([url]) => String(url).includes('shrine_visitors?'))).toHaveLength(12);
  });
  it("stops startup for missing state, incomplete pages or malformed persisted records", async () => {
    const s = setup();
    s.fetcher.mockResolvedValueOnce(Response.json([]));
    await expect(openSupabaseRepositories(s.database)).rejects.toThrow('missing');
    const incomplete = new ShrineDatabase(config, vi.fn(async () => Response.json([], { headers: { 'Content-Range': '0-0/3' } })));
    await expect(incomplete.read('visitors')).rejects.toThrow('Incomplete');
    const bad = setup([{ ...visitor(), prayerCount: -1 }]);
    await expect(openSupabaseRepositories(bad.database)).rejects.toThrow('Invalid shrine visitor');
    const duplicates = setup([], [lantern, { ...lantern, id: 'lantern-2', slot: 1 }]);
    await expect(openSupabaseRepositories(duplicates.database)).rejects.toThrow('Invalid shrine lantern');
  });
  it("persists statistics and lantern actions and restores them through fresh repositories", async () => {
    const s = setup();
    const repositories = await openSupabaseRepositories(s.database);
    const stats = new VisitorStatsService(repositories.visitors, { saveIntervalMs: 0 });
    stats.begin(visitor().ownerHash, 'session', 'garden', 1000);
    stats.record(visitor().ownerHash, 'prayerCount', 2000);
    await stats.flush();
    const lamps = new LanternService(repositories.lanterns);
    expect(await lamps.execute({ kind: 'hang', room: 'garden', ownerHash: visitor().ownerHash,
      requestId: 'request_0001', productId: 'paper-warm', wish: 'よい一日を', signature: '', slot: 0 }, 2000)).toMatchObject({ ok: true });
    const restored = await openSupabaseRepositories(s.database);
    expect(restored.visitors.load()[0]).toMatchObject({ prayerCount: 1, connectionCount: 1 });
    expect(restored.visitors.load()[0]!.daily['1970-01-01']?.prayerCount).toBe(1);
    expect(restored.lanterns.load()[0]).toMatchObject({ ownerHash: visitor().ownerHash, wish: 'よい一日を' });
    const copy = restored.visitors.load(); copy[0]!.prayerCount = 99;
    expect(restored.visitors.load()[0]!.prayerCount).toBe(1);
    await stats.dispose();
  });
  it("reconciles an ambiguous committed write using its original id before saving newer data", async () => {
    const s = setup();
    const repositories = await openSupabaseRepositories(s.database);
    s.ambiguous();
    await expect(repositories.visitors.save([visitor()])).rejects.toThrow('connection failed');
    expect(repositories.visitors.load()).toHaveLength(0);
    await repositories.visitors.save([{ ...visitor(), prayerCount: 2 }]);
    expect(s.revisions.visitors).toBe(2);
    const writes = s.fetcher.mock.calls.filter(([url]) => String(url).includes('/shrine_save_state'));
    expect(JSON.parse(writes[0]![1]!.body as string).p_write_id).toBe(JSON.parse(writes[1]![1]!.body as string).p_write_id);
    expect(repositories.visitors.load()[0]?.prayerCount).toBe(2);
  });
  it("refuses stale server snapshots rather than overwriting another writer", async () => {
    const s = setup([visitor()]);
    const first = await openSupabaseRepositories(s.database);
    const stale = await openSupabaseRepositories(s.database);
    await first.visitors.save([{ ...visitor(), prayerCount: 5 }]);
    await expect(stale.visitors.save([{ ...visitor(), prayerCount: 1 }])).rejects.toThrow('revision conflict');
    expect(s.rows.visitors[0]?.prayer_count).toBe(5);
  });
  it("redacts upstream failures and never falls back to local files", async () => {
    const s = setup();
    s.fetcher.mockResolvedValueOnce(new Response('private data and secret key', { status: 500 }));
    const error = await s.database.revision('visitors').catch(error => error as Error);
    if (!(error instanceof Error)) throw new Error('Expected the request to fail');
    expect(error.message).toContain('HTTP 500');
    expect(error.message).not.toContain('private');
    expect(error.message).not.toContain(config.key);
  });
});
