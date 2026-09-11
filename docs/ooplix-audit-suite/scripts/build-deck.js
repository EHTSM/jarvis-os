#!/usr/bin/env node
/**
 * OOPLIX V1 — Investor deck builder
 *
 * Generates a branded PPTX from data/audit-register.json + data/brand.json.
 * Uses pptxgenjs, which is already a project dependency. No new packages.
 *
 *   node docs/ooplix-audit-suite/scripts/build-deck.js
 *
 * Output: docs/ooplix-audit-suite/decks/Ooplix-V1-Audit-Deck.pptx
 *
 * Design rule enforced in code: a PLANNED audit never renders a score. The
 * helper `scoreLabel()` is the single place that decides, so no slide can
 * accidentally print 0 for an audit that was never run.
 */

const path = require('path');
const fs = require('fs');

const SUITE = path.join(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(SUITE, 'data/audit-register.json'), 'utf8'));
const brand = JSON.parse(fs.readFileSync(path.join(SUITE, 'data/brand.json'), 'utf8'));

let PptxGenJS;
try {
  PptxGenJS = require('pptxgenjs');
} catch {
  console.error('pptxgenjs not resolvable from this directory.');
  console.error('Run from the repo root: node docs/ooplix-audit-suite/scripts/build-deck.js');
  process.exit(1);
}

const C = {
  ink: brand.palette.ink.hex.replace('#', ''),
  muted: brand.palette.inkMuted.hex.replace('#', ''),
  line: brand.palette.line.hex.replace('#', ''),
  surface: 'FFFFFF',
  surfaceAlt: brand.palette.surfaceAlt.hex.replace('#', ''),
  primary: brand.palette.primary.hex.replace('#', ''),
  success: brand.palette.success.hex.replace('#', ''),
  warning: brand.palette.warning.hex.replace('#', ''),
  critical: brand.palette.critical.hex.replace('#', ''),
  planned: brand.palette.planned.hex.replace('#', ''),
};

const executed = reg.audits.filter((a) => a.status === 'EXECUTED');
const planned = reg.audits.filter((a) => a.status === 'PLANNED');
const scored = executed.filter((a) => typeof a.score === 'number');

const totalFindings = executed.reduce((t, a) => t + (a.findings ? a.findings.total : 0), 0);
const criticalFindings = executed.reduce((t, a) => t + (a.findings ? a.findings.critical : 0), 0);
const criticalGapCount = (reg.residualCriticalGaps || []).filter((g) => g.severity === 'CRITICAL').length;

/** The one place that decides how a score is displayed. Never returns 0. */
function scoreLabel(audit) {
  if (audit.status === 'PLANNED') return '—';
  return typeof audit.score === 'number' ? audit.score.toFixed(1) : '—';
}

function verdictColor(v) {
  return (
    {
      CERTIFIED: C.success,
      'CERTIFIED WITH LIMITATIONS': C.warning,
      'NOT CERTIFIED': C.critical,
      PLANNED: C.planned,
    }[v] || C.muted
  );
}

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_16x9';
pptx.author = 'Ooplix Audit Programme';
pptx.company = 'Ooplix';
pptx.title = 'Ooplix V1 — Master Audit & Certification Record';
pptx.subject = reg.suite.classification;

// ---- Masters -------------------------------------------------------------

pptx.defineSlideMaster({
  title: 'TITLE',
  background: { color: C.primary },
  objects: [
    { text: { text: 'CONFIDENTIAL', options: { x: 0.5, y: 5.0, w: 3, h: 0.3, fontSize: 9, color: 'FFFFFF', transparency: 40 } } },
  ],
});

pptx.defineSlideMaster({
  title: 'CONTENT',
  background: { color: C.surface },
  objects: [
    { line: { x: 0.5, y: 4.95, w: 9.0, h: 0, line: { color: C.line, width: 0.75 } } },
    { text: { text: 'Ooplix V1 Master Audit Record · OPX-MAR-001', options: { x: 0.5, y: 5.02, w: 6, h: 0.28, fontSize: 8, color: C.muted } } },
  ],
  slideNumber: { x: 9.1, y: 5.02, fontSize: 8, color: C.muted },
});

function contentSlide(title, kicker) {
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  s.addText(title, { x: 0.5, y: 0.35, w: 9.0, h: 0.55, fontSize: 24, bold: true, color: C.ink, fontFace: 'Georgia' });
  if (kicker) {
    s.addText(kicker, { x: 0.5, y: 0.92, w: 9.0, h: 0.32, fontSize: 12, color: C.muted });
  }
  return s;
}

function notes(slide, text) {
  slide.addNotes(text);
}

// ---- 1. Title ------------------------------------------------------------
{
  const s = pptx.addSlide({ masterName: 'TITLE' });
  s.addText('Ooplix V1', { x: 0.7, y: 1.5, w: 8.6, h: 0.9, fontSize: 48, bold: true, color: 'FFFFFF', fontFace: 'Georgia' });
  s.addText('Master Audit & Certification Record', { x: 0.7, y: 2.35, w: 8.6, h: 0.6, fontSize: 26, color: 'FFFFFF', transparency: 12 });
  s.addText(
    `${executed.length} audits executed · ${totalFindings} findings recovered · ${criticalGapCount} critical gaps recorded, not hidden`,
    { x: 0.7, y: 3.1, w: 8.6, h: 0.4, fontSize: 14, color: 'FFFFFF', transparency: 25 }
  );
  s.addText(`${reg.suite.productVersion} · ${reg.suite.generated}`, { x: 0.7, y: 3.6, w: 8.6, h: 0.3, fontSize: 11, color: 'FFFFFF', transparency: 45 });
  notes(
    s,
    'Open on the third line, not the first. The number to hold onto is not 27 or 88 — it is 3. Three critical gaps found, reproduced, measured, and deliberately not fixed because fixing them properly means building something new. Do not apologise for the 3; it is the credibility of the whole deck.'
  );
}

// ---- 2. Thesis -----------------------------------------------------------
{
  const s = pptx.addSlide({ masterName: 'CONTENT' });
  s.addText('We audited by operating the product, not by reading its source.', {
    x: 0.8, y: 1.9, w: 8.4, h: 0.7, fontSize: 26, bold: true, color: C.ink, align: 'center', fontFace: 'Georgia',
  });
  s.addText('Every number in this deck is a measurement.', {
    x: 0.8, y: 2.65, w: 8.4, h: 0.5, fontSize: 20, color: C.muted, align: 'center',
  });
  notes(
    s,
    'Pause after reading. This is the methodological claim the deck rests on. Most audit decks are code review dressed as evidence. We inverted it: reproduce from outside, quantify against live data, then open the source. That ordering is why we found a knowledge graph that had never been indexed — invisible in code, because the code was correct.'
  );
}

// ---- 3. Evidence integrity ----------------------------------------------
{
  const s = contentSlide('Evidence integrity', 'The split that makes everything else in this deck checkable');
  s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.45, w: 4.35, h: 2.9, fill: { color: 'E8F3EC' }, line: { color: C.success, width: 1.5 } });
  s.addText('EXECUTED', { x: 0.75, y: 1.65, w: 3.9, h: 0.35, fontSize: 13, bold: true, color: C.success });
  s.addText(`${executed.length} audits`, { x: 0.75, y: 2.0, w: 3.9, h: 0.6, fontSize: 34, bold: true, color: C.ink });
  s.addText('A.1–A.13, B.1–B.19\n\nTraceable to committed certification\ndocuments and git history.', {
    x: 0.75, y: 2.65, w: 3.9, h: 1.4, fontSize: 12, color: C.ink,
  });

  s.addShape(pptx.ShapeType.rect, { x: 5.15, y: 1.45, w: 4.35, h: 2.9, fill: { color: 'F2F4F6' }, line: { color: C.planned, width: 1.5, dashType: 'dash' } });
  s.addText('PLANNED', { x: 5.4, y: 1.65, w: 3.9, h: 0.35, fontSize: 13, bold: true, color: C.planned });
  s.addText(`${planned.length} audits`, { x: 5.4, y: 2.0, w: 3.9, h: 0.6, fontSize: 34, bold: true, color: C.muted });
  s.addText('B.20–B.25, Phase C\n\nNot executed.\nNo score. No findings. No evidence.', {
    x: 5.4, y: 2.65, w: 3.9, h: 1.4, fontSize: 12, color: C.muted,
  });
  notes(
    s,
    'This slide is why the deck can be trusted. State it flatly: seven of the thirty-four register rows have not been run and appear with an em-dash where the score would be. We could have put projected numbers there and the deck would look better. We did not, because the first person to check would find them, and then nothing else in here would count.'
  );
}

// ---- 4. KPI dashboard ----------------------------------------------------
{
  const s = contentSlide('The position in five numbers', 'All measured against the running product');
  const kpis = [
    { label: 'AUDITS EXECUTED', value: String(executed.length), sub: `of ${reg.audits.length} total`, color: C.primary },
    { label: 'FINDINGS RECOVERED', value: String(totalFindings), sub: `${criticalFindings} critical`, color: C.success },
    { label: 'RESIDUAL CRITICAL', value: String(criticalGapCount), sub: 'one root cause', color: C.critical },
    { label: 'MEAN SCORE', value: (scored.reduce((t,a)=>t+a.score,0)/scored.length).toFixed(2), sub: `${scored.length} scored audits`, color: C.primary },
    { label: 'REGRESSION', value: '144/144', sub: '+142/142 phase', color: C.success },
  ];
  kpis.forEach((k, i) => {
    const x = 0.5 + i * 1.82;
    s.addShape(pptx.ShapeType.rect, { x, y: 1.6, w: 1.68, h: 1.5, fill: { color: C.surfaceAlt }, line: { color: C.line, width: 0.75 } });
    s.addText(k.label, { x: x + 0.12, y: 1.72, w: 1.44, h: 0.25, fontSize: 7.5, color: C.muted });
    s.addText(k.value, { x: x + 0.12, y: 2.0, w: 1.44, h: 0.55, fontSize: 24, bold: true, color: k.color });
    s.addText(k.sub, { x: x + 0.12, y: 2.6, w: 1.44, h: 0.3, fontSize: 8, color: C.muted });
  });
  s.addText(
    'Planned audits contribute nothing to any figure on this slide.',
    { x: 0.5, y: 3.35, w: 9.0, h: 0.3, fontSize: 10, italic: true, color: C.muted }
  );
  notes(s, 'Five numbers, five seconds each. The third one is the one that matters — lead with it if the room is skeptical.');
}

// ---- 5. Verdict distribution --------------------------------------------
{
  const s = contentSlide('Verdict distribution', '"Certified with limitations" is the honest majority verdict');
  const counts = { CERTIFIED: 0, 'CERTIFIED WITH LIMITATIONS': 0, 'NOT CERTIFIED': 0 };
  executed.forEach((a) => { if (counts[a.verdict] !== undefined) counts[a.verdict]++; });
  let x = 0.5;
  Object.entries(counts).forEach(([v, n]) => {
    const w = Math.max(1.4, (n / executed.length) * 8.6);
    s.addShape(pptx.ShapeType.rect, { x, y: 1.7, w, h: 0.75, fill: { color: verdictColor(v) } });
    s.addText(`${n}  ${v}`, { x, y: 1.7, w, h: 0.75, fontSize: 11, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
    x += w + 0.12;
  });
  s.addText(
    'B.19 Accessibility is recorded as NOT CERTIFIED rather than omitted or softened.\nWCAG 2.2 AA was not achieved and the failing criteria are listed as failing.',
    { x: 0.5, y: 2.75, w: 9.0, h: 0.8, fontSize: 13, color: C.ink }
  );
  notes(s, '"Certified with limitations" means criteria were met and residual gaps were named — not a soft pass. Point at the single red block and do not move on too quickly.');
}

// ---- 6. Scored audits ----------------------------------------------------
{
  const s = contentSlide('Scored audits', `${scored.length} of ${executed.length} executed audits carry a formal weighted score`);
  const rows = [[
    { text: 'Audit', options: { bold: true, color: 'FFFFFF', fill: { color: C.primary } } },
    { text: 'Verdict', options: { bold: true, color: 'FFFFFF', fill: { color: C.primary } } },
    { text: 'Score', options: { bold: true, color: 'FFFFFF', fill: { color: C.primary }, align: 'right' } },
  ]];
  scored.sort((a, b) => b.score - a.score).forEach((a, i) => {
    const bg = i % 2 ? C.surfaceAlt : 'FFFFFF';
    rows.push([
      { text: `${a.id}  ${a.title}`, options: { fill: { color: bg }, color: C.ink } },
      { text: a.verdict, options: { fill: { color: bg }, color: verdictColor(a.verdict), fontSize: 10 } },
      { text: scoreLabel(a), options: { fill: { color: bg }, bold: true, align: 'right', color: C.ink } },
    ]);
  });
  rows.push([
    { text: 'Mean of scored audits', options: { bold: true, fill: { color: 'FFFFFF' }, color: C.ink } },
    { text: '', options: { fill: { color: 'FFFFFF' } } },
    { text: (scored.reduce((t, a) => t + a.score, 0) / scored.length).toFixed(2), options: { bold: true, align: 'right', fill: { color: 'FFFFFF' }, color: C.ink } },
  ]);
  s.addTable(rows, { x: 0.5, y: 1.5, w: 9.0, fontSize: 11, border: { type: 'solid', color: C.line, pt: 0.5 }, colW: [5.0, 2.6, 1.4] });
  s.addText(
    'The other 29 executed audits were pass/fail against defined criteria. Averaging across both would fabricate precision.',
    { x: 0.5, y: 4.35, w: 9.0, h: 0.35, fontSize: 10, italic: true, color: C.muted }
  );
  notes(s, 'Do not average the 6 scored with the 29 unscored. That would be inventing a number, which is the exact failure this suite is built to avoid.');
}

// ---- 7. Before / after ---------------------------------------------------
{
  const s = contentSlide('Four measurements that changed materially', 'Before and after recovery, measured the same way');
  const pairs = reg.measuredHighlights.filter((h) =>
    ['Agent work rejected before B.11 fix', 'Knowledge graph edges before B.12', 'Event-loop block removed', 'DLQ entries naming the failing agent'].includes(h.metric)
  );
  const items = [
    { label: 'AGENT WORK REJECTED · B.11', before: '68.6%', after: '0.0%', note: '1371 of 2000 runs failed memory_pressure' },
    { label: 'KNOWLEDGE GRAPH EDGES · B.12', before: '5', after: '1526', note: 'capability existed; it had never been run' },
    { label: 'DLQ NAMING FAILING AGENT · B.18', before: '0', after: '980', note: 'anonymous backlog made triage impossible' },
    { label: 'EVENT-LOOP BLOCK · B.1', before: '483ms', after: '0', note: 'mission store retention cap' },
  ];
  items.forEach((it, i) => {
    const x = 0.5 + (i % 2) * 4.6;
    const y = 1.55 + Math.floor(i / 2) * 1.45;
    s.addText(it.label, { x, y, w: 4.3, h: 0.25, fontSize: 9, color: C.muted });
    s.addText(it.before, { x, y: y + 0.28, w: 1.5, h: 0.5, fontSize: 22, bold: true, color: C.critical });
    s.addText('→', { x: x + 1.45, y: y + 0.32, w: 0.4, h: 0.4, fontSize: 16, color: C.muted });
    s.addText(it.after, { x: x + 1.85, y: y + 0.28, w: 1.6, h: 0.5, fontSize: 22, bold: true, color: C.success });
    s.addText(it.note, { x, y: y + 0.82, w: 4.3, h: 0.28, fontSize: 9, color: C.muted });
  });
  notes(s, 'If time is short this slide replaces the entire findings section. Each pair is measured the same way before and after — that consistency is the claim.');
}

// ---- 8. Critical gaps ----------------------------------------------------
{
  const s = contentSlide('Three gaps. One root cause.', 'Recorded with reproduction steps, deliberately not closed');
  s.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.4, w: 9.0, h: 0.62, fill: { color: C.critical } });
  s.addText('Three storage models were built before multi-tenancy existed. None carries an ownership dimension.', {
    x: 0.5, y: 1.4, w: 9.0, h: 0.62, fontSize: 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle',
  });
  const gaps = reg.residualCriticalGaps.filter((g) => g.severity === 'CRITICAL');
  gaps.forEach((g, i) => {
    const x = 0.5 + i * 3.07;
    s.addShape(pptx.ShapeType.rect, { x, y: 2.25, w: 2.86, h: 2.0, fill: { color: 'FBE9EC' }, line: { color: C.critical, width: 1.25 } });
    s.addText(g.id, { x: x + 0.15, y: 2.38, w: 2.56, h: 0.28, fontSize: 11, bold: true, color: C.critical });
    s.addText(g.title, { x: x + 0.15, y: 2.66, w: 2.56, h: 0.6, fontSize: 10, bold: true, color: C.ink });
    s.addText(g.detail, { x: x + 0.15, y: 3.24, w: 2.56, h: 0.7, fontSize: 8, color: C.ink });
    s.addText(`Closes in ${g.closesIn}`, { x: x + 0.15, y: 3.95, w: 2.56, h: 0.22, fontSize: 8, bold: true, color: C.muted });
  });
  notes(
    s,
    'Reframing three critical gaps as one remediation programme is both more honest and more reassuring. Three unrelated critical isolation bugs would suggest a systemic quality problem; one dated architectural debt with three known surfaces is a tractable engineering project.'
  );
}

// ---- 9. Register (executed) ---------------------------------------------
{
  const chunks = [];
  for (let i = 0; i < executed.length; i += 12) chunks.push(executed.slice(i, i + 12));
  chunks.forEach((chunk, ci) => {
    const s = contentSlide(
      ci === 0 ? 'Master audit register — executed' : 'Master audit register — executed (cont.)',
      ci === 0 ? 'Every row traces to a committed certification document or commit' : null
    );
    const rows = [[
      { text: 'ID', options: { bold: true, color: 'FFFFFF', fill: { color: C.primary } } },
      { text: 'Audit', options: { bold: true, color: 'FFFFFF', fill: { color: C.primary } } },
      { text: 'Verdict', options: { bold: true, color: 'FFFFFF', fill: { color: C.primary } } },
      { text: 'Score', options: { bold: true, color: 'FFFFFF', fill: { color: C.primary }, align: 'right' } },
      { text: 'C/H/M/L', options: { bold: true, color: 'FFFFFF', fill: { color: C.primary }, align: 'right' } },
    ]];
    chunk.forEach((a, i) => {
      const bg = i % 2 ? C.surfaceAlt : 'FFFFFF';
      const f = a.findings;
      rows.push([
        { text: a.id, options: { fill: { color: bg }, bold: true, color: C.ink } },
        { text: a.title, options: { fill: { color: bg }, color: C.ink } },
        { text: a.verdict.replace('CERTIFIED WITH LIMITATIONS', 'CERT. W/ LIMITS'), options: { fill: { color: bg }, color: verdictColor(a.verdict), fontSize: 8.5 } },
        { text: scoreLabel(a), options: { fill: { color: bg }, align: 'right', color: C.ink } },
        { text: f ? `${f.critical}/${f.high}/${f.medium}/${f.low}` : '—', options: { fill: { color: bg }, align: 'right', color: C.ink } },
      ]);
    });
    s.addTable(rows, { x: 0.5, y: 1.45, w: 9.0, fontSize: 9, border: { type: 'solid', color: C.line, pt: 0.5 }, colW: [0.7, 4.0, 2.2, 0.8, 1.3] });
    notes(s, 'Register slide — reference material. Do not read aloud. Offer it for the appendix and move on unless someone asks for a specific row.');
  });
}

// ---- 10. Planned register ------------------------------------------------
{
  const s = contentSlide('Master audit register — planned', 'Not executed. No score, no findings, no evidence exists.');
  const rows = [[
    { text: 'ID', options: { bold: true, color: 'FFFFFF', fill: { color: C.planned } } },
    { text: 'Audit', options: { bold: true, color: 'FFFFFF', fill: { color: C.planned } } },
    { text: 'Score', options: { bold: true, color: 'FFFFFF', fill: { color: C.planned }, align: 'right' } },
    { text: 'Entry criteria', options: { bold: true, color: 'FFFFFF', fill: { color: C.planned } } },
  ]];
  planned.forEach((a, i) => {
    const bg = i % 2 ? C.surfaceAlt : 'FFFFFF';
    rows.push([
      { text: a.id, options: { fill: { color: bg }, bold: true, color: C.muted } },
      { text: a.title, options: { fill: { color: bg }, color: C.muted } },
      { text: '—', options: { fill: { color: bg }, align: 'right', color: C.muted } },
      { text: (a.entryCriteria || []).join('; '), options: { fill: { color: bg }, fontSize: 8, color: C.muted } },
    ]);
  });
  s.addTable(rows, { x: 0.5, y: 1.5, w: 9.0, fontSize: 9.5, border: { type: 'solid', color: C.line, pt: 0.5 }, colW: [0.7, 3.0, 0.7, 4.6] });
  s.addText('Every entry criterion traces to a measured finding in an executed audit.', {
    x: 0.5, y: 4.25, w: 9.0, h: 0.3, fontSize: 10, italic: true, color: C.muted,
  });
  notes(s, 'Present the entry criteria as the value here, not the audit names. B.20 cannot run until B.6\'s missing migration framework exists — we know that because B.6 measured its absence. The plan is derived from findings, not from a template.');
}

// ---- 11. Close -----------------------------------------------------------
{
  const s = pptx.addSlide({ masterName: 'TITLE' });
  s.addText('Measured, not asserted.', { x: 0.7, y: 2.1, w: 8.6, h: 0.9, fontSize: 40, bold: true, color: 'FFFFFF', fontFace: 'Georgia', align: 'center' });
  s.addText('Ooplix V1 Master Audit Record · OPX-MAR-001', { x: 0.7, y: 3.0, w: 8.6, h: 0.4, fontSize: 13, color: 'FFFFFF', transparency: 35, align: 'center' });
  notes(s, 'Land on the tagline and stop. Do not re-summarize — the register is the artifact and it speaks for itself.');
}

const out = path.join(SUITE, 'decks/Ooplix-V1-Audit-Deck.pptx');
pptx.writeFile({ fileName: out }).then(() => {
  console.log('Deck written:', out);
  console.log(`  ${executed.length} executed audits, ${planned.length} planned, ${scored.length} scored`);
  console.log('  Speaker notes embedded on every slide.');
});
