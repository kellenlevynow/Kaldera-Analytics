// Deterministic hash and value noise. No dependencies, no allocation.

export function hash2(ix: number, iy: number): number {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// Smooth value noise in [-1, 1].
export function valueNoise2(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = quintic(fx);
  const v = quintic(fy);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  const top = a + (b - a) * u;
  const bottom = c + (d - c) * u;
  return (top + (bottom - top) * v) * 2 - 1;
}

// Fractional Brownian motion, roughly in [-1, 1].
export function fbm2(x: number, y: number, octaves: number, lacunarity = 2.0, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(fx, fy) * amp;
    norm += amp;
    amp *= gain;
    // Rotate each octave a little to break up axis alignment.
    const nx = fx * 1.6 - fy * 1.2;
    const ny = fx * 1.2 + fy * 1.6;
    fx = nx * (lacunarity / 2) + 17.3;
    fy = ny * (lacunarity / 2) + 31.7;
  }
  return sum / norm;
}

// Ridged multifractal in [0, 1], sharp crests.
export function ridged2(x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise2(fx, fy));
    sum += n * n * amp;
    amp *= 0.5;
    fx = fx * 2.1 + 5.2;
    fy = fy * 2.1 + 9.1;
  }
  return sum;
}

// Cellular (Worley) noise: distance to the nearest of one jittered feature
// point per cell, in [0, ~1.4]. Returns the distance and the cell hash of the
// nearest point so callers can derive per-block attributes.
export function worley2(x: number, y: number): { f1: number; id: number } {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  let f1 = 8;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = x0 + i;
      const cy = y0 + j;
      const h = hash2(cx, cy);
      const px = cx + hash2(cx * 3 + 1, cy * 5 + 7);
      const py = cy + hash2(cx * 7 + 3, cy * 11 + 1);
      const dx = px - x;
      const dy = py - y;
      const d = dx * dx + dy * dy;
      if (d < f1) {
        f1 = d;
        id = h;
      }
    }
  }
  return { f1: Math.sqrt(f1), id };
}
