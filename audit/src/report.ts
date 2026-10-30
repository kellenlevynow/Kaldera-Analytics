// Report page behaviour: highlight the current section in the rail. No
// analytics on confidential reports by design.
const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.report-rail a'));
const sections = links.map((a) => document.querySelector<HTMLElement>(a.getAttribute('href') ?? '')).filter((s): s is HTMLElement => s !== null);
if ('IntersectionObserver' in window && sections.length) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${e.target.id}`));
      }
    },
    { rootMargin: '-20% 0px -70% 0px' }
  );
  sections.forEach((s) => io.observe(s));
}
document.querySelector<HTMLButtonElement>('[data-print]')?.addEventListener('click', () => window.print());
