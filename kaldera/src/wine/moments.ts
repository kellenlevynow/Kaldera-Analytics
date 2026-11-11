// The text of the journey. Each moment is fixed at the centre of the screen and
// its opacity follows the camera's progress through the pile, so the words stay
// in step with what is on screen however the visitor scrolls.
export interface Moments {
  set(progress: number): void;
}

interface Item {
  el: HTMLElement;
  from: number;
  to: number;
  scrim: number;
  shown: number;
  shift: number;
}

const FADE = 0.013;
const SHIFT = 14;

export function initMoments(): Moments {
  const items: Item[] = Array.from(document.querySelectorAll<HTMLElement>('.moment[data-from]')).map((el) => ({
    el,
    from: Number(el.dataset.from),
    to: Number(el.dataset.to),
    scrim: Number(el.dataset.scrim ?? 1),
    shown: -1,
    shift: 0
  }));
  const scrim = document.querySelector<HTMLElement>('.scrim');
  const spot = document.querySelector<HTMLElement>('.spot-close');
  let scrimShown = -1;
  let spotShown = -1;

  return {
    set(progress) {
      let shade = 0;
      for (const item of items) {
        const rise = item.from < 0 ? 1 : (progress - item.from) / FADE;
        const fall = item.to > 1 ? 1 : (item.to - progress) / FADE;
        const t = Math.min(1, Math.max(0, Math.min(rise, fall)));
        const a = t * t * (3 - 2 * t);
        // Enters from slightly below, leaves slightly above: the direction of travel.
        const shift = Math.round((rise < fall ? 1 - a : a - 1) * SHIFT * 10) / 10;
        const rounded = Math.round(a * 100) / 100;
        if (rounded !== item.shown) {
          item.shown = rounded;
          item.el.style.opacity = String(rounded);
          item.el.classList.toggle('is-live', rounded > 0.5);
        }
        if (shift !== item.shift) {
          item.shift = shift;
          item.el.style.setProperty('--shift', `${shift}px`);
        }
        shade = Math.max(shade, a * item.scrim);
      }
      const rounded = Math.round(shade * 100) / 100;
      if (scrim && rounded !== scrimShown) {
        scrimShown = rounded;
        scrim.style.opacity = String(rounded);
      }
      // The pool of light draws in as the camera settles over the bottle.
      const t = Math.min(1, Math.max(0, (progress - 0.8) / 0.06));
      const pool = Math.round(t * t * (3 - 2 * t) * 100) / 100;
      if (spot && pool !== spotShown) {
        spotShown = pool;
        spot.style.opacity = String(pool);
      }
    }
  };
}
