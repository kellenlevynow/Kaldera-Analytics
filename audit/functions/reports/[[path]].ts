// Access gate for every URL under /reports/. Fails closed: with no access mode
// configured, nothing under /reports/ is served.
//
//   REPORT_ACCESS_MODE=access  Cloudflare Access protects the path. The JWT
//                              Access attaches is verified here against the
//                              team's public keys, so a request that bypasses
//                              Access (or forges a header) is still refused.
//                              Needs ACCESS_TEAM_DOMAIN (e.g. kaldera.cloudflareaccess.com)
//                              and ACCESS_AUD (audience tags, comma-separated if several apps).
//   REPORT_ACCESS_MODE=basic   Per-report passphrases in REPORT_KEYS, a JSON
//                              object {"<slug>": "<passphrase>"}, checked with
//                              HTTP Basic auth. A stopgap until Access is set up.
//
// Secrets live in the Pages project's environment variables, never in the repo.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  REPORT_ACCESS_MODE?: string;
  REPORT_KEYS?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

const PRIVATE_HEADERS: Record<string, string> = {
  'cache-control': 'private, no-store, max-age=0',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'no-referrer'
};

function deny(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...PRIVATE_HEADERS, ...extra } });
}

function slugOf(url: URL): string | null {
  const m = url.pathname.match(/^\/reports\/([a-z0-9-]+)(\/|$)/);
  return m?.[1] ?? null;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let out = 0;
  for (let i = 0; i < ea.length; i++) out |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return out === 0;
}

async function basicAuth(request: Request, env: Env, slug: string): Promise<Response | null> {
  let keys: Record<string, string> = {};
  try { keys = JSON.parse(env.REPORT_KEYS ?? '{}'); } catch { return deny(500, 'Report access is misconfigured.'); }
  const expected = keys[slug];
  if (!expected) return deny(404, 'Not found.');
  const header = request.headers.get('authorization') ?? '';
  const challenge = { 'www-authenticate': 'Basic realm="Kaldera Analytics report", charset="UTF-8"' };
  if (!header.startsWith('Basic ')) return deny(401, 'Authentication required.', challenge);
  let decoded = '';
  try { decoded = atob(header.slice(6)); } catch { return deny(401, 'Authentication required.', challenge); }
  const password = decoded.slice(decoded.indexOf(':') + 1);
  if (!timingSafeEqual(password, expected)) return deny(401, 'Authentication required.', challenge);
  return null;
}

function b64url(input: string): Uint8Array<ArrayBuffer> {
  const s = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }

async function accessAuth(request: Request, env: Env): Promise<Response | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return deny(500, 'Report access is misconfigured.');
  const token = request.headers.get('cf-access-jwt-assertion') ?? request.headers.get('cookie')?.match(/CF_Authorization=([^;]+)/)?.[1];
  if (!token) return deny(403, 'Forbidden.');
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return deny(403, 'Forbidden.');
  let header: { kid?: string; alg?: string };
  let payload: { aud?: string | string[]; exp?: number; iss?: string; email?: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64url(h)));
    payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  } catch { return deny(403, 'Forbidden.'); }
  if (header.alg !== 'RS256' || !header.kid) return deny(403, 'Forbidden.');
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) return deny(403, 'Forbidden.');
  // ACCESS_AUD may list several applications (custom domain, pages.dev), comma-separated.
  const allowed = env.ACCESS_AUD.split(',').map((a) => a.trim()).filter(Boolean);
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.some((a) => typeof a === 'string' && allowed.includes(a))) return deny(403, 'Forbidden.');
  if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return deny(403, 'Forbidden.');
  const certs = await fetch(`https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
  if (!certs.ok) return deny(503, 'Could not verify access.');
  const { keys } = (await certs.json()) as { keys: Jwk[] };
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return deny(403, 'Forbidden.');
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  return ok ? null : deny(403, 'Forbidden.');
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const slug = slugOf(url);
  // No index of reports is ever served.
  if (!slug) return deny(404, 'Not found.');
  if (request.method !== 'GET' && request.method !== 'HEAD') return deny(405, 'Method not allowed.');

  const mode = env.REPORT_ACCESS_MODE;
  let refusal: Response | null;
  if (mode === 'access') refusal = await accessAuth(request, env);
  else if (mode === 'basic') refusal = await basicAuth(request, env, slug);
  else refusal = deny(403, 'Reports are not available.');
  if (refusal) return refusal;

  const asset = await env.ASSETS.fetch(request);
  const headers = new Headers(asset.headers);
  for (const [k, v] of Object.entries(PRIVATE_HEADERS)) headers.set(k, v);
  return new Response(asset.body, { status: asset.status, headers });
};
