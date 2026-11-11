import type { MotionMode, QualityMode, Store } from '../ui/motion';
import { bindCopy, bindToggle } from '../ui/hud';
import type { WineTelemetry } from './types';

export interface WineHud {
  setProgress(progress: number): void;
  setSceneStatus(text: string): void;
  setTelemetry(telemetry: WineTelemetry): void;
  setFound(found: boolean): void;
  hideCue(): void;
}

interface Options {
  motion: Store<MotionMode>;
  quality: Store<QualityMode>;
  email: string;
}

function query<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

export function initWineHud(options: Options): WineHud {
  bindToggle('data-motion-opt', options.motion);
  bindToggle('data-quality-opt', options.quality);
  bindCopy(options.email);

  const status = query<HTMLElement>('[data-scene-status]');
  const bar = query<HTMLElement>('[data-progress]');
  const cue = query<HTMLElement>('[data-cue]');
  const found = query<HTMLElement>('[data-found-count]');
  const tele = {
    depth: query<HTMLElement>('[data-tele="depth"]'),
    bottles: query<HTMLElement>('[data-tele="bottles"]'),
    layer: query<HTMLElement>('[data-tele="layer"]')
  };
  const last: Record<string, string | number> = { progress: -1 };
  const write = (el: HTMLElement | null, key: string, text: string) => {
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
    setSceneStatus(text) {
      write(status, 'scene', text);
    },
    setTelemetry(t) {
      write(tele.depth, 'depth', `${Math.max(0, t.depth).toFixed(2)} m`);
      write(tele.bottles, 'bottles', String(t.bottles));
      write(tele.layer, 'layer', t.layer);
    },
    setFound(isFound) {
      write(found, 'found', isFound ? '1 / 1' : '0 / 1');
    },
    hideCue() {
      cue?.classList.add('is-hidden');
    }
  };
}
