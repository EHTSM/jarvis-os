#!/usr/bin/env node
/**
 * OOPLIX V1 — Enterprise PDF report builder
 *
 * Renders the register + report structure into a branded A4 PDF using
 * playwright-core, which is already a project dependency. No new packages.
 *
 *   node docs/ooplix-audit-suite/scripts/build-pdf.js
 *
 * Output: docs/ooplix-audit-suite/reports/Ooplix-V1-Audit-Report.pdf
 *
 * If no Chromium binary is available to playwright-core, the script writes the
 * intermediate HTML and exits 0 with an explanation rather than failing — the
 * HTML prints to PDF correctly from any browser.
 */

const fs = require('fs');
const path = require('path');

const SUITE = path.join(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(SUITE, 'data/audit-register.json'), 'utf8'));
const brand = JSON.parse(fs.readFileSync(path.join(SUITE, 'data/brand.json'), 'utf8'));

const executed = reg.audits.filter((a) => a.status === 'EXECUTED');
const planned = reg.audits.filter((a) => a.status === 'PLANNED');
const scored = executed.filter((a) => typeof a.score === 'number');
const ei = reg.evidenceIntegrity;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Single decision point for score display. Never emits 0 for an unscored audit. */
const scoreCell = (a) => (a.status === 'PLANNED' || typeof a.score !== 'number' ? '&mdash;' : a.score.toFixed(1));

const verdictClass = (v) =>
  ({
    CERTIFIED: 'v-cert',
    'CERTIFIED WITH LIMITATIONS': 'v-lim',
    'NOT CERTIFIED': 'v-not',
    PLANNED: 'v-plan',
  }[v] || '');

function registerRows(list) {
  return list
    .map((a) => {
      const f = a.findings;
      return `<tr class="${a.status === 'PLANNED' ? 'planned-row' : ''}">
        <td class="mono b">${esc(a.id)}</td>
        <td>${esc(a.title)}</td>
        <td>${a.date ? esc(a.date) : '&mdash;'}</td>
        <td class="${verdictClass(a.verdict)}">${esc(a.verdict)}</td>
        <td class="num mono">${scoreCell(a)}</td>
        <td class="num mono">${f ? `${f.critical}/${f.high}/${f.medium}/${f.low}` : '&mdash;'}</td>
        <td class="sm">${esc(a.headline)}</td>
      </tr>`;
    })
    .join('\n');
}

const gapRows = (reg.residualCriticalGaps || [])
  .map(
    (g) => `<tr>
      <td class="mono b">${esc(g.id)}</td>
      <td class="mono">${esc(g.phase)}</td>
      <td class="sev-${g.severity.toLowerCase()}">${esc(g.severity)}</td>
      <td>${esc(g.title)}</td>
      <td class="sm">${esc(g.detail)}</td>
      <td class="sm">${esc(g.reasonOpen)}</td>
      <td class="mono">${esc(g.closesIn)}</td>
    </tr>`
  )
  .join('\n');

const highlightRows = reg.measuredHighlights
  .map(
    (h) => `<tr>
      <td>${esc(h.metric)}</td>
      <td class="num mono b">${esc(h.value)}</td>
      <td class="sm">${esc(h.detail)}</td>
      <td class="mono">${esc(h.phase)}</td>
    </tr>`
  )
  .join('\n');

const P = brand.palette;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Ooplix V1 — Master Audit &amp; Certification Report</title>
<style>
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.5 Georgia, 'Times New Roman', serif; color: ${P.ink.hex}; margin: 0; }
  h1,h2,h3 { font-family: -apple-system,'Segoe UI',Inter,system-ui,sans-serif; font-weight: 600; color: ${P.ink.hex}; }
  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 22pt 0 6pt; padding-bottom: 4pt; border-bottom: 1.5pt solid ${P.primary.hex}; page-break-after: avoid; }
  h3 { font-size: 11.5pt; margin: 14pt 0 4pt; page-break-after: avoid; }
  .mono { font-family: 'SF Mono','Cascadia Code',Menlo,Consolas,monospace; font-size: 9pt; }
  .b { font-weight: 700; }
  .num { text-align: right; }
  .sm { font-size: 8.5pt; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0 14pt; font-size: 9pt; page-break-inside: auto; }
  th { background: ${P.primary.hex}; color: #fff; text-align: left; padding: 5pt 6pt; font-family: -apple-system,'Segoe UI',sans-serif; font-size: 8.5pt; }
  td { padding: 4pt 6pt; border-bottom: 0.5pt solid ${P.line.hex}; vertical-align: top; }
  tr:nth-child(even) td { background: ${P.surfaceAlt.hex}; }
  tr { page-break-inside: avoid; }
  .planned-row td { color: ${P.planned.hex}; font-style: italic; border-bottom: 0.75pt dashed ${P.planned.hex}; }
  .v-cert { color: ${P.success.hex}; font-weight: 600; }
  .v-lim  { color: ${P.warning.hex}; font-weight: 600; }
  .v-not  { color: ${P.critical.hex}; font-weight: 700; }
  .v-plan { color: ${P.planned.hex}; }
  .sev-critical { color: ${P.critical.hex}; font-weight: 700; }
  .sev-high { color: ${P.warning.hex}; font-weight: 600; }
  .sev-medium { color: ${P.gold.hex}; font-weight: 600; }
  .cover { height: 247mm; display: flex; flex-direction: column; justify-content: center; page-break-after: always; }
  .cover .band { height: 6pt; background: ${P.primary.hex}; margin-bottom: 18pt; }
  .cover h1 { font-family: Georgia, serif; font-size: 30pt; }
  .cover .sub { font-size: 15pt; color: ${P.inkMuted.hex}; margin: 6pt 0 24pt; }
  .cover .meta { font-size: 10pt; color: ${P.inkMuted.hex}; line-height: 1.9; }
  .chip { display: inline-block; background: ${P.critical.hex}; color: #fff; padding: 3pt 9pt; font-size: 8.5pt; letter-spacing: .06em; font-family: sans-serif; }
  .panel { border: 1pt solid ${P.line.hex}; background: ${P.surfaceAlt.hex}; padding: 10pt 12pt; margin: 10pt 0; }
  .panel.alert { border-color: ${P.critical.hex}; background: #FBE9EC; }
  .kpis { display: flex; gap: 8pt; margin: 12pt 0; }
  .kpi { flex: 1; border: 1pt solid ${P.line.hex}; padding: 8pt; }
  .kpi .l { font-size: 7.5pt; color: ${P.inkMuted.hex}; font-family: sans-serif; letter-spacing: .04em; }
  .kpi .v { font-size: 19pt; font-weight: 700; font-family: sans-serif; }
  .kpi .s { font-size: 7.5pt; color: ${P.inkMuted.hex}; }
  .pagebreak { page-break-before: always; }
  footer { font-size: 8pt; color: ${P.inkMuted.hex}; }
</style></head><body>

<div class="cover">
  <div class="band"></div>
  <div class="chip">CONFIDENTIAL — INVESTOR / ENTERPRISE DUE DILIGENCE</div>
  <h1>Ooplix V1</h1>
  <div class="sub">Master Audit &amp; Certification Report</div>
  <div class="meta">
    <strong>Document ID</strong> OPX-RPT-001<br>
    <strong>Product</strong> ${esc(reg.suite.product)} (<span class="mono">${esc(reg.suite.repository)}</span>) ${esc(reg.suite.productVersion)}<br>
    <strong>Date of record</strong> ${esc(reg.suite.generated)}<br>
    <strong>Branch of record</strong> <span class="mono">${esc(reg.suite.branch)}</span><br>
    <strong>Version</strong> ${esc(reg.suite.version)} &middot; Retention: permanent certification record
  </div>
</div>

<h2>Statement of Evidence Integrity</h2>
<div class="panel">
  <p style="margin-top:0">${esc(ei.statement)}</p>
  <p style="margin-bottom:0"><strong>Register note.</strong> ${esc(ei.registerRowNote)}</p>
</div>
<table>
  <tr><th>Class</th><th class="num">Count</th><th>Meaning</th></tr>
  <tr><td><strong>EXECUTED</strong></td><td class="num b">${ei.executedCount}</td><td>Performed against the running product. Every figure traces to a committed certification document or a git commit.</td></tr>
  <tr><td><strong>PLANNED</strong></td><td class="num b">${ei.plannedCount}</td><td><strong>Not executed.</strong> Scope forecast only. No score, no findings, no evidence.</td></tr>
</table>

<h2>Executive Summary</h2>
<div class="kpis">
  <div class="kpi"><div class="l">EXECUTED</div><div class="v" style="color:${P.primary.hex}">${ei.executedCount}</div><div class="s">of ${ei.totalRows} rows</div></div>
  <div class="kpi"><div class="l">FINDINGS</div><div class="v" style="color:${P.success.hex}">${ei.findingsTotal}</div><div class="s">${ei.findingsBySeverity.critical} critical</div></div>
  <div class="kpi"><div class="l">RESIDUAL CRITICAL</div><div class="v" style="color:${P.critical.hex}">3</div><div class="s">one root cause</div></div>
  <div class="kpi"><div class="l">MEAN SCORE</div><div class="v" style="color:${P.primary.hex}">${ei.meanScoreOfScored.toFixed(2)}</div><div class="s">${ei.scoredCount} scored</div></div>
  <div class="kpi"><div class="l">REGRESSION</div><div class="v" style="color:${P.success.hex}">144/144</div><div class="s">+142/142 phase</div></div>
</div>
<p>The executed portfolio is strong on runtime integrity, isolation at the API boundary, recovery, and AI honesty. It is weak in three named places: tenant ownership in engines built before multi-tenancy (3 critical gaps), accessibility (1 audit recorded NOT CERTIFIED), and API surface consistency (response envelope 5.0/10, SDK readiness 5.5/10). None of these were discovered by users or external auditors &mdash; all were found, reproduced, and documented by the programme itself.</p>

<div class="panel alert">
  <strong>Three residual CRITICAL gaps remain open.</strong> All three are tenant-ownership gaps in storage models built without an ownership dimension. They share a root cause and should be treated as one remediation programme, not three tickets.
</div>

<h2 class="pagebreak">Master Audit Register &mdash; Executed</h2>
<table>
  <tr><th>ID</th><th>Audit</th><th>Date</th><th>Verdict</th><th class="num">Score</th><th class="num">C/H/M/L</th><th>Headline finding</th></tr>
  ${registerRows(executed)}
</table>

<h2>Master Audit Register &mdash; Planned</h2>
<p class="sm"><em>These audits have not been executed. No score, finding count, or evidence exists for any row below.</em></p>
<table>
  <tr><th>ID</th><th>Audit</th><th>Date</th><th>Verdict</th><th class="num">Score</th><th class="num">C/H/M/L</th><th>Forecast scope</th></tr>
  ${registerRows(planned)}
</table>

<h2 class="pagebreak">Residual Gap Register</h2>
<p>A <strong>defect</strong> is a broken capability that exists; it was recovered. A <strong>gap</strong> is a capability that was never built; it was recorded with reproduction steps and a reason for remaining open.</p>
<table>
  <tr><th>Gap</th><th>Phase</th><th>Severity</th><th>Title</th><th>Measured detail</th><th>Why open</th><th>Closes in</th></tr>
  ${gapRows}
</table>

<h2>Measured Highlights</h2>
<table>
  <tr><th>Metric</th><th class="num">Value</th><th>Detail</th><th>Source</th></tr>
  ${highlightRows}
</table>

<h2>Scored Audits</h2>
<table>
  <tr><th>Audit</th><th>Verdict</th><th class="num">Score</th></tr>
  ${scored.sort((a, b) => b.score - a.score).map((a) => `<tr><td class="mono b">${esc(a.id)}</td><td class="${verdictClass(a.verdict)}">${esc(a.verdict)}</td><td class="num mono b">${a.score.toFixed(1)}</td></tr>`).join('\n')}
  <tr><td colspan="2"><strong>Mean of scored audits</strong></td><td class="num mono b">${ei.meanScoreOfScored.toFixed(2)}</td></tr>
</table>
<p class="sm"><em>Only ${ei.scoredCount} of ${ei.executedCount} executed audits produced weighted dimension scores. The remainder were pass/fail against defined criteria. Averaging across both would fabricate precision.</em></p>

<h2>Change Control</h2>
<table>
  <tr><th>Version</th><th>Date</th><th>Change</th></tr>
  <tr><td class="mono">1.0.0</td><td class="mono">${esc(reg.suite.generated)}</td><td>Initial register. ${ei.executedCount} executed audits recorded from committed evidence; ${ei.plannedCount} planned audits recorded without scores.</td></tr>
</table>
<div class="panel">
  <strong>Amendment rules.</strong> A PLANNED row may only move to EXECUTED when accompanied by a committed certification document containing measured evidence. Scores may not be added to a PLANNED row under any circumstance. A NOT CERTIFIED verdict may not be revised without a new dated audit.
</div>

<footer><hr style="border:none;border-top:0.5pt solid ${P.line.hex};margin:16pt 0 6pt">
Ooplix V1 Master Audit &amp; Certification Report &middot; OPX-RPT-001 &middot; ${esc(reg.suite.classification)}
</footer>
</body></html>`;

const htmlPath = path.join(SUITE, 'reports/Ooplix-V1-Audit-Report.html');
fs.writeFileSync(htmlPath, html);
console.log('HTML written:', htmlPath);

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch {
    console.log('\nplaywright-core not resolvable. Print the HTML to PDF from any browser.');
    return;
  }
  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    console.log('\nNo Chromium binary available to playwright-core:', err.message.split('\n')[0]);
    console.log('The HTML above prints to a correct A4 PDF from any browser (Cmd-P → Save as PDF).');
    return;
  }
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const pdfPath = path.join(SUITE, 'reports/Ooplix-V1-Audit-Report.pdf');
  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: true,
    margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div style="font-size:7pt;color:#4A5C6D;width:100%;padding:0 16mm">OPX-RPT-001 · Ooplix V1 Master Audit Report</div>',
    footerTemplate:
      '<div style="font-size:7pt;color:#4A5C6D;width:100%;padding:0 16mm;display:flex;justify-content:space-between"><span>CONFIDENTIAL</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
  });
  await browser.close();
  console.log('PDF written:', pdfPath);
})();
