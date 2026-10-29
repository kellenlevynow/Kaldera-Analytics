import type { QualityTier } from './types';
import type { TerrainResolution } from './terrain';

export interface TierConfig {
  tier: QualityTier;
  dpr: number;
  terrain: TerrainResolution;
  stars: number;
  antialias: boolean;
  rocks: number;
  // Strength of the per-fragment relief layers (0 to 1).
  detail: number;
}

interface NavigatorHints {
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

export function detectTier(): QualityTier {
  const nav = navigator as Navigator & NavigatorHints;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4;
  const fewCores = typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency <= 4;
  if (coarse || mobile || lowMemory || fewCores) return 'medium';
  return 'high';
}

export function configFor(tier: QualityTier, deviceDpr: number): TierConfig {
  switch (tier) {
    case 'high': {
      const dpr = Math.min(deviceDpr, 2);
      return { tier, dpr, terrain: { angular: 1024, radial: 204, near: 1024, far: 320 }, stars: 2600, antialias: dpr < 2, rocks: 1600, detail: 1 };
    }
    case 'medium':
      return { tier, dpr: Math.min(deviceDpr, 1.5), terrain: { angular: 720, radial: 168, near: 768, far: 256 }, stars: 1600, antialias: false, rocks: 1000, detail: 1 };
    case 'low':
    default:
      return { tier: 'low', dpr: 1, terrain: { angular: 440, radial: 116, near: 512, far: 192 }, stars: 1000, antialias: false, rocks: 500, detail: 0.6 };
  }
}

export function lowerTier(tier: QualityTier): QualityTier {
  return tier === 'high' ? 'medium' : 'low';
}

// Averages the first N frame times after the scene comes online and reports once.
export class FrameMonitor {
  private frames = 0;
  private total = 0;
  private settled = false;
  average = 0;

  constructor(private readonly window = 90) {}

  sample(dtMs: number): 'downgrade' | 'static' | 'ok' | null {
    if (this.settled) {
      // Keep a rolling average for diagnostics only.
      this.average += (dtMs - this.average) * 0.05;
      return null;
    }
    // Ignore the first few frames while shaders compile and caches warm.
    if (this.frames < 6) {
      this.frames++;
      return null;
    }
    this.frames++;
    this.total += dtMs;
    if (this.frames < this.window + 6) return null;
    this.settled = true;
    this.average = this.total / this.window;
    if (this.average > 40) return 'static';
    if (this.average > 20) return 'downgrade';
    return 'ok';
  }

  reset(): void {
    this.frames = 0;
    this.total = 0;
    this.settled = false;
  }
}
