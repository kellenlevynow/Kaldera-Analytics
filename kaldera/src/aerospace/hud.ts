import { bindCopy } from '../ui/hud';
import type { AeroTelemetry } from './types';

export interface AeroHud {
  setProgress(progress: number): void;
  setSceneStatus(text: string): void;
  setTelemetry(telemetry: AeroTelemetry): void;
  setSystems(seen: number, total: number): void;
  hideCue(): void;
}

interface Options {
  email: string;
}

function query<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

export function initAeroHud(options: Options): AeroHud {
  bindCopy(options.email);

  const status = query<HTMLElement>('[data-scene-status]');
  const bar = query<HTMLElement>('[data-progress]');
  const cue = query<HTMLElement>('[data-cue]');
  const systems = query<HTMLElement>('[data-systems]');
  const tele = {
    assembly: query<HTMLElement>('[data-tele="assembly"]'),
    focus: query<HTMLElement>('[data-tele="focus"]'),
    separation: query<HTMLElement>('[data-tele="separation"]')
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
      write(tele.assembly, 'assembly', t.assembly);
      write(tele.focus, 'focus', t.focus);
      write(tele.separation, 'separation', `${String(Math.round(t.separation * 100)).padStart(3, '0')} %`);
    },
    setSystems(seen, total) {
      write(systems, 'systems', `${String(seen).padStart(2, '0')} / ${String(total).padStart(2, '0')}`);
    },
    hideCue() {
      cue?.classList.add('is-hidden');
    }
  };
}
