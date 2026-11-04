import type { Plugin, ViteDevServer } from "vite";
import { crawlFiles, siteMetadata } from "../../src/shared/site";

/** Emit real HTML metadata; social crawlers do not have to run Vue or Three.js. */
export function metadataPlugin(origin: string): Plugin {
  const files = crawlFiles(origin);
  const middleware = (server: { middlewares: ViteDevServer["middlewares"] }) => {
    server.middlewares.use((request, response, next) => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (/^\/admin(?:\/|$)/.test(path)) response.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
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
      return html.replace("<!-- SITE_METADATA -->", siteMetadata(origin, /^\/admin(?:\/|$)/.test(path)));
    },
    configureServer: middleware,
    configurePreviewServer: middleware,
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: files.robots });
      this.emitFile({ type: "asset", fileName: "sitemap.xml", source: files.sitemap });
    },
  };
}
