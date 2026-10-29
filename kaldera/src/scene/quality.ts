import type { QualityTier } from './types';
import type { TerrainResolution } from './terrain';

export interface TierConfig {
  tier: QualityTier;
  dpr: number;
  terrain: TerrainResolution;
  stars: number;
  antialias: boolean;
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
      return { tier, dpr, terrain: { angular: 640, radial: 156, near: 768, far: 256 }, stars: 2000, antialias: dpr < 2 };
    }
    case 'medium':
      return { tier, dpr: Math.min(deviceDpr, 1.5), terrain: { angular: 448, radial: 118, near: 512, far: 256 }, stars: 1200, antialias: false };
    case 'low':
    default:
      return { tier: 'low', dpr: 1, terrain: { angular: 288, radial: 84, near: 384, far: 192 }, stars: 800, antialias: false };
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
