// Original, deterministic sound design. Requires ffmpeg on PATH; no external samples.
import { writeFile, unlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rate = 32000, seconds = 48, length = rate * seconds;
const channels = [new Float64Array(length), new Float64Array(length)];
let seed = 79247;
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const tau = Math.PI * 2;
function add(start, duration, pan, sample) {
  const left = Math.sqrt((1 - pan) / 2), right = Math.sqrt((1 + pan) / 2);
  for (let i = 0; i < duration * rate; i++) {
    const value = sample(i / rate);
    const index = (Math.floor(start * rate) + i) % length;
    channels[0][index] += value * left;
    channels[1][index] += value * right;
  }
}
// Periodic forest breeze: filter a second cycle so the seam has no transient.
for (let c = 0; c < 2; c++) {
  const noise = Float64Array.from({ length }, () => random() * 2 - 1);
  let low = 0, slow = 0;
  for (let i = 0; i < length * 2; i++) {
    const index = i % length, t = index / rate;
    low += 0.065 * (noise[index] - low);
    slow += 0.004 * (low - slow);
    if (i >= length) channels[c][index] = (low * 0.12 + slow * 0.22) *
      (0.65 + 0.17 * Math.sin(tau * t / 16 + c) + 0.12 * Math.sin(tau * t / 24));
  }
}
// Small, distant birds, with irregular spacing and pitch sweeps.
for (const start of [2.1, 7.8, 15.4, 26.2, 35.8, 43.1]) {
  const pan = random() * 1.4 - 0.7, base = 2100 + random() * 900;
  for (let j = 0; j < 2 + Math.floor(random() * 3); j++) {
    const duration = 0.11 + random() * 0.09;
    add(start + j * 0.26, duration, pan, t =>
      0.025 * Math.sin(Math.PI * t / duration) ** 2 *
      Math.sin(tau * (base * t + 450 * t * t / duration + 13 * Math.sin(40 * t))));
  }
}
// Sparse breathy pentatonic phrases, inspired by bamboo flute timbres.
for (const [start, midi, duration, pan] of [
  [0.8, 62, 4.3, -0.25], [6.4, 65, 3.8, -0.1], [12.1, 67, 5.3, 0.15],
  [20.5, 69, 4.6, 0.2], [27.3, 67, 3.7, 0.05], [33.4, 65, 4.5, -0.15],
  [41, 62, 5.5, -0.25],
]) {
  const f = 440 * 2 ** ((midi - 69) / 12);
  const tone = t => {
    const env = Math.sin(Math.PI * t / duration) ** 2;
    const phase = tau * f * t + 0.13 * Math.sin(tau * 4.5 * t);
    return env * (0.031 * Math.sin(phase) + 0.006 * Math.sin(phase * 2) +
      0.002 * Math.sin(phase * 3) + 0.0015 * (random() * 2 - 1));
  };
  add(start, duration, pan, tone);
  // A quiet, diffuse tail rather than an intrusive melody.
  for (const delay of [0.31, 0.61, 0.97])
    add(start + delay, duration, -pan, t => tone(t) * 0.12);
}
// Distant small metal bells, deliberately unlike a large temple gong.
for (const start of [10.2, 30.8]) {
  add(start, 9, 0.45, t => {
    const attack = 1 - Math.exp(-t * 130);
    return attack * [1, 2.73, 4.17, 5.43].reduce((sum, ratio, i) =>
      sum + 0.025 / (i + 1) * Math.exp(-t * (0.62 + i * 0.24)) *
      Math.sin(tau * 1230 * ratio * t), 0);
  });
}
const peak = Math.max(...channels.map(ch => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
const pcm = Buffer.alloc(length * 2 * 2);
for (let i = 0; i < length; i++) for (let c = 0; c < 2; c++)
  pcm.writeInt16LE(Math.round(channels[c][i] / peak * 0.48 * 32767), (i * 2 + c) * 2);
const wav = Buffer.alloc(44);
wav.write('RIFF'); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28);
wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
wav.writeUInt32LE(pcm.length, 40);
const temporary = join(tmpdir(), `komorebi-sound-${process.pid}.wav`);
await writeFile(temporary, Buffer.concat([wav, pcm]));
try {
  const output = fileURLToPath(new URL('../public/audio/shrine-garden.mp3', import.meta.url));
  const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', temporary,
    '-codec:a', 'libmp3lame', '-b:a', '112k', '-map_metadata', '-1', output], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('ffmpeg failed');
  console.log(`Created ${output} (48s stereo, original synthesis)`);
} finally { await unlink(temporary); }
