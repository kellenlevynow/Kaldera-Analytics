// Constants and helpers shared by the browser scene and scripts/bake-pile.mjs.
// No imports, so node can load it directly.

// Radius of the well the pile sits in, metres.
export const WELL_RADIUS = 0.78;

// The probe that rides with the camera: a capsule, axis vertical.
export const PROBE_RADIUS = 0.33;
export const PROBE_HALF = 0.2;
// The probe's centre sits this far below the camera.
export const PROBE_DROP = 0.05;

// The hero lies on the floor at the centre of the well, neck toward -Z, label up.
// A quarter turn about X takes the bottle's +Y axis to -Z and the label's +Z to +Y.
export const HERO_QUAT = { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };

export function heroPosition(shape: { height: number; origin: number; bodyR: number }): { x: number; y: number; z: number } {
  return { x: 0, y: shape.bodyR + 0.001, z: shape.height / 2 - shape.origin };
}

// Baked pile file: 'KPIL', version, dynamic count, bed count (uint32), then
// well radius, pile top and two reserved float32, then one shape byte per bottle
// (padded to four), then seven float32 per bottle: position xyz, quaternion xyzw.
// Bed bottles come first.
export const PILE_MAGIC = 0x4c49504b;
export const PILE_VERSION = 1;

export interface BakedPile {
  dynamicCount: number;
  bedCount: number;
  wellRadius: number;
  pileTop: number;
  shapes: Uint8Array;
  poses: Float32Array;
}

export function parsePile(buffer: ArrayBuffer): BakedPile {
  const head = new Uint32Array(buffer, 0, 4);
  if (head[0] !== PILE_MAGIC || head[1] !== PILE_VERSION) throw new Error('Unrecognised pile file');
  const dynamicCount = head[2] ?? 0;
  const bedCount = head[3] ?? 0;
  const floats = new Float32Array(buffer, 16, 4);
  const total = dynamicCount + bedCount;
  const shapesLength = Math.ceil(total / 4) * 4;
  const shapes = new Uint8Array(buffer, 32, total);
  const poses = new Float32Array(buffer, 32 + shapesLength, total * 7);
  return { dynamicCount, bedCount, wellRadius: floats[0] ?? WELL_RADIUS, pileTop: floats[1] ?? 0, shapes, poses };
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FlatBottle {
  shape: number;
  x: number;
  z: number;
  yaw: number;
  roll: number;
}

// One layer of bottles lying flat, packed by rejection sampling: random
// positions and headings, none crossing another. Used for the layers under the
// floor line, so no bare ground shows through the bed.
export function flatLayer(rnd: () => number, radius: number, lengths: number[], radii: number[], weights: number[], target: number): FlatBottle[] {
  const out: FlatBottle[] = [];
  const segs: Array<[number, number, number, number]> = [];
  for (let i = 0; i < target; i++) {
    let s = 0;
    let acc = 0;
    const pick = rnd();
    for (let k = 0; k < weights.length; k++) {
      acc += weights[k] ?? 0;
      if (pick <= acc) {
        s = k;
        break;
      }
    }
    const half = (lengths[s] ?? 0.3) / 2;
    const gap = (radii[s] ?? 0.04) * 2 * 0.86;
    for (let attempt = 0; attempt < 70; attempt++) {
      const r = Math.sqrt(rnd()) * radius;
      const a = rnd() * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const yaw = rnd() * Math.PI * 2;
      const seg: [number, number, number, number] = [x - Math.cos(yaw) * half, z - Math.sin(yaw) * half, x + Math.cos(yaw) * half, z + Math.sin(yaw) * half];
      if (segs.every((other) => segmentDistance(seg, other) > gap)) {
        segs.push(seg);
        out.push({ shape: s, x, z, yaw, roll: rnd() * Math.PI * 2 });
        break;
      }
    }
  }
  return out;
}

// Shortest distance between two segments in the plane, each given as x0 z0 x1 z1.
export function segmentDistance(p: [number, number, number, number], q: [number, number, number, number]): number {
  const [ax, az, bx, bz] = p;
  const [cx, cz, dx, dz] = q;
  const pointSeg = (px: number, pz: number, x0: number, z0: number, x1: number, z1: number) => {
    const vx = x1 - x0;
    const vz = z1 - z0;
    const len2 = vx * vx + vz * vz || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - x0) * vx + (pz - z0) * vz) / len2));
    return Math.hypot(px - (x0 + vx * t), pz - (z0 + vz * t));
  };
  const cross = (ux: number, uz: number, vx: number, vz: number) => ux * vz - uz * vx;
  const d1 = cross(bx - ax, bz - az, cx - ax, cz - az);
  const d2 = cross(bx - ax, bz - az, dx - ax, dz - az);
  const d3 = cross(dx - cx, dz - cz, ax - cx, az - cz);
  const d4 = cross(dx - cx, dz - cz, bx - cx, bz - cz);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(pointSeg(ax, az, cx, cz, dx, dz), pointSeg(bx, bz, cx, cz, dx, dz), pointSeg(cx, cz, ax, az, bx, bz), pointSeg(dx, dz, ax, az, bx, bz));
}
