import "../server/env.ts";
import { resolve } from "node:path";
import { mkdir, copyFile, chmod, constants } from "node:fs/promises";
import { FileVisitorRepository } from "../server/visitors/repository.ts";
import { FileLanternRepository } from "../server/lanterns/repository.ts";
import { ShrineDatabase, supabaseConfig, openSupabaseRepositories,
  validateVisitors, validateLanterns } from "../server/storage/supabase.ts";

// Stop the game server first; never merge or overwrite an already populated database.
const directory = resolve(process.env.DATA_DIR ?? "data");
const database = new ShrineDatabase(supabaseConfig());
const repositories = await openSupabaseRepositories(database);
const visitors = new FileVisitorRepository(resolve(directory, "visitors.json")).load();
const lanterns = new FileLanternRepository(resolve(directory, "lanterns.json")).load();
validateVisitors(visitors); validateLanterns(lanterns);
const existingVisitors = repositories.visitors.load();
const existingLanterns = repositories.lanterns.load();
const stable = value => Array.isArray(value) ? value.map(stable) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const canonical = value => JSON.stringify(stable([...value].sort((a,b) =>
  (a.visitorId ?? a.id).localeCompare(b.visitorId ?? b.id))));
if ((existingVisitors.length && canonical(existingVisitors) !== canonical(visitors)) ||
    (existingLanterns.length && canonical(existingLanterns) !== canonical(lanterns)))
  throw new Error("The shrine database already contains different records. Import refused; no data overwritten.");
const backup = resolve(directory, "backups", `before-supabase-${new Date().toISOString().replaceAll(":", "-")}`);
await mkdir(backup, { recursive: true, mode: 0o700 });
for (const name of ["visitors.json", "lanterns.json"]) {
  const target = resolve(backup, name);
  try { await copyFile(resolve(directory, name), target, constants.COPYFILE_EXCL); await chmod(target, 0o600); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
// Each dataset is atomic. A retry after a partially completed import is safe.
if (!existingVisitors.length && visitors.length) await repositories.visitors.save(visitors);
if (!existingLanterns.length && lanterns.length) await repositories.lanterns.save(lanterns);
const verified = await openSupabaseRepositories(database);
if (canonical(verified.visitors.load()) !== canonical(visitors) || canonical(verified.lanterns.load()) !== canonical(lanterns))
  throw new Error("Import verification failed. Keep the server stopped and inspect the backup.");
console.log(JSON.stringify({ imported: true, visitors: visitors.length, lanterns: lanterns.length, backup }, null, 2));
