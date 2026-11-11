// Bottle shapes: lathe profiles for the glass, a curved strip for the label, a
// foil capsule over the neck, and the capsule colliders the physics uses.
// All sizes in metres. The geometry origin sits at the centre of mass so the
// rigid body and the mesh share one transform.
import { BufferGeometry, CylinderGeometry, LatheGeometry, Vector2 } from 'three';

export type ShapeName = 'bordeaux' | 'burgundy' | 'flute';

export interface ColliderSpec {
  kind: 'capsule' | 'ball';
  y: number; // centre, relative to the origin
  halfHeight: number;
  radius: number;
}

export interface BottleShape {
  name: ShapeName;
  height: number;
  bodyR: number;
  neckR: number;
  shoulderStart: number; // y where the straight body ends
  shoulderEnd: number; // y where the neck begins
  labelY: number; // centre of the label
  labelH: number;
  labelWrap: number; // fraction of the circumference the label covers
  origin: number; // y of the centre of mass, measured from the base
  colliders: ColliderSpec[];
  volume: number; // approximate, m^3, for the mass
}

export interface BottleGeometry {
  glass: BufferGeometry;
  label: BufferGeometry;
  capsule: BufferGeometry;
}

// Two capsules: the body, and the neck reaching down over the shoulder. A third
// shape for the shoulder itself costs the solver nearly as much again for a few
// millimetres of glass.
function colliders(s: Omit<BottleShape, 'colliders' | 'volume' | 'origin'>, origin: number): ColliderSpec[] {
  const span = s.shoulderEnd - s.shoulderStart;
  const bodyBottom = 0.004;
  const bodyTop = s.shoulderStart + span * 0.4;
  const bodyR = s.bodyR;
  const neckR = s.neckR + 0.0035;
  const neckBottom = s.shoulderStart + span * 0.3;
  const neckTop = s.height;
  return [
    { kind: 'capsule', y: (bodyBottom + bodyTop) / 2 - origin, halfHeight: Math.max(0.005, (bodyTop - bodyBottom) / 2 - bodyR), radius: bodyR },
    { kind: 'capsule', y: (neckBottom + neckTop) / 2 - origin, halfHeight: Math.max(0.005, (neckTop - neckBottom) / 2 - neckR), radius: neckR }
  ];
}

function shape(spec: Omit<BottleShape, 'colliders' | 'volume' | 'origin'>): BottleShape {
  const origin = spec.height * 0.42;
  const volume = Math.PI * spec.bodyR * spec.bodyR * spec.shoulderStart + Math.PI * spec.neckR * spec.neckR * (spec.height - spec.shoulderEnd) + Math.PI * ((spec.bodyR + spec.neckR) / 2) ** 2 * (spec.shoulderEnd - spec.shoulderStart);
  return { ...spec, origin, colliders: colliders(spec, origin), volume };
}

export const SHAPES: Record<ShapeName, BottleShape> = {
  bordeaux: shape({ name: 'bordeaux', height: 0.3, bodyR: 0.0375, neckR: 0.0145, shoulderStart: 0.195, shoulderEnd: 0.232, labelY: 0.1, labelH: 0.09, labelWrap: 0.6 }),
  burgundy: shape({ name: 'burgundy', height: 0.295, bodyR: 0.04, neckR: 0.015, shoulderStart: 0.165, shoulderEnd: 0.245, labelY: 0.092, labelH: 0.08, labelWrap: 0.58 }),
  flute: shape({ name: 'flute', height: 0.33, bodyR: 0.034, neckR: 0.0135, shoulderStart: 0.15, shoulderEnd: 0.285, labelY: 0.1, labelH: 0.078, labelWrap: 0.62 })
};

export const SHAPE_NAMES: ShapeName[] = ['bordeaux', 'burgundy', 'flute'];

// Shoulder profile: fraction of the body radius kept at t in [0, 1] from body to neck.
function shoulder(name: ShapeName, t: number): number {
  switch (name) {
    case 'bordeaux':
      // Quarter circle: flat shoulder turning into a vertical neck.
      return Math.sqrt(Math.max(0, 1 - t * t));
    case 'burgundy': {
      // Gentle S curve.
      const s = t * t * (3 - 2 * t);
      return 1 - s;
    }
    case 'flute':
    default:
      return Math.pow(1 - t, 1.35);
  }
}

function glassProfile(s: BottleShape): Vector2[] {
  const pts: Vector2[] = [];
  const add = (r: number, y: number) => pts.push(new Vector2(r, y - s.origin));
  // Punt and base.
  add(0, 0.016);
  add(0.009, 0.014);
  add(0.02, 0.007);
  add(s.bodyR * 0.84, 0.0);
  add(s.bodyR * 0.96, 0.002);
  add(s.bodyR, 0.011);
  add(s.bodyR, s.shoulderStart);
  const n = 10;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    add(s.neckR + (s.bodyR - s.neckR) * shoulder(s.name, t), s.shoulderStart + (s.shoulderEnd - s.shoulderStart) * t);
  }
  add(s.neckR, s.shoulderEnd);
  add(s.neckR, s.height - 0.017);
  add(s.neckR + 0.0035, s.height - 0.0155);
  add(s.neckR + 0.0035, s.height - 0.001);
  add(s.neckR + 0.0028, s.height);
  add(s.neckR * 0.7, s.height);
  add(0, s.height);
  return pts;
}

function capsuleProfile(s: BottleShape): Vector2[] {
  const pts: Vector2[] = [];
  const add = (r: number, y: number) => pts.push(new Vector2(r, y - s.origin));
  const bottom = s.shoulderEnd + 0.012;
  const r = s.neckR + 0.0013;
  add(r, bottom);
  add(r, s.height - 0.0175);
  add(s.neckR + 0.0049, s.height - 0.015);
  add(s.neckR + 0.0049, s.height + 0.0004);
  add(s.neckR + 0.0025, s.height + 0.0012);
  add(0, s.height + 0.0012);
  return pts;
}

export function buildBottleGeometry(s: BottleShape, segments: number): BottleGeometry {
  const glass = new LatheGeometry(glassProfile(s), segments);
  const capsule = new LatheGeometry(capsuleProfile(s), Math.max(12, Math.round(segments * 0.6)));
  const wrap = Math.PI * 2 * s.labelWrap;
  const label = new CylinderGeometry(s.bodyR + 0.0006, s.bodyR + 0.0006, s.labelH, Math.max(16, Math.round(segments * 0.8)), 1, true, -wrap / 2, wrap);
  label.translate(0, s.labelY - s.origin, 0);
  return { glass, label, capsule };
}

// Label strip aspect (width over height), so the atlas tiles can match it.
export function labelAspect(s: BottleShape): number {
  return (Math.PI * 2 * s.bodyR * s.labelWrap) / s.labelH;
}
