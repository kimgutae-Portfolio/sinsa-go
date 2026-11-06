import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "vite";
import { ABOUT_PATH, SITE, crawlFiles, siteMetadata } from "../src/shared/site";
import { metadataPlugin } from "../scripts/branding/metadata-plugin";

function structuredData(html: string) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  expect(scripts).toHaveLength(1);
  return JSON.parse(scripts[0]![1]!);
}

describe("public search metadata", () => {
  it("identifies the site and the real page before JavaScript runs", () => {
    const metadata = siteMetadata(SITE.origin);
    const graph = structuredData(metadata)["@graph"];
    const website = graph.find((item: { "@type": string }) => item["@type"] === "WebSite");
    const webpage = graph.find((item: { "@type": string }) => item["@type"] === "WebPage");
    expect(website).toMatchObject({ name: SITE.name, url: SITE.origin + "/", inLanguage: "ja" });
    expect(webpage).toMatchObject({
      url: SITE.origin + "/", name: SITE.title, description: SITE.description,
      isPartOf: { "@id": website["@id"] },
    });
    expect(metadata).toContain('rel="canonical" href="https://komorebi-jinja.com/"');
    expect(metadata).toContain("オンライン参拝・おみくじ・絵馬");
    expect(metadata).not.toMatch(/LocalBusiness|Place|aggregateRating|SearchAction|room=/);
  });

  it("gives the introduction its own canonical and search result while retaining the site identity", () => {
    const metadata = siteMetadata("https://shrine.example", false, {
      path: ABOUT_PATH, title: "こもれび神社について", description: "手水やおみくじ、絵馬の楽しみ方。",
    });
    const graph = structuredData(metadata)["@graph"];
    expect(metadata).toContain('<title>こもれび神社について</title>');
    expect(metadata).toContain('rel="canonical" href="https://shrine.example/about"');
    expect(metadata).toContain('property="og:url" content="https://shrine.example/about"');
    expect(metadata).toContain('property="og:title" content="こもれび神社について"');
    expect(graph.find((item: { "@type": string }) => item["@type"] === "WebSite").url).toBe("https://shrine.example/");
    expect(graph.find((item: { "@type": string }) => item["@type"] === "WebPage").url).toBe("https://shrine.example/about");
  });

  it("keeps structured JSON and HTML safe when page text includes script delimiters", () => {
    const text = '</script><script>alert("hello")</script> & 森\u2028の神社';
    const metadata = siteMetadata(SITE.origin, false, { path: ABOUT_PATH, title: text, description: text });
    expect(metadata).not.toContain('</script><script>');
    expect(metadata).toContain('&lt;/script&gt;');
    expect(metadata.match(/<script\b/g)).toHaveLength(1);
    const graph = structuredData(metadata)["@graph"];
    expect(graph.find((item: { "@type": string }) => item["@type"] === "WebPage").description).toBe(text);
    for (const path of ["https://other.example/", "//other.example/", "/about?room=test", "/about#section", "/../admin"])
      expect(() => siteMetadata(SITE.origin, false, { path, title: "Page", description: "Page" })).toThrow();
  });

  it("does not describe private administration as a public search result", () => {
    const metadata = siteMetadata(SITE.origin, true);
    expect(metadata).toContain('name="robots" content="noindex, nofollow, noarchive"');
    expect(metadata).not.toMatch(/application\/ld\+json|rel="canonical"|property="og:|name="twitter:/);
  });

  it("lists only the real public routes and permits robots to see the administrator noindex header", () => {
    const files = crawlFiles(SITE.origin);
    const locations = [...files.sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
    expect(locations).toEqual([SITE.origin + "/", SITE.origin + ABOUT_PATH]);
    expect(files.sitemap).not.toMatch(/admin|room=|lastmod/);
    expect(files.robots).toContain("Disallow: /api/");
    expect(files.robots).not.toContain("Disallow: /admin");
  });
});

let directory: string | undefined;
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

it("builds crawlable introduction HTML and a visible preboot fallback without bundling the game into the guide", async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), "shrine-seo-build-")));
  await writeFile(join(directory, "index.html"), '<!doctype html><html lang="ja"><head><!-- SITE_METADATA --></head><body><div id="app"><!-- SITE_FALLBACK --></div></body></html>');
  const result = await build({
    root: directory, configFile: false, publicDir: false, logLevel: "silent",
    plugins: [metadataPlugin("https://shrine.example")], build: { write: false },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const assets = bundles.flatMap(bundle => "output" in bundle ? bundle.output : []);
  const text = (fileName: string) => {
    const file = assets.find(asset => asset.type === "asset" && asset.fileName === fileName);
    if (!file || file.type !== "asset") throw new Error(`Missing ${fileName}`);
    return typeof file.source === "string" ? file.source : new TextDecoder().decode(file.source);
  };
  const home = text("index.html");
  const about = text("about/index.html");
  expect(home).not.toMatch(/SITE_METADATA|SITE_FALLBACK/);
  expect(home).toContain('<h1');
  expect(home).toContain('href="/about"');
  expect(about).toContain('lang="ja"');
  expect(about).toContain('<h1');
  expect(about).toContain('href="https://shrine.example/about"');
  expect(about).toContain('href="/"');
  expect(about).toContain("手水");
  expect(about).not.toMatch(/type="module"|three-|\/src\/main\.ts/);
  expect(text("sitemap.xml")).toContain("https://shrine.example/about");
});
