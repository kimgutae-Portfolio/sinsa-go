/** Public identity only. Never put environment secrets in this module. */
export const SITE = {
  name: "こもれび神社",
  title: "こもれび神社｜オンライン参拝・おみくじ・絵馬",
  description: "森の小さな神社を、ブラウザーで。手水で清め、二礼二拍手一礼で参拝し、おみくじを引いて絵馬に願いを記す。PC・スマートフォンで訪れるオンラインの神社体験です。",
  origin: "https://komorebi-jinja.com",
  image: "/social/komorebi-shrine-v1.jpg",
  imageAlt: "森に囲まれたこもれび神社の境内。拝殿、参道、鳥居と小さな旅人。",
} as const;
export const ABOUT_PATH = "/about";
export interface PublicPageMetadata {
  path: string;
  title: string;
  description: string;
}

export function resolveSiteOrigin(value: string = SITE.origin) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("SITE_URL must be a public HTTPS origin, without a path, credentials, query or fragment.");
  return url.origin;
}
const attribute = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const jsonForHtml = (value: unknown) => JSON.stringify(value)
  .replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026")
  .replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");

export function siteMetadata(origin: string, privatePage = false, page?: PublicPageMetadata) {
  const home = resolveSiteOrigin(origin) + "/";
  const path = page?.path ?? "/";
  // Canonicals are clean public paths. Room and campaign queries describe the
  // same experience, and must never create additional indexable pages.
  if (!/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(path))
    throw new Error("Metadata needs a clean public pathname, without query or fragment.");
  const url = new URL(path, home).href;
  const image = new URL(SITE.image, home).href;
  const title = page?.title ?? SITE.title;
  const description = page?.description ?? SITE.description;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": home + "#website", url: home, name: SITE.name, inLanguage: "ja" },
      { "@type": "WebPage", "@id": url + "#webpage", url, name: title, description, inLanguage: "ja",
        isPartOf: { "@id": home + "#website" },
        primaryImageOfPage: { "@type": "ImageObject", url: image, width: 1200, height: 630, caption: SITE.imageAlt },
      },
    ],
  };
  const meta = (name: string, value: string, property = false) =>
    `<meta ${property ? "property" : "name"}="${name}" content="${attribute(value)}" />`;
  const shared = privatePage ? [
    `<title>管理画面 · ${SITE.name}</title>`, meta("robots", "noindex, nofollow, noarchive"),
  ] : [
    `<title>${attribute(title)}</title>`,
    meta("description", description), meta("robots", "index, follow, max-image-preview:large"),
    `<link rel="canonical" href="${attribute(url)}" />`,
    meta("og:type", "website", true), meta("og:locale", "ja_JP", true),
    meta("og:site_name", SITE.name, true), meta("og:title", page?.title ?? SITE.name, true),
    meta("og:description", description, true), meta("og:url", url, true),
    meta("og:image", image, true), meta("og:image:secure_url", image, true),
    meta("og:image:type", "image/jpeg", true), meta("og:image:width", "1200", true),
    meta("og:image:height", "630", true), meta("og:image:alt", SITE.imageAlt, true),
    meta("twitter:card", "summary_large_image"), meta("twitter:title", page?.title ?? SITE.name),
    meta("twitter:description", description), meta("twitter:image", image),
    meta("twitter:image:alt", SITE.imageAlt),
    `<script type="application/ld+json">${jsonForHtml(structuredData)}</script>`,
  ];
  return [...shared,
    meta("theme-color", "#f4f1e9"), meta("application-name", SITE.name), meta("apple-mobile-web-app-title", SITE.name),
    '<link rel="icon" href="/favicon.ico?v=2" sizes="16x16 32x32 48x48" />',
    '<link rel="icon" href="/icons/favicon-96.png?v=2" type="image/png" sizes="96x96" />',
    '<link rel="icon" href="/favicon.svg?v=2" type="image/svg+xml" sizes="any" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2" sizes="180x180" />',
    '<link rel="manifest" href="/site.webmanifest" />',
  ].join("\n    ");
}
export function crawlFiles(origin: string) {
  const url = resolveSiteOrigin(origin) + "/";
  return {
    robots: `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${url}sitemap.xml\n`,
    sitemap: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${url}</loc></url><url><loc>${new URL(ABOUT_PATH, url).href}</loc></url></urlset>\n`,
  };
}
