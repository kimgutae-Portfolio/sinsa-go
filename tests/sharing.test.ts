import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SITE, resolveSiteOrigin, siteMetadata, crawlFiles } from "../src/shared/site";
import { createShrineServer } from "../server/app";

describe("share metadata in the initial HTML", () => {
  it("uses the shrine's custom domain and permits an explicit HTTPS origin override", () => {
    expect(resolveSiteOrigin()).toBe("https://komorebi-jinja.com");
    expect(resolveSiteOrigin("https://shrine.example/")).toBe("https://shrine.example");
    for (const invalid of ["http://localhost:4173", "javascript:alert(1)", "https://user:secret@shrine.example",
      "https://shrine.example/a", "https://shrine.example/?token=secret", "https://shrine.example/#fragment"])
      expect(() => resolveSiteOrigin(invalid)).toThrow();
    const metadata = siteMetadata(resolveSiteOrigin());
    expect(metadata).toContain('rel="canonical" href="https://komorebi-jinja.com/"');
    expect(metadata).toContain('property="og:url" content="https://komorebi-jinja.com/"');
    expect(metadata).toContain(`property="og:image" content="https://komorebi-jinja.com${SITE.image}"`);
    const crawl = crawlFiles(resolveSiteOrigin());
    expect(crawl.robots).toContain('Sitemap: https://komorebi-jinja.com/sitemap.xml');
    expect(crawl.sitemap).toContain('<loc>https://komorebi-jinja.com/</loc>');
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
  const files: Record<string, string> = {
    [SITE.image]: 'image/jpeg', '/favicon.ico': 'image/vnd.microsoft.icon',
    '/icons/favicon-96.png': 'image/png', '/apple-touch-icon.png': 'image/png',
    '/site.webmanifest': 'application/manifest+json',
  };
  async function startFixture() {
    directory = await mkdtemp(join(tmpdir(), 'shrine-sharing-'));
    for (const path of Object.keys(files)) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await copyFile(resolve('public', `.${path}`), join(directory, path));
    }
    await writeFile(join(directory, 'index.html'), `<!doctype html><html lang="ja"><head>${siteMetadata(SITE.origin)}</head><body></body></html>`);
    await mkdir(join(directory, 'about'));
    await writeFile(join(directory, 'about', 'index.html'), '<!doctype html><html lang="ja"><head><title>こもれび神社について</title></head><body><h1>森の中で、ひと休み。</h1><p>ブラウザーで参拝やおみくじを体験できます。</p><a href="/">境内に戻る</a></body></html>');
    await writeFile(join(directory, 'google-site-verification.html'), 'google-site-verification: fixture');
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
    return `http://127.0.0.1:${address.port}`;
  }
  it("serves the finished card and icon files with valid MIME types and no JS-dependent metadata", async () => {
    const origin = await startFixture();
    const publicPage = await fetch(origin, { headers: { 'User-Agent': 'Twitterbot/1.0' } });
    expect(publicPage.headers.get('cache-control')).not.toContain('no-transform');
    const html = await publicPage.text();
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
    for (const path of ['/admin', '/admin/visitors']) {
      const admin = await fetch(origin + path);
      expect(admin.headers.get('content-type')).toContain('text/html');
      expect(admin.headers.get('x-robots-tag')).toContain('noindex');
      expect(admin.headers.get('cache-control')).toContain('no-transform');
    }
    const sitemap = await fetch(origin + '/sitemap.xml');
    expect(sitemap.headers.get('content-type')).toContain('application/xml');
    expect(await sitemap.text()).toContain(SITE.origin);
  });

  it("serves the about article directly and redirects alternate document URLs without losing queries", async () => {
    const origin = await startFixture();
    const about = await fetch(origin + '/about');
    expect(about.status).toBe(200);
    expect(about.headers.get('content-type')).toContain('text/html');
    expect(about.headers.get('x-robots-tag')).toBeNull();
    expect(await about.text()).toContain('<h1>森の中で、ひと休み。</h1>');
    for (const [path, destination] of [
      ['/index.html', '/'], ['/about/', '/about'], ['/about/index.html', '/about'], ['/admin/', '/admin'],
    ]) for (const method of ['GET', 'HEAD']) {
      const response = await fetch(origin + path + '?room=komorebi&from=guide', { method, redirect: 'manual' });
      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe(destination + '?room=komorebi&from=guide');
      expect(await response.text()).toBe('');
    }
    const room = await fetch(origin + '/?room=komorebi', { redirect: 'manual' });
    expect(room.status).toBe(200);
    expect(await room.text()).toContain('rel="canonical" href="https://komorebi-jinja.com/"');
  });

  it("returns real noindex 404s for unknown pages and missing assets instead of the game shell", async () => {
    const origin = await startFixture();
    for (const path of ['/not-a-shrine-page', '/not-a-shrine-page/', '/missing.html', '/administrator']) {
      const response = await fetch(origin + path, { headers: { Accept: 'text/html' } });
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('x-robots-tag')).toContain('noindex');
      const html = await response.text();
      expect(html).toContain('ページが見つかりません');
      expect(html).toContain('href="/"');
      expect(html).toContain('href="/about"');
      expect(html).not.toContain('rel="canonical"');
      const head = await fetch(origin + path, { method: 'HEAD', headers: { Accept: 'text/html' } });
      expect(head.status).toBe(404);
      expect(head.headers.get('content-length')).toBe(response.headers.get('content-length'));
      expect(await head.text()).toBe('');
    }
    for (const path of ['/assets/missing.js', '/textures/missing.webp', '/admin/missing.js']) {
      const response = await fetch(origin + path);
      expect(response.status).toBe(404);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(response.headers.get('x-robots-tag')).toContain('noindex');
      expect(await response.text()).not.toContain('<html');
    }
  });

  it("preserves real verification files and useful HEAD responses", async () => {
    const origin = await startFixture();
    const verification = await fetch(origin + '/google-site-verification.html');
    expect(verification.status).toBe(200);
    expect(await verification.text()).toBe('google-site-verification: fixture');
    for (const path of ['/', '/about', '/admin', '/favicon.ico']) {
      const response = await fetch(origin + path);
      const head = await fetch(origin + path, { method: 'HEAD' });
      expect(head.status).toBe(200);
      expect(head.headers.get('content-length')).toBe(response.headers.get('content-length'));
      expect(await head.text()).toBe('');
      await response.arrayBuffer();
    }
    const health = await fetch(origin + '/health', { method: 'HEAD' });
    expect(health.status).toBe(200);
    expect(health.headers.get('x-robots-tag')).toContain('noindex');
    expect(await health.text()).toBe('');
    const realtime = await fetch(origin + '/realtime', { method: 'HEAD' });
    expect(realtime.status).toBe(426);
    expect(realtime.headers.get('x-robots-tag')).toContain('noindex');
    expect(await realtime.text()).toBe('');
  });
});
