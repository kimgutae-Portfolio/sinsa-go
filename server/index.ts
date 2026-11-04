import "./env";
import { createShrineServer } from "./app";
import { resolve } from "node:path";
import { LanternService } from "./lanterns/service";
import { FileLanternRepository } from "./lanterns/repository";
import { VisitorStatsService } from "./visitors/service";
import { FileVisitorRepository } from "./visitors/repository";
import { hashAdminPassword, readAdminCredential } from "./admin/auth";
import { openSupabaseRepositories, ShrineDatabase, supabaseConfig } from "./storage/supabase";
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid PORT");
const lanternMode = process.env.LANTERN_MODE ?? "free";
if (lanternMode !== "free" && lanternMode !== "paid")
  throw new Error("LANTERN_MODE must be free or paid");
const backend = process.env.STORAGE_BACKEND ?? "file";
if (backend !== "file" && backend !== "supabase") throw new Error("STORAGE_BACKEND must be file or supabase");
const repositories = backend === "supabase"
  ? await openSupabaseRepositories(new ShrineDatabase(supabaseConfig()))
  : {
      visitors: new FileVisitorRepository(resolve(process.env.DATA_DIR ?? "data", "visitors.json")),
      lanterns: new FileLanternRepository(resolve(process.env.DATA_DIR ?? "data", "lanterns.json")),
    };
const app = createShrineServer({
  adminCredential: process.env.ADMIN_PASSWORD
    ? (() => {
        const credential = hashAdminPassword(process.env.ADMIN_PASSWORD!);
        return () => credential;
      })()
    : () =>
        readAdminCredential(
          resolve(process.env.DATA_DIR ?? "data", "admin.json"),
        ),
  stats: new VisitorStatsService(repositories.visitors),
  lanterns: new LanternService(
    repositories.lanterns,
    lanternMode,
  ),
  allowedOrigins: process.env.ALLOWED_ORIGINS?.split(",")
    .map((s) => s.trim())
    .filter(Boolean),
});
app.server.listen(port, process.env.HOST ?? "0.0.0.0", () =>
  console.log(`Shrine realtime + production server: http://localhost:${port} (storage: ${backend})`),
);
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void app.close().then(() => process.exit(0));
  });
app.server.on("error", (error) => {
  console.error(error);
  app.rooms.dispose();
  process.exit(1);
});
