import { DAIKICHI_CONTENT } from "./fortune-content/daikichi";
import { CHUKICHI_CONTENT } from "./fortune-content/chukichi";
import { SHOKICHI_CONTENT } from "./fortune-content/shokichi";
import { KICHI_CONTENT } from "./fortune-content/kichi";
import { SUEKICHI_CONTENT } from "./fortune-content/suekichi";

export const FORTUNE_CATEGORIES = [
  { key: "wish", label: "願望", reading: "ねがいごと" },
  { key: "visitor", label: "待人", reading: "まちびと" },
  { key: "lost", label: "失物", reading: "うせもの" },
  { key: "travel", label: "旅行", reading: "たびだち" },
  { key: "business", label: "商売", reading: "あきない" },
  { key: "study", label: "学問", reading: "がくもん" },
  { key: "relationship", label: "縁談", reading: "えんだん" },
  { key: "moving", label: "転居", reading: "やうつり" },
] as const;

export type FortuneCategory = typeof FORTUNE_CATEGORIES[number]["key"];

export interface Fortune {
  number: number;
  title: string;
  reading: string;
  message: string;
  detail: string;
  readings: Record<FortuneCategory, string>;
}
export type FortuneContent = Omit<Fortune, "number" | "title" | "reading">;

function withGrade(title: string, reading: string, contents: FortuneContent[]): Omit<Fortune, "number">[] {
  return contents.map(content => ({ title, reading, ...content }));
}

// Twenty authored sets per grade keep each grade at 20% and each complete set at 1%.
export const FORTUNES: Fortune[] = [
  ...withGrade("大吉", "だいきち", DAIKICHI_CONTENT),
  ...withGrade("中吉", "ちゅうきち", CHUKICHI_CONTENT),
  ...withGrade("小吉", "しょうきち", SHOKICHI_CONTENT),
  ...withGrade("吉", "きち", KICHI_CONTENT),
  ...withGrade("末吉", "すえきち", SUEKICHI_CONTENT),
].map((fortune, index) => ({ number: index + 1, ...fortune }));

export function formatFortuneNumber(number: number) {
  if (number === 100) return "百";
  const digits = "〇一二三四五六七八九";
  const tens = Math.floor(number / 10), ones = number % 10;
  return (tens ? `${tens > 1 ? digits[tens] : ""}十` : "") + (ones ? digits[ones] : "");
}
export function drawFortune(random = Math.random) {
  return FORTUNES[
    Math.min(
      FORTUNES.length - 1,
      Math.max(0, Math.floor(random() * FORTUNES.length)),
    )
  ]!;
}
