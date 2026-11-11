// The pile: a Rapier world with a floor, a ring of walls, a fixed bed of
// bottles, a deep pile loaded from the baked file, a fixed hero bottle and a
// kinematic probe that moves with the camera.
//
// A contact pile is one island to the solver, so waking any of it would wake
// all of it. Instead the pile is split in two around the probe:
//
// - Far bottles are kinematic and follow an analytic field: a hole the shape of
//   the probe (a little wider, with a nose reaching ahead of it) opens around
//   the camera's path and every far bottle is slid radially out of it, exactly
//   in step with the camera. They part ahead of the probe and close behind it.
// - Bottles within a thin shell of the probe are live rigid bodies. They are
//   pushed by the probe, collide with each other and with the far bottles,
//   which have already made room, and are handed back to the field once the
//   probe has left them at rest.
//
// This file loads in node as well (scripts/bake-pile.mjs benchmarks it), so
// its imports carry their extension and Rapier is handed in rather than imported.
import type * as RAPIER_T from '@dimforge/rapier3d';
import type { BottleShape } from './bottle.ts';
import { HERO_QUAT, PROBE_DROP, PROBE_HALF, PROBE_RADIUS, heroPosition, segmentDistance, type BakedPile } from './layout.ts';

let RAPIER: typeof RAPIER_T;

// The hole is this much wider than the probe, reaches this far ahead of its
// lower hemisphere (further at the reveal, to open the floor) and this far behind its upper one.
const HOLE_PAD = 0.03;
const NOSE = 0.14;
const NOSE_REVEAL = 0.2;
const TAIL = 0.1;
// Bottles within this distance of the probe's surface are live rigid bodies
// (the second figure is for machines that cannot keep up).
const LIVE_MARGIN = 0.11;
const LIVE_MARGIN_ECONOMY = 0.075;
// A live bottle is handed back once it is this much further out and slow.
const LIVE_SLACK = 0.05;
const REST_SPEED = 0.6;
// Far bottles this much beyond the live shell are kept current in the physics world, as obstacles.
const COLLAR = 0.16;
// Half the span over which a far bottle samples the field, to turn as it is moved.
const TWIST_SPAN = 0.11;

// Clear floor kept between the hero and the nearest bed bottle, surface to surface.
const HERO_GAP = 0.045;

const FAR = 0;
const LIVE = 1;

export interface PileOptions {
  baked: BakedPile;
  shapes: BottleShape[];
  heroShape: BottleShape;
}

const DENSITY = 1350; // glass plus wine, about 1.3 kg a bottle
const FRICTION = 0.58;
const RESTITUTION = 0.04;
const WALL_SEGMENTS = 28;
const WALL_HEIGHT = 12;

export class Pile {
  readonly world: RAPIER_T.World;
  // Bed bottles first (fixed), then the dynamic pile, in the baked order.
  readonly bodies: RAPIER_T.RigidBody[] = [];
  readonly bedCount: number;
  readonly count: number;
  readonly wellRadius: number;
  readonly pileTop: number;
  // Current pose of every bottle: position xyz, quaternion xyzw. Refreshed by refresh().
  readonly poses: Float32Array;
  awake = 0;
  live = 0;
  // Where each bottle sits with the hole closed, and its long axis there.
  private readonly rest: Float32Array;
  private readonly restAxis: Float32Array;
  private readonly state: Uint8Array;
  private readonly collar: Uint8Array;
  private readonly moved: Uint8Array;
  // Bottles that have been live keep their heading when the field moves them.
  private readonly noTwist: Uint8Array;
  private readonly probe: RAPIER_T.RigidBody;
  private last = { x: NaN, y: NaN, z: NaN, reveal: NaN };
  private liveMargin = LIVE_MARGIN;

  static use(rapier: typeof RAPIER_T): void {
    RAPIER = rapier;
  }

  constructor(options: PileOptions) {
    const { baked, shapes, heroShape } = options;
    this.bedCount = baked.bedCount;
    this.count = baked.bedCount + baked.dynamicCount;
    this.wellRadius = baked.wellRadius;
    this.pileTop = baked.pileTop;
    this.poses = new Float32Array(baked.poses);
    this.rest = new Float32Array(baked.poses);
    this.restAxis = new Float32Array(this.count * 3);
    this.state = new Uint8Array(this.count);
    this.collar = new Uint8Array(this.count);
    this.moved = new Uint8Array(this.count);
    this.noTwist = new Uint8Array(this.count);
    for (let i = 0; i < this.count; i++) this.setRestAxis(i);
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.numSolverIterations = 4;

    // Floor and walls.
    const floor = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(this.wellRadius + 2, 0.1, this.wellRadius + 2).setFriction(0.7), floor);
    const wallR = this.wellRadius + 0.06;
    const segment = (Math.PI * 2 * wallR) / WALL_SEGMENTS;
    for (let i = 0; i < WALL_SEGMENTS; i++) {
      const a = (i / WALL_SEGMENTS) * Math.PI * 2;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(Math.cos(a) * wallR, WALL_HEIGHT / 2 - 0.2, Math.sin(a) * wallR)
          .setRotation({ x: 0, y: Math.sin(-a / 2), z: 0, w: Math.cos(-a / 2) })
      );
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(0.06, WALL_HEIGHT / 2, segment / 2 + 0.03).setFriction(0.3), body);
    }

    // The hero: fixed, lying on the floor at the centre, label up.
    const heroAt = heroPosition(heroShape);
    const hero = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(heroAt.x, heroAt.y, heroAt.z).setRotation(HERO_QUAT));
    for (const c of heroShape.colliders) this.world.createCollider(this.colliderDesc(c), hero);

    // Bottles, exactly where the bake left them: the bed fixed, the pile kinematic until the probe comes near.
    const p = this.poses;
    const heroSegment: [number, number, number, number] = [0, -heroShape.height / 2, 0, heroShape.height / 2];
    for (let i = 0; i < this.count; i++) {
      const shape = shapes[baked.shapes[i] ?? 0] ?? shapes[0]!;
      const o = i * 7;
      if (i < this.bedCount) {
        // A bed bottle crowding the hero is left out, so the hero's outline stays clean.
        const ax = this.restAxis[i * 3]!;
        const az = this.restAxis[i * 3 + 2]!;
        const segment: [number, number, number, number] = [p[o]! - ax * shape.origin, p[o + 2]! - az * shape.origin, p[o]! + ax * (shape.height - shape.origin), p[o + 2]! + az * (shape.height - shape.origin)];
        if (segmentDistance(segment, heroSegment) < heroShape.bodyR + shape.bodyR + HERO_GAP) p[o + 1] = this.rest[o + 1] = -20;
      }
      const base = i < this.bedCount ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.kinematicPositionBased().setLinearDamping(0.2).setAngularDamping(0.45).setCanSleep(true);
      const body = this.world.createRigidBody(base.setTranslation(p[o]!, p[o + 1]!, p[o + 2]!).setRotation({ x: p[o + 3]!, y: p[o + 4]!, z: p[o + 5]!, w: p[o + 6]! }));
      for (const c of shape.colliders) this.world.createCollider(this.colliderDesc(c), body);
      this.bodies.push(body);
    }

    // The probe rides with the camera. Kinematic: it pushes, nothing pushes it.
    this.probe = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, this.pileTop + 2, 0));
    this.world.createCollider(RAPIER.ColliderDesc.capsule(PROBE_HALF, PROBE_RADIUS).setFriction(0.15), this.probe);
  }

  private colliderDesc(c: BottleShape['colliders'][number]): RAPIER_T.ColliderDesc {
    const desc = c.kind === 'capsule' ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius) : RAPIER.ColliderDesc.ball(c.radius);
    return desc.setTranslation(0, c.y, 0).setDensity(DENSITY).setFriction(FRICTION).setRestitution(RESTITUTION);
  }

  step(dt: number): void {
    // One variable step a frame. The far field is exact at any speed, so a long frame costs accuracy only in the live shell.
    this.world.timestep = dt;
    this.world.step();
  }

  // Thins the live shell, for machines where the solver is the bottleneck.
  setEconomy(on: boolean): void {
    this.liveMargin = on ? LIVE_MARGIN_ECONOMY : LIVE_MARGIN;
  }

  private setRestAxis(i: number): void {
    // The bottle's +Y axis under its rest rotation.
    const o = i * 7;
    const x = this.rest[o + 3]!;
    const y = this.rest[o + 4]!;
    const z = this.rest[o + 5]!;
    const w = this.rest[o + 6]!;
    this.restAxis[i * 3] = 2 * (x * y - w * z);
    this.restAxis[i * 3 + 1] = 1 - 2 * (x * x + z * z);
    this.restAxis[i * 3 + 2] = 2 * (y * z + w * x);
  }

  // Moves the far bottles to where the field puts them for a camera at this
  // position, hands bottles to and from the live shell, and keeps the physics
  // world's copy of the nearby far bottles current. `reveal` (0 to 1) lengthens
  // the nose so the floor opens around the hero.
  update(x: number, y: number, z: number, reveal: number): void {
    const p = this.poses;
    const rest = this.rest;
    const axis = this.restAxis;
    const state = this.state;
    const margin = this.liveMargin;
    const still = x === this.last.x && y === this.last.y && z === this.last.z && reveal === this.last.reveal;
    this.last = { x, y, z, reveal };

    // The hole, as a radius by height: the probe's capsule, padded, with a nose and a tail.
    const rf = PROBE_RADIUS + HOLE_PAD;
    const lo = y - PROBE_DROP - PROBE_HALF;
    const hi = y - PROBE_DROP + PROBE_HALF;
    const nose = rf + NOSE + NOSE_REVEAL * reveal;
    const tail = rf + TAIL;
    const yMin = lo - nose - TWIST_SPAN;
    const yMax = hi + tail + TWIST_SPAN;
    const half = Math.PI / 2;
    const hole = (py: number): number => {
      if (py >= lo && py <= hi) return rf;
      const u = py < lo ? (lo - py) / nose : (py - hi) / tail;
      return u >= 1 ? 0 : rf * Math.cos(half * u);
    };

    let live = 0;
    for (let i = this.bedCount; i < this.count; i++) {
      const o = i * 7;
      if (state[i] === LIVE) {
        live++;
        // Hand it back to the field once the probe has left it behind, at rest.
        const dx = p[o]! - x;
        const py = p[o + 1]!;
        const dz = p[o + 2]! - z;
        const dy = py < lo ? py - lo : py > hi ? py - hi : 0;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) - PROBE_RADIUS < margin + LIVE_SLACK) continue;
        const body = this.bodies[i]!;
        const v = body.linvel();
        if (v.x * v.x + v.y * v.y + v.z * v.z > REST_SPEED * REST_SPEED) continue;
        // Its rest position is where the field would have brought it from.
        const h = hole(py);
        const r2 = dx * dx + dz * dz;
        const k = r2 > 1e-8 ? Math.sqrt(Math.max(r2 - h * h, 0.1225 * r2) / r2) : 1;
        rest[o] = x + dx * k;
        rest[o + 1] = py;
        rest[o + 2] = z + dz * k;
        rest[o + 3] = p[o + 3]!;
        rest[o + 4] = p[o + 4]!;
        rest[o + 5] = p[o + 5]!;
        rest[o + 6] = p[o + 6]!;
        this.setRestAxis(i);
        this.noTwist[i] = 1;
        this.moved[i] = 1;
        this.collar[i] = 1;
        state[i] = FAR;
        live--;
        body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, false);
        continue;
      }

      // Far: the pose the field gives it.
      const ry = rest[o + 1]!;
      let changed = false;
      if (ry < yMin || ry > yMax) {
        if (this.moved[i] === 1) {
          for (let k = 0; k < 7; k++) p[o + k] = rest[o + k]!;
          this.moved[i] = 0;
          changed = true;
        }
      } else if (!still || this.moved[i] === 1) {
        changed = true;
        this.moved[i] = 1;
        const rx = rest[o]!;
        const rz = rest[o + 2]!;
        if (this.noTwist[i] === 1) {
          const h = hole(ry);
          const dx = rx - x;
          const dz = rz - z;
          const r2 = dx * dx + dz * dz;
          const k = r2 > 1e-8 ? Math.sqrt((r2 + h * h) / r2) : 1;
          p[o] = x + dx * k + (r2 > 1e-8 ? 0 : h);
          p[o + 1] = ry;
          p[o + 2] = z + dz * k;
          p[o + 3] = rest[o + 3]!;
          p[o + 4] = rest[o + 4]!;
          p[o + 5] = rest[o + 5]!;
          p[o + 6] = rest[o + 6]!;
        } else {
          // Carry two points of the bottle through the field; it moves with their midpoint and turns with their line.
          const ax = axis[i * 3]!;
          const ay = axis[i * 3 + 1]!;
          const az = axis[i * 3 + 2]!;
          let ex = 0;
          let ez = 0;
          let fx = 0;
          let fz = 0;
          for (let end = 0; end < 2; end++) {
            const sign = end === 0 ? 1 : -1;
            const qx = rx + ax * TWIST_SPAN * sign;
            const qy = ry + ay * TWIST_SPAN * sign;
            const qz = rz + az * TWIST_SPAN * sign;
            const h = hole(qy);
            const dx = qx - x;
            const dz = qz - z;
            const r2 = dx * dx + dz * dz;
            const k = r2 > 1e-8 ? Math.sqrt((r2 + h * h) / r2) : 1;
            const mx = x + dx * k + (r2 > 1e-8 ? 0 : h);
            const mz = z + dz * k;
            if (end === 0) {
              ex = mx;
              ez = mz;
            } else {
              fx = mx;
              fz = mz;
            }
          }
          p[o] = (ex + fx) / 2;
          p[o + 1] = ry;
          p[o + 2] = (ez + fz) / 2;
          // New axis: the line between the two carried points (their heights are unchanged).
          let nx = ex - fx;
          const ny = 2 * ay * TWIST_SPAN;
          let nz = ez - fz;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nx /= len;
          nz /= len;
          const my = ny / len;
          // Shortest rotation from the rest axis to the new one, applied before the rest rotation.
          let qx = ay * nz - az * my;
          let qy = az * nx - ax * nz;
          let qz = ax * my - ay * nx;
          let qw = 1 + ax * nx + ay * my + az * nz;
          const ql = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw) || 1;
          qx /= ql;
          qy /= ql;
          qz /= ql;
          qw /= ql;
          const bx = rest[o + 3]!;
          const by = rest[o + 4]!;
          const bz = rest[o + 5]!;
          const bw = rest[o + 6]!;
          p[o + 3] = qw * bx + qx * bw + qy * bz - qz * by;
          p[o + 4] = qw * by - qx * bz + qy * bw + qz * bx;
          p[o + 5] = qw * bz + qx * by - qy * bx + qz * bw;
          p[o + 6] = qw * bw - qx * bx - qy * by - qz * bz;
        }
      }

      // Distance from the probe's surface decides what the physics world needs to know.
      const dx = p[o]! - x;
      const py = p[o + 1]!;
      const dz = p[o + 2]! - z;
      const dy = py < lo ? py - lo : py > hi ? py - hi : 0;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) - PROBE_RADIUS;
      if (d > margin + COLLAR) {
        this.collar[i] = 0;
        continue;
      }
      const body = this.bodies[i]!;
      const fresh = this.collar[i] === 0;
      if (fresh) {
        // Entering the neighbourhood: the world's copy is stale, so place it outright.
        body.setTranslation({ x: p[o]!, y: py, z: p[o + 2]! }, false);
        body.setRotation({ x: p[o + 3]!, y: p[o + 4]!, z: p[o + 5]!, w: p[o + 6]! }, false);
        this.collar[i] = 1;
      }
      if (d < margin) {
        state[i] = LIVE;
        live++;
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
      } else if (changed && !fresh) {
        body.setNextKinematicTranslation({ x: p[o]!, y: py, z: p[o + 2]! });
        body.setNextKinematicRotation({ x: p[o + 3]!, y: p[o + 4]!, z: p[o + 5]!, w: p[o + 6]! });
      }
    }
    this.live = live;
  }

  // Copies the pose of every bottle that is live and awake into `poses`.
  refresh(): void {
    const p = this.poses;
    const state = this.state;
    let awake = 0;
    for (let i = this.bedCount; i < this.count; i++) {
      if (state[i] !== LIVE) continue;
      const body = this.bodies[i]!;
      if (body.isSleeping()) continue;
      awake++;
      const t = body.translation();
      const r = body.rotation();
      const o = i * 7;
      p[o] = t.x;
      p[o + 1] = t.y;
      p[o + 2] = t.z;
      p[o + 3] = r.x;
      p[o + 4] = r.y;
      p[o + 5] = r.z;
      p[o + 6] = r.w;
    }
    this.awake = awake;
  }

  // Puts the probe at a camera position outright, without sweeping through what lies between.
  placeProbe(x: number, y: number, z: number): void {
    this.probe.setTranslation({ x, y: y - PROBE_DROP, z }, true);
  }

  // Moves the probe to a camera position over the next step, pushing what is in the way.
  setProbe(x: number, y: number, z: number): void {
    this.probe.setNextKinematicTranslation({ x, y: y - PROBE_DROP, z });
  }

  // Height of the pile's surface near a point: the highest bottle within `radius` of it.
  surfaceAt(x: number, z: number, radius: number): number {
    const p = this.poses;
    const r2 = radius * radius;
    let top = 0;
    for (let i = 0; i < this.count; i++) {
      const o = i * 7;
      const dx = p[o]! - x;
      const dz = p[o + 2]! - z;
      if (dx * dx + dz * dz < r2 && p[o + 1]! > top) top = p[o + 1]!;
    }
    return top;
  }

  dispose(): void {
    this.world.free();
  }
}
