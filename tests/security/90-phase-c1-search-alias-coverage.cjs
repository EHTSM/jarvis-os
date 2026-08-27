#!/usr/bin/env node
"use strict";
/**
 * Phase C.1 Part 1 — complete MORE_TABS search-alias coverage.
 *
 * CONFIRMED finding (Phase C.0 inventory, measured against App.jsx source):
 * only 22 of 82 MORE_TABS entries carried an `alias` string. The remaining
 * 60 were discoverable by their exact visible label ONLY. Three entire
 * groups had zero search vocabulary:
 *
 *   AI & Agents  — 0/11 aliased  ("agent" matched nothing useful)
 *   Intelligence — 0/16 aliased  ("remember", "forecast", "plan my day" → 0)
 *   Org Levels   — 0/6  aliased  ("level 7", "l7" → 0)
 *
 * This is the same defect class already documented twice in App.jsx itself
 * (the `eod` no-entrypoint finding and the `lead`/`leads` PRIMARY_TAB_ALIASES
 * finding): real, working, fully-wired capability that a founder cannot find
 * because the search vocabulary is missing.
 *
 * Fix: extended the existing `alias` field only. No new search architecture,
 * no new navigation, no renamed labels, no new components, routes or
 * services — identical remit to Phase A.8.3 and A.13.
 *
 * These assertions lock in the recovery so a future edit cannot silently
 * regress a surface back to label-only discoverability.
 *
 * Usage: node tests/security/90-phase-c1-search-alias-coverage.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const assert = require("assert");
const fs     = require("fs");

let pass = 0;
function ok(msg)        { pass++; console.log(`  ✓  ${msg}`); }
function section(title) { console.log(`\n[${title}]`); }

/** Parse MORE_TABS entries out of App.jsx source. */
function parseMoreTabs(src) {
  const start = src.indexOf("const MORE_TABS = [");
  assert.ok(start > -1, "MORE_TABS array must exist in App.jsx");
  const body = src.slice(start, src.indexOf("\n];", start));
  const re = /\{\s*id:\s*"([^"]+)"\s*,\s*label:\s*"?([^",]*)"?\s*,\s*group:\s*"([^"]+)"(?:\s*,\s*alias:\s*"([^"]*)")?/g;
  return [...body.matchAll(re)].map(m => ({
    id: m[1], label: m[2].trim(), group: m[3], alias: m[4] || null,
  }));
}

/** Mirror of MoreMenu.filtered()'s matching rule for MORE_TABS. */
function search(tabs, q) {
  const needle = q.trim().toLowerCase();
  return tabs.filter(m =>
    m.label.toLowerCase().includes(needle) ||
    (m.group || "").toLowerCase().includes(needle) ||
    (m.alias || "").toLowerCase().includes(needle)
  );
}

async function main() {
  const src  = fs.readFileSync(require.resolve("../../frontend/src/App.jsx"), "utf8");
  const tabs = parseMoreTabs(src);

  section("Every MORE_TABS surface carries search vocabulary");
  {
    const missing = tabs.filter(t => !t.alias).map(t => t.id);
    assert.strictEqual(
      missing.length, 0,
      `every MORE_TABS entry must have an alias; missing on: ${missing.join(", ")}`
    );
    ok(`${tabs.length}/${tabs.length} surfaces aliased (was 22/82 before Phase C.1)`);
  }

  section("Exact-label search still resolves (no regression to existing behaviour)");
  {
    const broken = tabs.filter(t => !search(tabs, t.label).some(r => r.id === t.id));
    assert.strictEqual(
      broken.length, 0,
      `searching a tab's exact visible label must still return it; broken: ${broken.map(b => b.id).join(", ")}`
    );
    ok(`all ${tabs.length} labels resolve to their own surface`);
  }

  section("Every surface is reachable by at least one of its own alias tokens");
  {
    const unreachable = tabs.filter(t => {
      const tokens = (t.alias || "").split(/\s+/).filter(w => w.length > 3);
      return !tokens.some(tok => search(tabs, tok).some(r => r.id === t.id));
    });
    assert.strictEqual(
      unreachable.length, 0,
      `each surface must be findable via its own alias; unreachable: ${unreachable.map(u => u.id).join(", ")}`
    );
    ok(`all ${tabs.length} surfaces reachable via alias tokens`);
  }

  section("Previously-zero founder vocabulary now resolves");
  {
    // Each term measured as returning ZERO MORE_TABS hits before Phase C.1.
    const PROBES = [
      ["plan my day",     "planning"],
      ["remember",        "memory"],
      ["forecast",        "predict"],
      ["create agent",    "agentfactory"],
      ["who is working",  "agentcollab"],
      ["delegate",        "collab"],
      ["llm",             "aiusage"],
      ["budget",          "aicost"],
      ["uptime",          "systemhealth"],
      ["queue",           "runtime"],
      ["wiki",            "knowledge"],
      ["permissions",     "orgadmin"],
      ["gdpr",            "trustcompliance"],
      ["contract",        "legalos"],
      ["affiliate",       "referral"],
      ["dogfood",         "oroplix"],
    ];
    for (const [term, expectedId] of PROBES) {
      const hits = search(tabs, term);
      assert.ok(hits.length > 0, `search "${term}" must return at least one surface`);
      assert.ok(
        hits.some(h => h.id === expectedId),
        `search "${term}" must surface "${expectedId}" (got: ${hits.map(h => h.id).join(", ") || "none"})`
      );
    }
    ok(`${PROBES.length} founder-vocabulary probes each resolve to their real surface`);
  }

  section("Group-level vocabulary coverage (the three zero-coverage groups)");
  {
    for (const group of ["AI & Agents", "Intelligence", "Org Levels"]) {
      const inGroup = tabs.filter(t => t.group === group);
      assert.ok(inGroup.length > 0, `group "${group}" must have surfaces`);
      const aliased = inGroup.filter(t => t.alias).length;
      assert.strictEqual(
        aliased, inGroup.length,
        `every surface in "${group}" must be aliased (${aliased}/${inGroup.length})`
      );
      ok(`${group}: ${aliased}/${inGroup.length} aliased (was 0/${inGroup.length})`);
    }
  }

  section("Recovery integrity — alias-only, no structural change");
  {
    const ids = tabs.map(t => t.id);
    const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
    assert.strictEqual(dupes.length, 0, `duplicate MORE_TABS ids: ${dupes.join(", ")}`);

    // Aliases must be plain ASCII search vocabulary — no stray characters.
    const nonAscii = tabs.filter(t => t.alias && /[^\x00-\x7F]/.test(t.alias));
    assert.strictEqual(
      nonAscii.length, 0,
      `aliases must be ASCII search terms; non-ascii in: ${nonAscii.map(n => n.id).join(", ")}`
    );

    // A vocabulary-only recovery must not have changed the surface count.
    assert.strictEqual(tabs.length, 82, `expected 82 MORE_TABS surfaces, found ${tabs.length}`);
    ok("no duplicate ids, no non-ascii aliases, surface count unchanged (82)");
  }

  console.log(`\n${pass} passed, 0 failed`);
  process.exit(0);
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
