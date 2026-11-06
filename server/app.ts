import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { WebSocketServer } from "ws";
import { ShrineRooms, type RoomOptions } from "./rooms";
import { createAdminApi } from "./admin/api";
import type { AdminCredential } from "./admin/auth";

export function createShrineServer(
  options: RoomOptions & {
    staticRoot?: string;
    allowedOrigins?: string[];
    adminCredential?: () => AdminCredential | null;
  } = {},
) {
  const rooms = new ShrineRooms(options);
  const admin = createAdminApi(rooms, {
    credential: options.adminCredential,
    allowedOrigins: options.allowedOrigins,
    now: options.now,
  });
  const root = resolve(options.staticRoot ?? "dist");
  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".json": "application/json",
    ".glb": "model/gltf-binary",
    ".mp3": "audio/mpeg",
    ".webp": "image/webp",
    ".ico": "image/vnd.microsoft.icon",
    ".webmanifest": "application/manifest+json",
    ".xml": "application/xml; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
  };
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (/^\/admin(?:\/|$)/.test(pathname))
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (pathname === "/admin/") {
      res.writeHead(308, {
        Location: "/admin" + new URL(req.url ?? "/", "http://localhost").search,
      });
      res.end();
      return;
    }
    if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
      await admin.handle(req, res);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    if (pathname === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          rooms: rooms.rooms.size,
          visitors: [...rooms.sessions].filter((s) => s.room).length,
        }),
      );
      return;
    }
    if (pathname === "/realtime") {
      res.writeHead(426);
      res.end("WebSocketで接続してください。");
      return;
    }
    try {
      const file = resolve(root, `.${decodeURIComponent(pathname)}`);
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      let target = file;
      try {
        if (!(await stat(target)).isFile())
          target = resolve(root, "index.html");
      } catch {
        target = resolve(root, "index.html");
      }
      const body = await readFile(target);
      res.setHeader(
        "Content-Type",
        mime[extname(target)] ?? "application/octet-stream",
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Keep Cloudflare's automatic analytics beacon out of administrator HTML.
      const adminHtml = extname(target) === ".html" && /^\/admin(?:\/|$)/.test(pathname);
      res.setHeader(
        "Cache-Control",
        adminHtml ? "no-cache, no-transform" : target.includes(`${sep}assets${sep}`) ||
          (target.includes(`${sep}social${sep}`) && /-v\d+\.(jpg|png|webp)$/.test(target))
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
      res.writeHead(200);
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      res.writeHead(404);
      res.end("先に npm run build でアプリをビルドしてください。");
    }
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2048,
    perMessageDeflate: false,
  });
  server.on("upgrade", (request, socket, head) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    let allowed = true;
    const origin = request.headers.origin;
    if (origin) {
      try {
        const host = new URL(origin).host;
        allowed =
          host === request.headers.host ||
          Boolean(options.allowedOrigins?.includes(origin));
      } catch {
        allowed = false;
      }
    }
    if (path !== "/realtime" || !allowed) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => rooms.connect(ws));
  });
  return {
    server,
    rooms,
    async close() {
      admin.dispose();
      rooms.dispose();
      await rooms.flush();
      wss.close();
      if (server.listening)
        await new Promise<void>((done, reject) =>
          server.close((error) => (error ? reject(error) : done())),
        );
    },
  };
}
