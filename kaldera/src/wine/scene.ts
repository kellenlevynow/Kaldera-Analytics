// The search: a scroll-driven descent, straight down, through a deep physics
// pile of bottles, ending on one. Renderer, lights, instanced bottles culled to
// the camera's view, the camera path, the probe that displaces the pile, and
// the physics clock, which runs on scroll rather than on the wall.
//
// Motion is fixed to the reduced behaviour (the camera follows scroll without
// damping, roll, drift or parallax) and rendering to the low tier. ?tier= still
// forces another tier for inspection.
import gsap from 'gsap';
import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  DynamicDrawUsage,
  FogExp2,
  Group,
  HalfFloatType,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshLambertMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { QualityTier } from '../scene/types';
import { FrameMonitor } from '../scene/quality';
import { SHAPES, SHAPE_NAMES, buildBottleGeometry, type BottleGeometry } from './bottle';
import { STRATA, buildHeroLabel, buildLabelAtlas, loadLabelFonts, tileRect } from './labels';
import { HERO_QUAT, PROBE_DROP, PROBE_HALF, PROBE_RADIUS, flatLayer, heroPosition, mulberry, parsePile } from './layout';
import { FOIL_STRATA, GLASS_STRATA, LABEL_TINT, buildEnvironment, buildHeroEnvironment, buildRoughnessMap, createFoilMaterial, createGlassMaterial, createHeroMaterials, createLabelMaterial, pickWeighted } from './materials';
import { Pile } from './physics';
import { loadRapier } from './rapier';
import pileUrl from './pile.bin?url';
import type { WineDiagnostics, WineSceneController, WineSceneOptions } from './types';

interface WineTier {
  tier: QualityTier;
  dpr: number;
  segments: number;
  shadows: boolean;
  dof: boolean;
  msaa: number;
  // How far below the camera bottles are drawn, and the fog that hides the cut.
  reach: number;
  fog: number;
}

function wineConfig(tier: QualityTier, deviceDpr: number): WineTier {
  switch (tier) {
    case 'high': {
      const dpr = Math.min(deviceDpr, 2);
      return { tier, dpr, segments: 30, shadows: true, dof: true, msaa: dpr < 2 ? 4 : 2, reach: 1.4, fog: 0.97 };
    }
    case 'medium':
      return { tier, dpr: Math.min(deviceDpr, 1.5), segments: 24, shadows: false, dof: false, msaa: 0, reach: 1.25, fog: 1.08 };
    case 'low':
    default:
      return { tier: 'low', dpr: 1, segments: 16, shadows: false, dof: false, msaa: 0, reach: 1.05, fog: 1.28 };
  }
}

// The journey, in scroll progress. The descent is linear to P_SLOW, eases to a
// stop over the hero at P_FLOOR, and the rest is the reveal.
const P_SLOW = 0.74;
const P_FLOOR = 0.86;
// Camera height over the floor when it arrives, and how far it leans in afterwards.
const HERO_EYE = 0.52;
const PUSH_IN = 0.05;
// Fastest the camera will chase the scroll position, in progress per second.
// The probe is a physical thing; it may not teleport through the pile.
const CHASE = 0.11;
const CHASE_MAX = 0.3;
// The physics clock runs on scroll. It advances with the probe's travel, at the
// pace of a hand moving through bottles (DIG_SPEED, metres per second of
// physics time), plus a fraction of real time so that what has been disturbed
// can settle. Bottles then meet the probe at the same speed whether the visitor
// scrolls slowly or fast; fast scrolling only plays the same motion sooner.
const DIG_SPEED = 0.3;
const SETTLE_RATE = 0.2;
// Longest physics step, and the most physics time one frame may carry.
const STEP_MAX = 1 / 40;
const VIRTUAL_MAX = 3 * STEP_MAX;

const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface BottleSet {
  glass: InstancedMesh;
  label: InstancedMesh;
  foil: InstancedMesh;
  geometry: BottleGeometry;
  tiles: InstancedBufferAttribute;
  attributes: InstancedBufferAttribute[];
}

function writeMatrix(a: Float32Array, o: number, px: number, py: number, pz: number, x: number, y: number, z: number, w: number): void {
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  a[o] = 1 - (yy + zz);
  a[o + 1] = xy + wz;
  a[o + 2] = xz - wy;
  a[o + 3] = 0;
  a[o + 4] = xy - wz;
  a[o + 5] = 1 - (xx + zz);
  a[o + 6] = yz + wx;
  a[o + 7] = 0;
  a[o + 8] = xz + wy;
  a[o + 9] = yz - wx;
  a[o + 10] = 1 - (xx + yy);
  a[o + 11] = 0;
  a[o + 12] = px;
  a[o + 13] = py;
  a[o + 14] = pz;
  a[o + 15] = 1;
}

export async function createWineScene(options: WineSceneOptions): Promise<WineSceneController> {
  const { canvas } = options;
  const deviceDpr = window.devicePixelRatio || 1;
  const params = new URLSearchParams(window.location.search);
  // ?tier=high|medium|low forces a tier for inspection; ?debug keeps the frame monitor from changing it.
  const forced = params.get('tier');
  let tier: QualityTier = forced === 'high' || forced === 'medium' || forced === 'low' ? forced : 'low';
  const config = wineConfig(tier, deviceDpr);
  let dpr = config.dpr;
  let shadows = config.shadows;
  let dof = config.dof;

  // The baked pile, the physics engine and the label faces load together.
  const [pileBuffer] = await Promise.all([fetch(pileUrl).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`Pile failed to load: ${r.status}`)))), loadRapier().then((rapier) => Pile.use(rapier)), loadLabelFonts()]);
  const baked = parsePile(pileBuffer);

  const renderer = new WebGLRenderer({ canvas, antialias: !dof && dpr < 2, powerPreference: 'high-performance', alpha: false, stencil: false });
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(0x020202, 1);
  // Draw-call and triangle counts accumulate over every pass of a frame.
  renderer.info.autoReset = false;

  const scene = new Scene();
  scene.background = new Color(0x020202);
  scene.fog = new FogExp2(0x020202, config.fog);
  scene.environment = buildEnvironment(renderer);

  const camera = new PerspectiveCamera(46, 1, 0.04, 12);

  // Lights: a faint ambient, a cool key over the camera that lights a pool at
  // the centre of the frame and falls away toward its edges, and a warm lamp
  // off to one side that draws the long highlights down the glass. The key
  // narrows over the hero at the reveal and the lamp gives way to it.
  scene.add(new HemisphereLight(0x5c6275, 0x1a100a, 0.06));
  const lamp = new PointLight(0xffe2c8, 1.1, 6, 2);
  scene.add(lamp);
  const key = new SpotLight(0xf3f6ff, 1.5, 4, 0.68, 1, 1.6);
  key.castShadow = shadows;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.01;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 2;
  scene.add(key, key.target);

  // Ground under everything, black. Layers of bottles sit between it and the bed.
  const floor = new Mesh(new CircleGeometry(baked.wellRadius + 0.4, 48), new MeshLambertMaterial({ color: 0x020202 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.2;
  scene.add(floor);

  // Every bottle: the baked bed and pile (physics bodies), then two static
  // layers under the floor line. Shape, glass, foil, label and paper tint are
  // fixed up front, by stratum of the settled pile.
  const shapes = SHAPE_NAMES.map((name) => SHAPES[name]);
  const bodyCount = baked.bedCount + baked.dynamicCount;
  const under = [-0.043, -0.121].flatMap((y, k) =>
    flatLayer(
      mulberry(90 + k),
      baked.wellRadius - 0.02,
      shapes.map((s) => s.height),
      shapes.map((s) => s.bodyR),
      [0.5, 0.33, 0.17],
      Math.round(baked.wellRadius * baked.wellRadius * 240)
    ).map((bottle) => ({ ...bottle, y }))
  );
  const total = bodyCount + under.length;
  const shapeOf = new Uint8Array(total);
  shapeOf.set(baked.shapes);
  const underPoses = new Float32Array(under.length * 7);
  {
    const yawQ = new Quaternion();
    const layQ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2);
    const rollQ = new Quaternion();
    const up = new Vector3(0, 1, 0);
    under.forEach((bottle, k) => {
      const shape = shapes[bottle.shape]!;
      shapeOf[bodyCount + k] = bottle.shape;
      const centre = shape.origin - shape.height / 2;
      yawQ.setFromAxisAngle(up, -bottle.yaw).multiply(layQ).multiply(rollQ.setFromAxisAngle(up, bottle.roll));
      underPoses.set([bottle.x + Math.cos(bottle.yaw) * centre, bottle.y, bottle.z + Math.sin(bottle.yaw) * centre, yawQ.x, yawQ.y, yawQ.z, yawQ.w], k * 7);
    });
  }

  const look = new Float32Array(total * 13); // glass rgb, foil rgb, tint rgb, tile xyzw
  {
    const rnd = mulberry(1979);
    // The palette is held back a little: colour toward its own luminance.
    const quiet = (c: Color, keep: number) => {
      const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      return new Color(l + (c.r - l) * keep, l + (c.g - l) * keep, l + (c.b - l) * keep);
    };
    const bounds = [0.74, 0.5, 0.26]; // fractions of the pile's height where the strata change
    for (let i = 0; i < total; i++) {
      const y = i < bodyCount ? baked.poses[i * 7 + 1]! : 0;
      const f = y / baked.pileTop + (rnd() - 0.5) * 0.07;
      const stratum = f > bounds[0]! ? 0 : f > bounds[1]! ? 1 : f > bounds[2]! ? 2 : 3;
      const glass = quiet(pickWeighted(GLASS_STRATA[stratum]!, rnd()), 0.86);
      const foil = quiet(pickWeighted(FOIL_STRATA[stratum]!, rnd()), 0.84);
      const tint = LABEL_TINT[stratum]!;
      const span = STRATA[stratum]!;
      const tile = tileRect(span.start + Math.floor(rnd() * span.count));
      look.set([glass.r, glass.g, glass.b, foil.r, foil.g, foil.b, tint.r, tint.g, tint.b, tile[0], tile[1], tile[2], tile[3]], i * 13);
    }
  }

  const roughnessMap = buildRoughnessMap();
  const atlas = buildLabelAtlas();
  atlas.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const glassMaterial = createGlassMaterial(roughnessMap);
  const labelMaterial = createLabelMaterial(atlas);
  const foilMaterial = createFoilMaterial();
  const capacity = [0, 0, 0];
  for (let i = 0; i < total; i++) capacity[shapeOf[i]!]!++;
  const sets: BottleSet[] = shapes.map((shape, s) => {
    const n = Math.max(1, capacity[s]!);
    const geometry = buildBottleGeometry(shape, config.segments);
    const glass = new InstancedMesh(geometry.glass, glassMaterial, n);
    const label = new InstancedMesh(geometry.label, labelMaterial, n);
    const foil = new InstancedMesh(geometry.capsule, foilMaterial, n);
    const tiles = new InstancedBufferAttribute(new Float32Array(n * 4), 4);
    geometry.label.setAttribute('aTile', tiles);
    const attributes = [tiles];
    for (const mesh of [glass, label, foil]) {
      mesh.frustumCulled = false;
      mesh.castShadow = shadows && mesh !== label;
      mesh.receiveShadow = shadows;
      mesh.count = 0;
      mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
      attributes.push(mesh.instanceMatrix, mesh.instanceColor);
    }
    for (const attribute of attributes) attribute.setUsage(DynamicDrawUsage);
    scene.add(glass, label, foil);
    return { glass, label, foil, geometry, tiles, attributes };
  });

  // The hero: a Burgundy bottle in black with the only white label in the
  // pile, lying at the centre of the floor, label up, neck toward the top of the frame.
  const heroShape = SHAPES.burgundy;
  const heroAt = heroPosition(heroShape);
  const heroGeometry = buildBottleGeometry(heroShape, 96);
  const heroLabelTexture = buildHeroLabel();
  heroLabelTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const heroMaterials = createHeroMaterials(heroLabelTexture, buildHeroEnvironment(renderer));
  const hero = new Group();
  const heroGlass = new Mesh(heroGeometry.glass, heroMaterials.glass);
  const heroLabel = new Mesh(heroGeometry.label, heroMaterials.label);
  const heroFoil = new Mesh(heroGeometry.capsule, heroMaterials.foil);
  heroGlass.castShadow = shadows;
  heroFoil.castShadow = shadows;
  heroLabel.receiveShadow = shadows;
  hero.add(heroGlass, heroLabel, heroFoil);
  hero.position.set(heroAt.x, heroAt.y, heroAt.z);
  hero.quaternion.set(HERO_QUAT.x, HERO_QUAT.y, HERO_QUAT.z, HERO_QUAT.w);
  scene.add(hero);
  const heroTop = heroAt.y + heroShape.bodyR;
  key.target.position.set(0, heroAt.y, 0);

  const pile = new Pile({ baked, shapes, heroShape });

  // Post-processing: depth of field on the high tier only.
  let composer: EffectComposer | null = null;
  let bokeh: BokehPass | null = null;
  const buildComposer = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const target = new WebGLRenderTarget(Math.round(w * dpr), Math.round(h * dpr), { type: HalfFloatType, samples: config.msaa });
    composer = new EffectComposer(renderer, target);
    composer.setPixelRatio(dpr);
    composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, camera));
    bokeh = new BokehPass(scene, camera, { focus: 0.66, aperture: 0.02, maxblur: 0.006 });
    composer.addPass(bokeh);
    composer.addPass(new OutputPass());
  };
  const dropComposer = () => {
    composer?.dispose();
    composer = null;
    bokeh = null;
  };
  if (dof) buildComposer();

  // State.
  let progress = Math.min(1, Math.max(0, options.initialProgress ?? 0));
  // A page reloaded part-way down starts there: the far field opens around the probe wherever it is put.
  let current = progress;
  let staticMode = false;
  let online = false;
  let ticking = false;
  let frameCount = 0;
  let physicsMs = 0;
  let visible = 0;
  let aspect = 1;
  const monitor = new FrameMonitor(90);
  const debug = params.has('debug');
  // ?instant lets the camera chase the scroll position four times as fast, for captures.
  const instant = params.has('instant');

  const size = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    aspect = w / h;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  };

  // Camera path. Always straight down. The descent is linear in scroll, so
  // every scroll step moves the same distance through the pile; a slow weave
  // keeps it from feeling like a lift shaft. Near the floor the camera slows,
  // stops over the hero, then leans in a little.
  const pose = { x: 0, y: 0, z: 0, fov: 46, reveal: 0 };
  const weave = (p: number) => 1 - smoothstep((p - 0.64) / 0.17);
  const poseAt = (p: number, yTop: number) => {
    const portrait = aspect < 1;
    const fall = yTop - HERO_EYE;
    const speed = fall / (P_SLOW + (P_FLOOR - P_SLOW) / 2);
    let depth: number;
    if (p <= P_SLOW) depth = speed * p;
    else if (p < P_FLOOR) {
      const t = (p - P_SLOW) / (P_FLOOR - P_SLOW);
      depth = speed * P_SLOW + speed * (P_FLOOR - P_SLOW) * (t - (t * t) / 2);
    } else depth = fall + PUSH_IN * smoothstep((p - P_FLOOR) / (1 - P_FLOOR));
    const k = weave(p);
    const a = 0.15 * k;
    pose.x = a * Math.sin(Math.PI * 2 * 2.3 * p + 0.5);
    pose.z = a * Math.cos(Math.PI * 2 * 1.6 * p + 1.1);
    pose.y = yTop - depth;
    pose.reveal = smoothstep((p - 0.8) / (P_FLOOR - 0.8));
    pose.fov = lerp(portrait ? 58 : 46, 50, pose.reveal);
  };

  // The camera starts with the probe resting on the pile, so the first scroll moves bottles.
  poseAt(0, 10);
  const yTop = pile.surfaceAt(pose.x, pose.z, 0.2) + 0.04 + PROBE_DROP + PROBE_HALF + PROBE_RADIUS + 0.005;

  // Draws the bottles inside the camera's downward cone. Everything else in
  // the pile exists for the physics but costs nothing to render.
  const counts = [0, 0, 0];
  const drawPile = () => {
    const tanV = Math.tan((camera.fov * Math.PI) / 360);
    const tanD = Math.hypot(tanV, tanV * aspect);
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const reach = config.reach;
    counts[0] = counts[1] = counts[2] = 0;
    for (let i = 0; i < total; i++) {
      const body = i < bodyCount;
      const poses = body ? pile.poses : underPoses;
      const o = (body ? i : i - bodyCount) * 7;
      const dy = cy - poses[o + 1]!;
      if (dy < -0.1 || dy > reach) continue;
      const dx = poses[o]! - cx;
      const dz = poses[o + 2]! - cz;
      const limit = dy * tanD + 0.24;
      if (dx * dx + dz * dz > limit * limit) continue;
      const s = shapeOf[i]!;
      const set = sets[s]!;
      const n = counts[s]!++;
      const m = n * 16;
      writeMatrix(set.glass.instanceMatrix.array as Float32Array, m, poses[o]!, poses[o + 1]!, poses[o + 2]!, poses[o + 3]!, poses[o + 4]!, poses[o + 5]!, poses[o + 6]!);
      const l = i * 13;
      const c = n * 3;
      const glass = set.glass.instanceColor!.array as Float32Array;
      const foil = set.foil.instanceColor!.array as Float32Array;
      const tint = set.label.instanceColor!.array as Float32Array;
      glass[c] = look[l]!;
      glass[c + 1] = look[l + 1]!;
      glass[c + 2] = look[l + 2]!;
      foil[c] = look[l + 3]!;
      foil[c + 1] = look[l + 4]!;
      foil[c + 2] = look[l + 5]!;
      tint[c] = look[l + 6]!;
      tint[c + 1] = look[l + 7]!;
      tint[c + 2] = look[l + 8]!;
      const tiles = set.tiles.array as Float32Array;
      const t = n * 4;
      tiles[t] = look[l + 9]!;
      tiles[t + 1] = look[l + 10]!;
      tiles[t + 2] = look[l + 11]!;
      tiles[t + 3] = look[l + 12]!;
    }
    visible = 0;
    sets.forEach((set, s) => {
      const n = counts[s]!;
      visible += n;
      // The three meshes share one transform per bottle.
      const matrices = set.glass.instanceMatrix.array as Float32Array;
      (set.label.instanceMatrix.array as Float32Array).set(matrices.subarray(0, n * 16));
      (set.foil.instanceMatrix.array as Float32Array).set(matrices.subarray(0, n * 16));
      set.glass.count = set.label.count = set.foil.count = n;
      for (const attribute of set.attributes) {
        attribute.clearUpdateRanges();
        attribute.addUpdateRange(0, n * attribute.itemSize);
        attribute.needsUpdate = true;
      }
    });
  };

  const lampWarm = new Color(0xffe2c8);
  const lampDeep = new Color(0xffc890);
  const applyCamera = (p: number) => {
    poseAt(p, yTop);
    const { x, y, z } = pose;
    camera.position.set(x, y, z);
    camera.up.set(0, 0, -1);
    camera.lookAt(x, y - 1, z);
    if (Math.abs(camera.fov - pose.fov) > 0.01) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }

    // Light: the lamp warms and dims with depth, then gives way to the key,
    // which narrows from a pool the width of the frame to one around the bottle.
    const depth = Math.min(1, Math.max(0, (yTop - pose.y) / (yTop - HERO_EYE)));
    lamp.color.copy(lampWarm).lerp(lampDeep, depth);
    lamp.intensity = lerp(lerp(1.1, 0.85, depth), 0.2, pose.reveal);
    // Up and to the left of the frame, so highlights run the length of the glass.
    lamp.position.set(x - 0.42, y, z - 0.32);
    key.intensity = lerp(1.5, 2.1, pose.reveal);
    key.angle = lerp(0.68, 0.33, pose.reveal);
    key.position.set(x - 0.05, y + 0.1, z - 0.03);
    if (bokeh) {
      const uniforms = bokeh.uniforms as Record<string, { value: number }>;
      uniforms.focus!.value = lerp(0.66, pose.y - heroTop, pose.reveal);
      uniforms.aperture!.value = lerp(0.02, 0.05, pose.reveal);
    }
  };

  // The probe follows the camera through the pile in physics time. A frame's
  // travel is split into steps short enough that nothing tunnels, the far field
  // and the probe advancing together through each.
  const prev = { x: 0, y: 0, z: 0, reveal: 0 };
  const advancePile = (dt: number) => {
    const travel = Math.hypot(pose.x - prev.x, pose.y - prev.y, pose.z - prev.z);
    const virtual = Math.min(VIRTUAL_MAX, dt * SETTLE_RATE + travel / DIG_SPEED);
    const steps = Math.max(1, Math.min(3, Math.ceil(virtual / STEP_MAX)));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const x = prev.x + (pose.x - prev.x) * t;
      const y = prev.y + (pose.y - prev.y) * t;
      const z = prev.z + (pose.z - prev.z) * t;
      pile.update(x, y, z, prev.reveal + (pose.reveal - prev.reveal) * t);
      pile.setProbe(x, y, z);
      pile.step(virtual / steps);
    }
    pile.refresh();
    prev.x = pose.x;
    prev.y = pose.y;
    prev.z = pose.z;
    prev.reveal = pose.reveal;
  };

  const render = () => {
    renderer.info.reset();
    if (composer) composer.render();
    else renderer.render(scene, camera);
  };

  const layerName = () => {
    if (current > 0.855) return '05 The one';
    const f = (pose.y - 0.5) / baked.pileTop;
    const k = f > 0.74 ? 0 : f > 0.5 ? 1 : f > 0.26 ? 2 : 3;
    return `0${k + 1} ${STRATA[k]!.name}`;
  };

  const telemetry = () => {
    options.onTelemetry({ depth: yTop - pose.y, bottles: visible, layer: layerName(), found: current > 0.855 });
  };

  const frame = (dt: number) => {
    frameCount++;
    // The camera follows the scroll position, never faster than the pile can
    // be pushed aside. A jump (a reload mid-page, a link to the end) becomes a dive.
    const gap = progress - current;
    const cap = Math.min(CHASE_MAX, CHASE + 0.9 * Math.max(0, Math.abs(gap) - 0.06)) * dt * (instant ? 4 : 1);
    current += Math.min(cap, Math.max(-cap, gap));
    applyCamera(current);
    const t0 = performance.now();
    advancePile(dt);
    physicsMs += (performance.now() - t0 - physicsMs) * 0.1;
    drawPile();
    render();
    options.onProgress(current);
    if (frameCount % 4 === 0) telemetry();
  };

  const tick = (_t: number, deltaMs: number) => {
    const dt = Math.min(0.1, Math.max(0.001, deltaMs / 1000));
    frame(dt);
    const verdict = monitor.sample(deltaMs);
    if (debug) return;
    if (verdict === 'downgrade') lowerQuality(false);
    else if (verdict === 'static') lowerQuality(true);
  };

  const startTicker = () => {
    if (ticking || !online) return;
    ticking = true;
    gsap.ticker.add(tick);
  };
  const stopTicker = () => {
    if (!ticking) return;
    ticking = false;
    gsap.ticker.remove(tick);
  };

  const setShadows = (on: boolean) => {
    if (shadows === on) return;
    shadows = on;
    renderer.shadowMap.enabled = on;
    key.castShadow = on;
    for (const set of sets) {
      set.glass.castShadow = set.foil.castShadow = on;
      set.glass.receiveShadow = set.foil.receiveShadow = set.label.receiveShadow = on;
    }
    heroGlass.castShadow = heroFoil.castShadow = on;
    heroLabel.receiveShadow = on;
    for (const material of [glassMaterial, labelMaterial, foilMaterial, heroMaterials.glass, heroMaterials.label, heroMaterials.foil]) material.needsUpdate = true;
  };

  // Runtime downgrade: the pile and the physics stay as they are; fewer pixels,
  // a shorter view and no extra passes.
  const lowerQuality = (toStatic: boolean) => {
    if (toStatic) {
      staticMode = true;
      pile.setEconomy(true);
      dof = false;
      dropComposer();
      setShadows(false);
      dpr = 1;
      config.reach = Math.min(config.reach, 1.05);
      tier = 'low';
    } else {
      if (dof) {
        dof = false;
        dropComposer();
      } else {
        setShadows(false);
      }
      dpr = Math.max(1, Math.min(dpr, 1.5));
      config.reach = Math.max(1.05, config.reach - 0.22);
      tier = tier === 'high' ? 'medium' : 'low';
    }
    (scene.fog as FogExp2).density = 1.35 / config.reach;
    renderer.setPixelRatio(dpr);
    size();
    monitor.reset();
    options.onTier(tier, staticMode);
  };

  const onResize = () => size();
  const onVisibility = () => {
    if (document.hidden) stopTicker();
    else startTicker();
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);

  size();
  options.onTier(tier, staticMode);

  // First frame: the probe is placed, not moved, so nothing is flung.
  poseAt(current, yTop);
  pile.placeProbe(pose.x, pose.y, pose.z);
  prev.x = pose.x;
  prev.y = pose.y;
  prev.z = pose.z;
  prev.reveal = pose.reveal;
  applyCamera(current);
  pile.update(pose.x, pose.y, pose.z, pose.reveal);
  drawPile();
  render();
  online = true;
  options.onOnline();
  options.onProgress(current);
  telemetry();
  if (!document.hidden) startTicker();

  return {
    setProgress(p) {
      progress = Math.min(1, Math.max(0, p));
    },
    pause() {
      stopTicker();
    },
    resume() {
      if (!document.hidden) startTicker();
    },
    diagnostics(): WineDiagnostics {
      return {
        tier,
        bottles: total,
        visible,
        awake: pile.awake,
        live: pile.live,
        progress: current,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        pixelRatio: renderer.getPixelRatio(),
        avgFrameMs: monitor.average,
        physicsMs,
        online,
        dof: Boolean(composer),
        shadows
      };
    },
    dispose() {
      stopTicker();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      dropComposer();
      pile.dispose();
      for (const set of sets) {
        set.geometry.glass.dispose();
        set.geometry.label.dispose();
        set.geometry.capsule.dispose();
      }
      renderer.dispose();
    }
  };
}
