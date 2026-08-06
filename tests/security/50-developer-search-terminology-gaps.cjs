#!/usr/bin/env node
"use strict";
/**
 * Developer-vocabulary search terminology-gap regression —
 * frontend/src/App.jsx's MORE_TABS + its search filter.
 *
 * CONFIRMED finding (Developer Experience Certification, Phase A.5): a
 * full sweep of the 23 engineering search terms this mission explicitly
 * requires ("repository", "browser", "terminal", "logs", "observability",
 * "test", "debug", "review", "git", "github", "gitlab", "docker",
 * "deploy", "rollback", "monitoring", "alert", "incident", "project", ...)
 * found 17 zero-result terms, despite real, working features existing for
 * nearly all of them under less obvious labels:
 *
 *   "repository"/"repo"/"project"/"test"/"debug"/"review"/"ci"/"github" —
 *   all real content inside "Copilot" (DeveloperCopilotV2.jsx): a
 *   Repository Intelligence tab, real per-repo CI/coverage/PR/issue data,
 *   a "Code Review" section, and a GitHub connector with PR reviews + CI
 *   status.
 *
 *   "logs" — a real Logs.jsx component, rendered under the "History" tab.
 *
 *   "observability"/part of "monitoring"/"git" — Runtime Observer
 *   (RuntimeObserverPanel.jsx), which itself internally tracks git,
 *   filesystem, pm2, and logs events.
 *
 *   "incident"/"alert"/rest of "monitoring" — real Incidents/Alerts
 *   content inside "Reliability" (ReliabilityCenter.jsx).
 *
 *   "gitlab"/"github" (connector management) — real GitLab/GitHub/
 *   Bitbucket connector plumbing (backend/services/integrationConnectors.cjs)
 *   surfaced under "Integrations".
 *
 *   "docker"/"deploy"/"rollback" — real Docker/Deployments/blue-green/
 *   canary tabs inside "DevOps" (DevOpsCenterV2.jsx). This one is
 *   correctly role-gated (operator-only — DevOps here is Ooplix's own
 *   platform ops tooling, not a customer-facing deploy target), and a
 *   non-operator landing on it already saw an honest "DevOps is available
 *   to organization operators" message — but the tab was invisible to
 *   search for everyone, so a non-operator engineer had no way to
 *   discover the capability even exists. Made findable for all roles so
 *   the honest permission message is reachable rather than the feature
 *   appearing to not exist at all.
 *
 * NOT fixed, confirmed genuinely absent rather than just unindexed:
 *   "browser" and "terminal" — both are real, Electron-desktop-only
 *   features (VisualGit/CodeMirror/terminal panel inside
 *   ElectronWorkspace.jsx, which is a pure passthrough — `if
 *   (!isElectron()) return children` — in web mode). No alias was added;
 *   there is genuinely nothing to point to in a web session.
 *
 * Fix: same additive `alias` mechanism used throughout this engagement —
 * no renames, no new UI, no new architecture.
 *
 * This test is a static check against the real MORE_TABS source.
 *
 * Usage: node tests/security/50-developer-search-terminology-gaps.cjs
 */

process.chdir(require("path").join(__dirname, "../.."));

const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const failures = [];
function ok(msg)         { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; failures.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }
function assert(c, p, f) { c ? ok(p) : ko(p, f); }
function section(title)  { console.log(`\n[${title}]`); }

function parseMoreTabs() {
  const src = fs.readFileSync(path.join(__dirname, "../../frontend/src/App.jsx"), "utf8");
  const startIdx = src.indexOf("const MORE_TABS = [");
  const endIdx = src.indexOf("];", startIdx);
  const block = src.slice(startIdx, endIdx);
  const entries = [...block.matchAll(/id:\s*"([^"]+)",\s*label:\s*"?([^",]+)"?,\s*group:\s*"([^"]+)"(?:,\s*alias:\s*"([^"]+)")?/g)];
  return entries.map(m => ({ id: m[1], label: m[2].replace(/^"|"$/g, ""), group: m[3], alias: m[4] || null }));
}

function searchMatches(tabs, q) {
  const query = q.toLowerCase();
  return tabs.filter(t => t.label.toLowerCase().includes(query) || t.group.toLowerCase().includes(query) || (t.alias && t.alias.toLowerCase().includes(query)));
}

async function main() {
  section("Static — real MORE_TABS source resolves the developer-vocabulary terms");
  const tabs = parseMoreTabs();
  assert(tabs.length > 50, "MORE_TABS was parsed successfully from the real source (sanity check)", `only parsed ${tabs.length} entries`);

  const expectations = [
    ["repository",   "Copilot"],
    ["project",      "Copilot"],
    ["test",         "Copilot"],
    ["debug",        "Copilot"],
    ["review",       "Copilot"],
    ["ci",           "Copilot"],
    ["logs",         "History"],
    ["observability","Runtime Observer"],
    ["monitoring",   "Runtime Observer"],
    ["incident",     "Reliability"],
    ["alert",        "Reliability"],
    ["gitlab",       "Integrations"],
    ["docker",       "DevOps"],
    ["deploy",       "DevOps"],
    ["rollback",     "DevOps"],
  ];
  for (const [term, expectedLabel] of expectations) {
    const matches = searchMatches(tabs, term);
    assert(matches.some(m => m.label === expectedLabel), `"${term}" search resolves to the real ${expectedLabel} module`, `no match found among: ${JSON.stringify(matches.map(m => m.label))}`);
  }

  section("Static — no existing label/group was renamed (aliases are additive only)");
  for (const id of ["copilot", "activity", "reliability", "observer", "devops", "integrations"]) {
    const tab = tabs.find(t => t.id === id);
    assert(!!tab, `MORE_TABS still has an entry with id "${id}"`, "entry not found — may have been removed or renamed");
  }

  section("Static — 'browser' and 'terminal' deliberately have no alias (genuinely Electron-only, not just unindexed)");
  const browserMatches = searchMatches(tabs, "browser");
  assert(browserMatches.length === 0, "'browser' has no false alias pointing to a non-existent web-mode feature", `unexpected match: ${JSON.stringify(browserMatches.map(m => m.label))}`);
  const terminalMatches = searchMatches(tabs, "terminal");
  assert(terminalMatches.length === 0, "'terminal' has no false alias pointing to a non-existent web-mode feature", `unexpected match: ${JSON.stringify(terminalMatches.map(m => m.label))}`);

  const electronWsSrc = fs.readFileSync(path.join(__dirname, "../../frontend/src/components/ElectronWorkspace.jsx"), "utf8");
  assert(/if \(!isElectron\(\)\) return <>\{children\}<\/>/.test(electronWsSrc), "confirms ElectronWorkspace (which hosts VisualGit/terminal/browser panels) is a pure passthrough in web mode — the absence of a browser/terminal alias is deliberate, not an oversight", "expected passthrough guard not found in ElectronWorkspace.jsx — browser/terminal web availability may have changed");

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Developer Search Terminology Regression: ${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f.msg}: ${f.reason}`));
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
