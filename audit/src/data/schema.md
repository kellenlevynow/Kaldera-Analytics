# Report data model

One JSON file per engagement in `src/data/`. The renderer (`scripts/render-reports.mjs`)
turns it into `reports/<slug>/index.html`, which Vite builds and the access gate in
`functions/reports/[[path]].ts` protects. Every section is optional except `meta`
and `summary`; omit what the engagement does not need.

| Key | What it holds |
|---|---|
| `meta` | slug, title, subtitle, clientLabel (anonymised), date, version, supersedes, author, org, location, confidentiality, status |
| `summary` | lead (the one-paragraph thesis), paragraphs, `stats` (label/value rows), `headline` findings list, `direction` |
| `scope` | `window`, `sources` (id, source, gave, access), `couldNotOpen`, `note` |
| `method` | ordered steps |
| `funnel` | stages, each with `state`: measured, partial, unmeasured, broken |
| `findings` | id, title, confidence (`level`, `note`), paragraphs, `implication`, `evidence` refs |
| `measurement` | rows: said, now, masked |
| `reconciliation` | rows: figure, a, b, verdict |
| `claims` | load-bearing claims tested: claim, verdict (confirmed, softened, overturned), body, confidence |
| `changes` | first-pass claim, status, why |
| `conclusions` | text, confidence |
| `recommendations` | n, fix, requires, settles, phase (immediate, next, later), priority |
| `openQuestions` | unknown, settles |
| `evidence` | ref, shows, file (file names only; the files themselves are never served) |
| `closing` | heading, paragraphs |

Confidence levels: `high`, `moderate`, `low`, `none`, `unknown`. Verdicts: `confirmed`,
`softened`, `overturned`. Evidence references are written `[E07]` inside text and are
rendered as links to the evidence index.

Data that identifies a client belongs in `src/data/private/` (gitignored) or in a
private repository; this repository is public.
