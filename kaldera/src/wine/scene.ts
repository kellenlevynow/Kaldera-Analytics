// The search: a scroll-driven descent through a physics pile of bottles, ending
// on one. Renderer, lights, instanced bottles, the camera path, the probe that
// displaces the pile, depth of field on capable machines, quality tiers and
// reduced-motion behaviour.
import gsap from 'gsap';
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BackSide,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  FogExp2,
  Group,
  HalfFloatType,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Scene,
  ShaderMaterial,
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
import { FrameMonitor, detectTier } from '../scene/quality';
import { SHAPES, SHAPE_NAMES, buildBottleGeometry, type BottleGeometry } from './bottle';
import { LABEL_COUNT, buildHeroLabel, buildLabelAtlas, mulberry, tileRect } from './labels';
import { FOIL_COLORS, GLASS_COLORS, buildEnvironment, buildRoughnessMap, createFoilMaterial, createGlassMaterial, createHeroMaterials, createLabelMaterial, pickWeighted } from './materials';
import { Pile } from './physics';
import type { WineDiagnostics, WineSceneController, WineSceneOptions } from './types';

interface WineTier {
  tier: QualityTier;
  dpr: number;
  count: number;
  wellRadius: number;
  segments: number;
  shadows: boolean;
  dof: boolean;
  msaa: number;
}

function wineConfig(tier: QualityTier, deviceDpr: number): WineTier {
  switch (tier) {
    case 'high': {
      const dpr = Math.min(deviceDpr, 2);
      return { tier, dpr, count: 900, wellRadius: 0.95, segments: 40, shadows: true, dof: true, msaa: dpr < 2 ? 4 : 2 };
    }
    case 'medium':
      return { tier, dpr: Math.min(deviceDpr, 1.5), count: 560, wellRadius: 0.8, segments: 28, shadows: false, dof: false, msaa: 0 };
    case 'low':
    default:
      return { tier: 'low', dpr: 1, count: 360, wellRadius: 0.68, segments: 20, shadows: false, dof: false, msaa: 0 };
  }
}

const DESCENT_END = 0.78;
const REVEAL_END = 0.92;
const START_ABOVE = 0.72;
const THETA0 = 0.6;
const THETA_SWEEP = 2.4;
const HERO_POINT = new Vector3(0, 0.13, 0);
const HERO_DISTANCE_MAX = 0.72;
const HERO_EYE = 0.34;
const PROBE_RADIUS = 0.33;
const PROBE_HALF = 0.2;
const CLEAR_RADIUS = 0.56;

const smoothstep = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Pose {
  pos: Vector3;
  look: Vector3;
  up: Vector3;
  fov: number;
  theta: number;
}

interface BottleSet {
  glass: InstancedMesh;
  label: InstancedMesh;
  foil: InstancedMesh;
  geometry: BottleGeometry;
}

const shaftVertex = /* glsl */ `
varying vec2 vUv;
varying float vRim;
void main() {
  vUv = uv;
  vec3 n = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vRim = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;
const shaftFragment = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying float vRim;
void main() {
  float a = uOpacity * pow(vUv.y, 1.1) * (0.15 + 0.85 * vRim * vRim);
  gl_FragColor = vec4(vec3(0.82, 0.86, 1.0) * a, a);
}`;

export async function createWineScene(options: WineSceneOptions): Promise<WineSceneController> {
  const { canvas } = options;
  const deviceDpr = window.devicePixelRatio || 1;
  const params = new URLSearchParams(window.location.search);
  // ?tier=high|medium|low forces a tier for inspection; ?debug keeps the frame monitor from changing it.
  const forced = params.get('tier');
  let tier: QualityTier = forced === 'high' || forced === 'medium' || forced === 'low' ? forced : options.quality.get() === 'low' ? 'low' : detectTier();
  const config = wineConfig(tier, deviceDpr);
  // ?count=N overrides the bottle count for inspection in slow test browsers.
  const countOverride = Number(params.get('count'));
  if (params.has('debug') && countOverride > 0) config.count = Math.round(countOverride);
  let dpr = config.dpr;
  let shadows = config.shadows;
  let dof = config.dof;

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
  scene.fog = new FogExp2(0x030202, 0.5);
  scene.environment = buildEnvironment(renderer);

  // The final camera stays inside the well; its field of view keeps the hero the same size.
  const HERO_DISTANCE = Math.min(HERO_DISTANCE_MAX, config.wellRadius - 0.14);
  const HERO_FOV = (2 * Math.atan(0.262 / HERO_DISTANCE) * 180) / Math.PI;
  const camera = new PerspectiveCamera(50, 1, 0.04, 30);
  camera.position.set(0, 4, 0);

  // Lights: a faint cellar ambient, a lamp that travels with the camera, and
  // one shaft from above on the hero that the pile hides until the reveal.
  scene.add(new HemisphereLight(0x5c6275, 0x1a100a, 0.06));
  const lamp = new PointLight(0xffe2c8, 2.2, 7, 2);
  scene.add(lamp);
  const spot = new SpotLight(0xe6ecff, 150, 10, 0.24, 0.8, 1.7);
  spot.position.set(0.35, 4.2, -0.25);
  spot.target.position.copy(HERO_POINT);
  spot.castShadow = shadows;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.0004;
  spot.shadow.normalBias = 0.012;
  spot.shadow.camera.near = 1;
  spot.shadow.camera.far = 8;
  scene.add(spot, spot.target);

  // Floor and the well wall, dark and matte.
  const floor = new Mesh(new CircleGeometry(config.wellRadius + 0.7, 64), new MeshLambertMaterial({ color: 0x030303 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const wall = new Mesh(new CylinderGeometry(config.wellRadius + 0.1, config.wellRadius + 0.1, 8, 48, 1, true), new MeshLambertMaterial({ color: 0x020202, side: BackSide }));
  wall.position.y = 3.9;
  scene.add(wall);

  // The light shaft, additive, faded in for the reveal.
  const shaftMaterial = new ShaderMaterial({ uniforms: { uOpacity: { value: 0 } }, vertexShader: shaftVertex, fragmentShader: shaftFragment, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  const shaftLength = spot.position.distanceTo(new Vector3(0, 0, 0));
  const shaft = new Mesh(new ConeGeometry(0.62, shaftLength, 40, 1, true), shaftMaterial);
  shaft.position.copy(spot.position).add(new Vector3(0, 0, 0)).multiplyScalar(0.5);
  shaft.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), spot.position.clone().normalize());
  shaft.visible = false;
  scene.add(shaft);

  // Bottles: shapes, colours and labels assigned up front, deterministic.
  const rnd = mulberry(1979);
  const shapes = SHAPE_NAMES.map((name) => SHAPES[name]);
  const shapeWeights = [0.45, 0.35, 0.2];
  const dynamicCount = config.count;
  const bedCount = Math.round(config.wellRadius * config.wellRadius * 230);
  const count = dynamicCount + bedCount; // bodies: the bed first, then the pile
  const shapeOf = new Uint8Array(count);
  const localIndex = new Uint16Array(count);
  const perShape = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const r = rnd();
    let s = 0;
    let acc = 0;
    for (let k = 0; k < shapeWeights.length; k++) {
      acc += shapeWeights[k] ?? 0;
      if (r <= acc) {
        s = k;
        break;
      }
    }
    shapeOf[i] = s;
    localIndex[i] = perShape[s] ?? 0;
    perShape[s] = (perShape[s] ?? 0) + 1;
  }

  const roughnessMap = buildRoughnessMap();
  const atlas = buildLabelAtlas();
  atlas.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const glassMaterial = createGlassMaterial(roughnessMap);
  const labelMaterial = createLabelMaterial(atlas);
  const foilMaterial = createFoilMaterial();
  const sets: BottleSet[] = shapes.map((shape, s) => {
    const n = Math.max(1, perShape[s] ?? 1);
    const geometry = buildBottleGeometry(shape, config.segments);
    const glass = new InstancedMesh(geometry.glass, glassMaterial, n);
    const label = new InstancedMesh(geometry.label, labelMaterial, n);
    const foil = new InstancedMesh(geometry.capsule, foilMaterial, n);
    const tiles = new Float32Array(n * 4);
    geometry.label.setAttribute('aTile', new InstancedBufferAttribute(tiles, 4));
    for (const mesh of [glass, label, foil]) {
      mesh.frustumCulled = false;
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
    }
    label.castShadow = false;
    return { glass, label, foil, geometry };
  });
  const hidden = new Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < count; i++) {
    const set = sets[shapeOf[i] ?? 0]!;
    const j = localIndex[i] ?? 0;
    set.glass.setColorAt(j, pickWeighted(GLASS_COLORS, rnd()));
    set.foil.setColorAt(j, pickWeighted(FOIL_COLORS, rnd()));
    const tile = tileRect(Math.floor(rnd() * LABEL_COUNT));
    const attr = set.geometry.label.getAttribute('aTile') as InstancedBufferAttribute;
    attr.setXYZW(j, tile[0], tile[1], tile[2], tile[3]);
    set.glass.setMatrixAt(j, hidden);
    set.label.setMatrixAt(j, hidden);
    set.foil.setMatrixAt(j, hidden);
  }
  for (const set of sets) {
    if (set.glass.instanceColor) set.glass.instanceColor.needsUpdate = true;
    if (set.foil.instanceColor) set.foil.instanceColor.needsUpdate = true;
    scene.add(set.glass, set.label, set.foil);
  }

  // The hero: a Burgundy bottle in black and white, standing at the centre.
  const heroShape = SHAPES.burgundy;
  const thetaEnd = THETA0 + THETA_SWEEP + 0.35;
  const heroYaw = Math.PI / 2 - thetaEnd;
  const heroGeometry = buildBottleGeometry(heroShape, 72);
  const heroMaterials = createHeroMaterials(buildHeroLabel());
  const hero = new Group();
  const heroGlass = new Mesh(heroGeometry.glass, heroMaterials.glass);
  const heroLabel = new Mesh(heroGeometry.label, heroMaterials.label);
  const heroFoil = new Mesh(heroGeometry.capsule, heroMaterials.foil);
  heroGlass.castShadow = shadows;
  heroGlass.receiveShadow = shadows;
  heroFoil.castShadow = shadows;
  hero.add(heroGlass, heroLabel, heroFoil);
  hero.position.set(0, heroShape.origin, 0);
  hero.rotation.y = heroYaw;
  scene.add(hero);

  // Decor: static copies of the settled top layer, rotated and shifted around
  // the well, so the field of bottles runs past the frame when seen from above.
  // Low-poly geometry, same materials and labels. Built once after settling.
  const decorCopies = tier === 'high' ? 8 : 6;
  const decorDepth = tier === 'high' ? 0.45 : 0.3;
  const decorGeometry = shapes.map((shape) => buildBottleGeometry(shape, 12));
  const decorSets: BottleSet[] = decorGeometry.map((geometry, s) => {
    const capacity = Math.max(1, (perShape[s] ?? 1) * decorCopies);
    const glass = new InstancedMesh(geometry.glass, glassMaterial, capacity);
    const label = new InstancedMesh(geometry.label, labelMaterial, capacity);
    const foil = new InstancedMesh(geometry.capsule, foilMaterial, capacity);
    geometry.label.setAttribute('aTile', new InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    for (const mesh of [glass, label, foil]) {
      mesh.frustumCulled = false;
      mesh.count = 0;
    }
    return { glass, label, foil, geometry };
  });
  const buildDecor = (pileTop: number) => {
    const ringR = config.wellRadius * 2.0 + 0.05;
    const used = [0, 0, 0];
    const offset = new Matrix4();
    const bodyM = new Matrix4();
    const p = new Vector3();
    const q = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const srcTiles = sets.map((set) => set.geometry.label.getAttribute('aTile') as InstancedBufferAttribute);
    const color = new Color();
    for (let k = 0; k < decorCopies; k++) {
      const a = (k / decorCopies) * Math.PI * 2 + 0.37;
      // Rotate the copy about the well centre, then shift it out onto the ring.
      const spin = new Matrix4().makeRotationY(a * 1.7 + k * 0.9);
      offset.makeTranslation(Math.cos(a) * ringR, 0.12 - 0.03 * (k % 3), Math.sin(a) * ringR).multiply(spin);
      for (let i = bedCount; i < count; i++) {
        const body = pile.bodies[i];
        if (!body) continue;
        const t = body.translation();
        if (t.y < pileTop - decorDepth) continue;
        const r = body.rotation();
        p.set(t.x, t.y, t.z);
        q.set(r.x, r.y, r.z, r.w);
        bodyM.compose(p, q, one).premultiply(offset);
        const s = shapeOf[i] ?? 0;
        const src = sets[s]!;
        const dst = decorSets[s]!;
        const j = localIndex[i] ?? 0;
        const n = used[s] ?? 0;
        if (n >= dst.glass.instanceMatrix.count) continue;
        dst.glass.setMatrixAt(n, bodyM);
        dst.label.setMatrixAt(n, bodyM);
        dst.foil.setMatrixAt(n, bodyM);
        src.glass.getColorAt(j, color);
        dst.glass.setColorAt(n, color);
        src.foil.getColorAt(j, color);
        dst.foil.setColorAt(n, color);
        const tiles = dst.geometry.label.getAttribute('aTile') as InstancedBufferAttribute;
        const st = srcTiles[s]!;
        tiles.setXYZW(n, st.getX(j), st.getY(j), st.getZ(j), st.getW(j));
        used[s] = n + 1;
      }
    }
    decorSets.forEach((set, s) => {
      const n = used[s] ?? 0;
      set.glass.count = n;
      set.label.count = n;
      set.foil.count = n;
      set.glass.instanceMatrix.needsUpdate = true;
      set.label.instanceMatrix.needsUpdate = true;
      set.foil.instanceMatrix.needsUpdate = true;
      if (set.glass.instanceColor) set.glass.instanceColor.needsUpdate = true;
      if (set.foil.instanceColor) set.foil.instanceColor.needsUpdate = true;
      (set.geometry.label.getAttribute('aTile') as InstancedBufferAttribute).needsUpdate = true;
      if (n > 0) scene.add(set.glass, set.label, set.foil);
    });
  };

  // Physics.
  await Pile.load();
  const pile = new Pile({
    count: dynamicCount,
    bedCount,
    wellRadius: config.wellRadius,
    shapes,
    shapeOf,
    hero: { shape: heroShape, yaw: heroYaw },
    probe: { radius: PROBE_RADIUS, halfHeight: PROBE_HALF },
    rnd: mulberry(404)
  });

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
    bokeh = new BokehPass(scene, camera, { focus: 0.75, aperture: 0.025, maxblur: 0.006 });
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
  let progress = options.initialProgress ?? 0;
  let current = progress;
  let reduced = options.motion.get() === 'reduced';
  let staticMode = false;
  let online = false;
  let ticking = false;
  let time = 0;
  let frameCount = 0;
  let physicsMs = 0;
  let nearCount = 0;
  let yTop = 3;
  const yLow = 0.62;
  let aspect = 1;
  const monitor = new FrameMonitor(90);
  const fine = window.matchMedia('(pointer: fine)');
  const debug = params.has('debug');
  // ?instant drops the scroll damping, so a capture at a scroll position shows that position.
  const instant = params.has('instant');
  const parallax = { x: 0, y: 0, tx: 0, ty: 0 };

  const size = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    aspect = w / h;
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  };

  // Camera path. Descent: a slow spiral straight down through the pile, the
  // screen rolling gently with the direction of travel. Reveal: the camera
  // lifts its gaze and settles level with the hero's label.
  const pose: Pose = { pos: new Vector3(), look: new Vector3(), up: new Vector3(0, 1, 0), fov: 50, theta: THETA0 };
  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const tmpC = new Vector3();
  const descentPose = (u: number, out: Pose) => {
    const portrait = aspect < 1;
    const e = smoothstep(u);
    const y = lerp(yTop, yLow, e);
    const theta = THETA0 + THETA_SWEEP * u;
    const r = 0.08 + 0.1 * Math.sin(u * Math.PI);
    out.pos.set(Math.cos(theta) * r, y, Math.sin(theta) * r);
    tmpA.set(-Math.sin(theta), 0, Math.cos(theta)); // tangent
    out.look.copy(out.pos).addScaledVector(tmpA, 0.3).add(tmpB.set(-out.pos.x * 0.15, -1, -out.pos.z * 0.15));
    out.up.copy(tmpA);
    out.fov = (portrait ? 56 : 42) + 10 * u;
    out.theta = theta;
  };
  const computePose = (p: number, out: Pose) => {
    if (p <= DESCENT_END) {
      descentPose(p / DESCENT_END, out);
      return;
    }
    const v = smoothstep((p - DESCENT_END) / (REVEAL_END - DESCENT_END));
    descentPose(1, out);
    const portrait = aspect < 1;
    const theta = THETA0 + THETA_SWEEP + 0.35 * v;
    tmpA.set(Math.cos(theta) * HERO_DISTANCE, HERO_EYE, Math.sin(theta) * HERO_DISTANCE); // final position
    // Frame the bottle off centre: to the right on landscape, high on portrait.
    tmpB.copy(HERO_POINT);
    if (portrait) {
      // The panel covers the lower part of a phone screen; the bottle sits in the upper third.
      tmpB.y -= 0.16;
    } else {
      tmpC.copy(HERO_POINT).sub(tmpA).normalize();
      const rx = -tmpC.z;
      const rz = tmpC.x; // right vector of a camera looking along tmpC with y up
      tmpB.x -= rx * 0.16;
      tmpB.z -= rz * 0.16;
    }
    out.pos.lerp(tmpA, v);
    out.look.lerp(tmpB, v);
    out.up.lerp(tmpC.set(0, 1, 0), v).normalize();
    out.fov = lerp(out.fov, portrait ? HERO_FOV + 16 : HERO_FOV, v);
    out.theta = theta;
  };

  // Instance sync from the physics bodies.
  const _p = new Vector3();
  const _q = new Quaternion();
  const _s = new Vector3(1, 1, 1);
  const _m = new Matrix4();
  const syncInstances = () => {
    const bodies = pile.bodies;
    for (let i = 0; i < count; i++) {
      const body = bodies[i];
      if (!body) continue;
      const t = body.translation();
      const r = body.rotation();
      _p.set(t.x, t.y, t.z);
      _q.set(r.x, r.y, r.z, r.w);
      _m.compose(_p, _q, _s);
      const set = sets[shapeOf[i] ?? 0]!;
      const j = localIndex[i] ?? 0;
      set.glass.setMatrixAt(j, _m);
      set.label.setMatrixAt(j, _m);
      set.foil.setMatrixAt(j, _m);
    }
    for (const set of sets) {
      set.glass.instanceMatrix.needsUpdate = true;
      set.label.instanceMatrix.needsUpdate = true;
      set.foil.instanceMatrix.needsUpdate = true;
    }
  };

  const applyCamera = (p: number, dt: number) => {
    computePose(p, pose);
    tmpA.copy(pose.pos);
    if (!reduced && !staticMode) {
      tmpA.x += Math.sin(time * 0.5) * 0.008;
      tmpA.y += Math.sin(time * 0.37) * 0.005;
      tmpA.z += Math.cos(time * 0.43) * 0.008;
      parallax.x += (parallax.tx - parallax.x) * (1 - Math.exp(-dt * 3));
      parallax.y += (parallax.ty - parallax.y) * (1 - Math.exp(-dt * 3));
    }
    camera.position.copy(tmpA);
    camera.up.copy(pose.up);
    tmpB.copy(pose.look);
    if (parallax.x !== 0 || parallax.y !== 0) {
      // Small look offset in camera space.
      tmpC.copy(pose.look).sub(camera.position).normalize();
      const right = new Vector3().crossVectors(tmpC, pose.up).normalize();
      const upv = new Vector3().crossVectors(right, tmpC).normalize();
      tmpB.addScaledVector(right, parallax.x * 0.05).addScaledVector(upv, -parallax.y * 0.035);
    }
    camera.lookAt(tmpB);
    if (Math.abs(camera.fov - pose.fov) > 0.01) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    tmpC.copy(tmpB).sub(camera.position).normalize();
    const keyRight = new Vector3().crossVectors(tmpC, pose.up).normalize();
    lamp.position.copy(camera.position).addScaledVector(pose.up, 0.32).addScaledVector(keyRight, -0.42);
    pile.setProbe(pose.pos.x, pose.pos.y - 0.05, pose.pos.z);
    pile.setClearRadius(CLEAR_RADIUS * smoothstep((p - 0.66) / 0.2));
    const reveal = smoothstep((p - 0.72) / 0.18);
    shaftMaterial.uniforms.uOpacity!.value = reveal * 0.32;
    shaft.visible = reveal > 0.001;
    if (bokeh) {
      const focusDistance = lerp(0.72, camera.position.distanceTo(HERO_POINT), reveal);
      const uniforms = bokeh.uniforms as Record<string, { value: number }>;
      uniforms.focus!.value = focusDistance;
      uniforms.aperture!.value = lerp(0.025, 0.04, reveal);
    }
  };

  const render = () => {
    renderer.info.reset();
    if (composer) composer.render();
    else renderer.render(scene, camera);
  };

  const telemetry = () => {
    options.onTelemetry({
      depth: yTop - camera.position.y,
      bottles: nearCount,
      hdg: (pose.theta * 180) / Math.PI,
      found: current > 0.93
    });
  };

  const frame = (dt: number) => {
    time += dt;
    frameCount++;
    if (reduced || staticMode || instant) current = progress;
    else current += (progress - current) * (1 - Math.exp(-dt * 4.5));
    applyCamera(current, dt);
    const t0 = performance.now();
    pile.step(Math.min(1 / 30, Math.max(1 / 120, dt)));
    physicsMs += (performance.now() - t0 - physicsMs) * 0.1;
    syncInstances();
    if (frameCount % 10 === 0) nearCount = pile.countNear(camera.position.x, camera.position.y, camera.position.z, 1.4);
    render();
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
    spot.castShadow = on;
    for (const set of sets) {
      set.glass.castShadow = on;
      set.glass.receiveShadow = on;
      set.foil.castShadow = on;
      set.label.receiveShadow = on;
    }
    heroGlass.castShadow = on;
    heroGlass.receiveShadow = on;
    heroFoil.castShadow = on;
    for (const material of [glassMaterial, labelMaterial, foilMaterial, heroMaterials.glass, heroMaterials.label, heroMaterials.foil, floor.material]) material.needsUpdate = true;
  };

  // Runtime downgrade keeps the pile as it is and spends less on pixels.
  const lowerQuality = (toStatic: boolean) => {
    if (toStatic) {
      staticMode = true;
      dof = false;
      dropComposer();
      setShadows(false);
      dpr = 1;
    } else {
      if (dof) {
        dof = false;
        dropComposer();
      } else {
        setShadows(false);
      }
      dpr = Math.max(1, Math.min(dpr, 1.5));
      if (tier === 'high') tier = 'medium';
      else tier = 'low';
    }
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
  const onPointer = (event: PointerEvent) => {
    if (reduced || staticMode || !fine.matches) return;
    parallax.tx = (event.clientX / window.innerWidth) * 2 - 1;
    parallax.ty = (event.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pointermove', onPointer, { passive: true });
  const unsubMotion = options.motion.subscribe((mode) => {
    reduced = mode === 'reduced';
    if (reduced) {
      parallax.tx = parallax.ty = parallax.x = parallax.y = 0;
    }
  });
  const unsubQuality = options.quality.subscribe((mode) => {
    if (mode === 'low') lowerQuality(true);
  });

  size();
  options.onTier(tier, staticMode);

  // Settle the pile across frames before the canvas fades in.
  await new Promise<void>((resolve) => {
    const stepSettle = () => {
      const fraction = pile.settle(12);
      options.onSettling(fraction);
      if (fraction >= 1) {
        resolve();
        return;
      }
      window.requestAnimationFrame(stepSettle);
    };
    window.requestAnimationFrame(stepSettle);
  });

  yTop = pile.pileTop() + START_ABOVE;
  buildDecor(pile.pileTop());
  current = progress;
  syncInstances();
  // Warm up: compile every program against a real frame before showing it.
  applyCamera(current, 1 / 60);
  render();
  online = true;
  options.onOnline();
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
        bottles: dynamicCount,
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
      window.removeEventListener('pointermove', onPointer);
      unsubMotion();
      unsubQuality();
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
