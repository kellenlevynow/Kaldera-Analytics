// Scene assembly: renderer, time-sliced terrain bake, sky, network, camera rig,
// render loop in gsap.ticker, quality tiers and reduced-motion behaviour.
import gsap from 'gsap';
import { DataTexture, FogExp2, Mesh, NoToneMapping, PerspectiveCamera, RGBAFormat, Scene, ShaderMaterial, SRGBColorSpace, UnsignedByteType, Vector2, Vector3, WebGLRenderer } from 'three';
import type { QualityTier, SceneController, SceneDiagnostics, SceneOptions } from './types';
import { FAR_HALF, NEAR_HALF, bakeFar, buildTerrain, sunDir, sunRotation, type BakeGrid, type TerrainBuild } from './terrain';
import { terrainFragment, terrainVertex } from './shaders';
import { createSky } from './sky';
import { buildNetwork } from './network';
import { CameraRig } from './camera';
import { FrameMonitor, configFor, detectTier, lowerTier } from './quality';

const FOG_DENSITY = 0.021;
const BAKE_BUDGET_MS = 7;
const CONTOUR_BASE = 0.14;
const CONTOUR_DATA = 0.62;

// Drives a generator across animation frames within a per-frame time budget.
function runSliced<T>(gen: Generator<number, T, void>, budgetMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const step = () => {
      const start = performance.now();
      try {
        for (;;) {
          const r = gen.next();
          if (r.done) {
            resolve(r.value);
            return;
          }
          if (performance.now() - start > budgetMs) break;
        }
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  });
}

export async function createScene(options: SceneOptions): Promise<SceneController> {
  const { canvas } = options;
  const deviceDpr = window.devicePixelRatio || 1;
  let tier: QualityTier = options.quality.get() === 'low' ? 'low' : detectTier();
  let config = configFor(tier, deviceDpr);

  const renderer = new WebGLRenderer({ canvas, antialias: config.antialias, powerPreference: 'high-performance', alpha: false, stencil: false });
  renderer.setPixelRatio(config.dpr);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x000000, 1);

  const scene = new Scene();
  scene.fog = new FogExp2(0x000000, FOG_DENSITY);
  const camera = new PerspectiveCamera(42, 1, 0.05, 700);

  const blank = new DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  blank.needsUpdate = true;
  const uniforms = {
    uNear: { value: blank as DataTexture },
    uFar: { value: blank as DataTexture },
    uNearHalf: { value: NEAR_HALF },
    uFarHalf: { value: FAR_HALF },
    uFarReady: { value: 0 },
    uSunRot: { value: new Vector2(sunRotation[0], sunRotation[1]) },
    uSunDir: { value: sunDir.clone() },
    uExposure: { value: 1.55 },
    uEarthshine: { value: new Vector3(0.011, 0.012, 0.015) },
    uContour: { value: CONTOUR_BASE },
    uContourSpacing: { value: 0.2 },
    uIce: { value: 1.0 },
    uTime: { value: 0 },
    uFogDensity: { value: FOG_DENSITY }
  };
  const terrainMaterial = new ShaderMaterial({ uniforms, vertexShader: terrainVertex, fragmentShader: terrainFragment });

  let build: TerrainBuild = await runSliced(buildTerrain(config.terrain), BAKE_BUDGET_MS);
  uniforms.uNear.value = build.near.texture;
  let far: BakeGrid | null = null;
  const terrain = new Mesh(build.geometry, terrainMaterial);
  terrain.frustumCulled = false;
  scene.add(terrain);

  const network = buildNetwork(build.sampler, config.dpr);
  scene.add(network.group);
  const sky = createSky(config.stars, config.dpr);
  scene.add(sky.stars, sky.sun, sky.earth);

  const rig = new CameraRig(camera, build.sampler, network.nodes);

  let progress = options.initialProgress ?? 0;
  let active = options.initialActive ?? 0;
  let reduced = options.motion.get() === 'reduced';
  let staticMode = false;
  let online = false;
  let ticking = false;
  let renderQueued = false;
  let time = 0;
  let telemetryCounter = 0;
  let contourTarget = active === 5 ? CONTOUR_DATA : CONTOUR_BASE;
  const monitor = new FrameMonitor(90);
  const fine = window.matchMedia('(pointer: fine)');
  // ?debug keeps the frame monitor from changing tiers, for inspection in slow test browsers.
  const debug = new URLSearchParams(window.location.search).has('debug');

  const size = () => {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    rig.setAspect(w / h);
  };

  const render = () => {
    sky.update(camera);
    network.update(time, rig.progress, camera.position);
    renderer.render(scene, camera);
  };

  const renderOnce = () => {
    uniforms.uContour.value = contourTarget;
    render();
    options.onTelemetry(rig.telemetry());
  };

  const requestRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    window.requestAnimationFrame(() => {
      renderQueued = false;
      renderOnce();
    });
  };

  const frame = (dt: number) => {
    time += dt;
    uniforms.uTime.value = time;
    uniforms.uContour.value += (contourTarget - uniforms.uContour.value) * (1 - Math.exp(-dt * 3));
    rig.update(dt);
    render();
    if ((telemetryCounter++ & 1) === 0) options.onTelemetry(rig.telemetry());
  };

  const tick = (_time: number, deltaMs: number) => {
    const dt = Math.min(0.1, Math.max(0.001, deltaMs / 1000));
    frame(dt);
    const verdict = monitor.sample(deltaMs);
    if (debug) return;
    if (verdict === 'downgrade') void setTier(lowerTier(tier));
    else if (verdict === 'static') enterStatic();
  };

  const startTicker = () => {
    if (ticking) return;
    ticking = true;
    gsap.ticker.add(tick);
  };
  const stopTicker = () => {
    if (!ticking) return;
    ticking = false;
    gsap.ticker.remove(tick);
  };

  // Reduced motion and static mode: camera cuts to the active keyframe, render on demand.
  const applyMode = () => {
    if (reduced || staticMode) {
      stopTicker();
      rig.setParallax(0, 0);
      rig.snap(reduced ? active / rig.segments : progress);
      requestRender();
    } else if (!document.hidden) {
      rig.target = progress;
      startTicker();
    }
  };

  const enterStatic = () => {
    if (staticMode) return;
    staticMode = true;
    options.onTier(tier, true);
    applyMode();
  };

  let rebuilding = false;
  const setTier = async (next: QualityTier) => {
    if (next === tier || rebuilding) return;
    rebuilding = true;
    tier = next;
    config = configFor(tier, deviceDpr);
    renderer.setPixelRatio(config.dpr);
    sky.setDpr(config.dpr);
    network.setDpr(config.dpr);
    size();
    monitor.reset();
    options.onTier(tier, staticMode);
    try {
      const nextBuild = await runSliced(buildTerrain(config.terrain), BAKE_BUDGET_MS);
      const old = terrain.geometry;
      const oldTexture = build.near.texture;
      terrain.geometry = nextBuild.geometry;
      uniforms.uNear.value = nextBuild.near.texture;
      old.dispose();
      oldTexture.dispose();
      build = nextBuild;
    } finally {
      rebuilding = false;
      if (!ticking) requestRender();
    }
  };

  // Listeners
  const onResize = () => {
    size();
    if (!ticking) requestRender();
  };
  const onVisibility = () => {
    if (document.hidden) stopTicker();
    else if (!reduced && !staticMode) startTicker();
  };
  const onPointer = (event: PointerEvent) => {
    if (reduced || staticMode || !fine.matches) return;
    rig.setParallax((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pointermove', onPointer, { passive: true });
  const unsubMotion = options.motion.subscribe((mode) => {
    reduced = mode === 'reduced';
    applyMode();
  });
  const unsubQuality = options.quality.subscribe((mode) => {
    void setTier(mode === 'low' ? 'low' : detectTier());
  });

  // First frame, then online. The far plain bakes afterwards and fades in.
  size();
  rig.snap(reduced ? active / rig.segments : progress);
  renderOnce();
  online = true;
  options.onOnline();
  options.onTier(tier, staticMode);
  applyMode();
  void runSliced(bakeFar(config.terrain.far), BAKE_BUDGET_MS).then((grid) => {
    far = grid;
    uniforms.uFar.value = grid.texture;
    uniforms.uFarReady.value = 1;
    if (!ticking) requestRender();
  });

  const controller: SceneController = {
    setProgress(p) {
      progress = p;
      if (reduced) return;
      if (staticMode) {
        rig.snap(p);
        requestRender();
      } else {
        rig.target = p;
      }
    },
    setActive(index) {
      if (index === active && online) return;
      active = index;
      contourTarget = index === 5 ? CONTOUR_DATA : CONTOUR_BASE;
      if (reduced) {
        rig.snap(index / rig.segments);
        requestRender();
      }
    },
    diagnostics(): SceneDiagnostics {
      return {
        tier,
        staticMode,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        pixelRatio: renderer.getPixelRatio(),
        avgFrameMs: Math.round(monitor.average * 100) / 100,
        online,
        vertices: build.vertexCount
      };
    },
    dispose() {
      stopTicker();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointer);
      unsubMotion();
      unsubQuality();
      network.dispose();
      sky.dispose();
      build.near.texture.dispose();
      far?.texture.dispose();
      blank.dispose();
      terrain.geometry.dispose();
      terrainMaterial.dispose();
      renderer.dispose();
    }
  };
  return controller;
}
