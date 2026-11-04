export interface Fortune {
  title: string;
  reading: string;
  message: string;
  detail: string;
  wish: string;
  color: string;
  item: string;
}
export const FORTUNES: Fortune[] = [
  {
    title: "大吉",
    reading: "だいきち",
    message: "あなたに、よい風が吹いています。",
    detail:
      "長くあたためてきた想いが、花をひらくとき。小さな勇気を出して、一歩を踏み出してみてください。思いがけない喜びが、すぐそばにあります。",
    wish: "願っていたことが、一歩近づきます。",
    color: "木漏れ日のような黄色",
    item: "あたたかいお茶",
  },
  {
    title: "中吉",
    reading: "ちゅうきち",
    message: "ゆっくり、あなたの歩幅で。",
    detail:
      "急がなくても大丈夫。日々の小さな積み重ねが、確かな道になります。今日は身近な人に、やさしい言葉をかけてみてください。",
    wish: "こつこつとした想いが、実を結びます。",
    color: "若葉の黄緑色",
    item: "お気に入りの本",
  },
  {
    title: "小吉",
    reading: "しょうきち",
    message: "小さな幸せが、あなたを待っています。",
    detail:
      "見慣れた景色にも、新しい発見が隠れています。少し顔を上げて、空を見てみましょう。何気ない一日にも、贈りものがあります。",
    wish: "小さな機会を、大切に。",
    color: "さくらの淡い桃色",
    item: "手書きの手紙",
  },
  {
    title: "吉",
    reading: "きち",
    message: "今の歩みも、十分にすてきです。",
    detail:
      "あなたが重ねてきた時間は、なくなりません。自分を信じて、もう少し進んでみてください。よいご縁が、その道に寄り添ってくれるでしょう。",
    wish: "信じて、穏やかに待ってみましょう。",
    color: "晴れた空の青色",
    item: "小さな手帳",
  },
  {
    title: "末吉",
    reading: "すえきち",
    message: "よいことは、ちょうどよいときに。",
    detail:
      "まだ咲かない花にも、春は訪れます。今日はゆっくり休んで、明日のための余白を残しましょう。待った先に、うれしい便りが届くかもしれません。",
    wish: "時を重ねると、道がひらけます。",
    color: "静かな森の緑色",
    item: "散歩道で見つけた葉っぱ",
  },
];
export function drawFortune(random = Math.random) {
  return FORTUNES[
    Math.min(
      FORTUNES.length - 1,
      Math.max(0, Math.floor(random() * FORTUNES.length)),
    )
  ]!;
}
