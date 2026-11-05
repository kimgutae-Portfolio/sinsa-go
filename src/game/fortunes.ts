import { DAIKICHI_CONTENT } from "./fortune-content/daikichi";
import { CHUKICHI_CONTENT } from "./fortune-content/chukichi";
import { SHOKICHI_CONTENT } from "./fortune-content/shokichi";
import { KICHI_CONTENT } from "./fortune-content/kichi";
import { SUEKICHI_CONTENT } from "./fortune-content/suekichi";

export interface Fortune {
  title: string;
  reading: string;
  message: string;
  detail: string;
  wish: string;
  color: string;
  item: string;
}
export type FortuneContent = Omit<Fortune, "title" | "reading">;

function withGrade(title: string, reading: string, contents: FortuneContent[]): Fortune[] {
  return contents.map(content => ({ title, reading, ...content }));
}

// Twenty authored sets per grade keep each grade at 20% and each complete set at 1%.
export const FORTUNES: Fortune[] = [
  ...withGrade("大吉", "だいきち", DAIKICHI_CONTENT),
  ...withGrade("中吉", "ちゅうきち", CHUKICHI_CONTENT),
  ...withGrade("小吉", "しょうきち", SHOKICHI_CONTENT),
  ...withGrade("吉", "きち", KICHI_CONTENT),
  ...withGrade("末吉", "すえきち", SUEKICHI_CONTENT),
];
export function drawFortune(random = Math.random) {
  return FORTUNES[
    Math.min(
      FORTUNES.length - 1,
      Math.max(0, Math.floor(random() * FORTUNES.length)),
    )
  ]!;
}
