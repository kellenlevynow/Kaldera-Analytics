// The pile: a Rapier world with a floor, a ring of walls, several hundred
// compound-capsule bottles, a fixed hero bottle, a kinematic probe that moves
// with the camera and a kinematic sphere that grows around the hero to clear
// the floor for the reveal.
import type * as RAPIER_T from '@dimforge/rapier3d';
import { loadRapier } from './rapier';

let RAPIER: typeof RAPIER_T;
import type { BottleShape } from './bottle';

export interface PileOptions {
  count: number; // dynamic bottles
  bedCount: number; // fixed bottles lying flat on the floor, indices [0, bedCount)
  wellRadius: number;
  shapes: BottleShape[];
  shapeOf: Uint8Array; // bottle index to shape index
  hero: { shape: BottleShape; yaw: number };
  probe: { radius: number; halfHeight: number };
  rnd: () => number;
}

const DENSITY = 1350; // glass plus wine, about 1.3 kg a bottle
const FRICTION = 0.58;
const RESTITUTION = 0.04;
const WALL_SEGMENTS = 28;
const WALL_HEIGHT = 7;

export class Pile {
  readonly world: RAPIER_T.World;
  readonly bodies: RAPIER_T.RigidBody[] = [];
  readonly count: number; // dynamic
  readonly bedCount: number;
  readonly wellRadius: number;
  private readonly probe: RAPIER_T.RigidBody;
  private readonly clearBody: RAPIER_T.RigidBody;
  private readonly clearCollider: RAPIER_T.Collider;
  private clearRadius = 0.001;
  private settledSteps = 0;
  private readonly settleBudget: number;

  static async load(): Promise<void> {
    RAPIER = await loadRapier();
  }

  constructor(options: PileOptions) {
    const { count, bedCount, wellRadius, shapes, shapeOf, rnd } = options;
    this.count = count;
    this.bedCount = bedCount;
    this.wellRadius = wellRadius;
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.numSolverIterations = 4;
    this.settleBudget = 480;

    // Floor and walls.
    const floor = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(wellRadius + 2, 0.1, wellRadius + 2).setFriction(0.7), floor);
    const wallR = wellRadius + 0.06;
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

    // The hero: fixed, upright, at the centre of the floor.
    const heroShape = options.hero.shape;
    const hero = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, heroShape.origin, 0).setRotation({ x: 0, y: Math.sin(options.hero.yaw / 2), z: 0, w: Math.cos(options.hero.yaw / 2) })
    );
    for (const c of heroShape.colliders) this.world.createCollider(this.colliderDesc(c), hero);

    // The bed: bottles lying flat on the floor, fixed, packed by rejection
    // sampling, kept clear of the hero. The floor is never seen bare.
    const placed: Array<[number, number, number, number]> = []; // segment endpoints x0 z0 x1 z1
    const segDist = (a: [number, number, number, number], b: [number, number, number, number]) => segmentDistance(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]);
    for (let i = 0; i < bedCount; i++) {
      const shape = shapes[shapeOf[i] ?? 0] ?? shapes[0]!;
      const half = shape.height * 0.5;
      let ok = false;
      let seg: [number, number, number, number] = [0, 0, 0, 0];
      let yaw = 0;
      let cx = 0;
      let cz = 0;
      for (let attempt = 0; attempt < 120 && !ok; attempt++) {
        const r = Math.sqrt(rnd()) * (wellRadius - 0.04);
        const a = rnd() * Math.PI * 2;
        cx = Math.cos(a) * r;
        cz = Math.sin(a) * r;
        yaw = rnd() * Math.PI * 2;
        seg = [cx - Math.cos(yaw) * half, cz - Math.sin(yaw) * half, cx + Math.cos(yaw) * half, cz + Math.sin(yaw) * half];
        if (Math.hypot(seg[0], seg[1]) > wellRadius - 0.02 || Math.hypot(seg[2], seg[3]) > wellRadius - 0.02) continue;
        if (segmentDistance(seg[0], seg[1], seg[2], seg[3], 0, 0, 0, 0) < 0.13) continue;
        ok = placed.every((other) => segDist(seg, other) > shape.bodyR * 2 * 0.86);
      }
      if (!ok) {
        // Out of room: park it under the floor, hidden.
        const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -5, 0));
        this.bodies.push(body);
        continue;
      }
      placed.push(seg);
      // Lay the bottle along its yaw with a random roll about its own axis.
      const roll = qAxisY(rnd() * Math.PI * 2);
      const lay = { x: 0, y: 0, z: Math.sin(-Math.PI / 4), w: Math.cos(-Math.PI / 4) }; // +Y to +X
      const turn = qAxisY(-yaw);
      const q = qmul(turn, qmul(lay, roll));
      const centre = shape.origin - shape.height * 0.5; // origin offset along the axis
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(cx + Math.cos(yaw) * centre, shape.bodyR + 0.001, cz + Math.sin(yaw) * centre).setRotation(q)
      );
      for (const c of shape.colliders) this.world.createCollider(this.colliderDesc(c), body);
      this.bodies.push(body);
    }

    // Bottles: spawned in loose layers above the bed, random orientation, out to the wall.
    const spawnR = wellRadius - 0.06;
    const perLayer = Math.max(6, Math.floor((Math.PI * spawnR * spawnR) / 0.05));
    for (let i = bedCount; i < bedCount + count; i++) {
      const shape = shapes[shapeOf[i] ?? 0] ?? shapes[0]!;
      const layer = Math.floor((i - bedCount) / perLayer);
      const r = Math.sqrt(rnd()) * spawnR;
      const a = rnd() * Math.PI * 2;
      const y = 0.45 + layer * 0.19 + rnd() * 0.08;
      const q = randomQuaternion(rnd);
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(Math.cos(a) * r, y, Math.sin(a) * r)
          .setRotation(q)
          .setLinearDamping(0.2)
          .setAngularDamping(0.45)
          .setCanSleep(true)
      );
      for (const c of shape.colliders) this.world.createCollider(this.colliderDesc(c), body);
      this.bodies.push(body);
    }

    // The probe rides with the camera. Kinematic: it pushes, nothing pushes it.
    this.probe = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 40, 0));
    this.world.createCollider(RAPIER.ColliderDesc.capsule(options.probe.halfHeight, options.probe.radius).setFriction(0.15), this.probe);

    // The clearing sphere, centred on the hero, radius grown during the reveal.
    this.clearBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, heroShape.origin, 0));
    this.clearCollider = this.world.createCollider(RAPIER.ColliderDesc.ball(this.clearRadius).setFriction(0.1), this.clearBody);
  }

  private colliderDesc(c: BottleShape['colliders'][number]): RAPIER_T.ColliderDesc {
    const desc = c.kind === 'capsule' ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius) : RAPIER.ColliderDesc.ball(c.radius);
    return desc.setTranslation(0, c.y, 0).setDensity(DENSITY).setFriction(FRICTION).setRestitution(RESTITUTION);
  }

  // Runs up to `steps` settle steps at 60 Hz. Returns the settled fraction, 1 when done.
  settle(steps: number): number {
    this.world.timestep = 1 / 60;
    for (let i = 0; i < steps; i++) {
      this.world.step();
      this.settledSteps++;
      if (this.settledSteps >= this.settleBudget) return 1;
      if (this.settledSteps > 150 && this.settledSteps % 15 === 0 && this.allAsleep()) return 1;
    }
    return Math.min(0.99, this.settledSteps / this.settleBudget);
  }

  private allAsleep(): boolean {
    for (let i = this.bedCount; i < this.bodies.length; i++) if (!this.bodies[i]!.isSleeping()) return false;
    return true;
  }

  step(dt: number): void {
    // Variable step, clamped. Large frames are split so the probe cannot tunnel.
    const sub = dt > 1 / 45 ? 2 : 1;
    this.world.timestep = dt / sub;
    for (let i = 0; i < sub; i++) this.world.step();
  }

  setProbe(x: number, y: number, z: number): void {
    this.probe.setNextKinematicTranslation({ x, y, z });
  }

  setClearRadius(radius: number): void {
    const r = Math.max(0.001, radius);
    if (Math.abs(r - this.clearRadius) < 0.0005) return;
    this.clearRadius = r;
    this.clearCollider.setRadius(r);
    this.clearBody.setNextKinematicTranslation(this.clearBody.translation());
  }

  // Highest bottle in the pile, for the camera's starting height.
  pileTop(): number {
    let top = 0;
    for (let i = this.bedCount; i < this.bodies.length; i++) {
      const y = this.bodies[i]!.translation().y;
      if (y > top) top = y;
    }
    return top;
  }

  countNear(x: number, y: number, z: number, radius: number): number {
    const r2 = radius * radius;
    let n = 0;
    for (const body of this.bodies) {
      const t = body.translation();
      const dx = t.x - x;
      const dy = t.y - y;
      const dz = t.z - z;
      if (dx * dx + dy * dy + dz * dz < r2) n++;
    }
    return n;
  }

  dispose(): void {
    this.world.free();
  }
}

function qmul(a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number; w: number } {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
  };
}

function qAxisY(angle: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}

// Shortest distance between two segments in the plane.
function segmentDistance(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const pointSeg = (px: number, pz: number, x0: number, z0: number, x1: number, z1: number) => {
    const vx = x1 - x0;
    const vz = z1 - z0;
    const len2 = vx * vx + vz * vz || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - x0) * vx + (pz - z0) * vz) / len2));
    return Math.hypot(px - (x0 + vx * t), pz - (z0 + vz * t));
  };
  const cross = (ux: number, uz: number, vx: number, vz: number) => ux * vz - uz * vx;
  // Proper intersection means distance zero.
  const d1 = cross(bx - ax, bz - az, cx - ax, cz - az);
  const d2 = cross(bx - ax, bz - az, dx - ax, dz - az);
  const d3 = cross(dx - cx, dz - cz, ax - cx, az - cz);
  const d4 = cross(dx - cx, dz - cz, bx - cx, bz - cz);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(pointSeg(ax, az, cx, cz, dx, dz), pointSeg(bx, bz, cx, cz, dx, dz), pointSeg(cx, cz, ax, az, bx, bz), pointSeg(dx, dz, ax, az, bx, bz));
}

function randomQuaternion(rnd: () => number): { x: number; y: number; z: number; w: number } {
  const u1 = rnd();
  const u2 = rnd();
  const u3 = rnd();
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return { x: a * Math.sin(2 * Math.PI * u2), y: a * Math.cos(2 * Math.PI * u2), z: b * Math.sin(2 * Math.PI * u3), w: b * Math.cos(2 * Math.PI * u3) };
}
