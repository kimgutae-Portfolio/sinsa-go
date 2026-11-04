import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import "../server/env.ts";
import { ShrineDatabase, supabaseConfig, openSupabaseRepositories } from "../server/storage/supabase.ts";
const path = resolve(process.env.DATA_DIR ?? "data", "visitors.json");
let store;
try {
  store = process.env.STORAGE_BACKEND === "supabase"
    ? { version: 1, timezone: "Asia/Tokyo", visitors: (await openSupabaseRepositories(new ShrineDatabase(supabaseConfig()))).visitors.load() }
    : JSON.parse(await readFile(path, "utf8"));
} catch (error) {
  if (error.code === "ENOENT") {
    console.log("まだ訪問記録はありません。境内への接続から記録を開始します。");
    process.exit(0);
  }
  throw error;
}
if (store.version !== 1 || !Array.isArray(store.visitors))
  throw new Error("訪問記録の形式に対応していません。");
const keys = [
  "connectionCount",
  "visitCount",
  "prayerCount",
  "fortuneCount",
  "emaViewCount",
  "lanternHangCount",
  "lanternRemoveCount",
  "connectedMs",
];
const visitors = store.visitors;
if (process.argv.includes("--csv")) {
  const columns = [
    "visitorId",
    "firstSeenAt",
    "lastSeenAt",
    "lastRoom",
    ...keys,
  ];
  const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  console.log(columns.join(","));
  for (const visitor of visitors)
    console.log(columns.map((key) => cell(visitor[key])).join(","));
} else {
  const totals = Object.fromEntries(
    keys.map((key) => [
      key,
      visitors.reduce((sum, visitor) => sum + visitor[key], 0),
    ]),
  );
  console.log(
    JSON.stringify(
      { storedVisitors: visitors.length, timezone: store.timezone, totals },
      null,
      2,
    ),
  );
}
