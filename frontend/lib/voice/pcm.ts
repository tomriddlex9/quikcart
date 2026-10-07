// Pure PCM helpers shared by capture, playback and tests (no DOM, no Web Audio).

export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;
export const INPUT_MIME = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`;

/** Float [-1, 1] → little-endian-agnostic Int16 with clipping. */
export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function int16ToFloat(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) out[i] = input[i] / (input[i] < 0 ? 0x8000 : 0x7fff);
  return out;
}

/** Root-mean-square of a float block, 0..1. */
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function rmsInt16(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] / 0x8000;
    sum += v * v;
  }
  return Math.sqrt(sum / samples.length);
}

/** Map a raw RMS (speech is rarely above ~0.3) to a 0..1 orb level. */
export function normalizeLevel(value: number, gain = 3.2): number {
  return Math.max(0, Math.min(1, value * gain));
}

/** Linear-interpolation resampler (mono). Returns the input untouched when rates match. */
export function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    out[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return out;
}

export function int16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Base64 of little-endian PCM16 → Int16Array (odd trailing byte is dropped). */
export function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const even = binary.length - (binary.length % 2);
  const out = new Int16Array(even / 2);
  for (let i = 0; i < out.length; i++) {
    const lo = binary.charCodeAt(2 * i);
    const hi = binary.charCodeAt(2 * i + 1);
    const v = (hi << 8) | lo;
    out[i] = v & 0x8000 ? v - 0x10000 : v;
  }
  return out;
}

/** Parse the sample rate out of a mime type such as `audio/pcm;rate=24000`. */
export function rateFromMime(mime: string | undefined, fallback = OUTPUT_SAMPLE_RATE): number {
  const match = /rate=(\d+)/.exec(mime ?? "");
  return match ? Number(match[1]) : fallback;
}
