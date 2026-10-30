// Inquiry handler. Validates the form, drops obvious spam, forwards the lead
// to the configured webhook (CRM, Zapier, Make, a mailbox relay) and answers
// 503 until INQUIRY_WEBHOOK_URL is set, so the page can show the email fallback.
// Nothing is logged or stored here.

interface Env { INQUIRY_WEBHOOK_URL?: string; INQUIRY_WEBHOOK_TOKEN?: string }

const FIELDS = ['name', 'email', 'company', 'website', 'model', 'problem', 'systems', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'landing_page', 'referrer'] as const;
const REQUIRED = ['name', 'email', 'company', 'model', 'problem'] as const;
const LIMITS: Record<string, number> = { model: 4000, problem: 4000, systems: 500 };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.INQUIRY_WEBHOOK_URL) return json(503, { ok: false, configured: false, error: 'Inquiry service not configured.' });
  const type = request.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return json(415, { ok: false, error: 'Send JSON.' });
  if (Number(request.headers.get('content-length') ?? 0) > 32_000) return json(413, { ok: false, error: 'Too large.' });
  let raw: Record<string, unknown>;
  try { raw = (await request.json()) as Record<string, unknown>; } catch { return json(400, { ok: false, error: 'Invalid JSON.' }); }
  // Honeypot: real visitors never see this field.
  if (typeof raw.url2 === 'string' && raw.url2.trim()) return json(200, { ok: true });

  const lead: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = raw[f];
    if (typeof v === 'string') lead[f] = v.trim().slice(0, LIMITS[f] ?? 300);
  }
  for (const f of REQUIRED) if (!lead[f]) return json(400, { ok: false, error: 'Please complete the required fields.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email ?? '')) return json(400, { ok: false, error: 'Please enter a valid email address.' });

  const payload = { source: 'audit.kaldera-analytics.com', form: 'inquiry', received_at: new Date().toISOString(), country: request.headers.get('cf-ipcountry') ?? '', ...lead };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (env.INQUIRY_WEBHOOK_TOKEN) headers.authorization = `Bearer ${env.INQUIRY_WEBHOOK_TOKEN}`;
  const forward = await fetch(env.INQUIRY_WEBHOOK_URL, { method: 'POST', headers, body: JSON.stringify(payload) }).catch(() => null);
  if (!forward || !forward.ok) return json(502, { ok: false, error: 'Could not deliver the inquiry. Please email hello@kaldera-analytics.com.' });
  return json(200, { ok: true });
};

export const onRequestGet: PagesFunction<Env> = async () => json(405, { ok: false, error: 'Method not allowed.' });
