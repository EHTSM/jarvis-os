#!/usr/bin/env node
/**
 * OOPLIX V1 — Critical Findings Dossier builder
 *
 *   node docs/ooplix-audit-suite/scripts/build-findings-dossier.js
 *
 * Extracts the CRITICAL findings verbatim from the committed PHASE_B*.md
 * certifications and assembles register/CRITICAL_FINDINGS_DOSSIER.md.
 *
 * This is the document technical due diligence actually reads: for each
 * critical finding, the reproduction, the measured evidence, the root cause
 * with file references, the fix, and the negative-tested regression.
 *
 * Design decision: the finding bodies are COPIED, not paraphrased. A dossier
 * that restates measurements in the author's own words re-introduces exactly
 * the transcription risk the audit method was built to avoid. If the text here
 * disagrees with the certification, the certification wins — and this script
 * regenerates rather than being hand-edited.
 *
 * B.1 is deliberately absent: it is commit-evidenced only, with no
 * certification document to extract from. Its critical finding is recorded in
 * the register with its commit SHA.
 */

const fs = require('fs');
const path = require('path');

const SUITE = path.join(__dirname, '..');
const REPO = path.join(SUITE, '..', '..');
const reg = JSON.parse(fs.readFileSync(path.join(SUITE, 'data/audit-register.json'), 'utf8'));

/** Section boundary: next same-or-higher heading, so a finding never absorbs its siblings. */
function extractFindings(txt) {
  const out = [];
  const re = /^### ((?:F|D)\d+) — (.+?)$/gm;
  const hits = [];
  let m;
  while ((m = re.exec(txt)) !== null) hits.push({ id: m[1], title: m[2], start: m.index, bodyStart: re.lastIndex });

  hits.forEach((h, i) => {
    // Stop at the next ### / ## / # heading, whichever comes first.
    const rest = txt.slice(h.bodyStart);
    const nextHeading = rest.search(/^#{1,3} /m);
    const body = (nextHeading === -1 ? rest : rest.slice(0, nextHeading)).trim();
    out.push({ id: h.id, title: h.title, body });
  });
  return out;
}

const files = fs
  .readdirSync(REPO)
  .filter((f) => /^PHASE_B\d+_.*CERTIFICATION\.md$/.test(f))
  .sort((a, b) => {
    const n = (s) => parseInt(s.match(/PHASE_B(\d+)/)[1], 10);
    return n(a) - n(b);
  });

const critical = [];
const high = [];

files.forEach((file) => {
  const txt = fs.readFileSync(path.join(REPO, file), 'utf8');
  const pm = txt.match(/^# Phase (B\.\d+(?:\.\d+)*) — (.+?)$/m);
  const phase = pm ? pm[1] : file;
  const phaseName = pm ? pm[2] : '';

  extractFindings(txt).forEach((f) => {
    const sev = /CRITICAL/.test(f.title) ? 'CRITICAL' : /HIGH/.test(f.title) ? 'HIGH' : 'MEDIUM';
    const rec = {
      phase,
      phaseName,
      artifact: file,
      id: f.id,
      title: f.title.replace(/\s*\(\*\*.+?\*\*\)\s*$/, '').trim(),
      severity: sev,
      body: f.body,
    };
    if (sev === 'CRITICAL') critical.push(rec);
    else if (sev === 'HIGH') high.push(rec);
  });
});

/**
 * Order by numeric segment, not parseFloat: "19.2.3" parses as 19.2, which
 * ties B.19.2.2 with B.19.2.3 and orders sub-phases arbitrarily.
 */
const phaseSegs = (p) => p.replace('B.', '').split('.').map(Number);
const phaseCmp = (a, b) => {
  const x = phaseSegs(a), y = phaseSegs(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
};
critical.sort((a, b) => phaseCmp(a.phase, b.phase));
high.sort((a, b) => phaseCmp(a.phase, b.phase));

// --- Commit-only criticals (no certification document) ---------------------
const certPhases = new Set(critical.concat(high).map((r) => r.phase));
const commitOnly = reg.audits.filter(
  (a) => a.status === 'EXECUTED' && a.findings && a.findings.critical > 0 && !certPhases.has(a.id)
);

const testRefs = [];
critical.concat(high).forEach((r) => {
  const m = r.body.match(/`(tests\/[^`]+)`\s*—\s*(\d+) tests/);
  const neg = r.body.match(/Negative-tested:?\*{0,2}\s*(\d+) fail/i);
  if (m) testRefs.push({ phase: r.phase, id: r.id, file: m[1], count: +m[2], negFail: neg ? +neg[1] : null });
});

const lines = [];
const P = (s) => lines.push(s);

P('# OOPLIX V1 — Critical Findings Dossier');
P('');
P('**Document ID:** OPX-CFD-001');
P(`**Product:** ${reg.suite.product} (\`${reg.suite.repository}\`) ${reg.suite.productVersion}`);
P(`**Date of record:** ${reg.suite.generated}`);
P(`**Branch of record:** \`${reg.suite.branch}\``);
P(`**Classification:** ${reg.suite.classification}`);
P('');
P('> **Generated document.** Finding bodies are copied verbatim from the committed');
P('> certifications listed in §Sources — not paraphrased. Regenerate with');
P('> `node docs/ooplix-audit-suite/scripts/build-findings-dossier.js` rather than editing by hand.');
P('');
P('---');
P('');
P('## Purpose');
P('');
P('This is the document technical due diligence reads. For each critical finding it carries the');
P('**reproduction**, the **measured evidence**, the **root cause with file references**, the **fix**,');
P('and the **negative-tested regression** — in the auditor\'s original words, with original numbers.');
P('');
P('A reader who wants the summary should read `MASTER_AUDIT_REGISTER.md`. A reader who wants to');
P('verify that the summary is true should read this.');
P('');
P('## Contents');
P('');
P(`| # | Phase | ID | Severity | Finding |`);
P(`|---|---|---|---|---|`);
critical.forEach((r, i) => {
  const anchor = `${r.phase.replace('.', '')}-${r.id}`.toLowerCase();
  P(`| ${i + 1} | ${r.phase} | \`${r.id}\` | 🔴 CRITICAL | [${r.title}](#${anchor}) |`);
});
commitOnly.forEach((a) => {
  P(`| — | ${a.id} | — | 🔴 CRITICAL | ${a.headline} *(commit-evidenced, no certification document)* |`);
});
P('');
P(`**${critical.length} critical findings** extracted from ${files.length} certification documents.`);
P(`**${commitOnly.length} further critical finding${commitOnly.length === 1 ? '' : 's'}** ${commitOnly.length === 1 ? 'is' : 'are'} commit-evidenced only and recorded in the register.`);
P('');
P('---');
P('');
P('## Critical Findings');
P('');

critical.forEach((r, i) => {
  const anchor = `${r.phase.replace('.', '')}-${r.id}`.toLowerCase();
  P(`<a id="${anchor}"></a>`);
  P('');
  P(`### ${i + 1}. ${r.phase} \`${r.id}\` — ${r.title}`);
  P('');
  P(`**Severity:** 🔴 CRITICAL  ·  **Phase:** ${r.phase} — ${r.phaseName}  ·  **Source:** \`${r.artifact}\``);
  P('');
  P(r.body);
  P('');
  P('---');
  P('');
});

P('## High-Severity Findings — Index');
P('');
P('Full bodies are in the source certifications; this index exists so the dossier is a complete');
P('map of what was found rather than only the worst of it.');
P('');
P('| Phase | ID | Finding | Source |');
P('|---|---|---|---|');
high.forEach((r) => {
  P(`| ${r.phase} | \`${r.id}\` | ${r.title} | \`${r.artifact}\` |`);
});
P('');
P(`**${high.length} high-severity findings** recorded across the certification set.`);
P('');
P('---');
P('');
P('## Regression Evidence');
P('');
P('A regression test that passes against the *un-fixed* code proves nothing. Every suite below was');
P('verified to fail before the fix landed; the `Negative-tested` column records how many of its');
P('assertions fail when the fix is reverted.');
P('');
P('| Phase | Finding | Test suite | Tests | Negative-tested |');
P('|---|---|---|---|---|');
testRefs.forEach((t) => {
  P(`| ${t.phase} | \`${t.id}\` | \`${t.file}\` | ${t.count} | ${t.negFail !== null ? `**${t.negFail} fail** without the fix` : 'see source'} |`);
});
P('');
P(`**Baseline:** ${reg.evidenceIntegrity.regressionBaseline}`);
P('');
P('---');
P('');
P('## Residual Critical Gaps');
P('');
P('Distinct from the findings above. A **finding** was a broken capability that existed and was');
P('recovered. A **gap** is a capability that was never built — recorded with its reproduction and');
P('its reason for remaining open, rather than constructed under audit-day time pressure.');
P('');
P('| Gap | Phase | Title | Measured evidence | Why open | Closes in |');
P('|---|---|---|---|---|---|');
reg.residualCriticalGaps
  .filter((g) => g.severity === 'CRITICAL')
  .forEach((g) => {
    P(`| **${g.id}** | ${g.phase} | ${g.title} | ${g.detail} | ${g.reasonOpen} | ${g.closesIn} |`);
  });
P('');
P('All three share one root cause: **storage models built before multi-tenancy existed, none carrying');
P('an ownership dimension.** They are one remediation programme, not three tickets.');
P('');
P('---');
P('');
P('## Sources');
P('');
P('| Certification | Phase |');
P('|---|---|');
files.forEach((f) => {
  const txt = fs.readFileSync(path.join(REPO, f), 'utf8');
  const pm = txt.match(/^# Phase (B\.\d+(?:\.\d+)*) — (.+?)$/m);
  P(`| \`${f}\` | ${pm ? `${pm[1]} — ${pm[2]}` : '—'} |`);
});
P('');
P('Verify any figure by opening the named certification. Verify the A-phase findings via');
P('`git log --oneline security/reality-completion`.');
P('');
P('---');
P('');
P(`*Ooplix V1 Critical Findings Dossier · OPX-CFD-001 · ${reg.suite.classification}*`);

const out = path.join(SUITE, 'register/CRITICAL_FINDINGS_DOSSIER.md');
fs.writeFileSync(out, lines.join('\n') + '\n');

console.log('Dossier written:', out);
console.log(`  ${critical.length} critical findings extracted verbatim from ${files.length} certifications`);
console.log(`  ${high.length} high-severity findings indexed`);
console.log(`  ${testRefs.length} regression suites referenced`);
console.log(`  ${commitOnly.length} commit-only critical finding(s) cross-referenced: ${commitOnly.map((a) => a.id).join(', ') || 'none'}`);
const bodyMax = Math.max(...critical.map((r) => r.body.length));
console.log(`  largest finding body: ${bodyMax} chars (boundary detection working if < 6000)`);
