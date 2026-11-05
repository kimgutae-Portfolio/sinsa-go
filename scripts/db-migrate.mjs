import "../server/env.ts";
import { readFile } from "node:fs/promises";
import { managementQuery } from "./supabase-management.mjs";

const metadata = `select n.nspname as schema, c.relname as name, c.relkind as kind,
 c.relrowsecurity as rls, c.relacl::text as acl,
 (select jsonb_agg(jsonb_build_array(a.attname, a.atttypid, a.attnotnull) order by a.attnum)
  from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'
 and c.relkind in ('r','p','v','m') and not (n.nspname='public' and c.relname in ('shrine_visitors','shrine_lanterns','shrine_storage_state'))
 order by n.nspname,c.relname`;
const before = await managementQuery(metadata);
const collision = await managementQuery(`select to_regclass('public.shrine_storage_state') is not null as state,
 to_regclass('public.shrine_visitors') is not null as visitors,
 to_regclass('public.shrine_lanterns') is not null as lanterns,
 to_regprocedure('public.shrine_save_state(text,bigint,uuid,jsonb)') is not null as save_function`);
if (Object.values(collision[0]).some(Boolean)) {
  if (!Object.values(collision[0]).every(Boolean)) throw new Error("Partial shrine namespace collision; setup refused.");
  const version = await managementQuery("select kind, schema_version from public.shrine_storage_state order by kind");
  if (version.length !== 2 || version.some(row => row.schema_version !== 1)) throw new Error("Unknown existing shrine schema; setup refused.");
  console.log("Shrine schema v1 is already present; existing tables were retained.");
} else {
  const sql = await readFile(new URL('../supabase/migrations/202611040001_shrine_storage.sql', import.meta.url), 'utf8');
  await managementQuery(sql, false);
  const after = await managementQuery(metadata);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Existing service metadata changed during setup. Inspect concurrent schema changes before proceeding.");
  console.log("Created only shrine_* objects. Existing service table definitions and permissions are unchanged.");
}
// Function-only repair: synchronize ema by id while keeping safeupdate enabled.
const emaSyncSql = await readFile(new URL('../supabase/migrations/202611050001_shrine_ema_snapshot_sync.sql', import.meta.url), 'utf8');
await managementQuery(emaSyncSql, false);
if (JSON.stringify(before) !== JSON.stringify(await managementQuery(metadata)))
  throw new Error("Existing service metadata changed during the shrine repair. Inspect concurrent schema changes before proceeding.");
console.log("Updated only shrine_save_state for safe ema synchronization; no existing records were changed.");
const security = await managementQuery(`select c.relname, c.relrowsecurity as rls,
 has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_access,
 has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as authenticated_access
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
 and c.relname in ('shrine_storage_state','shrine_visitors','shrine_lanterns') order by c.relname`);
const functions = await managementQuery(`select
 has_function_privilege('anon','public.shrine_save_state(text,bigint,uuid,jsonb)','EXECUTE') as anon_access,
 has_function_privilege('authenticated','public.shrine_save_state(text,bigint,uuid,jsonb)','EXECUTE') as authenticated_access`);
if (security.length !== 3 || security.some(row => !row.rls || row.anon_access || row.authenticated_access) ||
    functions[0].anon_access || functions[0].authenticated_access)
  throw new Error("Shrine access verification failed. Do not start the game server.");
console.log("Verified RLS and denied anon/authenticated table and function access.");
