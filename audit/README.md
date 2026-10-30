# Kaldera Funnel Audit

The Funnel Audit offering: a public landing page and methodology page, plus private,
access-controlled client reports rendered from structured data. Lives at
`audit.kaldera-analytics.com` as its own Cloudflare Pages project, separate from the
main site in `../kaldera`.

Stack: Vite (multi-page, static), TypeScript, Cloudflare Pages Functions for the
report access gate and the inquiry handler. No framework, no database.

## Layout

```
index.html                 public landing page
methodology.html           how the audit is run, confidence scale, access, report structure
src/main.ts                analytics events, attribution capture, inquiry form
src/report.ts              report page behaviour (section rail, print)
src/styles/                tokens (dark and paper surfaces), base, landing, report
src/data/<slug>.json       report data, one file per engagement (see src/data/schema.md)
src/data/private/          gitignored: report data that identifies a client
scripts/render-reports.mjs renders src/data/*.json to reports/<slug>/index.html
reports/                   build output of the renderer (gitignored)
functions/reports/[[path]].ts  access gate for /reports/*, fails closed
functions/api/inquiry.ts   validates and forwards inquiries to a webhook
public/_headers            CSP and privacy headers; /reports/* is no-store and noindex
```

## Scripts

```bash
npm install
npm run dev        # render reports, Vite dev server on http://localhost:5174 (no Functions)
npm run build      # render, tsc --noEmit, vite build into dist/
npm run preview    # serve dist/ on 4174 (static only, no Functions)
npm run pages:dev  # wrangler pages dev dist on 8788, with Functions and .dev.vars
```

For `pages:dev`, put local-only values in `.dev.vars` (gitignored), for example
`REPORT_ACCESS_MODE=basic` and `REPORT_KEYS={"sales-training-firm":"a-long-passphrase"}`.

## Reports

A report is a JSON file in `src/data/` (schema in `src/data/schema.md`). The renderer turns
it into a page under `/reports/<slug>/`, in the same section order every time: executive
summary, scope, method, funnel overview, findings, measurement, claims tested,
conclusions, recommendations and roadmap, open questions, standard, evidence index.
Sections absent from the data are left out.

Evidence files (screenshots, exports) are never committed or served. The evidence index
lists file names only. Inline references like `[E07]` link to the index.

This repository is public, so plain report data is never committed. Report JSON lives in
`src/data/private/` (gitignored). To ship a report, encrypt it into `src/data/encrypted/`
(committed) with a key that exists only in the Pages build environment:

```bash
node scripts/report-crypto.mjs keygen                      # once; store as REPORT_DATA_KEY (encrypted) in Pages
REPORT_DATA_KEY=... node scripts/report-crypto.mjs encrypt src/data/private/<slug>.json
```

`npm run build` decrypts every `.json.enc` when `REPORT_DATA_KEY` is set and renders the result.
Without the key, encrypted reports are skipped and the public pages still build. AES-256-GCM
with a random nonce per file; losing the key means re-encrypting from the plain JSON you hold.

## Access control for reports

`functions/reports/[[path]].ts` runs in front of every URL under `/reports/`. With no
configuration it refuses everything (403), so a fresh deploy never exposes a report.

Recommended: Cloudflare Access (Zero Trust, free for up to 50 users).

One command does the whole setup, including the Pages variables, with an API token that
has Access (apps, policies, identity providers) and Pages edit permissions:

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...   python3 scripts/setup-access.py --email client@example.com --team-email hello@example.com
```

Re-run it to change who can read reports. It also keeps the `kaldera-audit.pages.dev` host
and its preview deployments team-only, the way the proposals site is set up. Addresses are
passed on the command line and never stored in the repository. The manual equivalent:

1. Zero Trust dashboard, Access, Applications, Add an application, Self-hosted.
   Application domain `audit.kaldera-analytics.com`, path `reports`.
2. Policy: Allow, include Emails, list the client's addresses (and yours). Identity: One-time PIN is enough.
3. Copy the application's Audience (AUD) tag. In the Pages project set the environment
   variables `REPORT_ACCESS_MODE=access`, `ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com`,
   `ACCESS_AUD=<aud tag>`. Redeploy.
4. The function verifies the signed Access token on every request, so a request that
   reaches the origin without passing Access is still refused.

Stopgap: `REPORT_ACCESS_MODE=basic` with `REPORT_KEYS={"<slug>":"<passphrase>"}` gives each
report its own passphrase over HTTP Basic auth. Use a long random passphrase per client and
rotate it when the engagement ends.

Responses under `/reports/` carry `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`
and `Referrer-Policy: no-referrer`; `robots.txt` disallows the path; report pages carry
`noindex` meta and load no analytics.

## Inquiry form

`POST /api/inquiry` validates the fields, drops honeypot submissions, and forwards the lead
as JSON to `INQUIRY_WEBHOOK_URL` (a CRM form endpoint, Zapier or Make webhook, or a mailbox
relay), with `INQUIRY_WEBHOOK_TOKEN` as a bearer token if set. Until the URL is configured the
endpoint answers 503 and the page shows the email fallback. Nothing is stored at the edge.

Payload fields: name, email, company, website, model, problem, systems, utm_source,
utm_medium, utm_campaign, utm_content, utm_term, gclid, landing_page, referrer, country,
received_at, source, form.

## Measurement plan

One GA4 property (`G-G57RK7DHTP`, the same as the main site) with the cookie set on the root
domain, so a visitor who crosses from the main site keeps one session. Add
`audit.kaldera-analytics.com` to the web stream's cross-domain list is not required for
subdomains; add it to the stream's allowed referral exclusions only if self-referrals appear.

| Event | When | Type |
|---|---|---|
| `page_view` | Automatic | Interaction |
| `audit_cta_click` | Any element with `data-cta` is clicked (`cta_location`) | Interaction |
| `audit_inquiry_start` | First focus on an inquiry field | Interaction |
| `audit_inquiry_submit` | Server accepted the inquiry (2xx) | Conversion: mark as a key event in GA4 |
| `consultation_booked` | Reserved for the booking tool's confirmation page or webhook | Conversion, not yet wired |

Only `audit_inquiry_submit` should be marked as a key event. Clicks and form starts are never
counted as leads. No personal data is sent to analytics; `utm_source` and `utm_medium` ride on
the submit event as parameters. The report pages send nothing.

Verification: open GA4 DebugView, load the page with `?utm_source=test&utm_medium=qa`, click a
CTA, focus a field, submit a test inquiry with the webhook configured, and confirm one
`page_view`, one `audit_cta_click`, one `audit_inquiry_start`, one `audit_inquiry_submit`,
and that the webhook received the payload with the UTM values.

## Deploy

1. Cloudflare dashboard, Workers & Pages, Create, Pages, Connect to Git, pick this
   repository. Project name `kaldera-audit`. Production branch `main`.
2. Build settings: framework Vite (or None), root directory `audit`, build command
   `npm run build`, output directory `dist`, environment variable `NODE_VERSION=22`.
3. Environment variables (Production): `REPORT_ACCESS_MODE`, and either the Access
   variables or `REPORT_KEYS`; `INQUIRY_WEBHOOK_URL` (and token). Mark secrets as encrypted.
4. Custom domains, add `audit.kaldera-analytics.com`. The zone is on Cloudflare, so the
   CNAME is created automatically and TLS follows within minutes.
5. Configure Cloudflare Access as above, then verify: an unauthenticated request to a report
   URL returns 403 or the Access login; the landing page, methodology, `robots.txt`,
   `sitemap.xml` and an unknown URL (404) render; the inquiry form reaches the webhook.

Functions are bundled from `functions/` automatically by Pages; no wrangler deploy is needed.

## Writing rule

No em dashes anywhere: copy, comments, documentation, data.
