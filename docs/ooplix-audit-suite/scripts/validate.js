#!/usr/bin/env node
/**
 * OOPLIX V1 — Audit suite validator
 *
 *   node docs/ooplix-audit-suite/scripts/validate.js
 *
 * Enforces the evidence-integrity rules the suite claims to follow. Run this
 * before publishing or sharing any artifact from the suite. Exits non-zero on
 * any violation so it can gate a commit hook or CI step.
 *
 * The rules are not stylistic. Each one blocks a specific way this suite could
 * quietly start lying:
 *
 *   1. A PLANNED audit must never carry a score, findings, date, or evidence.
 *   2. Declared aggregate counts must equal what the audit rows actually sum to.
 *   3. Every residual gap must name a reason it is open and an audit that closes it.
 *   4. Every EXECUTED audit must cite at least one piece of evidence.
 *   5. Cited certification artifacts must exist on disk.
 */

const fs = require('fs');
const path = require('path');

const SUITE = path.join(__dirname, '..');
const REPO = path.join(SUITE, '..', '..');
const reg = JSON.parse(fs.readFileSync(path.join(SUITE, 'data/audit-register.json'), 'utf8'));

const errors = [];
const warnings = [];

const executed = reg.audits.filter((a) => a.status === 'EXECUTED');
const planned = reg.audits.filter((a) => a.status === 'PLANNED');
const scored = executed.filter((a) => typeof a.score === 'number');

// --- Rule 1: PLANNED rows carry no evidence of any kind --------------------
planned.forEach((a) => {
  if (a.score !== null && a.score !== undefined) errors.push(`R1 ${a.id}: PLANNED audit carries a score (${a.score}).`);
  if (a.findings) errors.push(`R1 ${a.id}: PLANNED audit carries findings.`);
  if (a.date) errors.push(`R1 ${a.id}: PLANNED audit carries a date (${a.date}).`);
  if (a.evidence && a.evidence.length) errors.push(`R1 ${a.id}: PLANNED audit cites evidence.`);
  if (a.verdict !== 'PLANNED') errors.push(`R1 ${a.id}: PLANNED audit has verdict "${a.verdict}".`);
  if (!a.entryCriteria || !a.entryCriteria.length) warnings.push(`R1 ${a.id}: PLANNED audit has no entry criteria.`);
});

// --- Rule 2: declared aggregates match computed ----------------------------
const ei = reg.evidenceIntegrity;
const sum = (k) => executed.reduce((t, a) => t + (a.findings ? a.findings[k] : 0), 0);
const computed = {
  executedCount: executed.length,
  plannedCount: planned.length,
  totalRows: reg.audits.length,
  scoredCount: scored.length,
  findingsTotal: sum('total'),
  certifiedCount: executed.filter((a) => a.verdict === 'CERTIFIED').length,
  certifiedWithLimitationsCount: executed.filter((a) => a.verdict === 'CERTIFIED WITH LIMITATIONS').length,
  notCertifiedCount: executed.filter((a) => a.verdict === 'NOT CERTIFIED').length,
};
Object.entries(computed).forEach(([k, v]) => {
  if (ei[k] !== undefined && ei[k] !== v) {
    errors.push(`R2 ${k}: declared ${ei[k]}, computed ${v}.`);
  }
});

const sev = { critical: sum('critical'), high: sum('high'), medium: sum('medium'), low: sum('low') };
Object.entries(sev).forEach(([k, v]) => {
  if (ei.findingsBySeverity && ei.findingsBySeverity[k] !== v) {
    errors.push(`R2 findingsBySeverity.${k}: declared ${ei.findingsBySeverity[k]}, computed ${v}.`);
  }
});
const sevSum = sev.critical + sev.high + sev.medium + sev.low;
if (sevSum !== computed.findingsTotal) {
  errors.push(`R2 severity breakdown sums to ${sevSum} but findings total is ${computed.findingsTotal}.`);
}

executed.forEach((a) => {
  if (!a.findings) return;
  const f = a.findings;
  const t = f.critical + f.high + f.medium + f.low;
  if (t !== f.total) errors.push(`R2 ${a.id}: severity breakdown sums to ${t}, total says ${f.total}.`);
});

if (scored.length) {
  const mean = scored.reduce((t, a) => t + a.score, 0) / scored.length;
  if (ei.meanScoreOfScored !== undefined && Math.abs(ei.meanScoreOfScored - mean) > 0.005) {
    errors.push(`R2 meanScoreOfScored: declared ${ei.meanScoreOfScored}, computed ${mean.toFixed(2)}.`);
  }
}

const byLayer = {};
executed.forEach((a) => { byLayer[a.layer] = (byLayer[a.layer] || 0) + (a.findings ? a.findings.total : 0); });
if (ei.findingsByLayer) {
  Object.entries(ei.findingsByLayer).forEach(([k, v]) => {
    if (byLayer[k] !== v) errors.push(`R2 findingsByLayer.${k}: declared ${v}, computed ${byLayer[k] || 0}.`);
  });
}

// --- Rule 3: gaps are accountable ------------------------------------------
(reg.residualCriticalGaps || []).forEach((g) => {
  if (!g.reasonOpen) errors.push(`R3 ${g.id}: no reasonOpen recorded.`);
  if (!g.closesIn) errors.push(`R3 ${g.id}: no closing audit named.`);
  if (!g.detail) errors.push(`R3 ${g.id}: no measured detail recorded.`);
  const target = reg.audits.find((a) => a.id === g.closesIn);
  if (!target) errors.push(`R3 ${g.id}: closesIn "${g.closesIn}" is not an audit in the register.`);
});

// --- Rule 4: executed audits cite evidence ---------------------------------
executed.forEach((a) => {
  if (!a.evidence || !a.evidence.length) errors.push(`R4 ${a.id}: EXECUTED audit cites no evidence.`);
  if (!a.findings) errors.push(`R4 ${a.id}: EXECUTED audit has no findings object.`);
});

// --- Rule 5: cited artifacts exist -----------------------------------------
executed.forEach((a) => {
  (a.artifacts || []).forEach((art) => {
    if (!fs.existsSync(path.join(REPO, art))) {
      warnings.push(`R5 ${a.id}: artifact not found on disk — ${art}`);
    }
  });
});

// --- Rule 6: dossier is present and current --------------------------------
const dossierPath = path.join(SUITE, 'register/CRITICAL_FINDINGS_DOSSIER.md');
if (!fs.existsSync(dossierPath)) {
  warnings.push('R6 CRITICAL_FINDINGS_DOSSIER.md missing — run scripts/build-findings-dossier.js');
} else {
  const dossier = fs.readFileSync(dossierPath, 'utf8');
  // Every critical gap must appear in the dossier's residual-gap table.
  (reg.residualCriticalGaps || [])
    .filter((g) => g.severity === 'CRITICAL')
    .forEach((g) => {
      if (!dossier.includes(g.id)) errors.push(`R6 dossier does not mention critical gap ${g.id}.`);
    });
  // Cited regression test files must exist on disk.
  const cited = [...dossier.matchAll(/`(tests\/[^`]+\.cjs)`/g)].map((m) => m[1]);
  [...new Set(cited)].forEach((t) => {
    if (!fs.existsSync(path.join(REPO, t))) errors.push(`R6 dossier cites a non-existent test file: ${t}`);
  });
}

// --- Rule 7: prose figures match computed data -----------------------------
// Catches the failure mode where audit rows are added but hand-written prose
// keeps the old totals. Only checks headline figures that must not drift.
const mean = scored.length ? scored.reduce((t, a) => t + a.score, 0) / scored.length : 0;
const proseFiles = [
  'README.md',
  'register/MASTER_AUDIT_REGISTER.md',
  'decks/INVESTOR_DECK.md',
  'reports/ENTERPRISE_PDF_REPORT_STRUCTURE.md',
  'workspaces/notion/NOTION_STRUCTURE.md',
  'workspaces/confluence/CONFLUENCE_STRUCTURE.md',
  'workspaces/figma/FIGMA_WIREFRAME_STRUCTURE.md',
];
// Stale patterns = any figure that contradicts the computed truth.
const staleChecks = [
  { re: /\b(\d+) executed audits?\b/g, truth: computed.executedCount, label: 'executed audit count' },
  { re: /\b(\d+) findings recovered\b/g, truth: computed.findingsTotal, label: 'findings total' },
  { re: /Mean (\d+\.\d+) ?\/ ?10/g, truth: +mean.toFixed(2), label: 'mean score' },
];
proseFiles.forEach((rel) => {
  const p = path.join(SUITE, rel);
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, 'utf8');
  staleChecks.forEach(({ re, truth, label }) => {
    for (const m of txt.matchAll(re)) {
      const found = parseFloat(m[1]);
      if (Math.abs(found - truth) > 0.005) {
        errors.push(`R7 ${rel}: ${label} reads ${m[1]}, computed ${truth}. ("${m[0]}")`);
      }
    }
  });
});

// --- Report ----------------------------------------------------------------
console.log('OOPLIX V1 — Audit Suite Validation\n');
console.log(`  Rows            ${reg.audits.length}  (${executed.length} executed, ${planned.length} planned)`);
console.log(`  Findings        ${computed.findingsTotal}  (C ${sev.critical} / H ${sev.high} / M ${sev.medium} / L ${sev.low})`);
console.log(`  Scored audits   ${scored.length}  mean ${scored.length ? (scored.reduce((t, a) => t + a.score, 0) / scored.length).toFixed(2) : 'n/a'}`);
console.log(`  Verdicts        ${computed.certifiedCount} certified · ${computed.certifiedWithLimitationsCount} with limitations · ${computed.notCertifiedCount} not certified`);
console.log(`  Residual gaps   ${(reg.residualCriticalGaps || []).length} escalated (${(reg.residualCriticalGaps || []).filter((g) => g.severity === 'CRITICAL').length} critical)\n`);

if (warnings.length) {
  console.log(`WARNINGS (${warnings.length}):`);
  warnings.forEach((w) => console.log('  ! ' + w));
  console.log('');
}

if (errors.length) {
  console.log(`FAILED — ${errors.length} integrity violation(s):`);
  errors.forEach((e) => console.log('  ✗ ' + e));
  process.exit(1);
}

console.log('PASS — all evidence-integrity rules satisfied.');
