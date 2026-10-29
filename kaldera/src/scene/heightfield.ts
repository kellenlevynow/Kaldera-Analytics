// Pure heightfield math: the analytic crater, the sun-aligned bakes and the
// polar mesh grid. No three.js here so the bake worker stays small; terrain.ts
// wraps the results in textures and geometry.
//
// The heightfield is a 21 km bowl with a fractured, ridged crest, terraced
// inner walls, a deterministic multi-scale crater population on every surface,
// hummocky ejecta, distant highland massifs and the Moon's curvature. Normals
// and grazing-sun shadows are baked into two sun-aligned grids (near: the
// crater and its margin, far: the surrounding plain) using a single sweep per
// row along the sun direction, so shadows stay crisp whatever the mesh density.
import { fbm2, hash2, ridged2, valueNoise2, worley2 } from './noise';

export const CRATER_R = 10.5; // mean rim crest radius, km
export const FLOOR_R = 3.9; // floor radius, km
export const RIM_H = 1.25; // crest height above the surrounding plain, km
export const FLOOR_Y = -3.0; // floor level, km
export const NEAR_HALF = 16; // near bake covers +-16 km
export const FAR_HALF = 42; // far bake covers +-42 km
export const OUTER_R = 120; // mesh extent, km
export const MOON_R = 1737.4; // km, for the horizon drop
export const SUN_AZIMUTH = 355; // degrees, direction the light comes from
export const SUN_ELEVATION = 12; // degrees. The floor stays in shadow below about 14.
// Rim installations sit on levelled pads at these crest angles (see network.ts).
export const NODE_ANGLES = [285, 330, 15, 60, 105, 150];

const DEG = Math.PI / 180;
export const sunCos = Math.cos(SUN_AZIMUTH * DEG);
export const sunSin = Math.sin(SUN_AZIMUTH * DEG);
export const sunRotation: [number, number] = [sunCos, sunSin];

export function rimRadiusAt(theta: number): number {
  return CRATER_R * (1 + 0.034 * Math.sin(2 * theta + 1.3) + 0.024 * Math.sin(3 * theta + 0.4) + 0.011 * Math.sin(7 * theta + 2.0) + 0.006 * Math.sin(11 * theta + 4.1));
}

export function rimHeightAt(theta: number): number {
  return RIM_H * (1 + 0.16 * Math.sin(3 * theta + 0.9) + 0.09 * Math.sin(5 * theta + 2.1) + 0.05 * Math.sin(9 * theta + 0.3));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Profile of a simple bowl crater, u = distance / radius. Parabolic floor,
// raised rim, ejecta blanket decaying outward.
function craterBowl(u: number, depth: number): number {
  if (u < 1) return -depth * (1 - u * u) + depth * 0.3 * smoothstep(0.55, 1, u);
  const d = u - 1;
  return depth * 0.3 * Math.exp(-d * d * 18) * (1 - smoothstep(0, 1.2, d));
}

// Deterministic crater population. Each layer tiles the plane with cells; a
// cell holds at most one crater with a jittered centre and a hashed radius.
// Jitter stays within a quarter cell and radii under 0.35 cell, so the four
// nearest cells cover every crater that can reach a point.
interface CraterLayer {
  cell: number;
  prob: number;
  seed: number;
}

const craterLayers: CraterLayer[] = [
  { cell: 9.0, prob: 0.55, seed: 11 },
  { cell: 3.4, prob: 0.62, seed: 23 },
  { cell: 1.3, prob: 0.7, seed: 37 },
  { cell: 0.5, prob: 0.75, seed: 53 }
];

function craterField(x: number, z: number, layer: CraterLayer): number {
  const c = layer.cell;
  const qx = x / c - 0.5;
  const qz = z / c - 0.5;
  const ix = Math.floor(qx);
  const iz = Math.floor(qz);
  let h = 0;
  for (let j = 0; j <= 1; j++) {
    for (let i = 0; i <= 1; i++) {
      const cx = ix + i;
      const cz = iz + j;
      const hs = hash2(cx * 7 + layer.seed, cz * 13 - layer.seed);
      if (hs > layer.prob) continue;
      const px = (cx + 0.5 + (hash2(cx + layer.seed, cz * 3) - 0.5) * 0.5) * c;
      const pz = (cz + 0.5 + (hash2(cx * 5, cz + layer.seed) - 0.5) * 0.5) * c;
      const r = c * (0.12 + 0.23 * hash2(cx * 11 + 1, cz * 17 + layer.seed));
      const dist = Math.hypot(x - px, z - pz);
      if (dist > r * 2.2) continue;
      // Degradation: most craters are old and shallow, a few are fresh.
      const age = hash2(cx * 19 + layer.seed, cz * 23 + 5);
      const depth = r * (0.12 + 0.3 * age * age);
      h += craterBowl(dist / r, depth);
    }
  }
  return h;
}

// Smooth staircase: integer steps with short ramps, minus the identity, so it
// averages to zero and can be added to a slope as benches.
function terrace(t: number): number {
  const f = t - Math.floor(t);
  return Math.floor(t) + smoothstep(0.35, 0.75, f) - t;
}

const nodeDirs = NODE_ANGLES.map((a) => [Math.cos(a * DEG), Math.sin(a * DEG), a * DEG] as const);

// 1 on an installation pad, 0 elsewhere. Fine detail is suppressed there so
// the structures stand on level ground.
export function padMaskAt(x: number, z: number): number {
  let mask = 0;
  for (const [cx, cz, a] of nodeDirs) {
    const r = rimRadiusAt(a) - 0.12;
    const d = Math.hypot(x - cx * r, z - cz * r);
    if (d < 1.0) mask = Math.max(mask, 1 - smoothstep(0.5, 1.0, d));
  }
  return mask;
}

// Analytic height in km at world (x, z).
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const rr = rimRadiusAt(theta);
  const hr = rimHeightAt(theta);
  const rf = FLOOR_R * (rr / CRATER_R);
  let h: number;
  let wall = 0; // 1 mid-way up the inner wall
  let t = 0; // 0 at the floor edge, 1 at the crest
  let plain = 0; // 1 on the plain outside the ejecta ramp
  const crest = 0.45; // half-width of the rounded crest, km
  if (r < rf) {
    const u = r / rf;
    h = FLOOR_Y + 0.14 * u * u;
  } else {
    // Wall and ejecta profiles, blended across the crest so the rim is rounded.
    t = Math.min(1.25, (r - rf) / (rr - rf));
    const sWall = 0.45 * Math.pow(t, 1.55) + 0.55 * smoothstep(0, 1, t);
    const hWall = FLOOR_Y + 0.14 + (hr - FLOOR_Y - 0.14) * sWall;
    const d = r - rr;
    const hEjecta = hr * Math.exp(-d / 2.3) + 0.16 * Math.exp(-Math.max(0, d) / 9.0);
    const blend = smoothstep(rr - crest, rr + crest, r);
    h = hWall * (1 - blend) + hEjecta * blend;
    if (r < rr) wall = Math.sin(Math.min(1, t) * Math.PI);
    if (d > 0) plain = smoothstep(0.2, 3.0, d);
  }

  const pad = r > rr - 1.6 && r < rr + 1.6 ? 1 - padMaskAt(x, z) : 1;
  const dCrest = r - rr;

  // Regolith undulation, domain warped so no lattice shows. Slopes stay a few
  // degrees so the grazing sun reads as terrain, not noise.
  const wx = fbm2(x * 0.21 + 9.0, z * 0.21 - 4.0, 2);
  const wz = fbm2(x * 0.21 - 3.0, z * 0.21 + 6.0, 2);
  h += 0.03 * fbm2(x * 0.62 + 3.1 + 1.4 * wx, z * 0.62 - 1.7 + 1.4 * wz, 3);
  h += 0.005 * valueNoise2(x * 3.1, z * 3.1);

  // Fractured crest: ridged relief along the rim, angular blocks on the crest
  // itself, radial fracture ridges running down the outer flank.
  const crestMask = Math.exp(-(dCrest * dCrest) / 0.6) * pad;
  if (crestMask > 0.002) {
    const ridge = ridged2(x * 1.15 + 5.0, z * 1.15 - 3.0, 3) - 0.42;
    h += 0.17 * crestMask * ridge;
    const w = worley2(x * 2.6 + 1.0, z * 2.6 - 2.0);
    const block = 1 - smoothstep(0.22, 0.5, w.f1);
    h += 0.085 * crestMask * block * (w.id - 0.35);
  }
  const flank = smoothstep(4.0, 0.4, dCrest) * smoothstep(-0.9, 0.2, dCrest) * pad;
  if (flank > 0.002) {
    h += 0.07 * flank * (ridged2(x * 0.7 - 2.0, z * 0.7 + 8.0, 3) - 0.45);
    // Outcrops: bedrock slabs breaking through the ejecta on the outer flank.
    const w = worley2(x * 4.2 - 3.0, z * 4.2 + 5.0);
    const slab = 1 - smoothstep(0.2, 0.42, w.f1);
    h += 0.05 * flank * slab * (w.id - 0.3);
  }

  // Inner wall: terraces (slump benches), debris chutes running downslope,
  // and slump lobes.
  if (wall > 0) {
    const tt = t * 3.4 + 0.45 * fbm2(x * 0.9 + 11.0, z * 0.9 + 5.0, 2);
    h += 0.3 * wall * terrace(tt) * pad;
    h += 0.16 * wall * fbm2(x * 1.3 + 11.0, z * 1.3 + 5.0, 2);
    // Chutes: ridged noise stretched along the radial direction. Two
    // parametrisations of the angle, blended, so neither seam shows.
    const across = r * 0.55;
    const seam = smoothstep(0.5 * Math.PI, 0.75 * Math.PI, Math.abs(theta));
    const theta2 = theta < 0 ? theta + 2 * Math.PI : theta;
    const chuteA = seam < 1 ? ridged2(theta * 15.0 + 2.0, across + 7.0, 2) : 0;
    const chuteB = seam > 0 ? ridged2(theta2 * 15.0 + 9.0, across - 3.0, 2) : 0;
    h += 0.08 * wall * (chuteA * (1 - seam) + chuteB * seam - 0.4);
    h += 0.04 * wall * (ridged2(x * 2.2 + 3.0, z * 2.2 + 1.0, 2) - 0.45);
  }
  // Hummocky ejecta outside, fading with distance.
  if (plain > 0) {
    const ejecta = Math.exp(-Math.max(0, r - CRATER_R) / 7.0);
    h += 0.12 * plain * ejecta * fbm2(x * 0.4 - 7.0, z * 0.4 + 2.0, 3);
  }

  // Crater population. The largest layer stays off the main crater so the
  // crest keeps its line; smaller craters pock every surface, damped on the
  // steep inner wall where they would read as noise.
  const steep = 1 - 0.4 * wall;
  const outside = smoothstep(rr + 0.5, rr + 5.0, r);
  const bigOutside = smoothstep(rr + 2.0, rr + 10.0, r);
  const l0 = craterLayers[0] as CraterLayer;
  const l1 = craterLayers[1] as CraterLayer;
  const l2 = craterLayers[2] as CraterLayer;
  const l3 = craterLayers[3] as CraterLayer;
  if (bigOutside > 0) h += bigOutside * craterField(x, z, l0);
  h += (0.35 + 0.65 * outside) * steep * pad * craterField(x, z, l1);
  h += steep * pad * craterField(x, z, l2);
  if (r < 60) h += steep * pad * craterField(x, z, l3);

  // Distant highland massifs on the horizon.
  if (r > 24) {
    const far = smoothstep(24, 58, r);
    h += far * (0.6 * fbm2(x * 0.045 + 2.0, z * 0.045 - 7.0, 3) + 0.45 * (ridged2(x * 0.07 + 1.0, z * 0.07 + 4.0, 3) - 0.4));
  }

  // The Moon's curvature drops the horizon.
  h -= (r * r) / (2 * MOON_R);
  return h;
}

const tanSun = Math.tan(SUN_ELEVATION * DEG);
const tanPenumbra = Math.tan(0.27 * DEG);

// Bake output: heights plus RGBA texels (normal xz, shade, relief).
export interface BakeData {
  half: number;
  size: number;
  step: number;
  heights: Float32Array;
  texels: Uint8Array;
}

export function* bakeGridData(half: number, size: number): Generator<number, BakeData, void> {
  const step = (2 * half) / (size - 1);
  const heights = new Float32Array(size * size);
  const texels = new Uint8Array(size * size * 4);

  // Pass 1: heights.
  for (let j = 0; j < size; j++) {
    const v = -half + j * step;
    const row = j * size;
    for (let i = 0; i < size; i++) {
      const u = -half + i * step;
      heights[row + i] = heightAt(u * sunCos - v * sunSin, u * sunSin + v * sunCos);
    }
    if ((j & 1) === 1) yield (0.7 * j) / size;
  }

  // Pass 2: shadow sweep from the sunward edge, plus normals. Alpha carries
  // the height above the surrounding plain for shading cues (ambient
  // occlusion in bowls, dust on low ground).
  for (let j = 0; j < size; j++) {
    const row = j * size;
    const rowUp = Math.min(size - 1, j + 1) * size;
    const rowDown = Math.max(0, j - 1) * size;
    let shadowLine = -Infinity;
    let occluderU = half;
    for (let i = size - 1; i >= 0; i--) {
      const u = -half + i * step;
      const h = heights[row + i] ?? 0;
      let shade = 1;
      if (shadowLine !== -Infinity) {
        const dist = Math.max(step, occluderU - u);
        const p = Math.max(step * 0.8 * tanSun, dist * tanPenumbra);
        shade = Math.min(1, Math.max(0, 0.5 + (h - shadowLine) / (2 * p)));
      }
      if (h >= shadowLine) occluderU = u;
      shadowLine = Math.max(h, shadowLine) - step * tanSun;

      const hu1 = heights[row + Math.min(size - 1, i + 1)] ?? h;
      const hu0 = heights[row + Math.max(0, i - 1)] ?? h;
      const hv1 = heights[rowUp + i] ?? h;
      const hv0 = heights[rowDown + i] ?? h;
      const dhdu = (hu1 - hu0) / (2 * step);
      const dhdv = (hv1 - hv0) / (2 * step);
      const dhdx = dhdu * sunCos - dhdv * sunSin;
      const dhdz = dhdu * sunSin + dhdv * sunCos;
      const inv = 1 / Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
      // Local relief: height relative to the mean of the four neighbours, in
      // texel-independent units, centred on 0.5. Negative in bowls.
      const relief = h - 0.25 * (hu1 + hu0 + hv1 + hv0);
      const k = (row + i) * 4;
      texels[k] = Math.round((-dhdx * inv * 0.5 + 0.5) * 255);
      texels[k + 1] = Math.round((-dhdz * inv * 0.5 + 0.5) * 255);
      texels[k + 2] = Math.round(shade * 255);
      texels[k + 3] = Math.round(Math.min(1, Math.max(0, 0.5 + relief / (step * 0.6))) * 255);
    }
    if ((j & 7) === 7) yield 0.7 + (0.3 * j) / size;
  }

  return { half, size, step, heights, texels };
}

// Bilinear shade lookup in a bake.
export function sampleBakeShade(bake: BakeData, x: number, z: number): number {
  const { half, size, step, texels } = bake;
  const u = x * sunCos + z * sunSin;
  const v = -x * sunSin + z * sunCos;
  const gx = (u + half) / step;
  const gy = (v + half) / step;
  if (gx < 0 || gy < 0 || gx > size - 1 || gy > size - 1) return 1;
  const ix = Math.min(size - 2, Math.floor(gx));
  const iy = Math.min(size - 2, Math.floor(gy));
  const fx = gx - ix;
  const fy = gy - iy;
  const at = (xx: number, yy: number) => (texels[(yy * size + xx) * 4 + 2] ?? 255) / 255;
  const top = at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx;
  const bottom = at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

export interface TerrainResolution {
  angular: number;
  radial: number;
  near: number;
  far: number;
}

// Mesh data: near bake plus the polar grid positions and indices.
export interface GridData {
  near: BakeData;
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
}

// Radial ring distribution: dense at the floor edge, densest around the rim,
// thinning across the plain, then wider rings out to the horizon.
function radialStations(count: number): number[] {
  const outerRings = [46, 50, 54.5, 59.5, 65, 71, 78, 86, 95, 106, OUTER_R];
  const inner = count - outerRings.length;
  const limit = FAR_HALF;
  const samples = 4096;
  const weights = new Float64Array(samples);
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const r = 0.3 + (limit - 0.3) * (i / (samples - 1));
    const rim = Math.exp(-(((r - CRATER_R) / 2.6) ** 2));
    const path = Math.exp(-(((r - CRATER_R - 0.5) / 1.1) ** 2));
    const floor = Math.exp(-(((r - FLOOR_R) / 1.6) ** 2));
    const far = r > 16 ? 16 / r : 1;
    const w = (0.3 + 6.0 * rim + 4.0 * path + 1.4 * floor) * far;
    weights[i] = w;
    total += w;
  }
  const out: number[] = [];
  let acc = 0;
  let k = 0;
  for (let i = 0; i < samples && out.length < inner; i++) {
    acc += weights[i] ?? 0;
    while (acc >= (k * total) / (inner - 1) && out.length < inner) {
      out.push(0.3 + (limit - 0.3) * (i / (samples - 1)));
      k++;
    }
  }
  while (out.length < inner) out.push(limit);
  out[out.length - 1] = limit;
  for (const r of outerRings) out.push(r);
  return out;
}

export function* buildGridData(res: TerrainResolution): Generator<number, GridData, void> {
  const near = yield* bakeGridData(NEAR_HALF, res.near);

  const { angular, radial } = res;
  const stations = radialStations(radial);
  const rings = stations.length;
  const vertexCount = angular * rings + 1;
  const positions = new Float32Array(vertexCount * 3);
  positions[0] = 0;
  positions[1] = heightAt(0, 0);
  positions[2] = 0;
  for (let i = 0; i < rings; i++) {
    const r = stations[i] ?? OUTER_R;
    // Alternate rings are rotated half a step so the grid reads as triangles,
    // not as a radial fan of quads, in the low sun.
    const twist = (i & 1) * 0.5;
    for (let j = 0; j < angular; j++) {
      const theta = ((j + twist) / angular) * Math.PI * 2;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const k = (1 + i * angular + j) * 3;
      positions[k] = x;
      positions[k + 1] = heightAt(x, z);
      positions[k + 2] = z;
    }
    if ((i & 1) === 1) yield 0.9 + (0.1 * i) / rings;
  }

  const indexCount = angular * 3 + (rings - 1) * angular * 6;
  const indices = new Uint32Array(indexCount);
  let k = 0;
  for (let j = 0; j < angular; j++) {
    indices[k++] = 0;
    indices[k++] = 1 + ((j + 1) % angular);
    indices[k++] = 1 + j;
  }
  for (let i = 0; i < rings - 1; i++) {
    // With the half-step twist, each (a, b, c, d) is a parallelogram: the
    // outer vertices sit half a step past the inner ones, so a even ring's
    // vertex j pairs with outer j, an odd ring's with outer j+1.
    const shift = (i & 1) === 0 ? 0 : 1;
    for (let j = 0; j < angular; j++) {
      const j1 = (j + 1) % angular;
      const a = 1 + i * angular + j;
      const b = 1 + i * angular + j1;
      const c = 1 + (i + 1) * angular + ((j + shift) % angular);
      const d = 1 + (i + 1) * angular + ((j + shift + 1) % angular);
      indices[k++] = a;
      indices[k++] = d;
      indices[k++] = c;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = d;
    }
  }

  return { near, positions, indices, vertexCount };
}

// Runs a sliced generator to completion in one go (worker side).
export function runToEnd<T>(gen: Generator<number, T, void>): T {
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
  }
}
