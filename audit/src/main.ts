// Public pages: measurement plan and inquiry form. Events are named so that
// interactions (cta click, form start) are never confused with the one
// completed conversion (inquiry submitted and accepted by the server).
const GA_ID = (import.meta.env.VITE_GA_ID as string | undefined) ?? 'G-G57RK7DHTP';

declare global {
  interface Window { dataLayer: unknown[]; gtag?: (...args: unknown[]) => void; }
}

function loadAnalytics(): void {
  if (!GA_ID || navigator.doNotTrack === '1') return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  // One GA4 property for both hostnames; the cookie is set on the root domain so
  // a visitor who arrives from the main site keeps one session.
  window.gtag('config', GA_ID, { cookie_domain: 'kaldera-analytics.com' });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
}

function track(name: string, params: Record<string, string | number | boolean> = {}): void {
  window.gtag?.('event', name, params);
}

// Source attribution: first-touch UTM and click ids for this session, copied
// into the inquiry so the CRM or webhook receives them with the lead.
const ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid'] as const;
function captureAttribution(): Record<string, string> {
  const key = 'kaldera_attr';
  let stored: Record<string, string> = {};
  try { stored = JSON.parse(sessionStorage.getItem(key) ?? '{}'); } catch { stored = {}; }
  const q = new URLSearchParams(location.search);
  const fresh: Record<string, string> = {};
  for (const k of ATTR_KEYS) { const v = q.get(k); if (v) fresh[k] = v.slice(0, 200); }
  if (Object.keys(fresh).length || !stored.landing_page) {
    stored = { ...stored, ...fresh, landing_page: stored.landing_page ?? location.origin + location.pathname, referrer: stored.referrer ?? document.referrer.slice(0, 300) };
    try { sessionStorage.setItem(key, JSON.stringify(stored)); } catch { /* storage unavailable */ }
  }
  return stored;
}

function wireCtas(): void {
  document.querySelectorAll<HTMLElement>('[data-cta]').forEach((el) => {
    el.addEventListener('click', () => track('audit_cta_click', { cta_location: el.dataset.cta ?? 'unknown', page_path: location.pathname }));
  });
}

function wireForm(): void {
  const form = document.querySelector<HTMLFormElement>('#inquiry');
  if (!form) return;
  const status = form.querySelector<HTMLElement>('[data-status]');
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  const attr = captureAttribution();
  for (const [k, v] of Object.entries(attr)) {
    const input = form.querySelector<HTMLInputElement>(`input[name="${k}"]`);
    if (input) input.value = v;
  }
  let started = false;
  form.addEventListener('focusin', (e) => {
    if (started || !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return;
    started = true;
    track('audit_inquiry_start', { form_id: 'inquiry' });
  });
  const say = (text: string, state: 'ok' | 'error' | '') => {
    if (!status) return;
    status.textContent = text;
    status.dataset.state = state;
  };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      say('Please complete the required fields.', 'error');
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries());
    if (button) button.disabled = true;
    say('Sending.', '');
    try {
      const res = await fetch('/api/inquiry', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
      if (res.ok) {
        // The only event that counts as a lead. No personal data goes to analytics.
        track('audit_inquiry_submit', { form_id: 'inquiry', utm_source: attr.utm_source ?? '(none)', utm_medium: attr.utm_medium ?? '(none)' });
        form.reset();
        say('Received. You will hear from us by email within two business days.', 'ok');
        return;
      }
      if (res.status === 503) {
        say('The inquiry service is not configured yet. Please email hello@kaldera-analytics.com and we will pick it up from there.', 'error');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      say(body.error ?? 'Something went wrong. Please email hello@kaldera-analytics.com instead.', 'error');
    } catch {
      say('Could not reach the server. Please email hello@kaldera-analytics.com instead.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  });
}

loadAnalytics();
captureAttribution();
wireCtas();
wireForm();
