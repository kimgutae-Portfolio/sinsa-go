export const RITUAL_STEPS = [
  { label: "一礼目", duration: 1.4, kind: "bow" },
  { label: "二礼目", duration: 1.4, kind: "bow" },
  { label: "一拍手目", duration: 0.8, kind: "clap" },
  { label: "二拍手目", duration: 0.8, kind: "clap" },
  { label: "最後の一礼", duration: 1.7, kind: "bow" },
] as const;
export const ALIGN_DURATION = 0.6;
export const RITUAL_DURATION =
  ALIGN_DURATION + RITUAL_STEPS.reduce((sum, step) => sum + step.duration, 0);
export function ritualFrame(elapsed: number) {
  let time = elapsed - ALIGN_DURATION;
  if (time < 0)
    return { index: -1, phase: 0, kind: "align" as const, done: false };
  for (let i = 0; i < RITUAL_STEPS.length; i++) {
    const step = RITUAL_STEPS[i]!;
    if (time < step.duration)
      return {
        index: i,
        phase: Math.max(0, time / step.duration),
        kind: step.kind,
        done: false,
      };
    time -= step.duration;
  }
  return { index: 4, phase: 1, kind: "bow" as const, done: true };
}

/** 手水: the four purification steps at the basin, played locally. */
export const TEMIZU_STEPS = [
  { label: "左手を清める", short: "左手", duration: 2, kind: "left" },
  { label: "右手を清める", short: "右手", duration: 2, kind: "right" },
  { label: "口をすすぐ", short: "口", duration: 2.4, kind: "mouth" },
  { label: "柄杓を清める", short: "柄杓", duration: 1.8, kind: "handle" },
] as const;
export type TemizuKind = (typeof TEMIZU_STEPS)[number]["kind"];
export const TEMIZU_DURATION =
  ALIGN_DURATION + TEMIZU_STEPS.reduce((sum, step) => sum + step.duration, 0);
export function temizuFrame(elapsed: number) {
  let time = elapsed - ALIGN_DURATION;
  if (time < 0)
    return { index: -1, phase: 0, kind: "align" as const, done: false };
  for (let i = 0; i < TEMIZU_STEPS.length; i++) {
    const step = TEMIZU_STEPS[i]!;
    if (time < step.duration)
      return { index: i, phase: time / step.duration, kind: step.kind, done: false };
    time -= step.duration;
  }
  return { index: TEMIZU_STEPS.length - 1, phase: 1, kind: "handle" as const, done: true };
}
