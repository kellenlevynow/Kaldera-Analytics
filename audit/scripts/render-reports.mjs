// Renders every report in src/data/*.json (and src/data/private/*.json when
// present) to reports/<slug>/index.html. Pure template, no runtime framework.
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDirs = [resolve(root, 'src/data'), resolve(root, 'src/data/private')];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Inline markup: `code`, **strong**, [E07] or [E07, E08] evidence refs.
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[(E\d{2}(?:\s*(?:,|to)\s*E\d{2})*)\]/g, (_, refs) =>
      '[' + refs.split(/\s*(,|to)\s*/).map((t) => (/^E\d{2}$/.test(t) ? `<a class="evref" href="#${t}">${t}</a>` : t === ',' ? ', ' : ' to ')).join('') + ']'
    );
const para = (arr) => (arr ?? []).map((p) => `<p>${inline(p)}</p>`).join('');
const badge = (level, label) => `<span class="badge" data-level="${esc(level)}">${esc(label ?? 'Confidence ' + level)}</span>`;
const verdict = (v) => `<span class="badge" data-verdict="${esc(v)}">${esc(v)}</span>`;
const section = (id, idx, title, body) => `<section class="rs" id="${id}"><p class="eyebrow"><span class="idx">[ ${idx} ]</span>${esc(title)}</p>${body}</section>`;

function render(d) {
  const m = d.meta;
  const toc = [];
  let i = 0;
  const idx = () => String(i++).padStart(2, '0');
  const parts = [];
  const add = (id, title, body) => { const n = idx(); toc.push({ id, n, title }); parts.push(section(id, n, title, body)); };

  // 00 Executive summary
  const s = d.summary;
  add('summary', 'Executive summary', `
    <h2>${esc(s.heading)}</h2>
    <p class="lead">${inline(s.lead)}</p>
    <div class="prose">${para(s.paragraphs)}</div>
    <div class="summary-grid">
      <div><h3>The business</h3><p>${inline(s.business)}</p></div>
      <div><h3>The symptom</h3><p>${inline(s.symptom)}</p></div>
      <div><h3>The finding</h3><p>${inline(s.finding)}</p></div>
    </div>
    <dl class="kv">${(s.stats ?? []).map((r) => `<div><dt>${esc(r.label)}</dt><dd>${inline(r.value)}</dd></div>`).join('')}</dl>
    ${s.direction ? `<div class="direction"><h3>Recommended direction</h3><p>${inline(s.direction)}</p></div>` : ''}`);

  // 01 Scope
  if (d.scope) {
    const sc = d.scope;
    add('scope', 'Engagement scope', `
      <h2>${esc(sc.heading ?? 'Where the numbers came from')}</h2>
      <div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Source</th><th>What it gave us</th><th>Access</th></tr></thead>
      <tbody>${sc.sources.map((r) => `<tr><td>${esc(r.id)}</td><td>${esc(r.source)}</td><td>${inline(r.gave)}</td><td>${inline(r.access)}</td></tr>`).join('')}</tbody></table></div>
      <div class="prose" style="margin-top:1.5rem"><p><strong>Could not open:</strong> ${inline(sc.couldNotOpen)}</p>${sc.note ? `<p>${inline(sc.note)}</p>` : ''}</div>`);
  }

  // 02 Method
  if (d.method) add('method', 'Method', `<h2>How the investigation was run</h2><ol class="steps">${d.method.map((x) => `<li><div><strong>${inline(x.step)}</strong>${x.detail ? `<span>${inline(x.detail)}</span>` : ''}</div></li>`).join('')}</ol>`);

  // 03 Funnel
  if (d.funnel) {
    add('funnel', 'Funnel overview', `<h2>${esc(d.funnel.heading)}</h2>
      <div class="funnel">${d.funnel.stages.map((st) => `<div class="stage" data-state="${esc(st.state)}"><h3>${esc(st.name)}</h3><span class="state">${esc(st.state)}</span><p>${inline(st.note)}</p></div>`).join('')}</div>
      <div class="legend"><span><i></i>Measured</span><span><i class="partial"></i>Partly measured</span><span><i class="unmeasured"></i>Not measured</span><span><i class="broken"></i>Broken path</span></div>`);
  }

  // 04 Findings
  if (d.findings) {
    add('findings', 'Findings', `<h2>What the data says</h2>${d.findings.map((f) => `
      <article class="finding" id="finding-${esc(f.id)}">
        <div class="fnum">F${esc(f.id)}</div>
        <div>
          <h3>${inline(f.title)}</h3>
          <div class="prose">${para(f.paragraphs)}</div>
          <div class="finding-foot">
            ${f.implication ? `<div class="implication"><h4>What it means for the business</h4><p>${inline(f.implication)}</p></div>` : ''}
            <div class="conf"><h4>Confidence</h4>${badge(f.confidence.level, 'Confidence ' + f.confidence.level)} <p>${inline(f.confidence.note)}</p></div>
            ${f.evidence?.length ? `<div class="conf"><h4>Evidence</h4><div class="evrefs">${f.evidence.map((e) => `<a class="evref" href="#${esc(e)}">${esc(e)}</a>`).join('')}</div></div>` : ''}
          </div>
        </div>
      </article>`).join('')}`);
  }

  // 05 Measurement and data quality
  if (d.measurement || d.reconciliation) {
    let body = '<h2>Measurement and data quality</h2>';
    if (d.measurement) body += `<h3 class="display-h3" style="margin-bottom:1rem">${esc(d.measurement.heading)}</h3><div class="table-wrap"><table class="table"><thead><tr><th>The report said</th><th>What we can now say</th><th>What it masked</th></tr></thead><tbody>${d.measurement.rows.map((r) => `<tr><td>${inline(r.said)}</td><td>${inline(r.now)}</td><td>${inline(r.masked)}</td></tr>`).join('')}</tbody></table></div>`;
    if (d.reconciliation) body += `<h3 class="display-h3" style="margin:2.5rem 0 1rem">${esc(d.reconciliation.heading)}</h3><div class="table-wrap"><table class="table"><thead><tr><th>Figure</th><th>Source A</th><th>Source B</th><th>Verdict</th></tr></thead><tbody>${d.reconciliation.rows.map((r) => `<tr><td>${inline(r.figure)}</td><td>${inline(r.a)}</td><td>${inline(r.b)}</td><td>${inline(r.verdict)}</td></tr>`).join('')}</tbody></table></div>`;
    add('measurement', 'Measurement', body);
  }

  // 06 Claims tested and changes
  if (d.claims || d.changes) {
    let body = `<h2>${esc(d.claims?.heading ?? 'Claims tested')}</h2>`;
    if (d.claims) body += d.claims.items.map((c) => `<article class="claim"><h3>${inline(c.claim)}</h3><div class="meta">${verdict(c.verdict)}${badge(c.confidence, 'Confidence ' + c.confidence)}</div><p>${inline(c.body)}</p></article>`).join('');
    if (d.changes) body += `<h3 class="display-h3" style="margin:2.5rem 0 1rem">${esc(d.changes.heading)}</h3><div class="table-wrap"><table class="table"><thead><tr><th>First-pass claim</th><th>Now</th><th>Why</th></tr></thead><tbody>${d.changes.rows.map((r) => `<tr><td>${inline(r.claim)}</td><td>${verdict(r.status)}</td><td>${inline(r.why)}</td></tr>`).join('')}</tbody></table></div>${d.changes.summary ? `<p class="prose" style="margin-top:1.25rem"><strong>${inline(d.changes.summary)}</strong></p>` : ''}`;
    add('claims', 'Claims tested', body);
  }

  // 07 Conclusions
  if (d.conclusions) add('conclusions', 'Conclusions', `<h2>What we conclude</h2><ol class="conclusions">${d.conclusions.map((c) => `<li><p>${inline(c.text)}</p>${badge(c.confidence, c.confidence)}</li>`).join('')}</ol>`);

  // 08 Recommendations and roadmap
  if (d.recommendations) {
    const r = d.recommendations;
    const phases = ['immediate', 'next', 'later'];
    const head = `<div class="rec-head"><span>#</span><span>Fix</span><span>Requires</span><span>Settles</span></div>`;
    const row = (x) => `<div class="rec"><div class="n">${esc(x.n)}</div><div class="fix">${inline(x.fix)}</div><div><span class="k">Requires</span><span class="v">${inline(x.requires)}</span></div><div><span class="k">Settles</span><span class="v">${inline(x.settles)}</span></div></div>`;
    let body = `<h2>${esc(r.heading)}</h2><p class="prose">The order matters. Each step either establishes a fact the next one depends on, or stops a leak that would distort the measurement that follows.</p>`;
    for (const p of phases) {
      const items = r.items.filter((x) => (x.phase ?? 'immediate') === p);
      if (!items.length) continue;
      body += `<div class="phase"><h3>${esc(r.phases?.[p] ?? p)}</h3>${head}${items.map(row).join('')}</div>`;
    }
    add('recommendations', 'Recommendations and roadmap', body);
  }

  // 09 Open questions
  if (d.openQuestions) add('open', 'Open questions', `<h2>${esc(d.openQuestions.heading)}</h2><div class="table-wrap"><table class="table"><thead><tr><th>Unknown</th><th>What would settle it</th></tr></thead><tbody>${d.openQuestions.rows.map((r) => `<tr><td>${inline(r.unknown)}</td><td>${inline(r.settles)}</td></tr>`).join('')}</tbody></table></div>`);

  // 10 Closing
  if (d.closing) add('standard', 'Standard', `<h2>${esc(d.closing.heading)}</h2><div class="closing"><p class="lead">${inline(d.closing.paragraphs[0])}</p><div class="prose">${para(d.closing.paragraphs.slice(1))}</div></div>`);

  // 11 Evidence index
  if (d.evidence) add('evidence', 'Evidence index', `<h2>Evidence index</h2>${d.evidence.note ? `<p class="prose" style="margin-bottom:1.25rem">${inline(d.evidence.note)}</p>` : ''}<div class="table-wrap"><table class="table"><thead><tr><th>Ref</th><th>What it shows</th><th>File</th></tr></thead><tbody>${d.evidence.rows.map((r) => `<tr id="${esc(r.ref)}"><td>${esc(r.ref)}</td><td>${inline(r.shows)}</td><td>${esc(r.file)}</td></tr>`).join('')}</tbody></table></div>`);

  const meta = [
    ['Prepared by', `${m.author}, ${m.org}`],
    ['Date', m.date],
    ['Version', m.version + (m.supersedes ? `, supersedes ${m.supersedes}` : '')],
    ['Status', m.status],
    ['Location', m.location]
  ];

  return `<!doctype html>
<html lang="en" data-surface="paper">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${esc(m.title)} | Kaldera Analytics</title>
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <meta name="referrer" content="no-referrer" />
    <meta name="color-scheme" content="light" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/src/styles/tokens.css" />
    <link rel="stylesheet" href="/src/styles/base.css" />
    <link rel="stylesheet" href="/src/styles/report.css" />
  </head>
  <body>
    <a class="skip" href="#summary">Skip to the summary</a>
    <header class="top">
      <a class="wordmark" href="/" aria-label="Kaldera Analytics"><span class="wordmark-name">KALDERA</span><span class="wordmark-sub">Analytics</span></a>
      <nav class="top-nav" aria-label="Report"><span class="label">${esc(m.status)}</span><button type="button" class="btn" data-print>Print or save PDF</button></nav>
    </header>
    <div class="report">
      <nav class="report-rail" aria-label="Report sections">${toc.map((t) => `<a href="#${t.id}"><span>${t.n}</span><span>${esc(t.title)}</span></a>`).join('')}</nav>
      <main class="report-body" id="main">
        <header class="report-cover">
          <p class="eyebrow"><span class="idx">Funnel audit</span>${esc(m.clientLabel)}</p>
          <h1>${esc(m.title)}</h1>
          <p class="sub">${esc(m.subtitle)}</p>
          <dl class="report-meta">${meta.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
          <p class="confidential">${esc(m.confidentiality)}</p>
        </header>
        ${parts.join('\n')}
        <footer class="report-foot"><span>${esc(m.org)}. ${esc(m.location)}. Marketing and revenue systems.</span><span>Diagnostic revised ${esc(m.date)}. Figures as of the windows stated in the summary and scope.</span></footer>
      </main>
    </div>
    <script type="module" src="/src/report.ts"></script>
  </body>
</html>`;
}

let count = 0;
for (const dir of dataDirs) {
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const data = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
    const out = resolve(root, 'reports', data.meta.slug);
    mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, 'index.html'), render(data));
    count++;
    console.log(`rendered reports/${data.meta.slug}/index.html`);
  }
}
if (!count) console.log('no reports to render');
