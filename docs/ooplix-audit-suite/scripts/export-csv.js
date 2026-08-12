#!/usr/bin/env node
/**
 * OOPLIX V1 — CSV exporter for Notion / Confluence / Excel import
 *
 *   node docs/ooplix-audit-suite/scripts/export-csv.js
 *
 * Writes:
 *   data/export-audit-register.csv
 *   data/export-gap-register.csv
 *
 * Score column contract: an unscored or planned audit exports an EMPTY cell,
 * never 0. Notion and Excel both coerce 0 into a real value in averages and
 * roll-ups, which would silently turn "never audited" into "scored zero" —
 * the exact misrepresentation this suite exists to prevent.
 */

const fs = require('fs');
const path = require('path');

const SUITE = path.join(__dirname, '..');
const reg = JSON.parse(fs.readFileSync(path.join(SUITE, 'data/audit-register.json'), 'utf8'));

const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (arr) => arr.map(cell).join(',');

// --- Audit register --------------------------------------------------------
const layerName = Object.fromEntries(reg.layers.map((l) => [l.id, `${l.id} ${l.name}`]));

const auditHeader = [
  'Audit ID', 'Title', 'Layer', 'Status', 'Verdict', 'Score', 'Date',
  'Critical', 'High', 'Medium', 'Low', 'Total Findings',
  'Headline', 'Scope', 'Evidence', 'Entry Criteria',
];

const auditRows = reg.audits.map((a) => {
  const f = a.findings;
  return row([
    a.id,
    a.title,
    layerName[a.layer] || a.layer,
    a.status,
    a.verdict,
    typeof a.score === 'number' ? a.score : '',   // empty, never 0
    a.date || '',
    f ? f.critical : '',
    f ? f.high : '',
    f ? f.medium : '',
    f ? f.low : '',
    f ? f.total : '',
    a.headline,
    a.scope,
    (a.evidence || []).join(' | '),
    (a.entryCriteria || []).join(' | '),
  ]);
});

const auditCsv = [row(auditHeader), ...auditRows].join('\n') + '\n';
const auditPath = path.join(SUITE, 'data/export-audit-register.csv');
fs.writeFileSync(auditPath, auditCsv);

// --- Gap register ----------------------------------------------------------
const gapHeader = ['Gap ID', 'Phase', 'Severity', 'Title', 'Measured Detail', 'Reason Open', 'Closes In', 'Status'];
const gapRows = (reg.residualCriticalGaps || []).map((g) =>
  row([g.id, g.phase, g.severity, g.title, g.detail, g.reasonOpen, g.closesIn, 'Open'])
);
const gapCsv = [row(gapHeader), ...gapRows].join('\n') + '\n';
const gapPath = path.join(SUITE, 'data/export-gap-register.csv');
fs.writeFileSync(gapPath, gapCsv);

const executed = reg.audits.filter((a) => a.status === 'EXECUTED').length;
const planned = reg.audits.filter((a) => a.status === 'PLANNED').length;
const scored = reg.audits.filter((a) => typeof a.score === 'number').length;

console.log('Audit register CSV:', auditPath);
console.log(`  ${reg.audits.length} rows — ${executed} executed, ${planned} planned`);
console.log(`  ${scored} rows carry a Score; ${reg.audits.length - scored} export an empty Score cell (never 0)`);
console.log('Gap register CSV:  ', gapPath);
console.log(`  ${gapRows.length} escalated gaps`);
console.log('\nNotion import: set Score to type Number and confirm empty cells stay empty.');
console.log('Any average over Score must filter "Score is not empty" first.');
