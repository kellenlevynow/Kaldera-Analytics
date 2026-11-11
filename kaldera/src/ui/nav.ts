// Primary navigation. On wide screens the items sit in the header; below the
// collapse width (see hud.css) a Menu button opens them as a panel.
export function initNav(): void {
  const html = document.documentElement;
  const toggle = document.querySelector<HTMLButtonElement>('.nav-toggle');
  const nav = document.getElementById('primary-nav');
  if (!toggle || !nav) return;
  const openLabel = toggle.textContent?.trim() || 'Menu';
  const closeLabel = 'Close';
  const isOpen = () => html.classList.contains('nav-open');

  const set = (open: boolean, moveFocus = true) => {
    html.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? closeLabel : openLabel;
    if (!moveFocus) return;
    if (open) nav.querySelector<HTMLElement>('a')?.focus();
    else toggle.focus();
  };

  toggle.addEventListener('click', () => set(!isOpen()));
  nav.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a')) set(false, false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) set(false);
  });
  const wide = window.matchMedia('(min-width: 901px)');
  wide.addEventListener('change', (event) => {
    if (event.matches && isOpen()) set(false, false);
  });
}
