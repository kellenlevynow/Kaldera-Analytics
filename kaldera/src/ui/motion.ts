// Motion and quality preferences. Persisted, reflected on <html>, and
// observable by the HUD and the scene.
export type MotionMode = 'full' | 'reduced';
export type QualityMode = 'auto' | 'low';

export interface Store<T> {
  get(): T;
  set(value: T): void;
  subscribe(fn: (value: T) => void): () => void;
}

function readStored<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in private modes. The preference still applies for this visit.
  }
}

function createStore<T extends string>(key: string, allowed: readonly T[], fallback: () => T): Store<T> & { explicit: boolean; reset(value: T): void } {
  const stored = readStored(key, allowed);
  let value: T = stored ?? fallback();
  const listeners = new Set<(value: T) => void>();
  const store = {
    explicit: stored !== null,
    get: () => value,
    set(next: T) {
      store.explicit = true;
      writeStored(key, next);
      if (next === value) return;
      value = next;
      listeners.forEach((fn) => fn(value));
    },
    // Used when the system preference changes and the visitor has not chosen explicitly.
    reset(next: T) {
      if (store.explicit || next === value) return;
      value = next;
      listeners.forEach((fn) => fn(value));
    },
    subscribe(fn: (value: T) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
  return store;
}

const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

export const motionStore = createStore<MotionMode>('kaldera:motion', ['full', 'reduced'], () => (reducedQuery.matches ? 'reduced' : 'full'));
export const qualityStore = createStore<QualityMode>('kaldera:quality', ['auto', 'low'], () => 'auto');

function applyMotion(mode: MotionMode): void {
  document.documentElement.dataset.motion = mode;
}

applyMotion(motionStore.get());
motionStore.subscribe(applyMotion);
reducedQuery.addEventListener('change', (event) => motionStore.reset(event.matches ? 'reduced' : 'full'));

export function isReduced(): boolean {
  return motionStore.get() === 'reduced';
}
