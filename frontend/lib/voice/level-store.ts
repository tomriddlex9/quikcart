// Audio levels live outside React state: they change ~60×/s and only the orb's
// requestAnimationFrame loop reads them. Components never re-render for a level change.

export interface LevelStore {
  /** Smoothed 0..1 microphone level. */
  getInput: () => number;
  /** Smoothed 0..1 assistant-speech level. */
  getOutput: () => number;
  setInput: (value: number) => void;
  setOutput: (value: number) => void;
  reset: () => void;
}

const clamp = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** Fast attack, slower release so the mouth/orb don't flicker on syllable gaps. */
export function createLevelStore(attack = 0.6, release = 0.12): LevelStore {
  const refs = { input: 0, output: 0 };
  const follow = (current: number, next: number) => {
    const target = clamp(next);
    return current + (target - current) * (target > current ? attack : release);
  };
  return {
    getInput: () => refs.input,
    getOutput: () => refs.output,
    setInput: (value) => {
      refs.input = follow(refs.input, value);
    },
    setOutput: (value) => {
      refs.output = follow(refs.output, value);
    },
    reset: () => {
      refs.input = 0;
      refs.output = 0;
    },
  };
}
