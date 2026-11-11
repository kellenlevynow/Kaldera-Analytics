// The hangar: one aircraft under one light, taken apart and put back together
// as the visitor scrolls. Renderer, the light and the floor, the airframe and
// its reflection, the camera path through the assemblies, and the quality tiers.
import gsap from 'gsap';
import {
  ACESFilmicToneMapping,
  CanvasTexture,
  CircleGeometry,
  Color,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Quaternion,
  RepeatWrapping,
  Scene,
  SpotLight,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer
} from 'three';
import type { QualityTier } from '../scene/types';
import { FrameMonitor, detectTier } from '../scene/quality';
import { GEAR, LIFT, buildAirframe, createMaterials, poseAirframe, type Airframe } from './airframe';
import { JOIN_END, JOIN_START, PARTS, SPLIT_START, assemblyLabel, focusLabel, partSeparationAt, separationAt } from './timeline';
import type { AeroDiagnostics, AeroSceneController, AeroSceneOptions } from './types';

interface AeroTier {
  tier: QualityTier;
  dpr: number;
  shadows: boolean;
  shadowSize: number;
  reflection: boolean;
}

function aeroConfig(tier: QualityTier, deviceDpr: number): AeroTier {
  switch (tier) {
    case 'high':
      return { tier, dpr: Math.min(deviceDpr, 2), shadows: true, shadowSize: 2048, reflection: true };
    case 'medium':
      return { tier, dpr: Math.min(deviceDpr, 1.5), shadows: true, shadowSize: 1024, reflection: true };
    case 'low':
    default:
      return { tier: 'low', dpr: 1, shadows: false, shadowSize: 512, reflection: false };
  }
}

// Fastest the camera will chase the scroll position, in progress per second,
// so a jump to the end becomes a traverse rather than a cut.
const CHASE = 0.3;
const BASE_FOV = 36;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

interface Key {
  p: number;
  pos: Vector3;
  look: Vector3;
  // The segment ending at this key orbits the look point instead of running straight.
  orbit?: boolean;
}

// Camera keyframes in world space. The airframe's chord plane is at y = 1.15
// on the floor and y = 2.15 while it is apart; the fly-bys are framed on the
// exploded positions of the assemblies (see focus in airframe.ts).
function buildKeys(frame: Airframe): Key[] {
  const V = (x: number, y: number, z: number) => new Vector3(x, y, z);
  const H = GEAR + LIFT;
  // Airframe space while apart, to world.
  const L = (x: number, y: number, z: number) => V(x, y + H, z);
  const f = frame.focus;
  const keys: Key[] = [
    { p: 0.0, pos: V(8.6, 2.6, 10.6), look: V(0.3, 2.6, 0.3) },
    { p: SPLIT_START, pos: V(8.4, 2.8, 10.4), look: V(0.3, 2.5, 0.3) },
    { p: 0.17, pos: V(12.5, 7.0, 13.0), look: V(0, 2.5, -0.2) }
  ];
  const flyby: Record<string, { from: Vector3; to: Vector3; lookFrom: Vector3; lookTo: Vector3 }> = {
    fuselage: { from: V(8.5, 3.2, 9.0), to: V(-8.0, 3.7, 8.2), lookFrom: L(f.fuselage.x, f.fuselage.y, f.fuselage.z), lookTo: L(0, 0.2, 0.2) },
    sensors: { from: V(-2.0, 1.45, 6.3), to: V(1.9, 1.25, 6.2), lookFrom: L(f.sensors.x, f.sensors.y, f.sensors.z), lookTo: L(0, -0.9, 4.2) },
    avionics: { from: V(2.6, H + 1.25, 4.4), to: V(-2.4, H + 1.1, 4.3), lookFrom: L(f.avionics.x, f.avionics.y, f.avionics.z), lookTo: L(0, 0.95, 1.6) },
    propulsion: { from: V(-4.6, H + 1.2, -5.4), to: V(2.6, H + 0.9, -8.0), lookFrom: L(f.propulsion.x, f.propulsion.y, f.propulsion.z), lookTo: L(0, 0.65, -4.0) },
    payload: { from: V(3.8, H - 0.9, -2.6), to: V(-0.6, H - 1.0, 3.4), lookFrom: L(f.payload.x, f.payload.y, f.payload.z), lookTo: L(0, -0.9, -0.95) },
    wings: { from: V(1.4, H + 1.3, 5.6), to: V(8.8, H + 1.1, 3.0), lookFrom: L(4.2, 0.3, 0.4), lookTo: L(f.wings.x, f.wings.y, f.wings.z) },
    gear: { from: V(4.4, 1.15, 1.4), to: V(3.9, 0.8, -3.8), lookFrom: V(1.3, 0.5, -0.6), lookTo: V(1.45, 0.45, -1.2) },
    controls: { from: V(3.6, H - 0.1, -5.4), to: V(8.2, H + 0.8, -5.4), lookFrom: L(5.2, 0.35, -1.7), lookTo: L(f.controls.x, f.controls.y, f.controls.z) }
  };
  for (const part of PARTS) {
    const k = flyby[part.id]!;
    keys.push({ p: part.from, pos: k.from, look: k.lookFrom }, { p: part.to - 0.004, pos: k.to, look: k.lookTo, orbit: true });
  }
  keys.push(
    { p: JOIN_START, pos: V(-11.8, 6.8, 12.6), look: V(0, 2.5, 0) },
    { p: JOIN_END, pos: V(-9.0, 2.9, 10.8), look: V(0, 1.2, 0.3) },
    { p: 1.0, pos: V(-8.4, 2.5, 10.2), look: V(0.1, 2.3, 0.4) }
  );
  return keys;
}

// The path is piecewise linear in progress with a gentle ease inside each
// segment; the camera itself is then smoothed in world space (see applyFrame),
// which turns the hand-over between two assemblies into a glide rather than a cut.
class Path {
  constructor(private keys: Key[]) {}

  sample(p: number, pos: Vector3, look: Vector3): void {
    const keys = this.keys;
    const n = keys.length;
    if (p <= keys[0]!.p) {
      pos.copy(keys[0]!.pos);
      look.copy(keys[0]!.look);
      return;
    }
    if (p >= keys[n - 1]!.p) {
      pos.copy(keys[n - 1]!.pos);
      look.copy(keys[n - 1]!.look);
      return;
    }
    let i = 0;
    while (i < n - 2 && p >= keys[i + 1]!.p) i++;
    const a = keys[i]!;
    const b = keys[i + 1]!;
    const s = clamp01((p - a.p) / Math.max(1e-6, b.p - a.p));
    const t = 0.5 * s + 0.5 * s * s * (3 - 2 * s);
    look.copy(a.look).lerp(b.look, t);
    if (!b.orbit) {
      pos.copy(a.pos).lerp(b.pos, t);
      return;
    }
    // Orbit: the camera's offset from the look point turns and changes length.
    offsetA.copy(a.pos).sub(a.look);
    offsetB.copy(b.pos).sub(b.look);
    const ra = offsetA.length();
    const rb = offsetB.length();
    offsetA.divideScalar(ra);
    offsetB.divideScalar(rb);
    turn.setFromUnitVectors(offsetA, offsetB);
    partial.identity().slerp(turn, t);
    pos.copy(offsetA).applyQuaternion(partial).multiplyScalar(lerp(ra, rb, t)).add(look);
  }
}

const offsetA = new Vector3();
const offsetB = new Vector3();
const turn = new Quaternion();
const partial = new Quaternion();

function floorTexture(): CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0e0e10';
  ctx.fillRect(0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  let seed = 11;
  for (let i = 0; i < size * size; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const g = ((seed / 4294967296 - 0.5) * 6) | 0;
    data.data[i * 4] = 14 + g;
    data.data[i * 4 + 1] = 14 + g;
    data.data[i * 4 + 2] = 16 + g;
  }
  ctx.putImageData(data, 0, 0);
  // Expansion joints in the slab.
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0.5, 0.5, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.strokeRect(2.5, 2.5, size - 4, size - 4);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(30, 30);
  return texture;
}

// The reflection environment: a black hall with one overhead light and a
// faint floor, so the composite and the titanium pick up one soft source.
function buildEnvironment(renderer: WebGLRenderer) {
  const pmrem = new PMREMGenerator(renderer);
  const env = new Scene();
  env.background = new Color(0x000000);
  const lamp = new Mesh(new CircleGeometry(2.6, 40), new MeshBasicMaterial({ color: new Color(5.5, 5.5, 5.8) }));
  lamp.position.set(1.5, 10, 2.5);
  lamp.lookAt(0, 0, 0);
  const halo = new Mesh(new CircleGeometry(7, 40), new MeshBasicMaterial({ color: new Color(0.35, 0.35, 0.38) }));
  halo.position.set(1.5, 10.5, 2.5);
  halo.lookAt(0, 0, 0);
  const floor = new Mesh(new PlaneGeometry(60, 60), new MeshBasicMaterial({ color: new Color(0.05, 0.05, 0.055) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2;
  env.add(halo, lamp, floor);
  const texture = pmrem.fromScene(env, 0.04, 0.1, 80).texture;
  pmrem.dispose();
  return texture;
}

export async function createAeroScene(options: AeroSceneOptions): Promise<AeroSceneController> {
  const { canvas } = options;
  const deviceDpr = window.devicePixelRatio || 1;
  const params = new URLSearchParams(window.location.search);
  const forced = params.get('tier');
  let tier: QualityTier = forced === 'high' || forced === 'medium' || forced === 'low' ? forced : detectTier();
  const config = aeroConfig(tier, deviceDpr);
  let dpr = config.dpr;
  let shadows = config.shadows;
  let reflection = config.reflection;
  let reduced = options.reduced;

  const renderer = new WebGLRenderer({ canvas, antialias: dpr < 2, powerPreference: 'high-performance', alpha: false, stencil: false });
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(0x000000, 1);
  renderer.info.autoReset = false;

  const scene = new Scene();
  scene.background = new Color(0x000000);
  scene.fog = new FogExp2(0x000000, 0.022);
  scene.environment = buildEnvironment(renderer);
  scene.environmentIntensity = 0.85;

  const camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 90);

  // One light. A single overhead spot, high and a little ahead of the aircraft,
  // with a soft edge, and a trace of bounce from the floor so the shadow side
  // is not pure black. A faint lamp travels with the camera for the close-ups.
  const key = new SpotLight(0xffffff, 2600, 0, 0.6, 0.7, 1.7);
  key.position.set(2.0, 13.5, 3.0);
  key.target.position.set(0, 1.6, -0.2);
  key.castShadow = shadows;
  key.shadow.mapSize.set(config.shadowSize, config.shadowSize);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.03;
  key.shadow.radius = 4;
  key.shadow.camera.near = 5;
  key.shadow.camera.far = 24;
  scene.add(key, key.target);
  scene.add(new HemisphereLight(0x2e3137, 0x08080a, 0.5));
  const lamp = new PointLight(0xdfe6f2, 0, 18, 2);
  scene.add(lamp);

  // The floor: dark, slightly glossy, with the aircraft's reflection under it.
  const floorMaterial = new MeshStandardMaterial({ color: 0xffffff, map: floorTexture(), roughness: 0.42, metalness: 0.05, transparent: true, opacity: 0.86 });
  const floor = new Mesh(new PlaneGeometry(120, 120), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.renderOrder = 2;
  scene.add(floor);

  const materials = createMaterials(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const frame = buildAirframe(materials);
  scene.add(frame.root);

  // The reflection: a clone of the airframe under the floor, posed every frame
  // like the original, seen through the floor's transparency.
  const mirror = new Group();
  mirror.scale.y = -1;
  const mirrored = frame.root.clone(true);
  const cloneOf = new Map<Object3D, Object3D>();
  {
    const originals: Object3D[] = [];
    const clones: Object3D[] = [];
    frame.root.traverse((o) => originals.push(o));
    mirrored.traverse((o) => clones.push(o));
    originals.forEach((o, i) => cloneOf.set(o, clones[i]!));
    mirrored.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = true;
    });
  }
  mirror.add(mirrored);
  mirror.visible = reflection;
  scene.add(mirror);
  const syncMirror = () => {
    mirrored.position.copy(frame.root.position);
    for (const e of frame.exploded) {
      const c = cloneOf.get(e.object);
      if (!c) continue;
      c.position.copy(e.object.position);
      c.quaternion.copy(e.object.quaternion);
    }
  };

  const path = new Path(buildKeys(frame));

  // State.
  let progress = clamp01(options.initialProgress ?? 0);
  let current = progress;
  let staticMode = false;
  let online = false;
  let ticking = false;
  let frameCount = 0;
  let aspect = 1;
  let portrait = 0;
  let needsRender = true;
  const monitor = new FrameMonitor(90);
  const debug = params.has('debug');
  const instant = params.has('instant');
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const size = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    aspect = w / h;
    portrait = clamp01((1.25 - aspect) / 0.75);
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    camera.fov = lerp(BASE_FOV, 54, portrait);
    camera.updateProjectionMatrix();
    needsRender = true;
  };

  const pos = new Vector3();
  const look = new Vector3();
  const target = { pos: new Vector3(), look: new Vector3() };
  let settled = false;
  const dir = new Vector3();
  const right = new Vector3();
  const up = new Vector3(0, 1, 0);
  let separation = 0;
  const applyFrame = (p: number, dt: number) => {
    separation = separationAt(p);
    poseAirframe(frame, separation, (order) => partSeparationAt(p, order));
    if (reflection) syncMirror();

    path.sample(p, target.pos, target.look);
    // Narrow frames stand further back so the aircraft stays in the frame.
    dir.copy(target.pos).sub(target.look);
    target.pos.copy(target.look).addScaledVector(dir, 1 + 0.55 * portrait);
    // The camera glides after its target; a hand-over between assemblies
    // becomes a swoop. Reduced motion follows the path exactly.
    if (reduced || instant || !settled) {
      pos.copy(target.pos);
      look.copy(target.look);
      settled = true;
    } else {
      const k = 1 - Math.exp(-dt * 3.4);
      pos.lerp(target.pos, k);
      look.lerp(target.look, k);
    }
    // Pointer parallax: a small sideways drift, desktop only.
    if (!reduced && !coarse) {
      dir.normalize();
      right.crossVectors(up, dir).normalize();
      pos.addScaledVector(right, pointer.x * 0.3).addScaledVector(up, pointer.y * 0.18);
    }
    camera.position.copy(pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    lamp.position.copy(pos).addScaledVector(right, 0.8).addScaledVector(up, 0.6);
    // The travelling lamp only matters up close; it fades out in the wide views.
    const distance = pos.distanceTo(look);
    lamp.intensity = 22 * clamp01((11 - distance) / 6) * (0.3 + 0.7 * separation);
  };

  const render = () => {
    renderer.info.reset();
    renderer.render(scene, camera);
    needsRender = false;
  };

  const telemetry = () => {
    options.onTelemetry({ assembly: assemblyLabel(current), focus: focusLabel(current), separation });
  };

  const frameStep = (dt: number) => {
    frameCount++;
    const before = current;
    if (reduced || instant) current = progress;
    else {
      const gap = progress - current;
      const cap = CHASE * dt;
      const step = gap * (1 - Math.exp(-dt * 3.2));
      current += Math.min(cap, Math.max(-cap, step));
      if (Math.abs(progress - current) < 0.00005) current = progress;
    }
    const px = pointer.x;
    const py = pointer.y;
    const k = 1 - Math.exp(-dt * 4);
    pointer.x += (pointer.tx - pointer.x) * k;
    pointer.y += (pointer.ty - pointer.y) * k;
    const gliding = pos.distanceToSquared(target.pos) > 1e-6 || look.distanceToSquared(target.look) > 1e-6;
    const moved = current !== before || gliding || Math.abs(pointer.x - px) > 0.0005 || Math.abs(pointer.y - py) > 0.0005;
    if (moved || needsRender || frameCount < 100) {
      applyFrame(current, dt);
      render();
      options.onProgress(current);
      return true;
    }
    return false;
  };

  const tick = (_t: number, deltaMs: number) => {
    const dt = Math.min(0.1, Math.max(0.001, deltaMs / 1000));
    const rendered = frameStep(dt);
    if (frameCount % 4 === 0) telemetry();
    if (!rendered) return;
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
    for (const m of Object.values(materials)) m.needsUpdate = true;
    floorMaterial.needsUpdate = true;
    needsRender = true;
  };
  const setReflection = (on: boolean) => {
    reflection = on;
    mirror.visible = on;
    needsRender = true;
  };

  // Runtime downgrade: the airframe stays as it is; fewer pixels and fewer passes.
  const lowerQuality = (toStatic: boolean) => {
    if (toStatic) {
      staticMode = true;
      setShadows(false);
      setReflection(false);
      dpr = 1;
      tier = 'low';
    } else {
      if (shadows) setShadows(false);
      else setReflection(false);
      dpr = Math.max(1, Math.min(dpr, 1.5));
      tier = tier === 'high' ? 'medium' : 'low';
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
    pointer.tx = (event.clientX / window.innerWidth - 0.5) * 2;
    pointer.ty = (0.5 - event.clientY / window.innerHeight) * 2;
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  if (!coarse) window.addEventListener('pointermove', onPointer, { passive: true });

  size();
  options.onTier(tier, staticMode);
  applyFrame(current, 0.016);
  render();
  online = true;
  options.onOnline();
  options.onProgress(current);
  telemetry();
  if (!document.hidden) startTicker();

  return {
    setProgress(p) {
      progress = clamp01(p);
    },
    setReduced(r) {
      reduced = r;
      needsRender = true;
    },
    pause() {
      stopTicker();
    },
    resume() {
      if (!document.hidden) startTicker();
    },
    diagnostics(): AeroDiagnostics {
      return {
        tier,
        progress: current,
        separation,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        pixelRatio: renderer.getPixelRatio(),
        avgFrameMs: monitor.average,
        online,
        shadows,
        reflection,
        camera: [pos.x, pos.y, pos.z, look.x, look.y, look.z].map((v) => Math.round(v * 100) / 100)
      };
    },
    dispose() {
      stopTicker();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointer);
      frame.root.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose();
      });
      for (const m of Object.values(materials)) m.dispose();
      renderer.dispose();
    }
  };
}
