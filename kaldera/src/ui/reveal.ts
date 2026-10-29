import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export interface Reveals {
  rebuild(): void;
  refresh(): void;
}

const EASE = 'power4.out';

function heroIntro(hero: HTMLElement, reduced: boolean): gsap.core.Timeline {
  // Individual items, never .hud-right: a transform on it would make the fixed
  // SYS panel position against it on small screens.
  const hudItems = gsap.utils.toArray<HTMLElement>('.hud-top .wordmark, .hud-top .hud-status, .hud-top .sys-group, .hud-top .hud-cta, .rail');
  const bottom = gsap.utils.toArray<HTMLElement>('.hud-bottom > *');
  const lines = gsap.utils.toArray<HTMLElement>('.line-inner', hero);
  const dek = hero.querySelector<HTMLElement>('.dek');
  const eyebrow = hero.querySelector<HTMLElement>('.eyebrow');
  const meta = hero.querySelector<HTMLElement>('.hero-meta');
  const cue = hero.querySelector<HTMLElement>('.cue');

  hero.classList.add('is-shown');
  const tl = gsap.timeline({ defaults: { ease: EASE } });

  if (reduced) {
    tl.set([hudItems, bottom, lines, dek, eyebrow, meta, cue], { clearProps: 'transform' })
      .fromTo([hudItems, bottom, eyebrow, lines, dek, meta, cue], { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none', stagger: 0.02 });
    return tl;
  }

  tl.fromTo(hudItems, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.06 }, 0)
    .fromTo(eyebrow, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.8 }, 0.25)
    .fromTo(lines, { yPercent: 110, y: 0 }, { yPercent: 0, y: 0, duration: 1.3, stagger: 0.09 }, 0.3)
    .fromTo(dek, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 1.0 }, 0.9)
    .fromTo(meta, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.9 }, 1.05)
    .fromTo(bottom, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.08 }, 1.2)
    .fromTo(cue, { opacity: 0 }, { opacity: 1, duration: 0.8 }, 1.6);
  return tl;
}

function nodeReveal(section: HTMLElement, reduced: boolean): gsap.core.Timeline {
  const eyebrow = section.querySelector<HTMLElement>('.eyebrow');
  const lines = gsap.utils.toArray<HTMLElement>('.line-inner', section);
  const dek = section.querySelector<HTMLElement>('.dek');
  const rows = gsap.utils.toArray<HTMLElement>('.spec-row, .channel, .colophon', section);
  const tl = gsap.timeline({ paused: true, defaults: { ease: EASE } });

  if (reduced) {
    tl.set(lines, { clearProps: 'transform' })
      .fromTo([eyebrow, lines, dek, rows], { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none', stagger: 0.02 });
    return tl;
  }

  tl.fromTo(eyebrow, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.7 }, 0)
    .fromTo(lines, { yPercent: 110, y: 0 }, { yPercent: 0, y: 0, duration: 1.2, stagger: 0.09 }, 0.05)
    .fromTo(dek, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.9 }, 0.3)
    .fromTo(rows, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.8, stagger: 0.07 }, 0.45);
  return tl;
}

export function initReveals(isReduced: () => boolean): Reveals {
  let timelines: gsap.core.Timeline[] = [];
  let triggers: ScrollTrigger[] = [];

  const build = () => {
    const reduced = isReduced();
    const hero = document.querySelector<HTMLElement>('.beat-hero');
    if (hero) timelines.push(heroIntro(hero, reduced));

    const sections = gsap.utils.toArray<HTMLElement>('.beat-node, .beat-close');
    for (const section of sections) {
      const tl = nodeReveal(section, reduced);
      timelines.push(tl);
      triggers.push(
        ScrollTrigger.create({
          trigger: section,
          start: 'top 65%',
          onEnter: () => {
            section.classList.add('is-shown');
            tl.play();
          },
          onLeaveBack: () => {
            tl.reverse();
          }
        })
      );
    }
  };

  const teardown = () => {
    triggers.forEach((t) => t.kill());
    timelines.forEach((tl) => tl.kill());
    triggers = [];
    timelines = [];
  };

  build();

  return {
    rebuild() {
      teardown();
      gsap.set('.line-inner, .fade, .hud-top .wordmark, .hud-top .hud-status, .hud-top .sys-group, .hud-top .hud-cta, .hud-bottom > *, .rail', { clearProps: 'all' });
      build();
      ScrollTrigger.refresh();
    },
    refresh() {
      ScrollTrigger.refresh();
    }
  };
}
