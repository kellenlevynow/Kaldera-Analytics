// Captions scrubbed by scroll: each fades in through the top of its beat and out through the bottom.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initCaptions(): () => void {
  const triggers: ScrollTrigger[] = [];
  for (const caption of gsap.utils.toArray<HTMLElement>('[data-caption]')) {
    const beat = caption.closest<HTMLElement>('.beat') ?? caption;
    const tl = gsap.timeline({ paused: true });
    tl.fromTo(caption, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.35, ease: 'none' })
      .to(caption, { opacity: 1, duration: 0.3, ease: 'none' })
      .to(caption, { opacity: 0, y: -14, duration: 0.35, ease: 'none' });
    triggers.push(
      ScrollTrigger.create({
        trigger: beat,
        start: 'top 70%',
        end: 'bottom 30%',
        scrub: 0.4,
        animation: tl
      })
    );
  }
  return () => triggers.forEach((t) => t.kill());
}
