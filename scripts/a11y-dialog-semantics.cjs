#!/usr/bin/env node
/**
 * B19.3 — recover dialog semantics on modals that lack them.
 *
 * RECOVERY, not new design. The pattern already ships in this repo and is
 * applied consistently by five components:
 *
 *   components/ConfirmDialog.jsx:66
 *     <div className="cdialog-overlay" role="dialog" aria-modal="true"
 *          aria-labelledby="cdialog-title" …>
 *       <div id="cdialog-title" className="cdialog-title">{title}</div>
 *
 *   also AgentFactoryCenter.jsx (x2), ContactsV2.jsx (x2), CommandPalette.jsx,
 *   UpgradeModal.jsx
 *
 * Eleven other modals were built with the same overlay → panel → title
 * structure but never received the three attributes. Assistive tech therefore
 * announces them as an anonymous group rather than a modal dialog.
 *
 * This applies the SAME three attributes to the panel and gives the EXISTING
 * title element an id to point at. It adds no markup, no focus trap, and no
 * component — only the attributes the sibling implementations already carry.
 *
 *   node scripts/a11y-dialog-semantics.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'frontend', 'src');
const APPLY = process.argv.includes('--apply');

/**
 * file → { panel, title, id }
 *   panel — className of the dialog panel (the child of the overlay)
 *   title — className of the existing heading inside it
 *   id    — the id to mint on that heading
 * Every entry was read off the component first; none is guessed.
 */
const TARGETS = [
  ['components/AgentRegistryCenter.jsx',  'arc-modal',  'arc-modal-title',  'arc-modal-title'],
  ['components/CompanyFactoryCenter.jsx', 'cfc-modal',  'cfc-modal-title',  'cfc-modal-title'],
  ['components/KnowledgeCenter.jsx',      'kc-modal',   'kc-modal-title',   'kc-modal-title'],
  // Panel class read off the source: K4's panel carries two classes, and
  // TeamWorkspace's title sits in a <form> nested inside the .tw-modal panel.
  ['components/WorkspaceSettingsK4.jsx',  'ws-modal k3-edit-modal', 'k3-modal-title',  'k3-modal-title'],
  ['components/TeamWorkspace.jsx',        'tw-modal',   'tw-invite-title',  'tw-invite-title'],
  // Second pass — each heading verified in source before being cited here.
  ['components/MemoryCenter.jsx',         'mc-modal',   'mc-form-heading',  'mc-form-heading'],
  ['components/WorkspaceSettingsL2.jsx',  'ws-modal',   'l2-detail-name',   'l2-detail-name'],
  ['components/WorkspaceSettingsK3.jsx',  'ws-modal k3-edit-modal', 'k3-member-title', 'k3-member-title'],
];

let changed = 0;
for (const [rel, panelCls, titleCls, id] of TARGETS) {
  const file = path.join(SRC, rel);
  if (!fs.existsSync(file)) { console.log('  MISSING     ' + rel); continue; }
  let src = fs.readFileSync(file, 'utf8');

  if (/role="dialog"/.test(src)) { console.log('  already     ' + rel); continue; }

  // 1. the panel gains the three attributes
  const panelRe = new RegExp(`(<div className="${panelCls}")`);
  if (!panelRe.test(src)) { console.log('  NO-PANEL    ' + rel + ' (.' + panelCls + ')'); continue; }
  src = src.replace(panelRe,
    `$1 role="dialog" aria-modal="true" aria-labelledby="${id}"`);

  // 2. the EXISTING title element gains the id the panel points at
  const titleRe = new RegExp(`(<(h[1-6]|div|span) className="${titleCls}")`);
  if (!titleRe.test(src)) { console.log('  NO-TITLE    ' + rel + ' (.' + titleCls + ')'); continue; }
  src = src.replace(titleRe, `$1 id="${id}"`);

  if (APPLY) fs.writeFileSync(file, src);
  changed++;
  console.log('  recovered   ' + rel + '  → aria-labelledby="' + id + '"');
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${changed} modals given the existing dialog pattern.`);
if (!APPLY) console.log('re-run with --apply to write.');
