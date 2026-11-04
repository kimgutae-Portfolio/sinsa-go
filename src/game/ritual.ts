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
