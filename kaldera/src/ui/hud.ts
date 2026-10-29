import type { MotionMode, QualityMode, Store } from './motion';

export interface Telemetry {
  alt: number; // kilometres above the terrain
  hdg: number; // degrees, 0 to 360
  sun: number; // sun elevation in degrees
  temp: number; // kelvin at the look-at point
}

export interface Hud {
  setProgress(progress: number): void;
  setActive(index: number): void;
  setSceneStatus(text: string): void;
  setTelemetry(telemetry: Telemetry): void;
  hideCue(): void;
}

interface HudOptions {
  motion: Store<MotionMode>;
  quality: Store<QualityMode>;
  email: string;
  portfolioUrl: string;
}

function query<T extends Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

function bindToggle<T extends string>(attribute: string, store: Store<T>): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(`[${attribute}]`));
  const render = (value: T) => {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.getAttribute(attribute) === value));
    }
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const next = button.getAttribute(attribute) as T | null;
      if (next) store.set(next);
    });
  }
  render(store.get());
  store.subscribe(render);
}

function bindCopy(email: string): void {
  const button = query<HTMLButtonElement>('[data-copy-email]');
  const link = query<HTMLAnchorElement>('[data-site-email]');
  if (link) {
    link.href = `mailto:${email}`;
    link.textContent = email;
  }
  if (!button) return;
  const idle = button.textContent ?? 'Copy';
  let timer = 0;
  const done = (ok: boolean) => {
    button.textContent = ok ? 'Copied' : 'Select to copy';
    button.setAttribute('aria-pressed', ok ? 'true' : 'false');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      button.textContent = idle;
      button.removeAttribute('aria-pressed');
    }, 1800);
  };
  button.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(email);
        done(true);
        return;
      }
    } catch {
      // Fall through to the selection fallback.
    }
    if (link) {
      const range = document.createRange();
      range.selectNodeContents(link);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      done(ok);
    }
  });
}

export function initHud(options: HudOptions): Hud {
  bindToggle('data-motion-opt', options.motion);
  bindToggle('data-quality-opt', options.quality);
  bindCopy(options.email);

  const portfolio = query<HTMLAnchorElement>('[data-site-portfolio]');
  if (portfolio) portfolio.href = options.portfolioUrl;

  const railLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.rail-link'));
  const sections = Array.from(document.querySelectorAll<HTMLElement>('section[data-index]'));
  const activeNode = query<HTMLElement>('[data-active-node]');
  const status = query<HTMLElement>('[data-scene-status]');
  const bar = query<HTMLElement>('[data-progress]');
  const cue = query<HTMLElement>('[data-cue]');
  const tele = {
    alt: query<HTMLElement>('[data-tele="alt"]'),
    hdg: query<HTMLElement>('[data-tele="hdg"]'),
    sun: query<HTMLElement>('[data-tele="sun"]'),
    temp: query<HTMLElement>('[data-tele="temp"]')
  };
  const last = { alt: '', hdg: '', sun: '', temp: '', active: -1, progress: -1 };

  const write = (el: HTMLElement | null, key: keyof typeof tele, text: string) => {
    if (!el || last[key] === text) return;
    last[key] = text;
    el.textContent = text;
  };

  return {
    setProgress(progress) {
      if (!bar) return;
      const value = Math.round(progress * 1000) / 1000;
      if (value === last.progress) return;
      last.progress = value;
      bar.style.transform = `scaleX(${value})`;
    },
    setActive(index) {
      if (index === last.active) return;
      last.active = index;
      railLinks.forEach((link, i) => {
        const active = i === index;
        link.classList.toggle('is-active', active);
        if (active) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
      const section = sections[index];
      if (activeNode && section) {
        activeNode.textContent = `[ ${String(index).padStart(2, '0')} ] ${section.dataset.node ?? ''}`;
      }
    },
    setSceneStatus(text) {
      if (status) status.textContent = text;
    },
    setTelemetry(t) {
      write(tele.alt, 'alt', `${t.alt.toFixed(1)} km`);
      write(tele.hdg, 'hdg', `${String(Math.round(((t.hdg % 360) + 360) % 360)).padStart(3, '0')}°`);
      write(tele.sun, 'sun', `${t.sun.toFixed(1)}°`);
      write(tele.temp, 'temp', `${Math.round(t.temp)} K`);
    },
    hideCue() {
      cue?.classList.add('is-hidden');
    }
  };
}
