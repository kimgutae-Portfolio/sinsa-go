/** Original sound design: dry wood collisions followed by a stick sliding out. */
export const OMIKUJI_SOUND_SECONDS = 1.8;
export const OMIKUJI_REDUCED_SOUND_SECONDS = 0.24;

export function createOmikujiSound(
  sampleRate: number,
  reducedMotion = false,
  seed = 39071,
): Float32Array<ArrayBuffer> {
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000)
    throw new RangeError("Unsupported omikuji sound sample rate");

  const seconds = reducedMotion ? OMIKUJI_REDUCED_SOUND_SECONDS : OMIKUJI_SOUND_SECONDS;
  const samples = new Float32Array(Math.ceil(sampleRate * seconds));
  let randomState = seed >>> 0;
  const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 4294967296);
  const tau = Math.PI * 2;

  function strike(start: number, strength: number, body = 1) {
    const first = Math.round(start * sampleRate);
    const duration = 0.13;
    const pitch = 0.92 + random() * 0.16;
    // Broad, short resonances keep this woody rather than bell-like or musical.
    const modes = [
      [238 * pitch, 0.039, 0.24 * body],
      [574 * pitch, 0.027, 0.26],
      [1117 * pitch, 0.018, 0.20],
      [2160 * pitch, 0.009, 0.10],
    ].map(([frequency, decay, amount]) => {
      const radius = Math.exp(-1 / (sampleRate * decay!));
      const phase = tau * frequency! / sampleRate;
      return {
        coefficient: 2 * radius * Math.cos(phase),
        radiusSquared: radius * radius,
        previous: -amount! * Math.sin(phase) / radius,
        current: 0,
      };
    });
    const noiseCoefficient = 1 - Math.exp(-tau * 3300 / sampleRate);
    const attackPole = Math.exp(-4500 / sampleRate);
    const contactPole = Math.exp(-1 / (sampleRate * 0.0035));
    let attackRemaining = 1, contactRemaining = 1;
    let noiseLow = 0;
    for (let i = 0; i < duration * sampleRate && first + i < samples.length; i++) {
      let resonances = 0;
      for (const mode of modes) {
        resonances += mode.current;
        const next = mode.coefficient * mode.current - mode.radiusSquared * mode.previous;
        mode.previous = mode.current;
        mode.current = next;
      }
      const noise = random() * 2 - 1;
      noiseLow += noiseCoefficient * (noise - noiseLow);
      const contact = (noise - noiseLow * 0.65) * contactRemaining * 0.38;
      samples[first + i]! += strength * (1 - attackRemaining) * (resonances + contact);
      attackRemaining *= attackPole;
      contactRemaining *= contactPole;
    }
  }

  function slide(start: number, duration: number, strength: number) {
    const first = Math.round(start * sampleRate);
    let low = 0, mid = 0;
    const lowCoefficient = 1 - Math.exp(-tau * 650 / sampleRate);
    const highCoefficient = 1 - Math.exp(-tau * 3900 / sampleRate);
    for (let i = 0; i < duration * sampleRate && first + i < samples.length; i++) {
      const t = i / sampleRate;
      const progress = t / duration;
      const noise = random() * 2 - 1;
      low += lowCoefficient * (noise - low);
      mid += highCoefficient * (noise - mid);
      const envelope = Math.sin(Math.PI * progress) ** 1.5;
      const grain = 0.36 + 0.30 * Math.sin(tau * 37 * t + 0.8 * Math.sin(tau * 9 * t)) ** 2;
      samples[first + i]! += (mid - low) * envelope * grain * strength;
    }
  }

  if (reducedMotion) {
    slide(0.006, 0.115, 0.16);
    strike(0.085, 0.40, 0.55);
  } else {
    // Reversals of the visible shake produce clusters of loose wooden sticks.
    for (const [time, strength] of [
      [0.16, 0.48], [0.28, 0.70], [0.40, 0.80], [0.53, 0.72],
      [0.66, 0.65], [0.79, 0.46], [0.90, 0.23],
    ]) {
      const contactTime = time! + (random() - 0.5) * 0.016;
      strike(contactTime, strength!);
      strike(contactTime + 0.018 + random() * 0.020, strength! * 0.45, 0.55);
      strike(contactTime + 0.047 + random() * 0.016, strength! * 0.20, 0.35);
    }
    slide(0.81, 0.69, 0.20);
    // Small contacts at the slot, ending when the number is fully revealed.
    strike(0.99, 0.11, 0.30);
    strike(1.24, 0.08, 0.25);
    strike(1.575, 0.30, 0.50);
  }

  // Remove slow offsets from the friction and leave both boundaries silent.
  const dcPole = Math.exp(-tau * 35 / sampleRate);
  let previousInput = 0, previousOutput = 0, peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const input = samples[i]!;
    const output = input - previousInput + dcPole * previousOutput;
    previousInput = input;
    previousOutput = output;
    const fade = Math.min(1, i / (sampleRate * 0.003), (samples.length - 1 - i) / (sampleRate * 0.008));
    samples[i] = output * fade;
    peak = Math.max(peak, Math.abs(samples[i]!));
  }
  const level = reducedMotion ? 0.30 : 0.48;
  if (peak > 0) for (let i = 0; i < samples.length; i++) samples[i]! *= level / peak;
  return samples;
}
