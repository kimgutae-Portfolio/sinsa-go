import { ABOUT_PATH, SITE, siteMetadata } from "./site";
import { ROOM_CAPACITY } from "./multiplayer";
import { FREE_LANTERN_POLICY } from "./lanterns";

export const ABOUT_META = {
  path: ABOUT_PATH,
  title: "こもれび神社について｜オンライン参拝の楽しみ方",
  description: "こもれび神社は、森の境内を歩いて参拝・おみくじ・絵馬を楽しむオンラインの神社体験です。手水の作法や遊び方、絵馬の公開と記録についてご案内します。",
} as const;

/** The same visible startup content is served to every visitor before Vue mounts. */
export function renderHomeFallback() {
  return `<main class="shrine-startup" style="min-height:100svh;box-sizing:border-box;display:grid;align-content:center;justify-items:center;gap:18px;padding:40px 24px;background:#f4f1e9;color:#303730;text-align:center;font-family:'Hiragino Mincho ProN','Yu Mincho',serif">
      <h1 style="margin:0;font-size:28px;font-weight:500;letter-spacing:.12em">${SITE.name}</h1>
      <p style="max-width:28em;margin:0;line-height:2">ブラウザーで訪れる、森の小さな神社。手水、参拝、おみくじ、絵馬をお楽しみいただけます。</p>
      <p role="status" style="margin:0;font-size:13px;color:#666b61">境内をひらいています。</p>
      <a href="${ABOUT_PATH}" style="color:#8b4436;text-underline-offset:5px;line-height:1.8">神社の紹介と遊び方</a>
      <noscript><p style="max-width:30em;margin:0;line-height:2">境内を歩く体験にはJavaScriptとWebGLが必要です。紹介ページはそのままお読みいただけます。</p></noscript>
    </main>`;
}

/** A small, useful page that can be read without Vue, Three.js or JavaScript. */
export function renderAboutPage(origin: string) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    ${siteMetadata(origin, false, ABOUT_META)}
    <link rel="stylesheet" href="/about.css" />
  </head>
  <body class="about-page">
    <a class="skip-link" href="#main">本文へ進む</a>
    <header class="page-header page-width">
      <a class="brand" href="/" aria-label="こもれび神社の境内へ">
        <img src="/favicon.svg" width="30" height="30" alt="" />
        <span>${SITE.name}</span>
      </a>
      <a class="header-return" href="/">境内へ <span aria-hidden="true">→</span></a>
    </header>

    <main id="main" class="page-width">
      <section class="introduction" aria-labelledby="about-title">
        <p class="eyebrow">境内のしおり</p>
        <h1 id="about-title">こもれび神社について</h1>
        <p class="lead">木漏れ日の中で、ひと休み。</p>
        <p class="opening">こもれび神社は、森の中にある架空の境内を、小さな旅人として歩くオンラインの神社体験です。ブラウザーを開いて、手水で清め、参拝し、おみくじを引いたり、絵馬に願いを記したり。ご自分の歩幅でお過ごしください。</p>
        <a class="enter-link" href="/">境内へ入る <span aria-hidden="true">→</span></a>
        <figure class="shrine-view">
          <img src="${SITE.image}" alt="${SITE.imageAlt}" width="1200" height="630" decoding="async" fetchpriority="high" />
          <figcaption>ブラウザーの中に広がる、こもれび神社の境内。</figcaption>
        </figure>
      </section>

      <nav class="page-contents" aria-label="このページの案内">
        <a href="#experiences">境内でできること</a>
        <a href="#how-to-visit">遊び方</a>
        <a href="#ema-and-records">絵馬と記録</a>
        <a href="#questions">よくあるご質問</a>
      </nav>

      <section id="experiences" class="guide-section" aria-labelledby="experiences-title">
        <h2 id="experiences-title">境内でできること</h2>
        <div class="section-content">
          <ol class="experiences">
            <li>
              <h3>手水で手と口を清める</h3>
              <p>柄杓を使い、左手、右手、口、柄杓の柄の順に清めます。体験中はカメラが手元に寄ります。画面右上の音の設定をオンにしていると、水音も聞こえます。</p>
            </li>
            <li>
              <h3>拝殿で参拝する</h3>
              <p>拝殿の前で、二礼二拍手一礼。旅人が立ち位置を整え、作法に沿ってゆっくり参拝します。</p>
            </li>
            <li>
              <h3>おみくじを引く</h3>
              <p>「おみくじを引く」を押すと筒が揺れ、番号が現れます。続いて御神籤をひらくと、運勢の言葉と、願望・待人・失物・旅行などの項目をお読みいただけます。</p>
            </li>
            <li>
              <h3>絵馬に願いを書く</h3>
              <p>絵柄を選び、短い願いと任意の名前を書いて絵馬掛所へ。同じ境内を訪れた人の絵馬も読むことができます。</p>
            </li>
          </ol>
        </div>
      </section>

      <section id="how-to-visit" class="guide-section" aria-labelledby="how-to-visit-title">
        <h2 id="how-to-visit-title">遊び方</h2>
        <div class="section-content">
          <p>ログインせずに、ブラウザーから入れます。画面下の場所を選ぶと、旅人がそこまで歩いて向かいます。</p>
          <dl class="controls">
            <div><dt>パソコン</dt><dd>地面をクリックするか、WASD・矢印キーで歩きます。ドラッグで見渡し、マウスホイールで距離を調節できます。</dd></div>
            <div><dt>スマートフォン</dt><dd>地面のタップ、または画面のジョイスティックで歩きます。スワイプで見渡し、近くの場所で体験ボタンを押してください。</dd></div>
          </dl>
          <p>ひとつの境内には最大${ROOM_CAPACITY}人が入れます。画面左上の参拝者数を押すと、別の境内を選んで移動できます。</p>
        </div>
      </section>

      <section id="ema-and-records" class="guide-section" aria-labelledby="ema-and-records-title">
        <h2 id="ema-and-records-title">絵馬と記録</h2>
        <div class="section-content">
          <p>絵馬は、ひとつのブラウザーにつき全ての境内を通して1枚、${FREE_LANTERN_POLICY.durationHours}時間掲示されます。願いの本文と、書き添えた名前は、掛けた境内の訪問者に公開されます。</p>
          <p>境内を移動しても、絵馬は元の場所に残ります。自分の絵馬を外すか、掲示期間が終わると、また掛けられます。</p>
          <p>訪問や参拝などの記録は、同じブラウザーの訪問者として保存されます。サイトデータの削除や、別の端末・ブラウザーへの変更で、別の訪問者として扱われることがあります。</p>
        </div>
      </section>

      <section id="questions" class="guide-section" aria-labelledby="questions-title">
        <h2 id="questions-title">よくあるご質問</h2>
        <div class="section-content questions">
          <details>
            <summary>スマートフォンでも訪れられますか？</summary>
            <p>スマートフォンのブラウザーでもご利用いただけます。境内を歩く体験には、JavaScriptとWebGLが動作する環境が必要です。アプリのインストールは不要です。</p>
          </details>
          <details>
            <summary>別の境内に移動すると、絵馬が見えません。</summary>
            <p>絵馬は、掛けた境内だけに表示されます。移動後も元の境内に残り、掛かっている間は別の境内に追加できません。画面に表示される、自分の絵馬の場所をご確認ください。</p>
          </details>
          <details>
            <summary>前に訪れたときの記録が見つかりません。</summary>
            <p>同じブラウザーのサイトデータを使って訪問者を区別しています。サイトデータを削除したり、別の端末・ブラウザーを使ったりすると、別の訪問者になります。絵馬を掛けたときのブラウザーをご利用ください。</p>
          </details>
        </div>
      </section>

      <p class="closing">ひと息ついたら、境内へ。</p>
      <div class="closing-action"><a class="enter-link" href="/">境内へ入る <span aria-hidden="true">→</span></a></div>
    </main>

    <footer class="page-footer page-width">
      <span>${SITE.name}</span>
      <a href="/">境内へ戻る <span aria-hidden="true">→</span></a>
    </footer>
  </body>
</html>`;
}
