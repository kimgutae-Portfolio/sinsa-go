/**
 * Lightweight filter for public ema wishes. It blocks contact details / links
 * (the most common spam) and a short list of abusive or explicit words in
 * Japanese, Korean and English. It is a first line of defence only; visitor
 * reports and the admin page handle what slips through.
 */

// Words are matched after normalisation (NFKC, lower case, katakana → hiragana,
// spaces and punctuation removed), so write them in that form.
const BLOCKED_WORDS = [
  // Japanese
  "しね",
  "死ね",
  "しねよ",
  "しねばいい",
  "しんでしまえ",
  "殺す",
  "殺してやる",
  "ころしてやる",
  "きえろ",
  "消えろ",
  "くたばれ",
  "きもい",
  "きしょい",
  "ぶす",
  "かす",
  "ごみくず",
  "しなちく",
  "えた",
  "せっくす",
  "ちんこ",
  "まんこ",
  "おっぱい",
  "えろ",
  "やりまん",
  "れいぷ",
  "強姦",
  "覚醒剤",
  // Korean
  "시발",
  "씨발",
  "ㅅㅂ",
  "병신",
  "ㅂㅅ",
  "좆",
  "지랄",
  "개새끼",
  "꺼져",
  "죽어",
  "죽여",
  "섹스",
  // English
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "porn",
  "sex",
  "rape",
  "killyourself",
  "kys",
];
// Short words that also hide inside harmless ones (ほしねがい, grape) must stand alone.
const STANDALONE_ONLY = new Set([
  "kys",
  "sex",
  "rape",
  "しね",
  "えた",
  "かす",
  "ぶす",
  "えろ",
]);

const CONTACT_PATTERNS = [
  /https?:|www\.|:\/\//iu,
  /[a-z0-9-]+\.(com|net|org|jp|io|me|ly|co|kr|xyz|info|app|link|site)\b/iu,
  /[\w.+-]+@[\w-]+\.[\w.]+/u,
  /(line|らいん|insta|いんすた|twitter|ついったー|ついった|discord|telegram|kakao|카톡|카카오)\s*(id|あいでぃ)?\s*[:：]/iu,
  /\d[\d\s-]{8,}\d/u,
  /@[a-z0-9_]{3,}/iu,
];

function normalise(text: string) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/gu, (c) =>
      String.fromCharCode(c.charCodeAt(0) - 0x60),
    )
    .replace(/ー/gu, "");
}

function compact(text: string) {
  return text.replace(/[\s\p{P}\p{S}_]/gu, "");
}

/** Returns a visitor-facing reason when the text must not be published. */
export function wishProblem(text: string): string | null {
  const plain = normalise(text);
  if (CONTACT_PATTERNS.some((pattern) => pattern.test(plain)))
    return "連絡先やリンクは書けません。願いごとだけをお書きください。";
  const joined = compact(plain);
  const tokens = plain.split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
  for (const word of BLOCKED_WORDS) {
    const target = compact(normalise(word));
    const hit = STANDALONE_ONLY.has(word)
      ? tokens.includes(target) || joined === target
      : joined.includes(target);
    if (hit)
      return "ほかの方を傷つけるおそれのある言葉は書けません。言葉を変えてお書きください。";
  }
  return null;
}

/** Distinct visitors needed before a reported ema is taken down automatically. */
export const REPORT_THRESHOLD = 3;
