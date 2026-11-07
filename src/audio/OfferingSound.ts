/** A small brass coin settling inside a wooden offering box; entirely synthesized. */
export const OFFERING_SOUND_SECONDS = 0.72;
export const OFFERING_REDUCED_SOUND_SECONDS = 0.18;

export function createOfferingSound(
  sampleRate: number,
  reducedMotion = false,
): Float32Array<ArrayBuffer> {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new RangeError("Unsupported offering sound sample rate");
  const seconds = reducedMotion ? OFFERING_REDUCED_SOUND_SECONDS : OFFERING_SOUND_SECONDS;
  const samples = new Float32Array(Math.ceil(sampleRate * seconds));
  const tau = Math.PI * 2;
  let seed = 51277;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

  function contact(start: number, strength: number, wood = false) {
    const first = Math.round(start * sampleRate);
    const duration = wood ? 0.12 : 0.19;
    const modes = (wood ? [
      [192, 0.027, 0.70], [347, 0.021, 0.34], [783, 0.012, 0.15],
    ] : [
      [1681, 0.036, 0.50], [2917, 0.026, 0.24], [4289, 0.018, 0.12], [6143, 0.010, 0.05],
    ]).filter(([frequency]) => frequency! < sampleRate * 0.45).map(([frequency, decay, amount]) => {
      const radius = Math.exp(-1 / (sampleRate * decay!));
      const phase = tau * frequency! / sampleRate;
      return { coefficient: 2 * radius * Math.cos(phase), radiusSquared: radius * radius,
        previous: -amount! * Math.sin(phase) / radius, current: 0 };
    });
    let noiseLow = 0;
    const filter = 1 - Math.exp(-tau * (wood ? 1800 : 4200) / sampleRate);
    for (let i = 0; i < duration * sampleRate && first + i < samples.length; i++) {
      const t = i / sampleRate;
      let resonance = 0;
      for (const mode of modes) {
        resonance += mode.current;
        const next = mode.coefficient * mode.current - mode.radiusSquared * mode.previous;
        mode.previous = mode.current;
        mode.current = next;
      }
      const noise = random() * 2 - 1;
      noiseLow += filter * (noise - noiseLow);
      const attack = Math.min(1, t / 0.0015);
      const edge = Math.min(1, (duration - t) / 0.012);
      samples[first + i]! += strength * attack * edge *
        (resonance + noiseLow * Math.exp(-t / 0.003) * (wood ? 0.22 : 0.08));
    }
  }

  if (reducedMotion) {
    contact(0.012, 0.24);
    contact(0.018, 0.46, true);
  } else {
    contact(0.018, 0.12); // A quiet touch as the coin leaves the visitor's hand.
    contact(0.45, 0.30);
    contact(0.459, 0.58, true);
    contact(0.505, 0.09, true);
  }

  // Keep both ends silent and leave ample headroom for the existing ambience.
  const dcPole = Math.exp(-tau * 35 / sampleRate);
  let previousInput = 0, previousOutput = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const input = samples[i]!;
    const output = input - previousInput + dcPole * previousOutput;
    previousInput = input;
    previousOutput = output;
    const fade = Math.min(1, i / (sampleRate * 0.003), (samples.length - 1 - i) / (sampleRate * 0.02));
    samples[i] = output * fade;
    peak = Math.max(peak, Math.abs(samples[i]!));
  }
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i]! *= (reducedMotion ? 0.20 : 0.26) / peak;
  return samples;
}
