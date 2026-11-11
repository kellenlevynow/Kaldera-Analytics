// The journey in scroll progress, shared by the page (text timings, HUD) and
// the scene (separation, camera). Pure data: no three.js here, so the entry
// script can read it before the scene chunk loads.

// The aircraft starts separating almost at once; it is fully apart by SPLIT_END,
// stays apart through the component fly-bys, and comes back together between
// JOIN_START and JOIN_END. The final reveal holds from there.
export const SPLIT_START = 0.03;
export const SPLIT_END = 0.17;
export const JOIN_START = 0.8;
export const JOIN_END = 0.93;

export type PartId = 'fuselage' | 'sensors' | 'avionics' | 'propulsion' | 'payload' | 'wings' | 'gear' | 'controls';

export interface Part {
  id: PartId;
  index: number; // 1 to 8, the order of the fly-bys
  name: string; // the assembly
  discipline: string; // what it stands for
  from: number; // scroll progress where the camera starts moving to it
  to: number; // where it hands over to the next
  // Order of separation: 0 leaves first on the way out and returns last on the way back.
  order: number;
}

const FIRST = 0.195;
const EACH = 0.0725;
const define = (index: number, id: PartId, name: string, discipline: string, order: number): Part => ({
  id,
  index,
  name,
  discipline,
  from: FIRST + (index - 1) * EACH,
  to: FIRST + index * EACH,
  order
});

export const PARTS: readonly Part[] = [
  define(1, 'fuselage', 'Fuselage', 'Positioning and market intelligence', 0.1),
  define(2, 'sensors', 'Sensor array', 'Signal and attribution', 0.55),
  define(3, 'avionics', 'Avionics', 'Data and intelligence', 0.4),
  define(4, 'propulsion', 'Propulsion', 'Demand generation', 0.3),
  define(5, 'payload', 'Payload', 'Account-based marketing', 0.5),
  define(6, 'wings', 'Wings', 'Reach and market expansion', 0.0),
  define(7, 'gear', 'Landing gear', 'Conversion and revenue', 0.75),
  define(8, 'controls', 'Flight control', 'Systems and governance', 0.2)
];

export const PART_COUNT = PARTS.length;

export const smoothstep = (t: number): number => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

// Overall separation, 0 to 1, at a point in the journey.
export function separationAt(p: number): number {
  if (p < SPLIT_END) return smoothstep((p - SPLIT_START) / (SPLIT_END - SPLIT_START));
  if (p < JOIN_START) return 1;
  return 1 - smoothstep((p - JOIN_START) / (JOIN_END - JOIN_START));
}

// Each assembly separates on its own cue inside the window, so the aircraft
// comes apart in a sequence rather than all at once, and returns in reverse.
export function partSeparationAt(p: number, order: number): number {
  const span = 0.55; // each assembly's own ramp, as a fraction of the window
  if (p < SPLIT_END) {
    const w = SPLIT_END - SPLIT_START;
    const start = SPLIT_START + order * (1 - span) * w;
    return smoothstep((p - start) / (span * w));
  }
  if (p < JOIN_START) return 1;
  const w = JOIN_END - JOIN_START;
  const start = JOIN_START + (1 - order) * (1 - span) * w;
  return 1 - smoothstep((p - start) / (span * w));
}

// The assembly the camera is on, or null in the overview stages.
export function partAt(p: number): Part | null {
  for (const part of PARTS) if (p >= part.from && p < part.to) return part;
  return null;
}

export function assemblyLabel(p: number): string {
  if (p < SPLIT_START) return 'Integrated';
  if (p < SPLIT_END) return 'Separating';
  if (p < JOIN_START) return 'Exploded';
  if (p < JOIN_END) return 'Reassembling';
  return 'Integrated';
}

export function focusLabel(p: number): string {
  const part = partAt(p);
  if (part) return `${String(part.index).padStart(2, '0')} ${part.name}`;
  if (p >= SPLIT_END && p < JOIN_START) return '00 Exploded view';
  return '00 Platform';
}
