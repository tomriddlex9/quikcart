"use client";

// Gapless 24 kHz PCM playback. Chunks are scheduled back-to-back on a single AudioContext;
// `flush()` (on a Live `interrupted` event or barge-in) drops everything still queued.

import { OUTPUT_SAMPLE_RATE, int16ToFloat, normalizeLevel, rms } from "@/lib/voice/pcm";

export interface AudioPlayer {
  enqueue: (pcm: Int16Array, sampleRate?: number) => void;
  flush: () => void;
  setMuted: (muted: boolean) => void;
  /** Current smoothed 0..1 output level (poll from rAF). */
  getLevel: () => number;
  /** Number of chunks still scheduled. */
  pending: () => number;
  close: () => Promise<void>;
}

export interface AudioPlayerOptions {
  /** Fired when the queue empties after audio was playing. */
  onDrained?: () => void;
}

export function createAudioPlayer(options: AudioPlayerOptions = {}): AudioPlayer {
  type Ctor = typeof AudioContext;
  const Ctx: Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext;
  const context = new Ctx({ sampleRate: OUTPUT_SAMPLE_RATE, latencyHint: "interactive" });
  const gain = context.createGain();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  gain.connect(analyser);
  analyser.connect(context.destination);
  const samples = new Float32Array(analyser.fftSize);

  const live = new Set<AudioBufferSourceNode>();
  let nextTime = 0;
  let level = 0;

  const enqueue = (pcm: Int16Array, sampleRate = OUTPUT_SAMPLE_RATE) => {
    if (pcm.length === 0) return;
    if (context.state === "suspended") void context.resume();
    const buffer = context.createBuffer(1, pcm.length, sampleRate);
    buffer.copyToChannel(int16ToFloat(pcm) as Float32Array<ArrayBuffer>, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    const startAt = Math.max(context.currentTime + 0.02, nextTime);
    source.start(startAt);
    nextTime = startAt + buffer.duration;
    live.add(source);
    source.onended = () => {
      live.delete(source);
      if (live.size === 0) options.onDrained?.();
    };
  };

  const flush = () => {
    const stopping = [...live];
    live.clear();
    for (const source of stopping) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already ended.
      }
      source.disconnect();
    }
    nextTime = 0;
  };

  return {
    enqueue,
    flush,
    setMuted: (muted) => {
      gain.gain.setTargetAtTime(muted ? 0 : 1, context.currentTime, 0.015);
    },
    getLevel: () => {
      if (live.size === 0) {
        level *= 0.8;
        return level;
      }
      analyser.getFloatTimeDomainData(samples as Float32Array<ArrayBuffer>);
      const target = normalizeLevel(rms(samples));
      level += (target - level) * (target > level ? 0.6 : 0.15);
      return level;
    },
    pending: () => live.size,
    close: async () => {
      flush();
      await context.close().catch(() => undefined);
    },
  };
}
