import './styles/index.css';
import './styles/wine.css';
import { site } from './site.config';
import { motionStore, qualityStore } from './ui/motion';
import { initReveals } from './ui/reveal';
import { initWineHud } from './wine/hud';
import { initCaptions } from './wine/overlay';
import type { WineSceneController } from './wine/types';

const html = document.documentElement;
html.classList.add('js');
if (new URLSearchParams(window.location.search).has('og')) html.classList.add('og');

const hud = initWineHud({ motion: motionStore, quality: qualityStore, email: site.email });
const reveals = initReveals(() => motionStore.get() === 'reduced');
initCaptions();
motionStore.subscribe(() => reveals.rebuild());

// Scroll progress over the whole page. The descent is continuous, so progress
// is simply the scrolled fraction; the scene maps it onto the camera path.
let maxScroll = 1;
let progress = 0;
let scene: WineSceneController | null = null;
let scrolled = false;
let found = false;

function measure(): void {
  maxScroll = Math.max(1, html.scrollHeight - window.innerHeight);
  update();
}

function update(): void {
  const y = Math.min(Math.max(window.scrollY, 0), maxScroll);
  progress = y / maxScroll;
  hud.setProgress(progress);
  scene?.setProgress(progress);
  const nowFound = progress > 0.93;
  if (nowFound !== found) {
    found = nowFound;
    hud.setFound(found);
  }
  if (!scrolled && y > 24) {
    scrolled = true;
    hud.hideCue();
  }
}

window.addEventListener('scroll', update, { passive: true });
window.addEventListener('resize', measure);
window.addEventListener('load', measure);
if (document.fonts) document.fonts.ready.then(measure).catch(() => undefined);
measure();

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

async function loadScene(): Promise<void> {
  const canvas = document.getElementById('scene');
  if (!(canvas instanceof HTMLCanvasElement) || !supportsWebGL() || typeof WebAssembly === 'undefined') {
    html.classList.add('no-webgl');
    hud.setSceneStatus('Poster');
    return;
  }
  try {
    hud.setSceneStatus('Loading');
    const { createWineScene } = await import('./wine/scene');
    scene = await createWineScene({
      canvas,
      motion: motionStore,
      quality: qualityStore,
      initialProgress: progress,
      onSettling(fraction) {
        hud.setSceneStatus(`Settling ${String(Math.round(fraction * 100)).padStart(2, '0')}%`);
      },
      onOnline() {
        canvas.classList.add('is-online');
        html.classList.add('has-scene');
        hud.setSceneStatus('Scene online');
      },
      onTelemetry: hud.setTelemetry,
      onTier(tier, staticMode) {
        html.dataset.tier = tier;
        if (staticMode) html.dataset.static = 'true';
        else delete html.dataset.static;
      }
    });
    scene.setProgress(progress);
    Object.defineProperty(window, '__kaldera', { value: { diagnostics: () => scene?.diagnostics() ?? null, pause: () => scene?.pause(), resume: () => scene?.resume() }, configurable: true });
  } catch (error) {
    console.error('Scene failed to start, keeping the poster.', error);
    html.classList.add('no-webgl');
    hud.setSceneStatus('Poster');
  }
}

// The Three.js and physics chunks load after first paint so the headline is the LCP element.
window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => void loadScene(), { timeout: 900 });
    } else {
      window.setTimeout(() => void loadScene(), 60);
    }
  });
});
