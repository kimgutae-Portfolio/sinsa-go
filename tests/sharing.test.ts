import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SITE, resolveSiteOrigin, siteMetadata, crawlFiles } from "../src/shared/site";
import { createShrineServer } from "../server/app";

describe("share metadata in the initial HTML", () => {
  it("uses the verified production domain and permits an explicit HTTPS custom domain", () => {
    expect(resolveSiteOrigin()).toBe("https://sinsa-go.vercel.app");
    expect(resolveSiteOrigin("https://shrine.example/")).toBe("https://shrine.example");
    for (const invalid of ["http://localhost:4173", "javascript:alert(1)", "https://user:secret@shrine.example",
      "https://shrine.example/a", "https://shrine.example/?token=secret", "https://shrine.example/#fragment"])
      expect(() => resolveSiteOrigin(invalid)).toThrow();
  });
  it("supplies complete, absolute OG and X tags before any JavaScript executes", async () => {
    const source = await readFile(resolve("index.html"), "utf8");
    const html = source.replace("<!-- SITE_METADATA -->", siteMetadata("https://shrine.example"));
    expect(html).not.toContain("<!-- SITE_METADATA -->");
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html).toContain(`<title>${SITE.title}</title>`);
    expect(html).toContain('property="og:url" content="https://shrine.example/"');
    expect(html).toContain(`property="og:image" content="https://shrine.example${SITE.image}"`);
    expect(html).toContain('property="og:image:width" content="1200"');
    expect(html).toContain('property="og:image:height" content="630"');
    expect(html).toContain('property="og:locale" content="ja_JP"');
    expect(html).toContain(`property="og:image:alt" content="${SITE.imageAlt}"`);
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain(`name="twitter:image" content="https://shrine.example${SITE.image}"`);
    expect(html).toContain('rel="canonical" href="https://shrine.example/"');
    expect(html).not.toMatch(/__SITE|SUPABASE|localhost|visitorKey/);
  });
  it("does not advertise the administrator login as a shareable shrine experience", () => {
    const head = siteMetadata(SITE.origin, true);
    expect(head).toContain('name="robots" content="noindex, nofollow, noarchive"');
    expect(head).toContain("管理画面");
    expect(head).not.toContain('property="og:');
    expect(head).not.toContain('name="twitter:');
    expect(head).toContain('/apple-touch-icon.png');
  });
  it("keeps the crawl files on the canonical origin without listing admin or private room parameters", () => {
    const files = crawlFiles("https://shrine.example");
    expect(files.robots).toContain('Sitemap: https://shrine.example/sitemap.xml');
    expect(files.sitemap).toContain('<loc>https://shrine.example/</loc>');
    expect(files.sitemap).not.toMatch(/admin|room=|localhost/);
  });
  it("includes real PNG and ICO variants rather than falling back to an SVG-only icon", async () => {
    for (const [path, size] of [
      ['icons/favicon-32.png', 32], ['icons/favicon-48.png', 48], ['icons/favicon-96.png', 96],
      ['apple-touch-icon.png', 180], ['icons/icon-192.png', 192], ['icons/icon-512.png', 512],
    ] as const) {
      const png = await readFile(resolve("public", path));
      expect(png.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
    const ico = await readFile(resolve('public/favicon.ico'));
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);
    expect([ico[6], ico[22], ico[38]]).toEqual([16,32,48]);
  });
});

let app: ReturnType<typeof createShrineServer> | undefined;
let directory: string | undefined;
afterEach(async () => {
  await app?.close(); app = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});
describe("crawler HTTP responses", () => {
  it("serves the finished card and icon files with valid MIME types and no JS-dependent metadata", async () => {
    directory = await mkdtemp(join(tmpdir(), 'shrine-sharing-'));
    const files: Record<string, string> = {
      [SITE.image]: 'image/jpeg', '/favicon.ico': 'image/vnd.microsoft.icon',
      '/icons/favicon-96.png': 'image/png', '/apple-touch-icon.png': 'image/png',
      '/site.webmanifest': 'application/manifest+json',
    };
    for (const path of Object.keys(files)) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await copyFile(resolve('public', `.${path}`), join(directory, path));
    }
    await writeFile(join(directory, 'index.html'), `<!doctype html><html lang="ja"><head>${siteMetadata(SITE.origin)}</head><body></body></html>`);
    const crawl = crawlFiles(SITE.origin);
    await writeFile(join(directory,'robots.txt'), crawl.robots);
    await writeFile(join(directory,'sitemap.xml'), crawl.sitemap);
    app = createShrineServer({ staticRoot: directory });
    await new Promise<void>((done, reject) => {
      app!.server.once('error', reject);
      app!.server.listen(0, '127.0.0.1', done);
    });
    const address = app.server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test socket');
    const origin = `http://127.0.0.1:${address.port}`;
    const html = await (await fetch(origin, { headers: { 'User-Agent': 'Twitterbot/1.0' } })).text();
    expect(html).toContain(`property="og:title" content="${SITE.name}"`);
    for (const [path, type] of Object.entries(files)) {
      const response = await fetch(origin + path);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(type);
      const body = new Uint8Array(await response.arrayBuffer());
      expect(body.length).toBeGreaterThan(100);
      if (path === SITE.image) {
        expect([...body.subarray(0, 3)]).toEqual([255,216,255]);
        expect(response.headers.get('cache-control')).toContain('immutable');
      }
    }
    const admin = await fetch(origin + '/admin');
    expect(admin.headers.get('x-robots-tag')).toContain('noindex');
    const sitemap = await fetch(origin + '/sitemap.xml');
    expect(sitemap.headers.get('content-type')).toContain('application/xml');
    expect(await sitemap.text()).toContain(SITE.origin);
  });
});
