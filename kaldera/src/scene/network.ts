// Rim installations and the network between them.
//
// Six nodes on the lit crest, one merged mesh for all structures, one Points
// object for beacons, one LineSegments for the rim link (with the reserve
// cable), two orbital rings, one Points object for satellites and one uplink
// line. Eight draw calls in total, all white or neutral grey.
import { BufferAttribute, BufferGeometry, BoxGeometry, CylinderGeometry, Euler, Group, Line, LineBasicMaterial, LineLoop, LineSegments, Matrix4, Mesh, Points, Quaternion, ShaderMaterial, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise';
import { beaconFragment, beaconVertex, linkFragment, linkVertex, satelliteFragment, satelliteVertex, structureFragment, structureVertex } from './shaders';
import { FLOOR_R, heightAt, rimRadiusAt, sunDir, type TerrainSampler } from './terrain';

export type NodeSide = 'left' | 'right';

export interface NodeSpec {
  id: string;
  index: number;
  angleDeg: number;
  side: NodeSide;
}

export interface NodeAnchor extends NodeSpec {
  position: Vector3;
}

// Side is where the node sits in the frame, opposite the text panel.
export const NODES: NodeSpec[] = [
  { id: 'demand', index: 1, angleDeg: 285, side: 'right' },
  { id: 'acquisition', index: 2, angleDeg: 330, side: 'left' },
  { id: 'conversion', index: 3, angleDeg: 15, side: 'right' },
  { id: 'automation', index: 4, angleDeg: 60, side: 'left' },
  { id: 'data', index: 5, angleDeg: 105, side: 'right' },
  { id: 'revenue', index: 6, angleDeg: 150, side: 'left' }
];

const DEG = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
// Structures are built in kilometres and scaled up for legibility from the rim path.
const S = 1.7;
const box = (w: number, h: number, d: number) => new BoxGeometry(w * S, h * S, d * S);
const cyl = (rt: number, rb: number, h: number, seg: number, hs = 1, open = false, start = 0, length = Math.PI * 2) => new CylinderGeometry(rt * S, rb * S, h * S, seg, hs, open, start, length);
const sphere = (r: number, w: number, h: number, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) => new SphereGeometry(r * S, w, h, phiStart, phiLength, thetaStart, thetaLength);
const torus = (r: number, t: number, rs: number, ts: number) => new TorusGeometry(r * S, t * S, rs, ts);
const WHITE = 0.88;
const PAINT = 0.72;
const DARK = 0.28;

export function anchorNodes(): NodeAnchor[] {
  return NODES.map((spec) => {
    const a = spec.angleDeg * DEG;
    const r = rimRadiusAt(a) - 0.12;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    return { ...spec, position: new Vector3(x, heightAt(x, z), z) };
  });
}

export interface Network {
  group: Group;
  nodes: NodeAnchor[];
  update(time: number, progress: number, cameraPosition: Vector3): void;
  setDpr(dpr: number): void;
  dispose(): void;
}

// Local frame on the crest: tangent along the rim, radial outward, world up.
class Frame {
  readonly tangent: Vector3;
  readonly radial: Vector3;
  constructor(readonly anchor: Vector3, angleDeg: number, private readonly sampler: TerrainSampler) {
    const a = angleDeg * DEG;
    this.radial = new Vector3(Math.cos(a), 0, Math.sin(a));
    this.tangent = new Vector3(-Math.sin(a), 0, Math.cos(a));
  }
  // Point at (along, out) on the local ground plus lift, following the terrain.
  at(along: number, out: number, lift: number): Vector3 {
    const p = this.anchor.clone().addScaledVector(this.tangent, along * S).addScaledVector(this.radial, out * S);
    p.y = this.sampler.heightAt(p.x, p.z) + lift * S;
    return p;
  }
  // Lift a world point by a scaled amount.
  up(p: Vector3, lift: number): Vector3 {
    return p.clone().setY(p.y + lift * S);
  }
  // Move a world point by scaled tangent and radial amounts (and lift).
  move(p: Vector3, along: number, out: number, lift = 0): Vector3 {
    return p.clone().addScaledVector(this.tangent, along * S).addScaledVector(this.radial, out * S).setY(p.y + lift * S);
  }
  shade(p: Vector3): number {
    return this.sampler.shadeAt(p.x, p.z);
  }
  sampleHeight(p: Vector3): number {
    return this.sampler.heightAt(p.x, p.z);
  }
}

class Builder {
  readonly parts: BufferGeometry[] = [];
  readonly beacons: Vector3[] = [];
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3(1, 1, 1);

  add(geometry: BufferGeometry, position: Vector3, albedo: number, shade: number, quaternion?: Quaternion): void {
    geometry.deleteAttribute('uv');
    this.m.compose(position, quaternion ?? this.q.identity(), this.s);
    geometry.applyMatrix4(this.m);
    const count = geometry.getAttribute('position').count;
    geometry.setAttribute('aAlbedo', new BufferAttribute(new Float32Array(count).fill(albedo), 1));
    geometry.setAttribute('aShade', new BufferAttribute(new Float32Array(count).fill(shade), 1));
    this.parts.push(geometry);
  }

  beacon(position: Vector3): void {
    this.beacons.push(position.clone());
  }
}

// Quaternion rotating +Y onto a direction.
function aim(direction: Vector3): Quaternion {
  return new Quaternion().setFromUnitVectors(UP, direction.clone().normalize());
}

function yaw(angleRad: number): Quaternion {
  return new Quaternion().setFromAxisAngle(UP, angleRad);
}

// 01 Demand: a row of vertical illumination arrays tracking the low sun.
function buildIllumination(b: Builder, f: Frame): void {
  const sunYaw = Math.atan2(sunDir.x, sunDir.z);
  const panelQ = new Quaternion().setFromEuler(new Euler(-7 * DEG, sunYaw, 0, 'YXZ'));
  for (let i = 0; i < 7; i++) {
    const along = (i - 3) * 0.1;
    const base = f.at(along, 0.02 * Math.sin(i * 1.7), 0);
    const shade = f.shade(base);
    const h = 0.17 + 0.02 * Math.cos(i * 2.1);
    b.add(cyl(0.005, 0.0075, h, 8), base.clone().setY(base.y + (h / 2) * S), WHITE, shade);
    b.add(box(0.085, 0.05, 0.004), base.clone().setY(base.y + (h - 0.028) * S), DARK, shade, panelQ);
    b.add(box(0.085, 0.05, 0.004), base.clone().setY(base.y + (h - 0.092) * S), DARK, shade, panelQ);
    b.add(box(0.028, 0.012, 0.028), base.clone().setY(base.y + (0.006) * S), PAINT, shade);
    if (i === 3) b.beacon(base.clone().setY(base.y + (h + 0.012) * S));
  }
  // Power conditioning hut at the end of the row.
  const hut = f.at(0.33, -0.03, 0);
  b.add(box(0.06, 0.028, 0.045), hut.clone().setY(hut.y + (0.014) * S), PAINT, f.shade(hut), yaw(f.radial.x));
}

// 02 Acquisition: relay towers with dishes.
function buildRelay(b: Builder, f: Frame): Vector3 {
  const heights = [0.21, 0.13, 0.16];
  const offsets: Array<[number, number]> = [
    [0, 0],
    [-0.16, 0.05],
    [0.17, -0.04]
  ];
  let top = f.anchor.clone();
  heights.forEach((h, i) => {
    const [along, out] = offsets[i] ?? [0, 0];
    const base = f.at(along, out, 0);
    const shade = f.shade(base);
    b.add(cyl(0.0045, 0.014, h, 8), base.clone().setY(base.y + (h / 2) * S), WHITE, shade);
    // Guy anchors.
    for (let k = 0; k < 3; k++) {
      const ang = k * 2.094 + i;
      const foot = base.clone().add(new Vector3(Math.cos(ang) * 0.06 * S, 0, Math.sin(ang) * 0.06 * S));
      foot.y = f.at(along + Math.cos(ang) * 0.06, out + Math.sin(ang) * 0.06, 0).y;
      b.add(box(0.012, 0.01, 0.012), foot.clone().setY(foot.y + (0.005) * S), PAINT, shade);
    }
    // Dish aimed up and outward from the crater.
    const dir = f.radial.clone().multiplyScalar(0.5).add(new Vector3(0, 1.1, 0)).add(f.tangent.clone().multiplyScalar(0.25 * (i - 1)));
    const dishPos = base.clone().setY(base.y + (h - 0.02) * S).addScaledVector(f.radial, (0.02) * S);
    b.add(cyl(0.03 + 0.01 * (i === 0 ? 1 : 0), 0.03 + 0.01 * (i === 0 ? 1 : 0), 0.005, 18), dishPos, WHITE, shade, aim(dir));
    b.add(cyl(0.002, 0.002, 0.05, 6), dishPos.clone().addScaledVector(dir.clone().normalize(), (0.025) * S), WHITE, shade, aim(dir));
    b.beacon(base.clone().setY(base.y + (h + 0.01) * S));
    if (i === 0) top = dishPos.clone().addScaledVector(dir.clone().normalize(), (0.05) * S);
  });
  // Equipment shelter.
  const shelter = f.at(0.02, 0.11, 0);
  b.add(box(0.07, 0.03, 0.05), shelter.clone().setY(shelter.y + (0.015) * S), PAINT, f.shade(shelter), yaw(f.radial.x));
  return top;
}

// 03 Conversion: landing pad with approach lights and a lander.
function buildPad(b: Builder, f: Frame): void {
  const center = f.at(0, 0.06, 0);
  const shade = f.shade(center);
  b.add(cyl(0.17, 0.17, 0.01, 8), center.clone().setY(center.y + (0.004) * S), DARK, shade, yaw(Math.PI / 8));
  b.add(cyl(0.06, 0.06, 0.012, 8), center.clone().setY(center.y + (0.006) * S), PAINT, shade, yaw(Math.PI / 8));
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const post = center.clone().add(new Vector3(Math.cos(ang) * 0.2 * S, 0, Math.sin(ang) * 0.2 * S));
    post.y = f.sampleHeight(post) + 0.014 * S;
    b.add(cyl(0.003, 0.003, 0.028, 6), post, WHITE, shade);
    if (i % 2 === 0) b.beacon(post.clone().setY(post.y + (0.016) * S));
  }
  // Lander: body, legs, engine bell.
  const body = center.clone().setY(center.y + (0.052) * S);
  b.add(box(0.05, 0.036, 0.05), body, WHITE, shade, yaw(0.3));
  b.add(cyl(0.012, 0.02, 0.018, 10), center.clone().setY(center.y + (0.026) * S), PAINT, shade);
  for (let k = 0; k < 4; k++) {
    const ang = k * (Math.PI / 2) + 0.3 + Math.PI / 4;
    const foot = center.clone().add(new Vector3(Math.cos(ang) * 0.045 * S, 0, Math.sin(ang) * 0.045 * S));
    const legDir = foot.clone().setY(center.y + (0.01) * S).sub(body).normalize();
    const mid = body.clone().add(foot.clone().setY(center.y + (0.01) * S)).multiplyScalar(0.5);
    b.add(cyl(0.0025, 0.0025, 0.06, 6), mid, WHITE, shade, aim(legDir));
  }
  // Blast berm on the crater side.
  const berm = f.at(0, -0.2, 0);
  b.add(box(0.28, 0.02, 0.03), berm.clone().setY(berm.y + (0.01) * S), PAINT, f.shade(berm), yaw(Math.atan2(f.tangent.x, f.tangent.z)));
}

// 04 Automation: rover garage, a service track and the fleet on it.
function buildFleet(b: Builder, f: Frame): void {
  const garage = f.at(-0.26, 0.04, 0);
  const shade = f.shade(garage);
  const vaultQ = new Quaternion().setFromEuler(new Euler(0, Math.atan2(f.tangent.x, f.tangent.z), Math.PI / 2, 'YXZ'));
  b.add(cyl(0.045, 0.045, 0.13, 14, 1, false, 0, Math.PI), garage.clone().setY(garage.y + (0.002) * S), PAINT, shade, vaultQ);
  b.add(box(0.05, 0.03, 0.08), garage.clone().addScaledVector(f.radial, (0.06) * S).setY(garage.y + 0.015 * S), WHITE, shade, yaw(Math.atan2(f.tangent.x, f.tangent.z)));
  b.beacon(garage.clone().setY(garage.y + (0.055) * S));
  // Track: dark strip in short straight segments following the crest.
  const trackQ = yaw(Math.atan2(f.tangent.x, f.tangent.z));
  for (let i = 0; i < 7; i++) {
    const along = -0.16 + i * 0.11;
    const seg = f.at(along, 0.0, 0);
    b.add(box(0.018, 0.003, 0.115), seg.clone().setY(seg.y + (0.0015) * S), DARK, f.shade(seg), trackQ);
  }
  const rand = mulberry32(44);
  for (let i = 0; i < 7; i++) {
    const along = -0.12 + i * 0.1 + (rand() - 0.5) * 0.04;
    const out = (rand() - 0.5) * 0.06;
    const pos = f.at(along, out, 0);
    const q = yaw(Math.atan2(f.tangent.x, f.tangent.z) + (rand() - 0.5) * 0.8);
    const roverShade = f.shade(pos);
    b.add(box(0.03, 0.014, 0.02), pos.clone().setY(pos.y + (0.014) * S), WHITE, roverShade, q);
    b.add(box(0.016, 0.008, 0.016), pos.clone().setY(pos.y + (0.025) * S), PAINT, roverShade, q);
    const wheelQ = new Quaternion().setFromEuler(new Euler(0, Math.atan2(f.tangent.x, f.tangent.z) + (rand() - 0.5) * 0.8, Math.PI / 2, 'YXZ'));
    b.add(cyl(0.006, 0.006, 0.026, 8), pos.clone().setY(pos.y + (0.006) * S).addScaledVector(f.tangent, (0.01) * S), DARK, roverShade, wheelQ);
    b.add(cyl(0.006, 0.006, 0.026, 8), pos.clone().setY(pos.y + (0.006) * S).addScaledVector(f.tangent, (-0.01) * S), DARK, roverShade, wheelQ);
  }
}

// 05 Data: the reserve head on the inner edge, tanks on the crest, a cable to the floor.
function buildReserve(b: Builder, f: Frame): { cableTop: Vector3; cableFoot: Vector3 } {
  const head = f.at(0, -0.1, 0);
  const shade = f.shade(head);
  const mastH = 0.12;
  b.add(cyl(0.008, 0.012, mastH, 8), head.clone().setY(head.y + (mastH / 2) * S), WHITE, shade);
  // Boom reaching over the wall, toward the crater centre.
  const boomQ = aim(f.radial.clone().negate());
  b.add(cyl(0.005, 0.005, 0.11, 6), head.clone().setY(head.y + (mastH - 0.01) * S).addScaledVector(f.radial, (-0.055) * S), WHITE, shade, boomQ);
  b.add(box(0.03, 0.03, 0.03), head.clone().setY(head.y + (mastH - 0.01) * S).addScaledVector(f.radial, (-0.11) * S), PAINT, shade);
  b.beacon(head.clone().setY(head.y + (mastH + 0.01) * S));
  // Three storage tanks on cradles.
  const tankQ = new Quaternion().setFromEuler(new Euler(0, Math.atan2(f.radial.x, f.radial.z), Math.PI / 2, 'YXZ'));
  for (let i = 0; i < 3; i++) {
    const t = f.at(-0.07 + i * 0.07, 0.1, 0);
    const ts = f.shade(t);
    b.add(cyl(0.022, 0.022, 0.085, 14), t.clone().setY(t.y + (0.03) * S), WHITE, ts, tankQ);
    b.add(sphere(0.022, 12, 8), t.clone().setY(t.y + (0.03) * S).addScaledVector(f.radial, (0.0425) * S), WHITE, ts);
    b.add(sphere(0.022, 12, 8), t.clone().setY(t.y + (0.03) * S).addScaledVector(f.radial, (-0.0425) * S), WHITE, ts);
    b.add(box(0.03, 0.01, 0.1), t.clone().setY(t.y + (0.005) * S), PAINT, ts, yaw(Math.atan2(f.radial.x, f.radial.z)));
  }
  // Processing hall.
  const hall = f.at(0.18, 0.06, 0);
  b.add(box(0.09, 0.03, 0.05), hall.clone().setY(hall.y + (0.015) * S), PAINT, f.shade(hall), yaw(Math.atan2(f.tangent.x, f.tangent.z)));
  const cableTop = head.clone().setY(head.y + (mastH - 0.012) * S).addScaledVector(f.radial, (-0.115) * S);
  const footR = FLOOR_R * 0.82;
  const a = Math.atan2(f.radial.z, f.radial.x);
  const cableFoot = new Vector3(Math.cos(a) * footR, 0, Math.sin(a) * footR);
  cableFoot.y = heightAt(cableFoot.x, cableFoot.z) + 0.02;
  return { cableTop, cableFoot };
}

// 06 Revenue: the pressurized core, four modules, connecting tubes, a ring walkway.
function buildCore(b: Builder, f: Frame): void {
  const c = f.at(0, 0.1, 0);
  const shade = f.shade(c);
  b.add(cyl(0.048, 0.052, 0.05, 20), c.clone().setY(c.y + (0.025) * S), WHITE, shade);
  b.add(sphere(0.048, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), c.clone().setY(c.y + (0.05) * S), WHITE, shade);
  b.beacon(c.clone().setY(c.y + (0.1) * S));
  for (let k = 0; k < 4; k++) {
    const ang = k * (Math.PI / 2) + 0.4;
    const dir = new Vector3(Math.cos(ang), 0, Math.sin(ang));
    const modCenter = c.clone().addScaledVector(dir, (0.15) * S);
    modCenter.y = f.sampleHeight(modCenter) + 0.026 * S;
    const q = aim(dir);
    b.add(cyl(0.024, 0.024, 0.1, 14), modCenter, WHITE, shade, q);
    b.add(sphere(0.024, 12, 8), modCenter.clone().addScaledVector(dir, (0.05) * S), WHITE, shade);
    b.add(sphere(0.024, 12, 8), modCenter.clone().addScaledVector(dir, (-0.05) * S), WHITE, shade);
    // Tube from the core to the module.
    const tubeMid = c.clone().setY(c.y + (0.026) * S).addScaledVector(dir, (0.075) * S);
    b.add(cyl(0.009, 0.009, 0.06, 8), tubeMid, PAINT, shade, q);
    // Module footing.
    b.add(box(0.05, 0.008, 0.03), modCenter.clone().setY(modCenter.y - 0.024 * S), PAINT, shade, yaw(-ang));
  }
  b.add(torus(0.1, 0.0035, 6, 48), c.clone().setY(c.y + (0.012) * S), WHITE, shade, new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, 0)));
}

interface RingSpec {
  radius: number;
  center: Vector3;
  u: Vector3;
  v: Vector3;
}

function ringSpec(radius: number, center: Vector3, tiltX: number, tiltZ: number): RingSpec {
  const q = new Quaternion().setFromEuler(new Euler(tiltX, 0, tiltZ));
  return { radius, center, u: new Vector3(1, 0, 0).applyQuaternion(q), v: new Vector3(0, 0, 1).applyQuaternion(q) };
}

function ringGeometry(spec: RingSpec, segments = 160): BufferGeometry {
  const positions = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const p = spec.center.clone().addScaledVector(spec.u, Math.cos(a) * spec.radius).addScaledVector(spec.v, Math.sin(a) * spec.radius);
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(positions, 3));
  return g;
}

export function buildNetwork(sampler: TerrainSampler, dpr: number): Network {
  const group = new Group();
  const nodes = anchorNodes();
  const builder = new Builder();
  const frames = nodes.map((n) => new Frame(n.position, n.angleDeg, sampler));

  buildIllumination(builder, frames[0] as Frame);
  const relayTop = buildRelay(builder, frames[1] as Frame);
  buildPad(builder, frames[2] as Frame);
  buildFleet(builder, frames[3] as Frame);
  const cable = buildReserve(builder, frames[4] as Frame);
  buildCore(builder, frames[5] as Frame);

  // Structures: one merged mesh.
  const merged = mergeGeometries(builder.parts, false);
  if (!merged) throw new Error('Structure merge failed');
  merged.computeBoundingSphere();
  const structureMaterial = new ShaderMaterial({
    uniforms: {
      uSunDir: { value: sunDir.clone() },
      uExposure: { value: 1.55 },
      uEarthshine: { value: new Vector3(0.011, 0.012, 0.015) },
      uFogDensity: { value: 0.021 }
    },
    vertexShader: structureVertex,
    fragmentShader: structureFragment
  });
  const structureMesh = new Mesh(merged, structureMaterial);
  structureMesh.frustumCulled = false;
  group.add(structureMesh);

  // Beacons.
  const beaconPositions = new Float32Array(builder.beacons.length * 3);
  const beaconPhase = new Float32Array(builder.beacons.length);
  builder.beacons.forEach((p, i) => {
    beaconPositions[i * 3] = p.x;
    beaconPositions[i * 3 + 1] = p.y;
    beaconPositions[i * 3 + 2] = p.z;
    beaconPhase[i] = i * 1.9;
  });
  const beaconGeometry = new BufferGeometry();
  beaconGeometry.setAttribute('position', new BufferAttribute(beaconPositions, 3));
  beaconGeometry.setAttribute('aPhase', new BufferAttribute(beaconPhase, 1));
  const beaconMaterial = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDpr: { value: dpr } },
    vertexShader: beaconVertex,
    fragmentShader: beaconFragment,
    transparent: true,
    depthWrite: false
  });
  const beacons = new Points(beaconGeometry, beaconMaterial);
  beacons.frustumCulled = false;
  group.add(beacons);

  // Rim link: crest polyline through the six nodes, plus the reserve cable.
  const linkPositions: number[] = [];
  const linkT: number[] = [];
  const pushSegment = (a: Vector3, ta: number, b: Vector3, tb: number) => {
    linkPositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    linkT.push(ta, tb);
  };
  const crestPoint = (angleDeg: number) => {
    const a = angleDeg * DEG;
    const r = rimRadiusAt(a) - 0.12;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    return new Vector3(x, heightAt(x, z) + 0.018, z);
  };
  const totalAngle = (nodes[nodes.length - 1]?.angleDeg ?? 0) + 360 - (nodes[0]?.angleDeg ?? 0);
  let prev = crestPoint(nodes[0]?.angleDeg ?? 0);
  let prevT = 0;
  const stepDeg = 0.5;
  for (let deg = stepDeg; deg <= totalAngle + 1e-6; deg += stepDeg) {
    const angle = (nodes[0]?.angleDeg ?? 0) + deg;
    const p = crestPoint(angle);
    const t = deg / totalAngle;
    pushSegment(prev, prevT, p, t);
    prev = p;
    prevT = t;
  }
  // Cable: from the reserve boom down to the floor, following the wall if it dips below the chord.
  const tData = ((nodes[4]?.angleDeg ?? 0) + 360 - (nodes[0]?.angleDeg ?? 0)) / totalAngle;
  let cPrev = cable.cableTop.clone();
  const cableSteps = 28;
  for (let i = 1; i <= cableSteps; i++) {
    const s = i / cableSteps;
    const p = cable.cableTop.clone().lerp(cable.cableFoot, s);
    p.y = Math.max(p.y, heightAt(p.x, p.z) + 0.04);
    pushSegment(cPrev, tData + ((i - 1) / cableSteps) * 0.09, p, tData + (i / cableSteps) * 0.09);
    cPrev = p;
  }
  const linkGeometry = new BufferGeometry();
  linkGeometry.setAttribute('position', new BufferAttribute(new Float32Array(linkPositions), 3));
  linkGeometry.setAttribute('aT', new BufferAttribute(new Float32Array(linkT), 1));
  const linkMaterial = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uBase: { value: 0.22 }, uPulse: { value: 0.75 }, uFogDensity: { value: 0.021 } },
    vertexShader: linkVertex,
    fragmentShader: linkFragment,
    transparent: true,
    depthWrite: false
  });
  const link = new LineSegments(linkGeometry, linkMaterial);
  link.frustumCulled = false;
  group.add(link);

  // Orbital rings and satellites.
  const orbitCenter = new Vector3(0, 6.5, 0);
  const rings = [ringSpec(15.5, orbitCenter, 0.38, 0.0), ringSpec(19.0, orbitCenter, -0.18, 0.52)];
  const ringMaterial = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
  const ringObjects = rings.map((spec) => {
    const loop = new LineLoop(ringGeometry(spec), ringMaterial);
    loop.frustumCulled = false;
    group.add(loop);
    return loop;
  });
  const satCount = 4;
  const satU = new Float32Array(satCount * 3);
  const satV = new Float32Array(satCount * 3);
  const satR = new Float32Array(satCount);
  const satPhase = new Float32Array(satCount);
  const satSpeed = new Float32Array(satCount);
  const satDefs = [
    { ring: 0, phase: 0.4, speed: 0.05 },
    { ring: 0, phase: 3.3, speed: 0.05 },
    { ring: 1, phase: 1.6, speed: -0.038 },
    { ring: 1, phase: 4.9, speed: -0.038 }
  ];
  satDefs.forEach((d, i) => {
    const spec = rings[d.ring] as RingSpec;
    satU.set([spec.u.x, spec.u.y, spec.u.z], i * 3);
    satV.set([spec.v.x, spec.v.y, spec.v.z], i * 3);
    satR[i] = spec.radius;
    satPhase[i] = d.phase;
    satSpeed[i] = d.speed;
  });
  const satGeometry = new BufferGeometry();
  satGeometry.setAttribute('position', new BufferAttribute(new Float32Array(satCount * 3), 3));
  satGeometry.setAttribute('aU', new BufferAttribute(satU, 3));
  satGeometry.setAttribute('aV', new BufferAttribute(satV, 3));
  satGeometry.setAttribute('aRadius', new BufferAttribute(satR, 1));
  satGeometry.setAttribute('aPhase', new BufferAttribute(satPhase, 1));
  satGeometry.setAttribute('aSpeed', new BufferAttribute(satSpeed, 1));
  const satMaterial = new ShaderMaterial({
    uniforms: { uCenter: { value: orbitCenter.clone() }, uTime: { value: 0 }, uDpr: { value: dpr } },
    vertexShader: satelliteVertex,
    fragmentShader: satelliteFragment,
    transparent: true,
    depthWrite: false
  });
  const satellites = new Points(satGeometry, satMaterial);
  satellites.frustumCulled = false;
  group.add(satellites);

  // Uplink: relay dish to the first satellite, fading in around the Acquisition beat.
  const uplinkPositions = new Float32Array([relayTop.x, relayTop.y, relayTop.z, relayTop.x, relayTop.y + 5, relayTop.z]);
  const uplinkGeometry = new BufferGeometry();
  uplinkGeometry.setAttribute('position', new BufferAttribute(uplinkPositions, 3));
  const uplinkMaterial = new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const uplink = new Line(uplinkGeometry, uplinkMaterial);
  uplink.frustumCulled = false;
  group.add(uplink);

  const satPos = new Vector3();
  const sat0 = satDefs[0] as { ring: number; phase: number; speed: number };
  const ring0 = rings[sat0.ring] as RingSpec;
  const acquisitionT = 2 / 7;

  return {
    group,
    nodes,
    update(time, progress) {
      beaconMaterial.uniforms.uTime!.value = time;
      linkMaterial.uniforms.uTime!.value = time;
      satMaterial.uniforms.uTime!.value = time;
      const a = sat0.phase + time * sat0.speed;
      satPos.copy(ring0.center).addScaledVector(ring0.u, Math.cos(a) * ring0.radius).addScaledVector(ring0.v, Math.sin(a) * ring0.radius);
      const attr = uplinkGeometry.getAttribute('position') as BufferAttribute;
      attr.setXYZ(1, satPos.x, satPos.y, satPos.z);
      attr.needsUpdate = true;
      const near = 1 - Math.min(1, Math.abs(progress - acquisitionT) / 0.11);
      uplinkMaterial.opacity = 0.45 * near * near;
      uplink.visible = near > 0.001;
    },
    setDpr(next) {
      beaconMaterial.uniforms.uDpr!.value = next;
      satMaterial.uniforms.uDpr!.value = next;
    },
    dispose() {
      merged.dispose();
      structureMaterial.dispose();
      beaconGeometry.dispose();
      beaconMaterial.dispose();
      linkGeometry.dispose();
      linkMaterial.dispose();
      ringObjects.forEach((r) => r.geometry.dispose());
      ringMaterial.dispose();
      satGeometry.dispose();
      satMaterial.dispose();
      uplinkGeometry.dispose();
      uplinkMaterial.dispose();
    }
  };
}
