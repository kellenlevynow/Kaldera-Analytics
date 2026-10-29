// Procedural south-polar crater.
//
// The heightfield is analytic. Normals and grazing-sun shadows are baked once
// on the CPU into two sun-aligned data textures (near: the crater and its
// margin, far: the surrounding plain) using a single sweep per row along the
// sun direction, so shadows stay crisp whatever the mesh density. The mesh is
// a polar grid with its vertex budget concentrated around the rim where the
// camera travels, extending far enough to form a real horizon.
import { BufferAttribute, BufferGeometry, ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, UnsignedByteType, Vector3 } from 'three';
import { fbm2, valueNoise2 } from './noise';

export const CRATER_R = 10.5; // mean rim crest radius, km
export const FLOOR_R = 3.9; // floor radius, km
export const RIM_H = 1.25; // crest height above the surrounding plain, km
export const FLOOR_Y = -3.0; // floor level, km
export const NEAR_HALF = 16; // near bake covers +-16 km
export const FAR_HALF = 42; // far bake covers +-42 km
export const OUTER_R = 120; // mesh extent, km
export const SUN_AZIMUTH = 205; // degrees, direction the light comes from
export const SUN_ELEVATION = 7; // degrees

const DEG = Math.PI / 180;
const sunCos = Math.cos(SUN_AZIMUTH * DEG);
const sunSin = Math.sin(SUN_AZIMUTH * DEG);
export const sunDir = new Vector3(sunCos * Math.cos(SUN_ELEVATION * DEG), Math.sin(SUN_ELEVATION * DEG), sunSin * Math.cos(SUN_ELEVATION * DEG)).normalize();
export const sunRotation: [number, number] = [sunCos, sunSin];

export function rimRadiusAt(theta: number): number {
  return CRATER_R * (1 + 0.034 * Math.sin(2 * theta + 1.3) + 0.024 * Math.sin(3 * theta + 0.4) + 0.011 * Math.sin(7 * theta + 2.0) + 0.006 * Math.sin(11 * theta + 4.1));
}

export function rimHeightAt(theta: number): number {
  return RIM_H * (1 + 0.16 * Math.sin(3 * theta + 0.9) + 0.09 * Math.sin(5 * theta + 2.1) + 0.05 * Math.sin(9 * theta + 0.3));
}

interface SmallCrater {
  x: number;
  z: number;
  r: number;
  depth: number;
}

const smallCraters: SmallCrater[] = [
  [16.5, -4.2, 2.1],
  [-14.8, 9.6, 1.6],
  [-19.5, -12.4, 2.6],
  [7.8, 17.9, 1.3],
  [21.4, 11.2, 1.9],
  [-6.2, -20.8, 1.5],
  [-24.6, 3.8, 1.1],
  [13.1, -17.6, 0.9],
  [25.8, -14.2, 2.4],
  [-11.4, 23.7, 1.7]
].map(([x, z, r]) => ({ x: x as number, z: z as number, r: r as number, depth: (r as number) * 0.2 }));

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function craterBowl(u: number, depth: number): number {
  if (u < 1) return -depth * (1 - u * u) + depth * 0.3 * smoothstep(0.55, 1, u);
  const d = u - 1;
  return depth * 0.3 * Math.exp(-d * d * 18) * (1 - smoothstep(0, 1.2, d));
}

// Analytic height in km at world (x, z).
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const theta = Math.atan2(z, x);
  const rr = rimRadiusAt(theta);
  const hr = rimHeightAt(theta);
  const rf = FLOOR_R * (rr / CRATER_R);
  let h: number;
  let wall = 0;
  let plain = 0;
  const crest = 0.45; // half-width of the rounded crest, km
  if (r < rf) {
    const u = r / rf;
    h = FLOOR_Y + 0.14 * u * u;
  } else {
    // Wall and ejecta profiles, blended across the crest so the rim is rounded.
    const t = Math.min(1.25, (r - rf) / (rr - rf));
    const sWall = 0.45 * Math.pow(t, 1.55) + 0.55 * smoothstep(0, 1, t);
    const hWall = FLOOR_Y + 0.14 + (hr - FLOOR_Y - 0.14) * sWall;
    const d = r - rr;
    const hEjecta = hr * Math.exp(-d / 2.3) + 0.16 * Math.exp(-Math.max(0, d) / 9.0);
    const blend = smoothstep(rr - crest, rr + crest, r);
    h = hWall * (1 - blend) + hEjecta * blend;
    if (r < rr) wall = Math.sin(Math.min(1, t) * Math.PI);
    if (d > 0) plain = smoothstep(0.2, 3.0, d);
  }

  // Gentle regolith undulation; slopes stay a few degrees so the grazing sun reads as terrain, not noise.
  h += 0.03 * fbm2(x * 0.62 + 3.1, z * 0.62 - 1.7, 3);
  h += 0.004 * valueNoise2(x * 3.1, z * 3.1);
  // Slumps and terraces on the inner wall.
  if (wall > 0) h += 0.1 * wall * fbm2(x * 1.3 + 11.0, z * 1.3 + 5.0, 2);
  // Hummocky ejecta outside, fading with distance.
  if (plain > 0) {
    const ejecta = Math.exp(-Math.max(0, r - CRATER_R) / 7.0);
    h += 0.12 * plain * ejecta * fbm2(x * 0.4 - 7.0, z * 0.4 + 2.0, 3);
  }
  if (r < 30) {
    for (const c of smallCraters) {
      const dx = x - c.x;
      const dz = z - c.z;
      const dist = Math.hypot(dx, dz);
      if (dist < c.r * 2.2) h += craterBowl(dist / c.r, c.depth);
    }
  }
  return h;
}

// Sun-aligned bake grid. u runs toward the sun, v across it.
export interface BakeGrid {
  half: number;
  size: number;
  step: number;
  heights: Float32Array;
  texels: Uint8Array;
  texture: DataTexture;
  sampleShade(x: number, z: number): number;
}

const tanSun = Math.tan(SUN_ELEVATION * DEG);
const tanPenumbra = Math.tan(0.27 * DEG);

function makeTexture(texels: Uint8Array, size: number): DataTexture {
  const texture = new DataTexture(texels, size, size, RGBAFormat, UnsignedByteType);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function* bakeGrid(half: number, size: number): Generator<number, BakeGrid, void> {
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
    if ((j & 3) === 3) yield (0.7 * j) / size;
  }

  // Pass 2: shadow sweep from the sunward edge, plus normals.
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
        const p = Math.max(step * 0.35 * tanSun, dist * tanPenumbra);
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
      const k = (row + i) * 4;
      texels[k] = Math.round((-dhdx * inv * 0.5 + 0.5) * 255);
      texels[k + 1] = Math.round((-dhdz * inv * 0.5 + 0.5) * 255);
      texels[k + 2] = Math.round(shade * 255);
      texels[k + 3] = 255;
    }
    if ((j & 7) === 7) yield 0.7 + (0.3 * j) / size;
  }

  const texture = makeTexture(texels, size);
  return {
    half,
    size,
    step,
    heights,
    texels,
    texture,
    sampleShade(x, z) {
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
  };
}

export interface TerrainSampler {
  heightAt(x: number, z: number): number;
  shadeAt(x: number, z: number): number;
  normalAt(x: number, z: number, target: Vector3): Vector3;
}

export interface TerrainResolution {
  angular: number;
  radial: number;
  near: number;
  far: number;
}

export interface TerrainBuild {
  geometry: BufferGeometry;
  near: BakeGrid;
  sampler: TerrainSampler;
  vertexCount: number;
}

// Radial ring distribution: dense at the floor edge, densest around the rim,
// thinning across the plain, then a few wide rings out to the horizon.
function radialStations(count: number): number[] {
  const inner = count - 6;
  const limit = FAR_HALF;
  const samples = 4096;
  const weights = new Float64Array(samples);
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const r = 0.3 + (limit - 0.3) * (i / (samples - 1));
    const rim = Math.exp(-(((r - CRATER_R) / 3.2) ** 2));
    const floor = Math.exp(-(((r - FLOOR_R) / 1.6) ** 2));
    const far = r > 16 ? 16 / r : 1;
    const w = (0.3 + 7.0 * rim + 1.4 * floor) * far;
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
  for (const r of [50, 60, 72, 86, 102, OUTER_R]) out.push(r);
  return out;
}

export function* buildTerrain(res: TerrainResolution): Generator<number, TerrainBuild, void> {
  const near = yield* bakeGrid(NEAR_HALF, res.near);

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
    for (let j = 0; j < angular; j++) {
      const theta = (j / angular) * Math.PI * 2;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const k = (1 + i * angular + j) * 3;
      positions[k] = x;
      positions[k + 1] = heightAt(x, z);
      positions[k + 2] = z;
    }
    if ((i & 3) === 3) yield 0.9 + (0.1 * i) / rings;
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
    for (let j = 0; j < angular; j++) {
      const j1 = (j + 1) % angular;
      const a = 1 + i * angular + j;
      const b = 1 + i * angular + j1;
      const c = 1 + (i + 1) * angular + j;
      const d = 1 + (i + 1) * angular + j1;
      indices[k++] = a;
      indices[k++] = d;
      indices[k++] = c;
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = d;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  const eps = 0.04;
  const sampler: TerrainSampler = {
    heightAt,
    shadeAt: (x, z) => near.sampleShade(x, z),
    normalAt(x, z, target) {
      const hx1 = heightAt(x + eps, z);
      const hx0 = heightAt(x - eps, z);
      const hz1 = heightAt(x, z + eps);
      const hz0 = heightAt(x, z - eps);
      return target.set(hx0 - hx1, 2 * eps, hz0 - hz1).normalize();
    }
  };

  return { geometry, near, sampler, vertexCount };
}

export function bakeFar(size: number): Generator<number, BakeGrid, void> {
  return bakeGrid(FAR_HALF, size);
}
