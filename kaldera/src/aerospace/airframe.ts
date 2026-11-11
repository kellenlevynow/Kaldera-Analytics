// The aircraft: an original low-observable flying wing in the spirit of the
// next generation of unmanned combat aircraft, built from one parametric body.
// Every skin, wing, rib and control surface is a region of the same lofted
// surface, cut at real span stations and chord fractions, so the assemblies
// meet exactly and separate along the axes they would be built on.
//
// Axes: x is span (right positive), y is up, z is forward. Metres. The chord
// plane is y = 0; the airframe rests on its gear with the floor at y = -GEAR.
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Path,
  Quaternion,
  RepeatWrapping,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector3
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PartId } from './timeline';

export const SPAN = 5.0;
export const NOSE_Z = 3.4;
export const TAIL_Z = -2.7;
// Height of the chord plane over the floor when the aircraft rests on its gear.
export const GEAR = 1.15;
// How far the airframe is hoisted while it is apart; the gear stay on the floor.
export const LIFT = 1.3;
// The centre section ends and the outer wings begin here.
const ROOT = 2.2;

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// Planform, right half.
export function leadingZ(x: number): number {
  return NOSE_Z - 0.8 * x;
}
export function trailingZ(x: number): number {
  if (x <= 0.5) return TAIL_Z;
  if (x <= ROOT) return TAIL_Z + (x - 0.5) * ((-0.45 - TAIL_Z) / (ROOT - 0.5));
  return -0.45 - 0.25 * (x - ROOT);
}
export function chord(x: number): number {
  return leadingZ(x) - trailingZ(x);
}
function thicknessRatio(x: number): number {
  return x < ROOT ? lerp(0.17, 0.13, x / ROOT) : lerp(0.13, 0.09, (x - ROOT) / (SPAN - ROOT));
}
// Half thickness along the chord: sharp at both edges, deepest a third of the way back.
function profile(u: number): number {
  const c = Math.min(1, Math.max(0, u));
  return 2.75 * Math.pow(c, 0.6) * Math.pow(1 - c, 0.9);
}
// The dorsal fairing over the engine, and the shallow bulge of the bay underneath.
function hump(x: number, z: number): number {
  const along = smooth((z + 3.2) / 0.5) * smooth((1.3 - z) / 0.8) * (1 - 0.4 * smooth((-1.6 - z) / 1.1));
  return 0.42 * Math.exp(-(x * x) / 0.64) * along;
}
function belly(x: number, z: number): number {
  return 0.1 * Math.exp(-(x * x) / 0.81) * smooth((z + 2.6) / 0.6) * smooth((0.3 - z) / 0.6);
}

// u runs from the leading edge (0) to the trailing edge (1).
export function surfaceTop(x: number, u: number, out: Vector3): Vector3 {
  const ax = Math.abs(x);
  const z = leadingZ(ax) - chord(ax) * u;
  return out.set(x, chord(ax) * thicknessRatio(ax) * 0.5 * profile(u) * 1.05 + hump(ax, z), z);
}
export function surfaceBottom(x: number, u: number, out: Vector3): Vector3 {
  const ax = Math.abs(x);
  const z = leadingZ(ax) - chord(ax) * u;
  return out.set(x, -(chord(ax) * thicknessRatio(ax) * 0.5 * profile(u) * 0.9 + belly(ax, z)), z);
}
export function chordFraction(x: number, z: number): number {
  const ax = Math.abs(x);
  return (leadingZ(ax) - z) / chord(ax);
}

// Pose on the skin: position and a frame whose y axis is the surface normal
// and whose z axis follows the sweep of the leading edge.
export function surfacePose(x: number, z: number, top: boolean, lift = 0): { position: Vector3; quaternion: Quaternion } {
  const u = chordFraction(x, z);
  const f = top ? surfaceTop : surfaceBottom;
  const p = f(x, u, new Vector3());
  const px = f(x + 0.01, u, new Vector3()).sub(f(x - 0.01, u, new Vector3()));
  const pu = f(x, u + 0.005, new Vector3()).sub(f(x, u - 0.005, new Vector3()));
  const n = new Vector3().crossVectors(pu, px).normalize();
  if ((top && n.y < 0) || (!top && n.y > 0)) n.negate();
  const forward = new Vector3(0, 0, 1).addScaledVector(n, -n.z).normalize();
  const right = new Vector3().crossVectors(n, forward).normalize();
  const m = new Matrix4().makeBasis(right, n, forward);
  return { position: p.addScaledVector(n, lift), quaternion: new Quaternion().setFromRotationMatrix(m) };
}

// A quad grid as an indexed geometry with smooth normals.
function grid(ni: number, nj: number, at: (i: number, j: number, out: Vector3) => void, flip: boolean): BufferGeometry {
  const count = (ni + 1) * (nj + 1);
  const positions = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const v = new Vector3();
  for (let i = 0; i <= ni; i++) {
    for (let j = 0; j <= nj; j++) {
      at(i, j, v);
      const k = i * (nj + 1) + j;
      positions[k * 3] = v.x;
      positions[k * 3 + 1] = v.y;
      positions[k * 3 + 2] = v.z;
      uvs[k * 2] = (v.x + SPAN) / (2 * SPAN);
      uvs[k * 2 + 1] = (NOSE_Z - v.z) / (NOSE_Z - TAIL_Z + 0.2);
    }
  }
  const indices = new Uint32Array(ni * nj * 6);
  let n = 0;
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      const a = i * (nj + 1) + j;
      const b = a + 1;
      const c = a + (nj + 1);
      const d = c + 1;
      if (flip) indices.set([a, c, b, b, c, d], n);
      else indices.set([a, b, c, b, d, c], n);
      n += 6;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

interface LoftSpec {
  x0: number;
  x1: number;
  u0: number;
  u1: number;
  nx: number;
  nu: number;
  top?: boolean;
  bottom?: boolean;
  capX0?: boolean;
  capX1?: boolean;
  capU0?: boolean;
  capU1?: boolean;
}

// A region of the body between two span stations and two chord fractions,
// closed where asked with rib faces (constant x) and cut faces (constant u).
export function loft(spec: LoftSpec): BufferGeometry {
  const { x0, x1, u0, u1, nx, nu } = spec;
  const pieces: BufferGeometry[] = [];
  const xAt = (i: number) => lerp(x0, x1, i / nx);
  const uAt = (j: number) => lerp(u0, u1, j / nu);
  if (spec.top !== false) pieces.push(grid(nx, nu, (i, j, out) => surfaceTop(xAt(i), uAt(j), out), true));
  if (spec.bottom !== false) pieces.push(grid(nx, nu, (i, j, out) => surfaceBottom(xAt(i), uAt(j), out), false));
  const rib = (x: number, flip: boolean) => grid(nu, 1, (j, k, out) => (k === 0 ? surfaceTop(x, uAt(j), out) : surfaceBottom(x, uAt(j), out)), flip);
  const cut = (u: number, flip: boolean) => grid(nx, 1, (i, k, out) => (k === 0 ? surfaceTop(xAt(i), u, out) : surfaceBottom(xAt(i), u, out)), flip);
  if (spec.capX0) pieces.push(rib(x0, false));
  if (spec.capX1) pieces.push(rib(x1, true));
  if (spec.capU0) pieces.push(cut(u0, false));
  if (spec.capU1) pieces.push(cut(u1, true));
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  return merged;
}

// A tube from one closed ring to another, the section blending between them.
function transition(ringA: (t: number, out: Vector3) => void, ringB: (t: number, out: Vector3) => void, segments: number, rings: number, flip = false): BufferGeometry {
  const a = new Vector3();
  const b = new Vector3();
  const g = grid(rings, segments, (i, j, out) => {
    const t = j / segments;
    const s = smooth(i / rings);
    ringA(t, a);
    ringB(t, b);
    out.copy(a).lerp(b, s);
  }, flip);
  return g;
}

const superellipse = (t: number, a: number, b: number, n: number) => {
  const c = Math.cos(t * Math.PI * 2);
  const s = Math.sin(t * Math.PI * 2);
  return [Math.sign(c) * Math.pow(Math.abs(c), 2 / n) * a, Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * b] as const;
};

// Materials. Matte graphite composite skins with a procedural panel map,
// brushed titanium for the interfaces, dark alloy for the machinery.
export interface Materials {
  skin: MeshPhysicalMaterial;
  skinInside: MeshPhysicalMaterial;
  skinBottom: MeshPhysicalMaterial;
  titanium: MeshStandardMaterial;
  alloy: MeshStandardMaterial;
  structure: MeshStandardMaterial;
  unit: MeshStandardMaterial;
  label: MeshStandardMaterial;
  glass: MeshPhysicalMaterial;
  rubber: MeshStandardMaterial;
  duct: MeshStandardMaterial;
  radome: MeshStandardMaterial;
}

function skinCanvases(bottom: boolean): { map: CanvasTexture; rough: CanvasTexture } {
  const size = 1024;
  const map = document.createElement('canvas');
  const rough = document.createElement('canvas');
  map.width = map.height = rough.width = rough.height = size;
  const m = map.getContext('2d')!;
  const r = rough.getContext('2d')!;
  // Planform coordinates to pixels.
  const px = (x: number) => ((x + SPAN) / (2 * SPAN)) * size;
  const py = (z: number) => ((NOSE_Z - z) / (NOSE_Z - TAIL_Z + 0.2)) * size;
  m.fillStyle = '#2c2d31';
  m.fillRect(0, 0, size, size);
  r.fillStyle = 'rgb(150,150,150)';
  r.fillRect(0, 0, size, size);
  // Composite grain: fine noise in the roughness and a trace in the colour.
  const grain = r.getImageData(0, 0, size, size);
  const tone = m.getImageData(0, 0, size, size);
  let seed = bottom ? 7 : 3;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < size * size; i++) {
    const g = (rnd() - 0.5) * 22;
    const d = grain.data;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.max(0, Math.min(255, 150 + g));
    const t = (rnd() - 0.5) * 5;
    const c = tone.data;
    c[i * 4] = Math.max(0, Math.min(255, 44 + t));
    c[i * 4 + 1] = Math.max(0, Math.min(255, 45 + t));
    c[i * 4 + 2] = Math.max(0, Math.min(255, 49 + t));
  }
  r.putImageData(grain, 0, 0);
  m.putImageData(tone, 0, 0);

  // Panel tones: broad bands following the sweep, a few levels apart.
  const band = (z0: number, z1: number, tone: string, roughTone: string) => {
    for (const side of [1, -1]) {
      const poly = [
        [0, z0],
        [side * SPAN, z0 - 0.8 * SPAN],
        [side * SPAN, z1 - 0.8 * SPAN],
        [0, z1]
      ];
      for (const ctx of [m, r]) {
        ctx.fillStyle = ctx === m ? tone : roughTone;
        ctx.beginPath();
        poly.forEach(([x, z], k) => (k ? ctx.lineTo(px(x!), py(z!)) : ctx.moveTo(px(x!), py(z!))));
        ctx.closePath();
        ctx.fill();
      }
    }
  };
  band(2.3, 1.6, 'rgba(255,255,255,0.025)', 'rgba(255,255,255,0.05)');
  band(0.4, -0.5, 'rgba(0,0,0,0.08)', 'rgba(255,255,255,0.07)');
  band(-1.3, -2.0, 'rgba(255,255,255,0.02)', 'rgba(0,0,0,0.05)');

  const seam = (points: Array<readonly [number, number]>, strength = 1) => {
    for (const [ctx, light, dark] of [
      [m, 'rgba(84,86,92,0.9)', 'rgba(10,10,12,0.95)'],
      [r, 'rgba(255,255,255,0.0)', 'rgba(230,230,230,0.9)']
    ] as const) {
      ctx.lineWidth = 1.4 * strength;
      ctx.strokeStyle = light;
      ctx.beginPath();
      points.forEach(([x, z], k) => (k ? ctx.lineTo(px(x) + 1, py(z) + 1) : ctx.moveTo(px(x) + 1, py(z) + 1)));
      ctx.stroke();
      ctx.strokeStyle = dark;
      ctx.beginPath();
      points.forEach(([x, z], k) => (k ? ctx.lineTo(px(x), py(z)) : ctx.moveTo(px(x), py(z))));
      ctx.stroke();
    }
  };
  // Chordwise seams at the structural stations, the wing joint strongest.
  for (const x of [0.6, 1.4]) for (const s of [1, -1]) seam([[s * x, leadingZ(x) - 0.05], [s * x, trailingZ(x) + 0.05]]);
  for (const s of [1, -1]) seam([[s * ROOT, leadingZ(ROOT) - 0.03], [s * ROOT, trailingZ(ROOT) + 0.03]], 1.6);
  for (const x of [3.0, 3.6, 4.3]) for (const s of [1, -1]) seam([[s * x, leadingZ(x) - 0.04], [s * x, trailingZ(x) + 0.04]], 0.8);
  // Seams parallel to the leading edge, and the spar lines.
  for (const z of [2.3, 1.6, 0.4, -0.5, -1.3, -2.0]) for (const s of [1, -1]) seam([[0, z], [s * SPAN, z - 0.8 * SPAN]], 0.9);
  for (const frac of [0.3, 0.68]) {
    const pts: Array<readonly [number, number]> = [];
    for (let i = 0; i <= 20; i++) {
      const x = (i / 20) * SPAN;
      pts.push([x, leadingZ(x) - chord(x) * frac]);
    }
    seam(pts, 0.7);
    seam(pts.map(([x, z]) => [-x, z] as const), 0.7);
  }
  // Control surface hinge lines on the outer wings.
  for (const s of [1, -1]) {
    const pts: Array<readonly [number, number]> = [];
    for (let i = 0; i <= 10; i++) {
      const x = ROOT + ((SPAN - ROOT) * i) / 10;
      pts.push([s * x, leadingZ(x) - chord(x) * 0.72]);
    }
    seam(pts, 1.3);
    for (const x of [2.4, 3.5, 3.65, 4.85]) seam([[s * x, leadingZ(x) - chord(x) * 0.72], [s * x, trailingZ(x)]], 1.2);
  }
  // Access hatches and the serrated bay outlines.
  const hatch = (x: number, z: number, w: number, h: number, saw = false) => {
    const pts: Array<readonly [number, number]> = [];
    if (saw) {
      const n = 4;
      for (let i = 0; i < n; i++) pts.push([x - w / 2 + (w * i) / n, z + h / 2], [x - w / 2 + (w * (i + 0.5)) / n, z + h / 2 - 0.08]);
      pts.push([x + w / 2, z + h / 2], [x + w / 2, z - h / 2]);
      for (let i = n; i > 0; i--) pts.push([x - w / 2 + (w * i) / n, z - h / 2], [x - w / 2 + (w * (i - 0.5)) / n, z - h / 2 + 0.08]);
      pts.push([x - w / 2, z - h / 2], [x - w / 2, z + h / 2]);
    } else pts.push([x - w / 2, z + h / 2], [x + w / 2, z + h / 2], [x + w / 2, z - h / 2], [x - w / 2, z - h / 2], [x - w / 2, z + h / 2]);
    seam(pts, 1.1);
  };
  if (bottom) {
    hatch(-0.26, -0.95, 0.5, 1.7, true);
    hatch(0.26, -0.95, 0.5, 1.7, true);
    hatch(0, 1.75, 0.42, 0.9, true);
    hatch(1.0, -0.9, 0.5, 0.9, true);
    hatch(-1.0, -0.9, 0.5, 0.9, true);
    hatch(0.0, 2.35, 0.34, 0.34);
  } else {
    hatch(-1.1, 0.4, 0.46, 0.46);
    hatch(1.1, 0.4, 0.46, 0.46);
    hatch(-1.55, 1.05, 0.3, 0.5);
    hatch(1.55, 1.05, 0.3, 0.5);
    hatch(0, 2.5, 0.5, 0.42, true);
  }
  // Fastener rows along the strongest seams.
  m.fillStyle = 'rgba(96,98,104,0.85)';
  for (const x of [0.6, 1.4, ROOT]) {
    for (const s of [1, -1]) {
      const z0 = leadingZ(x) - 0.12;
      const z1 = trailingZ(x) + 0.12;
      const n = Math.max(2, Math.round((z0 - z1) / 0.14));
      for (let i = 0; i <= n; i++) {
        const z = lerp(z0, z1, i / n);
        m.beginPath();
        m.arc(px(s * x) + 4, py(z), 1.1, 0, Math.PI * 2);
        m.fill();
      }
    }
  }
  const mapTexture = new CanvasTexture(map);
  mapTexture.colorSpace = SRGBColorSpace;
  mapTexture.wrapS = mapTexture.wrapT = RepeatWrapping;
  const roughTexture = new CanvasTexture(rough);
  return { map: mapTexture, rough: roughTexture };
}

export function createMaterials(anisotropy: number): Materials {
  const top = skinCanvases(false);
  const under = skinCanvases(true);
  for (const t of [top.map, top.rough, under.map, under.rough]) t.anisotropy = anisotropy;
  const skinParams = { color: 0xffffff, roughness: 1, metalness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.5 };
  return {
    skin: new MeshPhysicalMaterial({ ...skinParams, map: top.map, roughnessMap: top.rough }),
    skinInside: new MeshPhysicalMaterial({ ...skinParams, map: top.map, roughnessMap: top.rough, side: DoubleSide }),
    skinBottom: new MeshPhysicalMaterial({ ...skinParams, map: under.map, roughnessMap: under.rough, side: DoubleSide }),
    titanium: new MeshStandardMaterial({ color: 0x9fa2a7, roughness: 0.34, metalness: 0.95 }),
    alloy: new MeshStandardMaterial({ color: 0x45484e, roughness: 0.48, metalness: 0.85 }),
    structure: new MeshStandardMaterial({ color: 0x7a7e85, roughness: 0.42, metalness: 0.78, side: DoubleSide }),
    unit: new MeshStandardMaterial({ color: 0x2c2e33, roughness: 0.5, metalness: 0.6 }),
    label: new MeshStandardMaterial({ color: 0xd9dadc, roughness: 0.6, metalness: 0.1 }),
    glass: new MeshPhysicalMaterial({ color: 0x07080b, roughness: 0.06, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }),
    rubber: new MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.95, metalness: 0 }),
    duct: new MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.7, metalness: 0.4, side: DoubleSide }),
    radome: new MeshStandardMaterial({ color: 0x15161a, roughness: 0.55, metalness: 0.2 })
  };
}

// An assembly that moves when the aircraft comes apart.
export interface Exploded {
  object: Object3D;
  part: PartId;
  // Separation order, 0 first out; or 'global' for what follows the hoist (the gear stay on the floor).
  order: number | 'global';
  rest: Vector3;
  offset: Vector3;
  restQuat: Quaternion;
  axis: Vector3 | null;
  angle: number;
}

export interface Airframe {
  root: Group;
  exploded: Exploded[];
  // Where each assembly sits when the aircraft is fully apart, for the camera.
  focus: Record<PartId, Vector3>;
  materials: Materials;
}

export function buildAirframe(materials: Materials): Airframe {
  const root = new Group();
  const exploded: Exploded[] = [];
  const add = (object: Object3D, part: PartId, order: number | 'global', offset: Vector3, axis: Vector3 | null = null, angle = 0) => {
    exploded.push({ object, part, order, rest: object.position.clone(), offset, restQuat: object.quaternion.clone(), axis, angle });
    return object;
  };
  const mesh = (geometry: BufferGeometry, material: MeshStandardMaterial | MeshPhysicalMaterial, shadow = true) => {
    const m = new Mesh(geometry, material);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    return m;
  };
  const box = (w: number, h: number, d: number, material: MeshStandardMaterial, x = 0, y = 0, z = 0) => {
    const m = mesh(new BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    return m;
  };
  const v = new Vector3();

  // 01 Fuselage: the centre section's two skins and the structure between them.
  const fuselage = new Group();
  root.add(fuselage);
  const topSkin = new Group();
  const topSkinMesh = mesh(loft({ x0: -ROOT, x1: ROOT, u0: 0, u1: 1, nx: 48, nu: 52, bottom: false }), materials.skinInside);
  // The one light comes from above; the lifted skin must not put the structure in the dark.
  topSkinMesh.castShadow = false;
  topSkin.add(topSkinMesh);
  const bottomSkin = new Group();
  bottomSkin.add(mesh(loft({ x0: -ROOT, x1: ROOT, u0: 0, u1: 1, nx: 48, nu: 52, top: false }), materials.skinBottom));
  fuselage.add(topSkin, bottomSkin);
  add(topSkin, 'fuselage', 0.1, new Vector3(0, 1.45, 0));
  add(bottomSkin, 'fuselage', 0.1, new Vector3(0, -1.3, 0));

  // Fasteners along the seams of the top skin, one instanced mesh.
  {
    const rows: Array<[number, number, number]> = [];
    for (const x of [0.6, 1.4, ROOT - 0.04]) {
      for (const s of [1, -1]) {
        const z0 = leadingZ(x) - 0.12;
        const z1 = trailingZ(x) + 0.12;
        const n = Math.max(2, Math.round((z0 - z1) / 0.14));
        for (let i = 0; i <= n; i++) rows.push([s * x + 0.03, lerp(z0, z1, i / n), 0]);
      }
    }
    const bolts = new InstancedMesh(new CylinderGeometry(0.009, 0.009, 0.004, 8), materials.titanium, rows.length);
    const m4 = new Matrix4();
    rows.forEach(([x, z], k) => {
      const pose = surfacePose(x, z, true, 0.001);
      m4.compose(pose.position, pose.quaternion, new Vector3(1, 1, 1));
      bolts.setMatrixAt(k, m4);
    });
    bolts.castShadow = false;
    topSkin.add(bolts);
  }

  // Structure: bulkheads, ribs, two spars and a keel. Nothing of it moves on its own.
  const structure = new Group();
  fuselage.add(structure);
  const ribShape = (x: number, inset: number, holes: boolean) => {
    const shape = new Shape();
    const n = 40;
    for (let j = 0; j <= n; j++) {
      surfaceTop(x, j / n, v);
      if (j === 0) shape.moveTo(v.z, v.y * inset);
      else shape.lineTo(v.z, v.y * inset);
    }
    for (let j = n; j >= 0; j--) {
      surfaceBottom(x, j / n, v);
      shape.lineTo(v.z, v.y * inset);
    }
    shape.closePath();
    if (holes) {
      for (const u of [0.18, 0.45, 0.82]) {
        surfaceTop(x, u, v);
        const top = v.y * inset;
        surfaceBottom(x, u, v);
        const bottom = v.y * inset;
        const rad = Math.min(0.16, (top - bottom) * 0.3);
        if (rad < 0.03) continue;
        const hole = new Path();
        hole.absarc(v.z, (top + bottom) / 2, rad, 0, Math.PI * 2, true);
        shape.holes.push(hole);
      }
    }
    return shape;
  };
  const rib = (x: number, thick: number, material: MeshStandardMaterial, holes = true) => {
    const geometry = new ExtrudeGeometry(ribShape(x, 0.94, holes), { depth: thick, bevelEnabled: false });
    const m = mesh(geometry, material);
    m.rotation.y = -Math.PI / 2;
    m.position.x = x + thick / 2;
    return m;
  };
  for (const x of [-1.5, -0.7, 0.7, 1.5]) structure.add(rib(x, 0.03, materials.structure));
  for (const s of [1, -1]) structure.add(rib(s * (ROOT - 0.05), 0.05, materials.titanium));
  const web = (frac: number, x0: number, x1: number) => {
    const g = grid(24, 1, (i, k, out) => {
      const x = lerp(x0, x1, i / 24);
      if (k === 0) surfaceTop(x, frac, out);
      else surfaceBottom(x, frac, out);
      out.y *= 0.9;
    }, false);
    return mesh(g, materials.structure);
  };
  structure.add(web(0.3, -ROOT + 0.1, ROOT - 0.1), web(0.68, -ROOT + 0.1, ROOT - 0.1));
  structure.add(box(0.1, 0.12, 5.2, materials.structure, 0, -0.3, 0.2));
  // Engine mounts, either side of the dorsal bay.
  structure.add(box(0.06, 0.5, 0.08, materials.alloy, 0.42, 0.1, -0.9), box(0.06, 0.5, 0.08, materials.alloy, -0.42, 0.1, -0.9));

  // 06 Wings: solid outer panels, root rib in titanium, with the trailing edge
  // left open where the control surfaces go.
  const wings = new Group();
  root.add(wings);
  const wingPanel = (side: number) => {
    const g = new Group();
    const sx0 = side > 0 ? ROOT : -SPAN;
    const sx1 = side > 0 ? SPAN : -ROOT;
    g.add(mesh(loft({ x0: sx0, x1: sx1, u0: 0, u1: 0.72, nx: 30, nu: 36, capU1: true, capX0: side < 0, capX1: side > 0 }), materials.skin));
    for (const [a, b] of [
      [ROOT, 2.4],
      [3.5, 3.65],
      [4.85, SPAN]
    ] as const) {
      g.add(mesh(loft({ x0: side * (side > 0 ? a : b), x1: side * (side > 0 ? b : a), u0: 0.72, u1: 1, nx: 3, nu: 8, capX0: true, capX1: true }), materials.skin));
    }
    // Root rib: the interface the fuselage bulkhead mates with, and its bolts.
    const r = rib(side * ROOT - 0.02 * side, 0.04, materials.titanium, false);
    g.add(r);
    const bolts = new InstancedMesh(new CylinderGeometry(0.014, 0.014, 0.02, 8), materials.alloy, 12);
    const m4 = new Matrix4();
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    for (let k = 0; k < 12; k++) {
      const u = 0.08 + (0.84 * k) / 11;
      surfaceTop(side * ROOT, u, v);
      const top = v.y * 0.9;
      surfaceBottom(side * ROOT, u, v);
      const y = (top + v.y * 0.9) / 2;
      m4.compose(new Vector3(side * (ROOT - 0.01), y, v.z), q, new Vector3(1, 1, 1));
      bolts.setMatrixAt(k, m4);
    }
    g.add(bolts);
    return g;
  };
  const rightWing = add(wingPanel(1), 'wings', 0.0, new Vector3(1.7, 0.35, -0.3));
  const leftWing = add(wingPanel(-1), 'wings', 0.0, new Vector3(-1.7, 0.35, -0.3));
  wings.add(rightWing, leftWing);

  // 08 Flight control: four elevons on their hinge lines, and the flight
  // control computer inside the left centre section.
  const controls = new Group();
  root.add(controls);
  const elevon = (side: number, a: number, b: number, deflect: number) => {
    const geometry = loft({ x0: Math.min(side * a, side * b), x1: Math.max(side * a, side * b), u0: 0.72, u1: 1, nx: 12, nu: 10, capX0: true, capX1: true, capU0: true });
    const h0 = surfaceTop(side * a, 0.72, new Vector3());
    const h1 = surfaceTop(side * b, 0.72, new Vector3());
    const b0 = surfaceBottom(side * a, 0.72, new Vector3());
    const b1 = surfaceBottom(side * b, 0.72, new Vector3());
    const hinge = h0.clone().add(h1).add(b0).add(b1).multiplyScalar(0.25);
    const axis = h1.clone().add(b1).multiplyScalar(0.5).sub(h0.clone().add(b0).multiplyScalar(0.5)).normalize();
    geometry.translate(-hinge.x, -hinge.y, -hinge.z);
    const m = mesh(geometry, materials.skin);
    m.position.copy(hinge);
    // Hinge brackets.
    for (const t of [0.2, 0.8]) {
      const bracket = box(0.05, 0.05, 0.1, materials.alloy);
      bracket.position.copy(h0.clone().lerp(h1, t).sub(hinge)).y -= 0.02;
      bracket.position.z += 0.02;
      m.add(bracket);
    }
    const out = new Vector3(side * 2.05, 0.35, -0.85);
    return add(m, 'controls', 0.2, out, axis.multiplyScalar(side), deflect);
  };
  controls.add(elevon(1, 2.4, 3.5, -0.32), elevon(1, 3.65, 4.85, 0.26), elevon(-1, 2.4, 3.5, 0.32), elevon(-1, 3.65, 4.85, -0.26));
  const fcc = new Group();
  fcc.position.set(-1.5, -0.06, 0.35);
  fcc.add(box(0.36, 0.16, 0.3, materials.unit), box(0.2, 0.004, 0.08, materials.label, 0, 0.082, 0.04));
  for (const k of [-0.1, 0, 0.1]) {
    const c = mesh(new CylinderGeometry(0.018, 0.018, 0.03, 10), materials.titanium);
    c.rotation.x = Math.PI / 2;
    c.position.set(k, -0.02, 0.165);
    fcc.add(c);
  }
  controls.add(add(fcc, 'controls', 0.2, new Vector3(-0.5, 1.05, 0)));

  // 04 Propulsion: the dorsal intake and its duct, the engine, and the
  // flattened exhaust at the tail.
  const propulsion = new Group();
  root.add(propulsion);
  const lipCentre = surfaceTop(0, chordFraction(0, 1.55), new Vector3()).add(new Vector3(0, 0.03, 0));
  const lipTilt = 0.42;
  const lipRing = (t: number, out: Vector3) => {
    const [a, b] = superellipse(t, 0.5, 0.11, 3.2);
    out.set(a, lipCentre.y + b * Math.cos(lipTilt), lipCentre.z - b * Math.sin(lipTilt));
  };
  const faceCentre = new Vector3(0, 0.22, -0.55);
  const faceRing = (t: number, out: Vector3) => {
    const [a, b] = superellipse(t, 0.27, 0.27, 2);
    out.set(a, faceCentre.y + b, faceCentre.z);
  };
  propulsion.add(mesh(transition(lipRing, faceRing, 40, 10, true), materials.duct, false));
  {
    const pts: Vector3[] = [];
    for (let i = 0; i < 48; i++) {
      const p = new Vector3();
      lipRing(i / 48, p);
      pts.push(p);
    }
    const lip = mesh(new TubeGeometry(new CatmullRomCurve3(pts, true, 'catmullrom', 0.5), 96, 0.028, 10, true), materials.titanium);
    propulsion.add(lip);
    // Boundary layer diverter: a low ramp ahead of the lip.
    const ramp = box(0.9, 0.03, 0.36, materials.alloy, 0, lipCentre.y - 0.02, lipCentre.z + 0.3);
    ramp.rotation.x = -0.12;
    propulsion.add(ramp);
  }
  const engine = new Group();
  engine.position.set(0, 0.22, -1.45);
  const along = (g: BufferGeometry) => g.rotateX(Math.PI / 2);
  engine.add(mesh(along(new CylinderGeometry(0.29, 0.31, 1.5, 36)), materials.alloy));
  for (const z of [0.55, 0.05, -0.45]) {
    const ring = mesh(new TorusGeometry(0.31, 0.022, 10, 48), materials.titanium);
    ring.position.z = z;
    engine.add(ring);
  }
  // Fan: a spinner and twenty blades.
  const spinner = mesh(along(new ConeGeometry(0.09, 0.22, 20)), materials.titanium);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = 0.86;
  engine.add(spinner);
  {
    const blades = new InstancedMesh(new BoxGeometry(0.05, 0.19, 0.012), materials.titanium, 20);
    const m4 = new Matrix4();
    const q = new Quaternion();
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      q.setFromAxisAngle(new Vector3(0, 0, 1), a).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.6));
      m4.compose(new Vector3(Math.sin(a) * -0.185, Math.cos(a) * 0.185, 0.78), q, new Vector3(1, 1, 1));
      blades.setMatrixAt(k, m4);
    }
    engine.add(blades);
    const hub = mesh(along(new CylinderGeometry(0.27, 0.27, 0.06, 36)), materials.unit);
    hub.position.z = 0.74;
    engine.add(hub);
  }
  // Accessory gearbox and lines along the case.
  engine.add(box(0.22, 0.14, 0.5, materials.unit, 0.3, -0.16, 0.05), box(0.16, 0.1, 0.36, materials.unit, -0.3, -0.14, -0.1));
  for (const [x, y] of [
    [0.33, 0.06],
    [-0.33, 0.02],
    [0.1, 0.33]
  ] as const) {
    const line = mesh(along(new CylinderGeometry(0.012, 0.012, 1.3, 8)), materials.titanium, false);
    line.position.set(x, y, 0);
    engine.add(line);
  }
  // Tail cone to the flattened exhaust.
  const coneRing = (t: number, out: Vector3) => {
    const [a, b] = superellipse(t, 0.29, 0.29, 2);
    out.set(a, b, -0.75);
  };
  const exitRing = (t: number, out: Vector3) => {
    const [a, b] = superellipse(t, 0.34, 0.075, 3.6);
    out.set(a, b - 0.08, -1.58);
  };
  engine.add(mesh(transition(coneRing, exitRing, 48, 12, true), materials.alloy));
  const inner = (t: number, out: Vector3) => {
    const [a, b] = superellipse(t, 0.3, 0.055, 3.6);
    out.set(a, b - 0.08, -1.5);
  };
  const innerBack = (t: number, out: Vector3) => {
    const [a, b] = superellipse(t, 0.2, 0.05, 3.0);
    out.set(a, b - 0.06, -0.6);
  };
  engine.add(mesh(transition(inner, innerBack, 48, 6, true), materials.duct, false));
  propulsion.add(engine);
  add(propulsion, 'propulsion', 0.3, new Vector3(0, 0.55, -2.5));

  // 02 Sensor array: the turret under the nose, the radar aperture behind
  // the nose skin, and conformal apertures on each leading edge.
  const sensors = new Group();
  root.add(sensors);
  {
    const bottomAt = surfaceBottom(0, chordFraction(0, 2.3), new Vector3());
    const turret = new Group();
    turret.position.set(0, bottomAt.y, 2.3);
    const housing = mesh(new CylinderGeometry(0.2, 0.17, 0.13, 8), materials.radome);
    housing.position.y = -0.065;
    const ball = mesh(new CylinderGeometry(0.16, 0.16, 0.2, 24), materials.unit);
    ball.rotation.z = Math.PI / 2;
    ball.position.y = -0.24;
    const window = mesh(new CylinderGeometry(0.075, 0.075, 0.02, 24), materials.glass);
    window.rotation.x = Math.PI / 2;
    window.position.set(0, -0.24, 0.155);
    const window2 = window.clone();
    window2.position.set(0.09, -0.24, 0.13);
    window2.rotation.y = 0.6;
    window2.scale.setScalar(0.6);
    turret.add(housing, ball, window, window2);
    sensors.add(turret);
    const radar = box(0.78, 0.34, 0.035, materials.unit, 0, -0.02, 2.72);
    radar.rotation.x = -0.5;
    const face = box(0.7, 0.26, 0.006, materials.label, 0, 0.0, 0.02);
    face.material = materials.radome;
    radar.add(face);
    sensors.add(radar);
    for (const s of [1, -1]) {
      const pose = surfacePose(s * 1.25, leadingZ(1.25) - 0.32, true, 0.004);
      const aperture = mesh(new BoxGeometry(0.5, 0.008, 0.16), materials.glass);
      aperture.position.copy(pose.position);
      aperture.quaternion.copy(pose.quaternion);
      aperture.rotateY(s * 0.67);
      sensors.add(aperture);
    }
  }
  add(sensors, 'sensors', 0.55, new Vector3(0, -0.35, 1.9));

  // 03 Avionics: a tray of line-replaceable units behind the sensors.
  const avionics = new Group();
  root.add(avionics);
  avionics.position.set(0, -0.1, 1.15);
  avionics.add(box(1.1, 0.035, 0.84, materials.structure));
  const unit = (w: number, h: number, d: number, x: number, z: number) => {
    const g = new Group();
    g.position.set(x, 0.0175 + h / 2, z);
    g.add(box(w, h, d, materials.unit), box(w * 0.55, 0.004, d * 0.3, materials.label, 0, h / 2 + 0.002, -d * 0.2));
    const n = Math.max(1, Math.round(w / 0.1));
    for (let k = 0; k < n; k++) {
      const c = mesh(new CylinderGeometry(0.016, 0.016, 0.025, 10), materials.titanium);
      c.rotation.x = Math.PI / 2;
      c.position.set(-w / 2 + (w * (k + 0.5)) / n, -h * 0.2, d / 2 + 0.0125);
      g.add(c);
    }
    return g;
  };
  avionics.add(unit(0.28, 0.22, 0.36, -0.38, 0.2), unit(0.3, 0.18, 0.4, 0.0, 0.18), unit(0.24, 0.26, 0.3, 0.38, 0.22), unit(0.34, 0.14, 0.28, -0.3, -0.22), unit(0.22, 0.2, 0.26, 0.26, -0.24));
  add(avionics, 'avionics', 0.4, new Vector3(0, 1.0, 0.45));

  // Communications: a satcom array on the upper skin, a datalink unit inside,
  // blade antennas underneath. They travel with the avionics story.
  const comms = new Group();
  root.add(comms);
  {
    const pose = surfacePose(1.15, 0.4, true, 0.012);
    const satcom = mesh(new CylinderGeometry(0.26, 0.27, 0.03, 8), materials.radome);
    satcom.position.copy(pose.position);
    satcom.quaternion.copy(pose.quaternion);
    comms.add(add(satcom, 'avionics', 0.45, new Vector3(0.4, 2.0, 0)));
    const datalink = new Group();
    datalink.position.set(1.5, -0.06, 0.35);
    datalink.add(box(0.36, 0.16, 0.3, materials.unit), box(0.2, 0.004, 0.08, materials.label, 0, 0.082, 0.04));
    comms.add(add(datalink, 'avionics', 0.45, new Vector3(0.5, 1.05, 0)));
    for (const s of [1, -1]) {
      const under = surfaceBottom(s * 0.7, chordFraction(0.7, -0.3), new Vector3());
      const blade = mesh(new BoxGeometry(0.025, 0.15, 0.28), materials.radome);
      blade.position.set(under.x, under.y - 0.07, under.z);
      blade.rotation.x = 0.0;
      comms.add(add(blade, 'avionics', 0.45, new Vector3(s * 0.3, -0.55, 0)));
    }
  }

  // 05 Payload: the bay doors on their hinges and the modular payload between them.
  const payload = new Group();
  root.add(payload);
  {
    const floorAt = surfaceBottom(0.26, chordFraction(0.26, -0.95), new Vector3());
    for (const s of [1, -1]) {
      const door = new Group();
      door.position.set(s * 0.53, floorAt.y + 0.005, -0.95);
      const panel = box(0.5, 0.028, 1.68, materials.skinBottom, -s * 0.25, 0, 0);
      door.add(panel);
      for (const z of [-0.6, 0, 0.6]) door.add(box(0.06, 0.05, 0.08, materials.alloy, -s * 0.02, 0.03, z));
      payload.add(add(door, 'payload', 0.5, new Vector3(s * 0.2, -1.6, 0), new Vector3(0, 0, 1), -s * 1.05));
    }
    const module = new Group();
    module.position.set(0, -0.3, -0.95);
    module.add(box(0.46, 0.05, 1.5, materials.structure));
    const pod = mesh(new CapsuleGeometry(0.135, 1.0, 6, 20), materials.unit);
    pod.rotation.x = Math.PI / 2;
    pod.position.y = 0.11;
    module.add(pod);
    for (const z of [-0.45, 0.45]) module.add(box(0.3, 0.1, 0.06, materials.alloy, 0, 0.02, z));
    const lens = mesh(new CylinderGeometry(0.06, 0.06, 0.01, 20), materials.glass);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0.11, 0.65);
    module.add(lens);
    payload.add(add(module, 'payload', 0.5, new Vector3(0, -0.55, 0)));
  }

  // 07 Landing gear: nose gear and two mains, standing on the floor.
  const gear = new Group();
  root.add(gear);
  const leg = (x: number, z: number, twin: boolean, radius: number) => {
    const g = new Group();
    const top = surfaceBottom(x, chordFraction(x, z), new Vector3());
    g.position.set(x, top.y + 0.02, z);
    const wheelY = -GEAR + radius;
    const length = g.position.y - wheelY;
    const strut = mesh(new CylinderGeometry(0.03, 0.036, length, 14), materials.titanium);
    strut.position.y = -length / 2;
    const outer = mesh(new CylinderGeometry(0.048, 0.048, length * 0.45, 14), materials.alloy);
    outer.position.y = -length * 0.225;
    const mount = box(0.16, 0.08, 0.2, materials.alloy, 0, -0.04, 0);
    const brace = mesh(new CylinderGeometry(0.014, 0.014, length * 0.85, 8), materials.alloy);
    brace.position.set(0, -length * 0.55, 0.16);
    brace.rotation.x = 0.32;
    g.add(strut, outer, mount, brace);
    const wheel = (dx: number) => {
      const w = mesh(new CylinderGeometry(radius, radius, 0.09, 28), materials.rubber);
      w.rotation.z = Math.PI / 2;
      w.position.set(dx, wheelY - g.position.y, 0);
      // The wheel is already turned onto its side, so the hub shares its axis.
      w.add(mesh(new CylinderGeometry(radius * 0.5, radius * 0.5, 0.1, 20), materials.titanium));
      return w;
    };
    if (twin) g.add(wheel(-0.075), wheel(0.075));
    else g.add(wheel(0));
    const axle = mesh(new CylinderGeometry(0.02, 0.02, twin ? 0.3 : 0.14, 10), materials.titanium);
    axle.rotation.z = Math.PI / 2;
    axle.position.y = wheelY - g.position.y;
    g.add(axle);
    // Gear door, hanging open beside the leg.
    // Gear door, hanging open on the inboard side of the leg.
    const door = box(0.02, length * 0.6, Math.min(0.6, length * 0.55), materials.skinBottom, x >= 0 ? -0.2 : 0.2, -length * 0.36, 0);
    door.rotation.z = x >= 0 ? -0.12 : 0.12;
    g.add(door);
    return g;
  };
  gear.add(add(leg(0, 1.72, false, 0.15), 'gear', 'global', new Vector3(0, -LIFT, 0.5)));
  gear.add(add(leg(1.0, -0.9, true, 0.17), 'gear', 'global', new Vector3(0.45, -LIFT, -0.3)));
  gear.add(add(leg(-1.0, -0.9, true, 0.17), 'gear', 'global', new Vector3(-0.45, -LIFT, -0.3)));

  // Where each assembly sits when fully apart, in airframe space (the camera adds the hoist).
  const focus: Record<PartId, Vector3> = {
    fuselage: new Vector3(0, 0.1, 0.2),
    sensors: new Vector3(0, -0.85, 4.3),
    avionics: new Vector3(0, 1.0, 1.6),
    propulsion: new Vector3(0, 0.7, -3.9),
    payload: new Vector3(0, -0.85, -0.95),
    wings: new Vector3(5.0, 0.35, 0.0),
    gear: new Vector3(0.5, -GEAR - LIFT + 0.5, 0.3),
    controls: new Vector3(6.3, 0.35, -1.9)
  };

  // One draw call per material per assembly: the static meshes of each
  // assembly are merged in place. Instanced meshes stay as they are.
  root.updateMatrixWorld(true);
  consolidate(structure);
  for (const e of exploded) consolidate(e.object);

  return { root, exploded, focus, materials };
}

function consolidate(unit: Object3D): void {
  const byMaterial = new Map<MeshStandardMaterial, BufferGeometry[]>();
  const found: Mesh[] = [];
  const inverse = new Matrix4().copy(unit.matrixWorld).invert();
  const relative = new Matrix4();
  unit.traverse((o) => {
    if (!(o instanceof Mesh) || o instanceof InstancedMesh) return;
    const mesh = o as Mesh<BufferGeometry, MeshStandardMaterial>;
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    relative.multiplyMatrices(inverse, mesh.matrixWorld);
    geometry.applyMatrix4(relative);
    const list = byMaterial.get(mesh.material) ?? [];
    list.push(geometry);
    byMaterial.set(mesh.material, list);
    found.push(mesh);
  });
  if (found.length < 2) return;
  for (const mesh of found) {
    if (mesh !== unit) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
  }
  const self = unit instanceof Mesh ? (unit as Mesh<BufferGeometry, MeshStandardMaterial>) : null;
  for (const [material, geometries] of byMaterial) {
    const merged = mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    if (self && material === self.material) {
      self.geometry.dispose();
      self.geometry = merged;
      continue;
    }
    const mesh = new Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    unit.add(mesh);
  }
  // A merged geometry carries the children's transforms, so the unit's own
  // mesh must keep an identity transform below its pose: it already does,
  // since the merge is relative to the unit.
}

// The aircraft rests on the floor assembled, is hoisted by LIFT as it comes
// apart, and returns. Each assembly moves along its own axis by its own
// separation; the gear follow the global separation so they stay on the floor.
export function poseAirframe(frame: Airframe, separation: number, partSeparation: (order: number) => number): void {
  frame.root.position.y = GEAR + LIFT * separation;
  for (const e of frame.exploded) {
    const s = e.order === 'global' ? separation : partSeparation(e.order);
    e.object.position.copy(e.rest).addScaledVector(e.offset, s);
    if (e.axis) e.object.quaternion.setFromAxisAngle(e.axis, e.angle * s).multiply(e.restQuat);
  }
}
