import { ALIGN_DURATION, TEMIZU_DURATION, TEMIZU_STEPS } from "../game/ritual";

/** Original water sound: a ladle dip, small palm pours, and the final handle rinse. */
export const TEMIZU_SOUND_SECONDS = TEMIZU_DURATION + 0.16;

export function createTemizuSound(sampleRate: number): Float32Array<ArrayBuffer> {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new RangeError("Unsupported temizu sound sample rate");

  const samples = new Float32Array(Math.ceil(sampleRate * TEMIZU_SOUND_SECONDS));
  const tau = Math.PI * 2;
  let seed = 84031;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const smooth = (value: number) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  };

  function drop(start: number, strength: number, low = false) {
    const first = Math.round(start * sampleRate);
    const duration = low ? 0.105 : 0.065;
    const frequency = (low ? 490 : 1050) + random() * (low ? 290 : 1100);
    const radius = Math.exp(-1 / (sampleRate * (low ? 0.014 : 0.006)));
    const phase = tau * frequency / sampleRate;
    const coefficient = 2 * radius * Math.cos(phase);
    const radiusSquared = radius * radius;
    let previous = -Math.sin(phase) / radius, current = 0;
    const noisePole = Math.exp(-1 / (sampleRate * 0.003));
    const lowCoefficient = 1 - Math.exp(-tau * 2400 / sampleRate);
    let contact = 1, filtered = 0;
    for (let i = 0; i < duration * sampleRate && first + i < samples.length; i++) {
      const noise = random() * 2 - 1;
      filtered += lowCoefficient * (noise - filtered);
      const attack = Math.min(1, i / (sampleRate * 0.0018));
      samples[first + i]! += strength * attack * (current * 0.24 + filtered * contact * 0.8);
      const next = coefficient * current - radiusSquared * previous;
      previous = current;
      current = next;
      contact *= noisePole;
    }
  }

  function pour(start: number, duration: number, strength: number, thin = false) {
    const first = Math.round(start * sampleRate);
    const lowCoefficient = 1 - Math.exp(-tau * (thin ? 900 : 500) / sampleRate);
    const highCoefficient = 1 - Math.exp(-tau * (thin ? 4700 : 3400) / sampleRate);
    const rippleCoefficient = 1 - Math.exp(-tau * 17 / sampleRate);
    let low = 0, high = 0, ripple = 0;
    for (let i = 0; i < duration * sampleRate && first + i < samples.length; i++) {
      const t = i / sampleRate;
      const noise = random() * 2 - 1;
      low += lowCoefficient * (noise - low);
      high += highCoefficient * (noise - high);
      ripple += rippleCoefficient * (noise - ripple);
      const envelope = smooth(t / 0.09) * smooth((duration - t) / 0.18);
      // Irregular little contacts keep the falling water from sounding like steady hiss.
      const texture = Math.max(0.18, Math.min(1.1, 0.56 + ripple * 7));
      samples[first + i]! += strength * envelope * texture * (high - low + low * 0.26);
    }
    for (let time = 0.065; time < duration - 0.045; time += 0.043 + random() * 0.042) {
      const edge = Math.min(1, time / 0.14, (duration - time) / 0.18);
      drop(start + time, strength * edge * (0.11 + random() * 0.16), random() > 0.7);
    }
  }

  function drips(start: number, strength: number) {
    for (let i = 0; i < 3; i++)
      drop(start + i * 0.11 + random() * 0.025, strength * (1 - i * 0.22));
  }

  let start = ALIGN_DURATION;
  for (const step of TEMIZU_STEPS) {
    const at = (phase: number) => start + step.duration * phase;
    if (step.kind === "left") {
      // The ladle is filled once, before the left palm receives the first pour.
      pour(at(0.075), step.duration * 0.16, 0.30);
      drop(at(0.10), 0.22, true);
      drips(at(0.25), 0.08);
    }
    if (step.kind === "left" || step.kind === "right") {
      pour(at(0.27), step.duration * 0.42, 0.62);
      drips(at(0.73), 0.12);
    } else if (step.kind === "mouth") {
      // Only water into the cupped hand and runoff; the ladle never touches the mouth.
      pour(at(0.20), step.duration * 0.22, 0.43);
      drips(at(0.55), 0.075);
    } else {
      pour(at(0.25), step.duration * 0.51, 0.38, true);
      drips(at(0.77), 0.095);
    }
    start += step.duration;
  }

  // Remove low offsets; finite fades prevent clicks if the buffer ends naturally.
  const dcPole = Math.exp(-tau * 32 / sampleRate);
  let previousInput = 0, previousOutput = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const input = samples[i]!;
    const output = input - previousInput + dcPole * previousOutput;
    previousInput = input;
    previousOutput = output;
    const fade = Math.min(1, i / (sampleRate * 0.008), (samples.length - 1 - i) / (sampleRate * 0.04));
    samples[i] = output * fade;
    peak = Math.max(peak, Math.abs(samples[i]!));
  }
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i]! *= 0.44 / peak;
  return samples;
}
