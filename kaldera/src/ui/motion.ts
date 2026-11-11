// Motion and quality are fixed configuration, not visitor settings: motion runs
// in full and quality adapts automatically (src/scene/quality.ts picks the tier
// from the device and the measured frame time). The operating system's
// reduced-motion preference is still honoured as an accessibility setting.
export type MotionMode = 'full' | 'reduced';
export type QualityMode = 'auto' | 'low';

export const MOTION: MotionMode = 'full';
export const QUALITY: QualityMode = 'auto';

export interface Store<T> {
  get(): T;
  subscribe(fn: (value: T) => void): () => void;
}

function createStore<T>(initial: T): Store<T> & { update(next: T): void } {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get: () => value,
    update(next) {
      if (next === value) return;
      value = next;
      listeners.forEach((fn) => fn(value));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
}

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const motion = createStore<MotionMode>(reducedQuery.matches ? 'reduced' : MOTION);

export const motionStore: Store<MotionMode> = motion;
export const qualityStore: Store<QualityMode> = createStore<QualityMode>(QUALITY);

function applyMotion(mode: MotionMode): void {
  document.documentElement.dataset.motion = mode;
}

applyMotion(motion.get());
motion.subscribe(applyMotion);
reducedQuery.addEventListener('change', (event) => motion.update(event.matches ? 'reduced' : MOTION));

// Preferences saved by an earlier version of the site are no longer read.
try {
  window.localStorage.removeItem('kaldera:motion');
  window.localStorage.removeItem('kaldera:quality');
} catch {
  // Storage can be unavailable; nothing to clear then.
}

export function isReduced(): boolean {
  return motion.get() === 'reduced';
}
