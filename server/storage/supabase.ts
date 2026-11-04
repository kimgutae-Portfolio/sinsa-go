import { randomUUID } from "node:crypto";
import { validVisitorSummary, validVisitorCounters } from "../../src/shared/visitorStats";
import { validPublicLantern } from "../../src/shared/lanterns";
import { validRoom } from "../../src/shared/multiplayer";
import type { StoredVisitor, VisitorRepository } from "../visitors/repository";
import type { StoredLantern, LanternRepository } from "../lanterns/repository";

export interface SupabaseConfig { url: string; key: string }
export function supabaseConfig(env: NodeJS.ProcessEnv = process.env): SupabaseConfig {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase requires a URL and a server-only secret/service_role key.");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search ||
      parsed.hash || !["", "/"].includes(parsed.pathname))
    throw new Error("SUPABASE_URL must be an HTTPS project origin.");
  if (!key.startsWith("sb_secret_")) {
    let role: unknown;
    try { role = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString()).role; } catch {}
    if (role !== "service_role") throw new Error("Use the server-only service_role/secret key, not a publishable/anon key.");
  }
  return { url: parsed.origin, key };
}
type Kind = "visitors" | "lanterns";
type Row = Record<string, unknown>;
const snake = (key: string) => key.replace(/[A-Z]/g, value => `_${value.toLowerCase()}`);
export function encodeRecord(record: StoredVisitor | StoredLantern): Row {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [snake(key), value]));
}
export function decodeRecord(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase()), value]));
}
export function validateVisitors(records: StoredVisitor[]) {
  if (!records.every(item => item && validVisitorSummary(item) &&
    /^[a-f0-9]{64}$/.test(item.ownerHash) && (item.accountId === null || typeof item.accountId === "string") &&
    item.daily && typeof item.daily === "object" && !Array.isArray(item.daily) &&
    Object.entries(item.daily).every(([day, counters]) => /^\d{4}-\d{2}-\d{2}$/.test(day) && validVisitorCounters(counters))) ||
    new Set(records.map(item => item.visitorId)).size !== records.length ||
    new Set(records.map(item => item.ownerHash)).size !== records.length)
    throw new Error("Invalid shrine visitor data. Startup stopped; no data was overwritten.");
}
export function validateLanterns(records: StoredLantern[]) {
  if (records.length > 768 || !records.every(item => item && validPublicLantern(item) && validRoom(item.room) &&
    /^[a-f0-9]{64}$/.test(item.ownerHash) && item.issuance === "free" &&
    typeof item.requestId === "string" && item.requestId.length <= 64) ||
    new Set(records.map(item => item.id)).size !== records.length ||
    new Set(records.map(item => `${item.room}:${item.slot}`)).size !== records.length ||
    new Set(records.map(item => `${item.room}:${item.ownerHash}`)).size !== records.length)
    throw new Error("Invalid shrine lantern data. Startup stopped; no data was overwritten.");
}

/** Restricted to shrine_* objects. Never logs keys, URLs, payloads or upstream errors. */
export class ShrineDatabase {
  constructor(private config: SupabaseConfig, private transport: typeof fetch = fetch) {}
  async request(path: string, options: RequestInit = {}): Promise<Response> {
    if (!/^(shrine_visitors|shrine_lanterns|shrine_storage_state)(\?|$)/.test(path) && path !== "rpc/shrine_save_state")
      throw new Error("Unsupported shrine database operation.");
    const headers = new Headers(options.headers);
    headers.set("apikey", this.config.key);
    if (!this.config.key.startsWith("sb_secret_")) headers.set("Authorization", `Bearer ${this.config.key}`);
    headers.set("Content-Type", "application/json");
    let response: Response;
    try {
      response = await this.transport(`${this.config.url}/rest/v1/${path}`, {
        ...options, headers, signal: AbortSignal.timeout(12000),
      });
    } catch { throw new Error("Shrine database connection failed; no file-storage fallback was used."); }
    if (!response.ok) {
      if (response.status === 409) throw new Error("Shrine database revision conflict. Run only one game server; restart before retrying.");
      throw new Error(`Shrine database HTTP ${response.status}. Check credentials and the shrine migration.`);
    }
    return response;
  }
  async revision(kind: Kind): Promise<number> {
    const response = await this.request(`shrine_storage_state?kind=eq.${kind}&select=revision`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !Number.isSafeInteger(rows[0]?.revision) || rows[0].revision < 0)
      throw new Error("Shrine database storage state is missing or invalid. Apply the shrine migration first.");
    return rows[0].revision;
  }
  async read(kind: Kind): Promise<Row[]> {
    const result: Row[] = [];
    const order = kind === "visitors" ? "visitor_id" : "id";
    while (true) {
      const response = await this.request(`shrine_${kind}?select=*&order=${order}.asc&offset=${result.length}&limit=500`,
        { headers: { Prefer: "count=exact" } });
      const rows = await response.json();
      const count = response.headers.get("Content-Range")?.split("/")[1];
      const total = count && /^\d+$/.test(count) ? Number(count) : NaN;
      if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < 0 ||
          result.length + rows.length > total || (!rows.length && result.length < total))
        throw new Error("Incomplete shrine database response. Startup stopped to avoid truncating records.");
      result.push(...rows);
      if (result.length === total) return result;
    }
  }
  async save(kind: Kind, revision: number, writeId: string, records: Row[]): Promise<number> {
    const response = await this.request("rpc/shrine_save_state", { method: "POST", body: JSON.stringify({
      p_kind: kind, p_expected_revision: revision, p_write_id: writeId, p_records: records,
    }) });
    const next = await response.json();
    if (!Number.isSafeInteger(next) || next !== revision + 1) throw new Error("Invalid shrine save acknowledgement.");
    return next;
  }
}

class SnapshotRepository<T extends StoredVisitor | StoredLantern> {
  private pending?: { id: string; records: T[] };
  constructor(private database: ShrineDatabase, private kind: Kind,
    private records: T[], private revision: number) {}
  load(): T[] { return structuredClone(this.records); }
  async save(records: T[]): Promise<void> {
    // Confirm an ambiguous previous network result before submitting the next snapshot.
    if (this.pending) await this.commitPending();
    this.pending = { id: randomUUID(), records: structuredClone(records) };
    await this.commitPending();
  }
  private async commitPending() {
    const pending = this.pending!;
    this.revision = await this.database.save(this.kind, this.revision, pending.id, pending.records.map(encodeRecord));
    this.records = pending.records;
    this.pending = undefined;
  }
}
export async function openSupabaseRepositories(database: ShrineDatabase): Promise<{
  visitors: VisitorRepository; lanterns: LanternRepository;
}> {
  const visitorRevision = await database.revision("visitors");
  const lanternRevision = await database.revision("lanterns");
  const visitors = (await database.read("visitors")).map(decodeRecord) as unknown as StoredVisitor[];
  const lanterns = (await database.read("lanterns")).map(decodeRecord) as unknown as StoredLantern[];
  validateVisitors(visitors);
  validateLanterns(lanterns);
  if (await database.revision("visitors") !== visitorRevision || await database.revision("lanterns") !== lanternRevision)
    throw new Error("Shrine database changed during startup. Stop the other game server and retry.");
  return {
    visitors: new SnapshotRepository(database, "visitors", visitors, visitorRevision),
    lanterns: new SnapshotRepository(database, "lanterns", lanterns, lanternRevision),
  };
}
