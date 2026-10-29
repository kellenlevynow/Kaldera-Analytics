import './styles/index.css';
import { site } from './site.config';
import { motionStore, qualityStore } from './ui/motion';
import { initHud } from './ui/hud';
import { initReveals } from './ui/reveal';
import type { SceneController } from './scene/types';

const html = document.documentElement;
html.classList.add('js');
if (new URLSearchParams(window.location.search).has('og')) html.classList.add('og');

const hud = initHud({ motion: motionStore, quality: qualityStore, email: site.email, portfolioUrl: site.portfolioUrl });
const reveals = initReveals(() => motionStore.get() === 'reduced');
motionStore.subscribe(() => reveals.rebuild());

// Scroll progress. Keyframe k lands exactly at the top of section k, so the
// camera path and the traverse bar stay aligned with the content even when a
// section grows taller than one viewport.
const sections = Array.from(document.querySelectorAll<HTMLElement>('section[data-index]'));
let tops: number[] = [];
let maxScroll = 1;
let progress = 0;
let activeIndex = 0;
let scene: SceneController | null = null;
let scrolled = false;

function measure(): void {
  const scrollY = window.scrollY;
  tops = sections.map((s) => s.getBoundingClientRect().top + scrollY);
  maxScroll = Math.max(1, html.scrollHeight - window.innerHeight);
  update();
}

function update(): void {
  const y = Math.min(Math.max(window.scrollY, 0), maxScroll);
  const n = tops.length;
  let p = 0;
  let active = 0;
  if (n > 1) {
    let k = 0;
    while (k < n - 1 && y >= (tops[k + 1] ?? Infinity)) k++;
    const start = tops[k] ?? 0;
    const end = k < n - 1 ? (tops[k + 1] ?? maxScroll) : maxScroll;
    const local = end > start ? Math.min(1, Math.max(0, (y - start) / (end - start))) : 1;
    p = (k + (k < n - 1 ? local : local)) / (n - 1);
    p = Math.min(1, p);
    // Active beat: the one occupying the middle of the viewport.
    const mid = y + window.innerHeight * 0.5;
    active = 0;
    for (let i = 0; i < n; i++) if ((tops[i] ?? 0) <= mid) active = i;
  }
  progress = p;
  activeIndex = active;
  hud.setProgress(progress);
  hud.setActive(activeIndex);
  scene?.setProgress(progress);
  scene?.setActive(activeIndex);
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
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
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
    const { createScene } = await import('./scene/index');
    scene = await createScene({
      canvas,
      motion: motionStore,
      quality: qualityStore,
      onOnline() {
        canvas.classList.add('is-online');
        html.classList.add('has-scene');
        hud.setSceneStatus('Scene online');
      },
      onTelemetry: hud.setTelemetry,
      initialProgress: progress,
      initialActive: activeIndex,
      onTier(tier, staticMode) {
        html.dataset.tier = tier;
        if (staticMode) html.dataset.static = 'true';
        else delete html.dataset.static;
      }
    });
    scene.setProgress(progress);
    scene.setActive(activeIndex);
    Object.defineProperty(window, '__kaldera', { value: { diagnostics: () => scene?.diagnostics() ?? null }, configurable: true });
  } catch (error) {
    console.error('Scene failed to start, keeping the poster.', error);
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
