/* AudioWorkletProcessor: mono mic input → 16 kHz Int16 frames (20 ms) + RMS level.
 *
 * Posts { pcm: ArrayBuffer (Int16 LE, 320 samples), rms: number } to the main thread.
 * Resamples from the context's native rate with linear interpolation, so it works even when
 * the browser ignores a requested 16 kHz AudioContext (Safari).
 * Mirrors lib/voice/pcm.ts (floatToInt16 / resampleLinear / rms); keep them in sync.
 */
const TARGET_RATE = 16000;
const FRAME_SAMPLES = 320;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE; // input samples per output sample
    this.position = 0; // fractional read position into `pending`
    this.pending = new Float32Array(0);
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.filled = 0;
    this.sumSquares = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;

    const merged = new Float32Array(this.pending.length + channel.length);
    merged.set(this.pending, 0);
    merged.set(channel, this.pending.length);

    let pos = this.position;
    while (pos + 1 < merged.length) {
      const left = Math.floor(pos);
      const frac = pos - left;
      const sample = merged[left] * (1 - frac) + merged[left + 1] * frac;
      const clipped = Math.max(-1, Math.min(1, sample));
      this.frame[this.filled++] = clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff);
      this.sumSquares += clipped * clipped;
      if (this.filled === FRAME_SAMPLES) {
        const rms = Math.sqrt(this.sumSquares / FRAME_SAMPLES);
        const out = this.frame.buffer.slice(0);
        this.port.postMessage({ pcm: out, rms }, [out]);
        this.filled = 0;
        this.sumSquares = 0;
      }
      pos += this.ratio;
    }

    const consumed = Math.min(Math.floor(pos), merged.length);
    this.pending = merged.slice(consumed);
    this.position = pos - consumed;
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
