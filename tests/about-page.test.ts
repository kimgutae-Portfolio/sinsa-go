import { describe, expect, it } from "vitest";
import { ABOUT_META, renderAboutPage, renderHomeFallback } from "../src/shared/about";
import { ABOUT_PATH, SITE } from "../src/shared/site";
import { ROOM_CAPACITY } from "../src/shared/multiplayer";
import { FREE_LANTERN_POLICY } from "../src/shared/lanterns";

describe("the public shrine introduction", () => {
  it("provides a complete readable Japanese page without requiring the game runtime", () => {
    const html = renderAboutPage("https://shrine.example");
    expect(html).toContain('<html lang="ja">');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain(`<title>${ABOUT_META.title}</title>`);
    expect(html).toContain(`rel="canonical" href="https://shrine.example${ABOUT_PATH}"`);
    expect(html).toContain(`src="${SITE.image}" alt="${SITE.imageAlt}" width="1200" height="630"`);
    expect(html).not.toMatch(/<script[^>]+\bsrc=/);
    expect(html).not.toContain('src="/src/main.ts"');
    expect(html).not.toContain('id="app"');
    for (const anchor of ["experiences", "how-to-visit", "ema-and-records", "questions"]) {
      expect(html).toContain(`href="#${anchor}"`);
      expect(html).toContain(`id="${anchor}"`);
    }
    expect(html).toContain('href="/">境内へ入る');
  });

  it("explains actual experiences and ownership limits without making physical-place or price claims", () => {
    const html = renderAboutPage(SITE.origin);
    expect(html).toContain("架空の境内");
    for (const phrase of ["二礼二拍手一礼", "「おみくじを引く」", "任意の名前", "WASD・矢印キー", "ジョイスティック"])
      expect(html).toContain(phrase);
    expect(html).toContain(`最大${ROOM_CAPACITY}人`);
    expect(html).toContain(`1枚、${FREE_LANTERN_POLICY.durationHours}時間`);
    expect(html).toContain("掛けた境内の訪問者に公開");
    expect(html).toContain("サイトデータを削除");
    expect(html).toContain("別の端末・ブラウザー");
    expect(html.match(/<details>/g)).toHaveLength(3);
    expect(html).not.toMatch(/無料|有料|料金|FAQPage|LocalBusiness|aggregateRating|streetAddress/);
  });

  it("keeps the startup text visible and gives visitors without JavaScript a usable introduction link", () => {
    const html = renderHomeFallback();
    expect(html).toMatch(new RegExp(`<h1\\b[^>]*>${SITE.name}</h1>`));
    expect(html).toContain(`href="${ABOUT_PATH}"`);
    expect(html).toContain("手水、参拝、おみくじ、絵馬");
    expect(html).toContain("<noscript>");
    expect(html).toContain("JavaScriptとWebGLが必要");
    expect(html).not.toMatch(/aria-hidden|display:\s*none|visibility:\s*hidden/);
  });
});
