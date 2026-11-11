import './styles/index.css';
import './styles/wine.css';
import { site } from './site.config';
import { initWineHud } from './wine/hud';
import { initMoments } from './wine/moments';
import type { WineSceneController } from './wine/types';

const html = document.documentElement;
html.classList.add('js');
if (new URLSearchParams(window.location.search).has('og')) html.classList.add('og');

// Motion is fixed to the reduced behaviour and rendering to the low tier (data-motion in
// wine.html, the tier in src/wine/scene.ts); the page offers no controls for either.
const hud = initWineHud({ email: site.email });
const moments = initMoments();

// Scroll progress over the whole page. The descent is continuous, so progress
// is simply the scrolled fraction; the scene maps it onto the camera path and
// reports the camera's own progress back, which is what the text follows.
let maxScroll = 1;
let progress = 0;
let scene: WineSceneController | null = null;
let sceneDriving = false;
let scrolled = false;
let found = false;

function follow(p: number): void {
  moments.set(p);
  const nowFound = p > 0.855;
  if (nowFound !== found) {
    found = nowFound;
    hud.setFound(found);
  }
}

function measure(): void {
  maxScroll = Math.max(1, html.scrollHeight - window.innerHeight);
  update();
}

function update(): void {
  const y = Math.min(Math.max(window.scrollY, 0), maxScroll);
  progress = y / maxScroll;
  hud.setProgress(progress);
  scene?.setProgress(progress);
  if (!sceneDriving) follow(progress);
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

// Links to the closing message go to the end of the journey; the camera follows.
const toEnd = (event: Event) => {
  event.preventDefault();
  window.scrollTo({ top: html.scrollHeight });
};
for (const link of Array.from(document.querySelectorAll<HTMLElement>('[data-to-end]'))) link.addEventListener('click', toEnd);
// Keyboard focus landing in a moment brings the journey to it.
for (const moment of Array.from(document.querySelectorAll<HTMLElement>('.moment[data-from]'))) {
  moment.addEventListener('focusin', () => {
    const from = Math.max(0, Number(moment.dataset.from));
    const to = Math.min(1, Number(moment.dataset.to));
    const target = to >= 1 ? 1 : (from + to) / 2;
    if (Math.abs(target - progress) > 0.01) window.scrollTo({ top: target * maxScroll });
  });
}

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
      initialProgress: progress,
      onOnline() {
        canvas.classList.add('is-online');
        html.classList.add('has-scene');
        hud.setSceneStatus('Scene online');
        sceneDriving = true;
      },
      onProgress: follow,
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
    sceneDriving = false;
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
