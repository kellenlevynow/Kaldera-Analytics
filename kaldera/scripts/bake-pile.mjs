// Bakes the settled bottle pile for the wine page.
//
//   node scripts/bake-pile.mjs            pour, settle, write src/wine/pile.bin
//   node scripts/bake-pile.mjs --bench    also drive a probe through the result and report timings
//
// The browser loads the result asleep, so the page starts with a deep, settled
// pile and no simulation at load. Uses the node-friendly Rapier build; the
// simulation parameters mirror src/wine/physics.ts.
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import RAPIER from '@dimforge/rapier3d-compat';
import { SHAPES, SHAPE_NAMES } from '../src/wine/bottle.ts';
import { HERO_QUAT, PILE_MAGIC, PILE_VERSION, PROBE_DROP, PROBE_HALF, PROBE_RADIUS, WELL_RADIUS, heroPosition, mulberry, parsePile } from '../src/wine/layout.ts';

const OUT = fileURLToPath(new URL('../src/wine/pile.bin', import.meta.url));
const args = process.argv.slice(2);
const COUNT = Number(args.find((a) => /^\d+$/.test(a)) ?? 2800);
const BENCH = args.includes('--bench');
const BENCH_ONLY = args.includes('--bench-only');

const DENSITY = 1350;
const FRICTION = 0.58;
const RESTITUTION = 0.04;
const WALL_SEGMENTS = 28;
const WALL_HEIGHT = 16;
const SHAPE_WEIGHTS = [0.5, 0.33, 0.17];

await RAPIER.init();
const shapes = SHAPE_NAMES.map((name) => SHAPES[name]);
const heroShape = SHAPES.burgundy;

function colliderDesc(c) {
  const desc = c.kind === 'capsule' ? RAPIER.ColliderDesc.capsule(c.halfHeight, c.radius) : RAPIER.ColliderDesc.ball(c.radius);
  return desc.setTranslation(0, c.y, 0).setDensity(DENSITY).setFriction(FRICTION).setRestitution(RESTITUTION);
}

function makeWorld(radius) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.numSolverIterations = 4;
  const floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(radius + 2, 0.1, radius + 2).setFriction(0.7), floor);
  const wallR = radius + 0.06;
  const segment = (Math.PI * 2 * wallR) / WALL_SEGMENTS;
  for (let i = 0; i < WALL_SEGMENTS; i++) {
    const a = (i / WALL_SEGMENTS) * Math.PI * 2;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(Math.cos(a) * wallR, WALL_HEIGHT / 2 - 0.2, Math.sin(a) * wallR)
        .setRotation({ x: 0, y: Math.sin(-a / 2), z: 0, w: Math.cos(-a / 2) })
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.06, WALL_HEIGHT / 2, segment / 2 + 0.03).setFriction(0.3), body);
  }
  const hero = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, heroPosition(heroShape).y, heroPosition(heroShape).z).setRotation(HERO_QUAT));
  for (const c of heroShape.colliders) world.createCollider(colliderDesc(c), hero);
  return world;
}

const qmul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z
});
const qAxisY = (angle) => ({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });

function segmentDistance(ax, az, bx, bz, cx, cz, dx, dz) {
  const pointSeg = (px, pz, x0, z0, x1, z1) => {
    const vx = x1 - x0;
    const vz = z1 - z0;
    const len2 = vx * vx + vz * vz || 1e-9;
    const t = Math.max(0, Math.min(1, ((px - x0) * vx + (pz - z0) * vz) / len2));
    return Math.hypot(px - (x0 + vx * t), pz - (z0 + vz * t));
  };
  const cross = (ux, uz, vx, vz) => ux * vz - uz * vx;
  const d1 = cross(bx - ax, bz - az, cx - ax, cz - az);
  const d2 = cross(bx - ax, bz - az, dx - ax, dz - az);
  const d3 = cross(dx - cx, dz - cz, ax - cx, az - cz);
  const d4 = cross(dx - cx, dz - cz, bx - cx, bz - cz);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(pointSeg(ax, az, cx, cz, dx, dz), pointSeg(bx, bz, cx, cz, dx, dz), pointSeg(cx, cz, ax, az, bx, bz), pointSeg(dx, dz, ax, az, bx, bz));
}

function randomQuaternion(rnd) {
  const u1 = rnd();
  const u2 = rnd();
  const u3 = rnd();
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return { x: a * Math.sin(2 * Math.PI * u2), y: a * Math.cos(2 * Math.PI * u2), z: b * Math.sin(2 * Math.PI * u3), w: b * Math.cos(2 * Math.PI * u3) };
}

function pickShape(rnd) {
  const r = rnd();
  let acc = 0;
  for (let k = 0; k < SHAPE_WEIGHTS.length; k++) {
    acc += SHAPE_WEIGHTS[k];
    if (r <= acc) return k;
  }
  return 0;
}

function bake() {
  const rnd = mulberry(404);
  const world = makeWorld(WELL_RADIUS);
  const shapeOf = [];
  const bed = [];
  const dynamic = [];

  // The bed: bottles lying flat on the floor, fixed, packed by rejection sampling, clear of the hero.
  const heroSeg = [0, -heroShape.height / 2, 0, heroShape.height / 2];
  const placed = [];
  const bedTarget = Math.round(WELL_RADIUS * WELL_RADIUS * 240);
  for (let i = 0; i < bedTarget; i++) {
    const s = pickShape(rnd);
    const shape = shapes[s];
    const half = shape.height * 0.5;
    let ok = false;
    let seg = [0, 0, 0, 0];
    let yaw = 0;
    let cx = 0;
    let cz = 0;
    for (let attempt = 0; attempt < 160 && !ok; attempt++) {
      const r = Math.sqrt(rnd()) * (WELL_RADIUS - 0.04);
      const a = rnd() * Math.PI * 2;
      cx = Math.cos(a) * r;
      cz = Math.sin(a) * r;
      yaw = rnd() * Math.PI * 2;
      seg = [cx - Math.cos(yaw) * half, cz - Math.sin(yaw) * half, cx + Math.cos(yaw) * half, cz + Math.sin(yaw) * half];
      if (Math.hypot(seg[0], seg[1]) > WELL_RADIUS - 0.02 || Math.hypot(seg[2], seg[3]) > WELL_RADIUS - 0.02) continue;
      if (segmentDistance(...seg, ...heroSeg) < heroShape.bodyR + shape.bodyR + 0.014) continue;
      ok = placed.every((other) => segmentDistance(...seg, ...other) > shape.bodyR * 2 * 0.86);
    }
    if (!ok) continue;
    placed.push(seg);
    const roll = qAxisY(rnd() * Math.PI * 2);
    const lay = { x: 0, y: 0, z: Math.sin(-Math.PI / 4), w: Math.cos(-Math.PI / 4) };
    const q = qmul(qAxisY(-yaw), qmul(lay, roll));
    const centre = shape.origin - shape.height * 0.5;
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx + Math.cos(yaw) * centre, shape.bodyR + 0.001, cz + Math.sin(yaw) * centre).setRotation(q));
    for (const c of shape.colliders) world.createCollider(colliderDesc(c), body);
    bed.push(body);
    shapeOf.push(s);
  }

  // The pour: batches dropped just above the pile, each given time to land.
  const spawnR = WELL_RADIUS - 0.07;
  const perLayer = Math.max(6, Math.floor((Math.PI * spawnR * spawnR) / 0.05));
  const topOf = () => dynamic.reduce((top, body) => Math.max(top, body.translation().y), 0.1);
  world.timestep = 1 / 60;
  let steps = 0;
  const t0 = Date.now();
  while (dynamic.length < COUNT) {
    const base = topOf() + 0.3;
    const batch = Math.min(170, COUNT - dynamic.length);
    for (let i = 0; i < batch; i++) {
      const s = pickShape(rnd);
      const shape = shapes[s];
      const layer = Math.floor(i / perLayer);
      const r = Math.sqrt(rnd()) * spawnR;
      const a = rnd() * Math.PI * 2;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(Math.cos(a) * r, base + layer * 0.19 + rnd() * 0.08, Math.sin(a) * r)
          .setRotation(randomQuaternion(rnd))
          .setLinearDamping(0.2)
          .setAngularDamping(0.45)
          .setCanSleep(true)
      );
      for (const c of shape.colliders) world.createCollider(colliderDesc(c), body);
      dynamic.push(body);
      shapeOf.push(s);
    }
    for (let i = 0; i < 110; i++) {
      world.step();
      steps++;
    }
    process.stdout.write(`\rpoured ${dynamic.length}/${COUNT}, top ${topOf().toFixed(2)} m, ${steps} steps`);
  }
  // Settle until everything sleeps.
  let asleep = false;
  for (let i = 0; i < 2400 && !asleep; i++) {
    world.step();
    steps++;
    if (i % 30 === 0) asleep = dynamic.every((body) => body.isSleeping());
  }
  const pileTop = topOf();
  console.log(`\nsettled: ${bed.length} bed, ${dynamic.length} dynamic, top ${pileTop.toFixed(3)} m, asleep ${asleep}, ${steps} steps, ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const total = bed.length + dynamic.length;
  const shapesLength = Math.ceil(total / 4) * 4;
  const buffer = new ArrayBuffer(32 + shapesLength + total * 7 * 4);
  new Uint32Array(buffer, 0, 4).set([PILE_MAGIC, PILE_VERSION, dynamic.length, bed.length]);
  new Float32Array(buffer, 16, 4).set([WELL_RADIUS, pileTop, 0, 0]);
  new Uint8Array(buffer, 32, total).set(shapeOf);
  const poses = new Float32Array(buffer, 32 + shapesLength, total * 7);
  [...bed, ...dynamic].forEach((body, i) => {
    const t = body.translation();
    const r = body.rotation();
    poses.set([t.x, t.y, t.z, r.x, r.y, r.z, r.w], i * 7);
  });
  writeFileSync(OUT, new Uint8Array(buffer));
  console.log(`wrote ${OUT} (${(buffer.byteLength / 1024).toFixed(1)} KB)`);
  world.free();
}

// Loads the baked file into the page's own Pile class and drives the probe through it.
async function bench() {
  const { Pile } = await import('../src/wine/physics.ts');
  Pile.use(RAPIER);
  const file = readFileSync(OUT);
  const baked = parsePile(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  const pile = new Pile({ baked, shapes, heroShape });
  const yStart = pile.surfaceAt(0, 0.15, 0.2) + 0.04 + PROBE_DROP + PROBE_HALF + PROBE_RADIUS;
  const yEnd = 0.56;
  const path = (u) => [0.15 * Math.sin(u * 12), yStart + (yEnd - yStart) * u, 0.15 * Math.cos(u * 9)];
  const QUICK = args.includes('--quick');
  pile.placeProbe(...path(QUICK ? 0.3 : 0));
  for (const speed of QUICK ? [0.3] : [0.15, 0.45, 1.4]) {
    const frames = Math.round(((yStart - yEnd) / speed) * 60);
    const run = (from, to, label) => {
      let worst = 0;
      let sum = 0;
      let fieldMs = 0;
      let liveSum = 0;
      let liveMax = 0;
      let awakeSum = 0;
      let maxSpeed = 0;
      let inside = 0;
      let n = 0;
      const step = from < to ? 1 : -1;
      for (let f = from; f !== to + step; f += step) {
        const [x, y, z] = path(f / frames);
        const t = performance.now();
        pile.update(x, y, z, Math.min(1, Math.max(0, (f / frames - 0.85) / 0.15)));
        pile.setProbe(x, y, z);
        const t1 = performance.now();
        pile.step(1 / 60);
        pile.refresh();
        const ms = performance.now() - t;
        fieldMs += t1 - t;
        sum += ms;
        n++;
        worst = Math.max(worst, ms);
        liveSum += pile.live;
        awakeSum += pile.awake;
        liveMax = Math.max(liveMax, pile.live);
        if (f % 10 === 0) {
          const cy = y - PROBE_DROP;
          for (let i = pile.bedCount; i < pile.count; i++) {
            const o = i * 7;
            const py = pile.poses[o + 1];
            const dy = py < cy - PROBE_HALF ? py - (cy - PROBE_HALF) : py > cy + PROBE_HALF ? py - (cy + PROBE_HALF) : 0;
            const d = Math.hypot(pile.poses[o] - x, dy, pile.poses[o + 2] - z);
            if (d < PROBE_RADIUS + 0.2) {
              const v = pile.bodies[i].linvel();
              maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.y, v.z));
              // A bottle centre well inside the probe means it was squeezed through.
              if (d < PROBE_RADIUS - 0.02) inside++;
            }
          }
        }
      }
      let escaped = 0;
      let top = 0;
      for (let i = pile.bedCount; i < pile.count; i++) {
        const o = i * 7;
        if (!(pile.poses[o + 1] > -0.05) || Math.hypot(pile.poses[o], pile.poses[o + 2]) > pile.wellRadius + 0.4) escaped++;
        top = Math.max(top, pile.poses[o + 1]);
      }
      console.log(`${label} at ${speed} m/s: ${n} frames, avg ${(sum / n).toFixed(2)} ms (field ${(fieldMs / n).toFixed(2)}), worst ${worst.toFixed(1)} ms, live avg ${Math.round(liveSum / n)} max ${liveMax}, awake avg ${Math.round(awakeSum / n)}, max bottle speed ${maxSpeed.toFixed(1)} m/s, inside probe ${inside}, escaped ${escaped}, top ${top.toFixed(2)} m`);
    };
    if (QUICK) {
      run(Math.round(frames * 0.3), Math.round(frames * 0.6), 'descent');
    } else {
      run(0, frames, 'descent');
      run(frames, 0, 'climb  ');
    }
  }
  pile.dispose();
}

if (!BENCH_ONLY) bake();
if (BENCH || BENCH_ONLY) await bench();
