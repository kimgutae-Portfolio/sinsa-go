// Maintenance only. The game server never loads a management token.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { supabaseConfig } from "../server/storage/supabase.ts";

async function accessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  if (process.platform === "darwin") for (const account of ["supabase", "access-token"]) {
    const result = spawnSync("/usr/bin/security", ["find-generic-password", "-s", "Supabase CLI", "-a", account, "-w"],
      { encoding: "utf8", timeout: 10000 });
    if (result.status === 0 && result.stdout.trim()) {
      const value = result.stdout.trim();
      if (value.startsWith("go-keyring-base64:")) return Buffer.from(value.slice(18), "base64").toString();
      if (value.startsWith("go-keyring-encoded:")) return Buffer.from(value.slice(19), "hex").toString();
      return value;
    }
  }
  try { return (await readFile(`${homedir()}/.supabase/access-token`, "utf8")).trim(); } catch {}
  throw new Error("Supabase CLI login or SUPABASE_ACCESS_TOKEN is required only for the additive schema setup. Alternatively run the migration in SQL Editor.");
}
export async function managementQuery(query, readOnly = true) {
  const { url } = supabaseConfig();
  const host = new URL(url).hostname;
  if (!/^[a-z0-9]+\.supabase\.co$/.test(host)) throw new Error("Management setup requires a hosted Supabase project URL.");
  const token = await accessToken();
  let response;
  try {
    response = await fetch(`https://api.supabase.com/v1/projects/${host.split('.')[0]}/database/query`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, read_only: readOnly }), signal: AbortSignal.timeout(30000),
    });
  } catch { throw new Error("Supabase management connection failed. Check project state before retrying a migration."); }
  if (!response.ok) throw new Error(`Supabase schema setup failed (HTTP ${response.status}). No credentials or SQL payload logged.`);
  return response.json();
}
