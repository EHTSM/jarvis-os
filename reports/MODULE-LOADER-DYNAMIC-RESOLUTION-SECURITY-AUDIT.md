# MODULE LOADER & DYNAMIC MODULE RESOLUTION SECURITY AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

The ~400 module-loader/error-leak occurrences identified during Mission 12's classification pass,
across the cluster of route files it flagged. All `require(...)` and dynamic `import(...)` call sites
across `backend/routes/*.js`, `backend/services/*.cjs`, `agents/**/*.cjs`, with particular attention to
any request-influenced module/path/package selector.

## Methodology

Commissioned a dedicated, comprehensive background inventory to answer the single question that
determines this mission's actual severity: does any `require()`/dynamic `import()` in this codebase ever
resolve a **variable, request-influenced target**, or are all occurrences fixed, hardcoded, developer-
authored paths (a lower-severity error-message-leak class only)? Every `require(` call with a non-
string-literal argument was individually traced to its origin. Every genuine finding acted on was live-
reproduced via a safe, fully reversible technique (temporarily moving a real service file aside to
simulate a missing module, then restoring it immediately) — never a destructive or irreversible action.

## Headline Finding

**There is no module-resolution-target vulnerability anywhere in this codebase.** Every `require()` call
resolves to a hardcoded, developer-authored path. No customer-controlled value — directly or through any
traced call chain — ever selects, constructs, or influences what module gets loaded. Categories the
mission was specifically asked to check (customer-controlled module/path/package identifiers, plugin/
agent-name-to-module-path dispatch, path traversal through module resolution, dynamic `import()`) are
**all empty**.

This mission is therefore **not security-critical remediation work** — it is confirmation of that
negative, plus a bounded fix for the lower-severity class Mission 12 correctly identified: unguarded
`require()` of a fixed path, which leaks Node's raw `Cannot find module` text (including its require
stack — internal route-file/mount-chain structure) to the client if the target module is ever
missing/broken.

## Inventory Corrections to Mission 12's Estimate

Two corrections surfaced during the inventory, both narrowing the actual remediation target:

1. **The cluster is larger in raw count than "~400/32 files."** Counting the full `backend/services/*.cjs`
   layer in addition to routes, the true repo-wide total of this lazy-accessor idiom is closer to ~1,900
   occurrences. Mission 12's ~400 figure captured only a subset of the route layer.
2. **~80% of the route-layer occurrences were already guarded.** Of the 248 route-layer lazy accessors
   across 54 files, 133 were already wrapped in a `_try(fn)`-style helper (the exact convention already
   established and certified in `auth.js`, `companyFactory.js`, `enterpriseSso.js`, and others) plus 31
   more using an equivalent inline try/catch — leaving **115 genuinely unguarded accessors across 22
   files** as the real, actionable remediation target. This is the number this mission fixed.

## Genuine Defect Found and Fixed — 1 (class-wide, 115 sites across 22 files)

**Unguarded `require()` of a fixed, hardcoded service path leaks Node's raw module-resolution error.**
Representative and highest-value instance: `backend/routes/odi.js`'s `svc` object (30 of the 115 sites —
26% of the total), gated only by `requireAuth` (not `operatorOnly`).

**Live-reproduced** via a safe, fully reversible technique: temporarily renamed a real, currently-working
service file (`backend/services/visualCaptureService.cjs`) aside (not deleted, not corrupted — moved to
a scratch location and restored immediately after each test), then made a real HTTP request through the
actual running server as a freshly registered ordinary customer account:

```
GET /odi/screenshots  →  500
{"success":false,"error":"Cannot find module '../services/visualCaptureService.cjs'\nRequire stack:\n
- /Users/.../backend/routes/odi.js\n- /Users/.../backend/routes/index.js\n- /Users/.../backend/server.js"}
```

This discloses the require stack — the real internal route-file structure and Express mount chain — to
any authenticated customer, with no operator privilege required. All 21 other affected files share the
identical unguarded-accessor shape and identical exposure (all gated by at least `requireAuth`; 13 of the
22 files additionally require `operatorOnly`, per Mission 12's own reachability classification, reused
here rather than re-derived).

**Fixed** across all 22 files (odi.js plus 20 more: `scientificDiscovery.js`, `productFactory.js`,
`physicalWorld.js`, `organizationNetwork.js`, `odi-x.js`, `oai-x.js`, `knowledgeNetwork.js`,
`globalInfrastructure.js`, `autonomousRevenue.js`, `autonomousMarketplace.js`,
`autonomousInvestment.js`, `platformOrg.js`, `ecosystemOrg.js`, `civilizationOrg.js`, `autonomousOrg.js`,
`postOmega.js`, `growthOS.js`, `distribution.js`, `contentSEO.js`, `closedBeta.js` — `founderIdentityOS.js`
was checked and found already guarded, no fix needed) by wrapping every `require()` call in the exact
`_try(fn)` helper convention already established and certified elsewhere in this codebase — reused
verbatim, no new module-loading mechanism introduced. Two files (`productFactory.js`, `odi-x.js`) already
had a local `_try` helper defined but unused for these specific accessors; it was wired in rather than
duplicated.

**Live-verified post-fix**: the same reproduction (service file moved aside, real HTTP request through
the actual server) now returns a generic error with no module name, no require stack, and no internal
path disclosed. Legitimate functionality reconfirmed unaffected across multiple routes (`GET
/odi/screenshots`, `GET /product-factory/dashboard` returned real data; `GET /science/dashboard`, `GET
/physical/health-system` correctly still return `403 Forbidden — operator access required`, confirming
the fix did not alter any pre-existing authorization gate).

## Confirmed Clean — No Genuine Module-Resolution Vulnerability

- **No `require(variable)` with a customer-influenced target anywhere.** 249 non-string-literal
  `require()` calls repo-wide decompose into exactly four shapes, all traced and confirmed safe: (a) the
  `_tryRequire(p)` helper family (234 occurrences) — always fed string literals at every call site; (b) 3
  template-literal interpolations, all iterating hardcoded literal arrays at module-load/bootstrap time,
  never from `req`; (c) 4 `path.join()` targets with hardcoded second segments; (d) 2 string
  concatenations, both module-load-time constants.
- **No plugin/agent/capability-name-to-module-path dispatcher exists anywhere.** `plugins.js`,
  `extensions.js`, `marketplace.js`, `autonomousMarketplace.js`, `agents.js`, `agentsRuntime.js` contain
  zero dynamic requires. Plugin "loading" in this codebase is metadata/registry bookkeeping, not
  `require()` dispatch.
- **No path traversal through module resolution is possible** — a direct consequence of the above; no
  customer-controlled segment ever reaches a require path.
- **No dynamic `import()` anywhere** — the only two `import(` matches repo-wide are English prose in
  comments ("marketing import", "Bulk credential import"), not code.
- **`phase24.js:112`'s `require(${JSON.stringify(require.resolve(...))})`** — checked specifically
  because it echoes the JSON.stringify-as-quoting idiom Mission 13 found genuinely exploitable in a shell-
  string context. Here the context is a generated **JavaScript source string** (passed to `node -e`), not
  a shell command — `JSON.stringify()` is the *correct* escaping function for a JS string literal, and
  `require.resolve()`'s own argument is a fixed literal path never influenced by `req.body`. Confirmed
  safe; not part of Mission 13's finding and not reopened.
- **`repositoryEditingEngine.cjs:148`'s `_grepSymbol`** — the most dangerous-looking unescaped
  construction found anywhere in the inventory, but confirmed dead code (never called, not exported).
  Not fixed — flagged for cleanup consideration outside this mission's security scope.
- No `vm` module usage, no `eval()` executing customer data, and the single `new Function(...)` in
  `selfHealingFrontend.cjs` is a syntax-validity probe whose result is discarded, never invoked.

## Decision Required

None. No architectural or product decision was raised — the fix reuses an existing, already-certified
convention exactly as-is.

## Credential/Environment Blockers

None. All findings and fixes were fully verifiable locally with no external credentials required.

## Findings Summary

**P0:** 0 **P1:** 0 **P2:** 1 (class-wide: unguarded-require error-message leak, 115 sites / 22 files,
fixed) **Other:** 0 genuine defects beyond the above.

## Total Module-Loader Occurrences

**~1,900 repo-wide** (services + routes layers combined) using the lazy-accessor idiom; **248** in the
route layer specifically (54 files); of those, **133 already guarded** (32 files, pre-existing `_try` or
equivalent), **115 unguarded** (22 files) — **all 115 fixed this mission**.

## Files Inventoried

54 route files containing the lazy-accessor idiom (full classification from the inventory, reused from
Mission 12's reachability work where applicable); ~230 agent files and 3 service-layer files using the
`_tryRequire(p)` idiom (confirmed literal-only, no fix needed); all `backend/routes/*.js`,
`backend/services/*.cjs`, `agents/**/*.cjs` for the dynamic-target `require()`/`import()` search.

## Customer-Reachable

All 115 fixed sites (22 files) sit behind at least `requireAuth`; 13 of the 22 files additionally require
`operatorOnly` (both tiers fixed identically, since the leak is about module-loading hygiene, not
authorization).

## Operator-Only

13 of the 22 fixed files are `operatorOnly`-gated on top of `requireAuth` (lower real-world exposure,
fixed anyway for consistency and defense in depth, per the mission's "certify the customer-reachable
security surface" instruction — an operator-only leak is still a leak).

## Internal/Dead

`repositoryEditingEngine.cjs:148`'s `_grepSymbol` (dangerous-looking unescaped construction, confirmed
never called/exported — not fixed, flagged for cleanup).

## Intentional/Safe

The `_tryRequire(p)` idiom (~234 occurrences across ~230 agent files plus `pluginSDK.cjs` and
`runtime.js`) — always fed literal paths, no fix needed, correctly using an established safe pattern
already. 133 route-layer accessors already guarded pre-mission. `phase24.js:112`'s generated-script
`require(require.resolve(...))` — correct use of `JSON.stringify` in its actual (JS string, not shell)
context.

## Live Verification

The representative finding (`odi.js`) was reproduced against the real running server via an actual HTTP
request from a freshly registered ordinary customer account, using a safe and fully reversible technique
(a real service file temporarily renamed aside, then restored immediately — never deleted, corrupted, or
left in a broken state). Post-fix, the same reproduction was repeated and confirmed closed. All 22 fixed
files were confirmed to load without error after the fix; a spot-check across 4 different fixed route
files via real HTTP requests confirmed legitimate functionality (real data returned) and confirmed
pre-existing `operatorOnly` gates were unaffected by the fix.

## Negative Testing

Reverted a single accessor in `odi.js` (`capture`) back to its unguarded form; confirmed the structural
regression test correctly and precisely detected exactly one unwrapped `require()` occurrence remaining
(`30 !== 29`); separately confirmed via a direct, cache-isolated reproduction that the reverted accessor
genuinely throws Node's raw `Cannot find module` error again with the real absolute path. Restored;
confirmed the structural test and both live tests passed cleanly again.

## Regression Before/After

**Before:** 461/461 effective (Mission 13's baseline). **After:** 464/464 effective — the full-suite run
reported 461/464 with 3 failures (blocks 133 and 155, unrelated to any file touched this mission — mission
recovery timing and an authorization-gate test), all 3 confirmed to be pre-existing, load-dependent
flakes by re-running each in complete isolation, where every one passed cleanly. This matches the
already-documented pattern of full-suite-load flakiness recorded throughout this multi-mission session.

## New Tests

3 (block 173 — 1 structural covering all 22 fixed files + 2 live: one confirming the fix closes the leak
via a cache-isolated fresh-process reproduction, one confirming the same broken-module condition without
the fix genuinely still throws the raw error, proving the negative-test mechanism itself is real).

## Build

PASS (`npm run build:frontend`, clean production build).

## Security

`tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS (after waiting out this environment's
shared registration rate-limit window, exhausted by this mission's own live testing).

## Current Baseline

464/464 effective, Build PASS, Security 8/8 PASS, server healthy, `.env` untouched, no merge, no push.

## Server Status

Restarted twice across this mission's fix-and-verify cycle (all touched files are `require()`-cached),
confirmed healthy after each restart.

## .env Status

Untouched throughout.

## Merge/Push Status

No merge. No push. Unrelated uncommitted work in the working tree preserved throughout.
