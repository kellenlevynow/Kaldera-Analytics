// Runs heightfield bakes in bake.worker.ts when workers are available, or
// time-sliced on the main thread otherwise. Jobs run one at a time in order.
import { FAR_HALF, bakeGridData, buildGridData, type BakeData, type GridData, type TerrainResolution } from './heightfield';
import type { BakeJob } from './bake.worker';

const BAKE_BUDGET_MS = 8;

// Drives a generator across animation frames within a per-frame time budget.
export function runSliced<T>(gen: Generator<number, T, void>, budgetMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const step = () => {
      const start = performance.now();
      try {
        for (;;) {
          const r = gen.next();
          if (r.done) {
            resolve(r.value);
            return;
          }
          if (performance.now() - start > budgetMs) break;
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  });
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export interface Baker {
  grid(res: TerrainResolution): Promise<GridData>;
  far(size: number): Promise<BakeData>;
  readonly threaded: boolean;
  dispose(): void;
}

export function createBaker(): Baker {
  let worker: Worker | null = null;
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let chain: Promise<unknown> = Promise.resolve();

  try {
    if (typeof Worker === 'function') {
      worker = new Worker(new URL('./bake.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ id: number; data: unknown }>) => {
        const p = pending.get(event.data.id);
        if (!p) return;
        pending.delete(event.data.id);
        p.resolve(event.data.data);
      };
      worker.onerror = (event) => {
        // Fall back to the main thread for every job still waiting and the ones to come.
        const error = new Error(event.message || 'Bake worker failed');
        for (const p of pending.values()) p.reject(error);
        pending.clear();
        worker?.terminate();
        worker = null;
      };
    }
  } catch {
    worker = null;
  }

  const post = <T>(job: BakeJob): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (!worker) {
        reject(new Error('No worker'));
        return;
      }
      pending.set(job.id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage(job);
    });

  // Serialise jobs so a tier change never races the first build.
  const enqueue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = chain.then(run, run);
    chain = next.catch(() => undefined);
    return next;
  };

  return {
    get threaded() {
      return worker !== null;
    },
    grid(res) {
      return enqueue(async () => {
        if (worker) {
          try {
            return await post<GridData>({ id: nextId++, kind: 'grid', res });
          } catch {
            // fall through to the sliced path
          }
        }
        return runSliced(buildGridData(res), BAKE_BUDGET_MS);
      });
    },
    far(size) {
      return enqueue(async () => {
        if (worker) {
          try {
            return await post<BakeData>({ id: nextId++, kind: 'far', size });
          } catch {
            // fall through
          }
        }
        return runSliced(bakeGridData(FAR_HALF, size), BAKE_BUDGET_MS);
      });
    },
    dispose() {
      worker?.terminate();
      worker = null;
      pending.clear();
    }
  };
}
