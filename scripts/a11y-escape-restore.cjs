#!/usr/bin/env node
/**
 * B19.2.3 — restore the Escape-to-dismiss binding on modals.
 *
 * B19.1 added `useEscapeKey(open, onClose)` to twelve modals that could
 * otherwise only be closed by clicking the backdrop — a mouse-only affordance
 * that traps a keyboard user. The hook still exists but NO file imports it any
 * more, so every one of those modals regressed. `tests/runtime/26` catches it.
 *
 * For each modal this binds Escape to the SAME handler the backdrop onClick
 * already calls, so the keyboard path matches the mouse path exactly — no new
 * behaviour, only the recovered one.
 *
 *   node scripts/a11y-escape-restore.cjs [--apply]
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'frontend', 'src');
const APPLY = process.argv.includes('--apply');

/** file → the dismiss expression its backdrop onClick already invokes. */
const TARGETS = [
  ['components/AgentRegistryCenter.jsx',        'onClose'],
  ['components/BetaChecklist.jsx',              '() => setFeedbackOpen(false)'],
  ['components/CompanyFactoryCenter.jsx',       'onClose'],
  ['components/KnowledgeCenter.jsx',            'onClose'],
  ['components/MemoryCenter.jsx',               '() => setEditing(null)'],
  ['components/MissionControlV1.jsx',           '() => setStopConfirm(false)'],
  ['components/WorkflowOSV2.jsx',               '() => setLogItem(null)'],
  ['components/WorkspaceSettingsK4.jsx',        '() => setEditing(null)'],
  ['components/WorkspaceSettingsL2.jsx',        'onClose'],
  ['components/WorkspaceSettingsL3.jsx',        '() => setDetail(null)'],
  ['components/operator-os/MissionEngine.jsx',  'onClose'],
  ['components/GuidedTour.jsx',                 'skip'],
];

/** Depth of the import specifier from the file back to src/. */
function hookImport(rel) {
  const depth = rel.split('/').length - 1;
  return `import { useEscapeKey } from "${'../'.repeat(depth)}hooks/useEscapeKey";`;
}

let changed = 0;
for (const [rel, handler] of TARGETS) {
  const file = path.join(SRC, rel);
  if (!fs.existsSync(file)) { console.log('  MISSING  ' + rel); continue; }
  let src = fs.readFileSync(file, 'utf8');
  if (/useEscapeKey/.test(src)) { console.log('  already  ' + rel); continue; }

  // 1. add the import after the last existing import
  const imports = [...src.matchAll(/^import .*?;$/gm)];
  if (!imports.length) { console.log('  NO-IMPORTS ' + rel); continue; }
  const last = imports[imports.length - 1];
  src = src.slice(0, last.index + last[0].length)
      + '\n' + hookImport(rel)
      + src.slice(last.index + last[0].length);

  // 2. Call the hook at the TOP of the component function that renders the
  //    overlay. A hook must run unconditionally on every render, so anchoring
  //    on the nearest `return (` is wrong — that can sit inside a .map()
  //    callback, which would call a hook in a loop and break the Rules of
  //    Hooks. Instead walk back to the enclosing function declaration.
  const ovIdx = src.search(/<div className="[^"]*(overlay|backdrop)[^"]*"/);
  if (ovIdx === -1) { console.log('  NO-OVERLAY ' + rel); continue; }
  const before = src.slice(0, ovIdx);

  // Nearest preceding component definition: `function Name(` at any indent, or
  // `const Name = (…) => {` / `= memo(function Name(`.
  const defs = [...before.matchAll(
    /(?:^|\n)\s*(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)\s*\([^)]*\)\s*\{|(?:^|\n)\s*(?:export\s+)?const\s+([A-Z]\w*)\s*=\s*(?:memo\()?\s*(?:function\s*\w*\s*)?\([^)]*\)\s*(?:=>\s*)?\{/g)];
  if (!defs.length) { console.log('  NO-COMPONENT ' + rel); continue; }
  const def = defs[defs.length - 1];
  const name = def[1] || def[2];
  const bodyStart = def.index + def[0].length;

  // The dismiss handler usually closes over a setter (`() => setEditing(null)`),
  // so the hook must sit AFTER that useState — otherwise the identifier is
  // referenced in its temporal dead zone. Insert after the last useState/useRef
  // declared between the component start and the overlay it renders.
  const head = src.slice(bodyStart, ovIdx);
  const decls = [...head.matchAll(/^[ \t]*const\s*\[[^\]]*\]\s*=\s*use(?:State|Reducer)\([\s\S]*?\);$/gm)];
  const insertAt = decls.length
    ? bodyStart + decls[decls.length - 1].index + decls[decls.length - 1][0].length
    : bodyStart;
  src = src.slice(0, insertAt)
      + `\n  // B19.2.3: Escape mirrors the backdrop click — restored from B19.1.`
      + `\n  useEscapeKey(true, ${handler});`
      + src.slice(insertAt);
  console.log(`  (into ${name})`);

  if (APPLY) fs.writeFileSync(file, src);
  changed++;
  console.log('  bound    ' + rel + '  → ' + handler);
}

console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${changed} modals rebound.`);
if (!APPLY) console.log('re-run with --apply to write.');
