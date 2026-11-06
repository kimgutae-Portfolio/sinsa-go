import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { WebSocketServer } from "ws";
import { ShrineRooms, type RoomOptions } from "./rooms";
import { createAdminApi } from "./admin/api";
import type { AdminCredential } from "./admin/auth";

const notFoundHtml = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>ページが見つかりません｜こもれび神社</title>
<style>body{margin:0;background:#f4f1e9;color:#303730;font-family:"Yu Mincho",serif;line-height:1.9}main{max-width:34rem;margin:12vh auto;padding:2rem}h1{font-size:1.7rem;font-weight:500}a{color:#8b4436;text-underline-offset:.2em}nav{display:flex;gap:1.5rem;flex-wrap:wrap;margin-top:2rem}</style>
</head><body><main><p>こもれび神社</p><h1>ページが見つかりません</h1>
<p>お探しのページは、移動したか、公開を終えた可能性があります。</p>
<nav aria-label="神社のページ"><a href="/">境内に戻る</a><a href="/about">こもれび神社について</a></nav>
</main></body></html>`;

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
    const requestUrl = new URL(req.url ?? "/", "http://localhost");
    const pathname = requestUrl.pathname;
    if (/^\/admin(?:\/|$)/.test(pathname))
      res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
    if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
      await admin.handle(req, res);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const canonicalPath = pathname === "/index.html" ? "/"
      : pathname === "/about/" || pathname === "/about/index.html" ? "/about"
      : pathname === "/admin/" ? "/admin" : undefined;
    if (canonicalPath) {
      res.writeHead(308, { Location: canonicalPath + requestUrl.search });
      res.end();
      return;
    }
    if (pathname === "/health") {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Robots-Tag", "noindex");
      res.end(
        req.method === "HEAD" ? undefined : JSON.stringify({
          ok: true,
          rooms: rooms.rooms.size,
          visitors: [...rooms.sessions].filter((s) => s.room).length,
        }),
      );
      return;
    }
    if (pathname === "/realtime") {
      res.writeHead(426, { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" });
      res.end(req.method === "HEAD" ? undefined : "WebSocketで接続してください。");
      return;
    }
    const sendNotFound = () => {
      const destination = req.headers["sec-fetch-dest"];
      const documentRequest = destination === "document" || (!destination &&
        (req.headers.accept?.includes("text/html") || ["", ".html"].includes(extname(pathname))));
      const body = documentRequest ? notFoundHtml : "ファイルが見つかりません。";
      res.writeHead(404, {
        "Content-Type": documentRequest ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    try {
      const file = resolve(root, `.${decodeURIComponent(pathname)}`);
      if (file !== root && !file.startsWith(root + sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const adminDocument = /^\/admin(?:\/|$)/.test(pathname) && ["", ".html"].includes(extname(pathname));
      let target = pathname === "/" ? resolve(root, "index.html")
        : pathname === "/about" ? resolve(root, "about", "index.html") : file;
      let exists = false;
      try { exists = (await stat(target)).isFile(); } catch { /* Missing routes are handled below. */ }
      if (!exists) {
        if (adminDocument) target = resolve(root, "index.html");
        else { sendNotFound(); return; }
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
      res.setHeader("Content-Length", body.length);
      res.writeHead(200);
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      sendNotFound();
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
