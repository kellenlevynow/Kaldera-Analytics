import './styles/index.css';
import './styles/aerospace.css';
import { site } from './site.config';
import { motionStore } from './ui/motion';
import { initNav } from './ui/nav';
import { initMoments } from './ui/moments';
import { initAeroHud } from './aerospace/hud';
import { PART_COUNT, assemblyLabel, focusLabel, partAt, separationAt } from './aerospace/timeline';
import type { AeroSceneController } from './aerospace/types';

const html = document.documentElement;
html.classList.add('js');
if (new URLSearchParams(window.location.search).has('og')) html.classList.add('og');

const hud = initAeroHud({ email: site.email });
initNav();
const moments = initMoments();

// Scroll progress over the whole page. The journey is continuous, so progress
// is simply the scrolled fraction; the scene maps it onto the separation and the
// camera path and reports the camera's own progress back, which the text follows.
let maxScroll = 1;
let progress = 0;
let scene: AeroSceneController | null = null;
let sceneDriving = false;
let scrolled = false;
let seen = 0;

function follow(p: number): void {
  moments.set(p);
  const part = partAt(p);
  if (part && part.index > seen) {
    seen = part.index;
    hud.setSystems(seen, PART_COUNT);
  }
  // Without the scene the HUD still reads the journey from scroll alone.
  if (!sceneDriving) hud.setTelemetry({ assembly: assemblyLabel(p), focus: focusLabel(p), separation: separationAt(p) });
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
  if (!(canvas instanceof HTMLCanvasElement) || !supportsWebGL()) {
    html.classList.add('no-webgl');
    hud.setSceneStatus('Poster');
    return;
  }
  try {
    hud.setSceneStatus('Loading');
    const { createAeroScene } = await import('./aerospace/scene');
    scene = await createAeroScene({
      canvas,
      reduced: motionStore.get() === 'reduced',
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
    motionStore.subscribe((mode) => scene?.setReduced(mode === 'reduced'));
    Object.defineProperty(window, '__kaldera', { value: { diagnostics: () => scene?.diagnostics() ?? null, pause: () => scene?.pause(), resume: () => scene?.resume() }, configurable: true });
  } catch (error) {
    console.error('Scene failed to start, keeping the poster.', error);
    sceneDriving = false;
    html.classList.add('no-webgl');
    hud.setSceneStatus('Poster');
  }
}

// The Three.js chunk loads after first paint so the headline is the LCP element.
window.requestAnimationFrame(() => {
  window.requestAnimationFrame(() => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => void loadScene(), { timeout: 900 });
    } else {
      window.setTimeout(() => void loadScene(), 60);
    }
  });
});
