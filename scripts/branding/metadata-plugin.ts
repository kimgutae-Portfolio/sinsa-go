import type { Plugin, ViteDevServer } from "vite";
import { ABOUT_PATH, crawlFiles, siteMetadata } from "../../src/shared/site";
import { renderAboutPage, renderHomeFallback } from "../../src/shared/about";

/** Emit real HTML metadata; social crawlers do not have to run Vue or Three.js. */
export function metadataPlugin(origin: string): Plugin {
  const files = crawlFiles(origin);
  const middleware = (server: { middlewares: ViteDevServer["middlewares"] }) => {
    server.middlewares.use((request, response, next) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const path = url.pathname;
      if (/^\/admin(?:\/|$)/.test(path)) response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
      if (path === ABOUT_PATH + "/" || path === ABOUT_PATH + "/index.html") {
        response.writeHead(308, { Location: ABOUT_PATH + url.search });
        response.end();
        return;
      }
      if (path === ABOUT_PATH) {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache");
        response.end(request.method === "HEAD" ? undefined : renderAboutPage(origin));
        return;
      }
      if (path === "/robots.txt" || path === "/sitemap.xml") {
        response.setHeader("Content-Type", path === "/robots.txt" ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8");
        response.end(path === "/robots.txt" ? files.robots : files.sitemap);
        return;
      }
      next();
    });
  };
  return {
    name: "shrine-share-metadata",
    transformIndexHtml(html, context) {
      const path = new URL(context.originalUrl ?? context.path, "http://localhost").pathname;
      const privatePage = /^\/admin(?:\/|$)/.test(path);
      return html
        .replace("<!-- SITE_METADATA -->", () => siteMetadata(origin, privatePage))
        .replace("<!-- SITE_FALLBACK -->", () => privatePage ? "<p>管理画面をひらいています…</p>" : renderHomeFallback());
    },
    configureServer: middleware,
    configurePreviewServer: middleware,
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: files.robots });
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: files.sitemap });
      this.emitFile({ type: "asset", fileName: "about/index.html", source: renderAboutPage(origin) });
    },
  };
}
