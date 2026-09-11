# C.8 — INTERNATIONALIZATION CAPABILITY MATRIX

Date: 2026-08-14 · Branch: `security/reality-completion`

Exactly one classification per capability, per Discovery's evidence.
`PRODUCTION READY` · `FIXED` · `VERIFY` · `NOT MEASURED` · `CREDENTIAL BLOCKED` · `ENVIRONMENT BLOCKED` · `GENUINE GAP` · `ARCHIVE`

---

## Language inventory

| Language | Locale | Translation source | Coverage | Frontend | Backend | Persistence | Fallback | Status |
|---|---|---|---:|---|---|---|---|---|
| English | `en` | Hardcoded UI strings (no resource file — strings live directly in JSX) | 100% (it is the only content that exists) | Full | Full | N/A — not a preference, the only state | N/A | **PRODUCTION READY** (as the sole, hardcoded language) |

**No other language is supported at any layer.** No translation file, no locale resource, no second-language string exists anywhere in the codebase. This is a one-row table because there is genuinely one language.

---

## Core i18n infrastructure

| Capability | Classification | Evidence |
|---|---|---|
| i18n library (i18next / react-intl / etc.) | **GENUINE GAP** | Confirmed absent from `package.json` |
| Translation resource files | **GENUINE GAP** | Confirmed absent — no `locales/`, `translations/`, `*.lang.json` anywhere |
| Language selector UI | **GENUINE GAP** | Confirmed absent in source and live in the authenticated Settings page |
| Locale detection (browser/device) | **GENUINE GAP** | No `navigator.language` usage found driving any UI decision |
| Language preference persistence (any scope) | **GENUINE GAP** | No field in account or organization schema |
| Fallback logic for missing translations | **N/A** | Nothing to fall back from — there is no translation layer |
| RTL support | **GENUINE GAP** | Confirmed absent — 0 `dir="rtl"` / `direction:rtl` references anywhere |
| Document `lang` attribute | **PRODUCTION READY** (for its actual scope) | Static `lang="en"`, consistent between source and shipped build, accurately reflects the product's actual single-language state |

---

## Formatting

| Capability | Classification | Evidence |
|---|---|---|
| Currency formatting — INR-specific (`_fmtINRExact`) | **PRODUCTION READY** | `Intl.NumberFormat("en-IN", {style:"currency", currency:"INR"})` — deliberately locale-pinned for correct lakh/crore grouping; verified live: `₹12,34,568` for 1234567.89, `₹0` for 0, `-₹1,234` for -1234, all value-preserving |
| Currency formatting — general purpose (`_fmtAmt` in BusinessOS.jsx) | **PRODUCTION READY** | `Intl.NumberFormat(undefined, {style:"currency", currency})` — genuinely locale-aware (adapts to the browser's active locale); verified live |
| Date/time formatting | **VERIFY** | 144 genuine `Date.toLocaleDateString`/`toLocaleTimeString` call sites found. Mix of default-locale (`[]`/`undefined`, adapts to environment) and hardcoded regional hints (`en-IN`, `en-US`, `en-GB`) with no single consistent policy. 3 components mix both patterns internally (`CommandCenter.jsx`, `ContentSEO.jsx`, `WorkflowOSV2.jsx`). Investigated the clearest case (`CommandCenter.jsx`): a timeline event time (`10:39:07 PM`, default locale) and a page-header date (`Fri 14 Aug`, hardcoded `en-GB`) — different formats for different purposes, both individually correct and readable, not a visible clash. **Not classified as a defect** — no broken or confusing output was found — but the inconsistent locale-hint policy is real and worth a future consistency pass. See Findings note below. |
| Number formatting (non-currency) | **NOT MEASURED** | Only the two currency call sites (`_fmtINRExact`, `_fmtAmt`) were found and verified; general non-currency numeric formatting across the other 108 plain `toLocaleString()` calls was not individually audited for correctness beyond confirming the pattern is locale-adaptive by construction |
| Pluralization | **GENUINE GAP** | No pluralization library or logic found (would require i18n infrastructure that does not exist) |
| Relative time (e.g. "2 hours ago") | **VERIFY** | `_timeAgo`-style hand-written helpers confirmed present in prior C-phase reading (e.g. C.1's ContactsV2 work); not re-verified for locale-correctness in this pass beyond confirming they exist and are not raw `Date.toLocaleString` calls |

---

## Journeys — since no language switching exists, most journey checks are N/A by definition

| Journey | Classification | Notes |
|---|---|---|
| Language selection | **N/A — capability does not exist** | Cannot test switching a control that isn't present |
| Locale detection on first load | **N/A** | No detection logic exists to test |
| Translation resource loading | **N/A** | No resources exist to load |
| UI change after language switch | **N/A** | No switch exists to trigger |
| Persistence across reload | **N/A** | No preference exists to persist |
| Persistence across logout/login | **N/A** | Same |
| Persistence across tenant/workspace switch | **N/A** | Same |
| Fallback safety (broken/missing key) | **N/A** | No translation keys exist to break |

**These are not failures — they are accurately N/A**, because the mission's own instruction is to measure actual behavior, not force a test against a system that does not exist. Forcing a "FAIL" verdict onto a nonexistent feature would misrepresent the finding.

---

## Environment-specific

| Capability | Classification | Evidence |
|---|---|---|
| Web language selection | **N/A — capability does not exist** | See above |
| Electron language selection | **N/A — capability does not exist** | `electron/main.cjs` confirmed to have no language-selection code (only an unrelated `.localeCompare()` sort) |
| Electron persistence | **N/A** | Same |

---

## Security / tenancy

| Capability | Classification | Evidence |
|---|---|---|
| Tenant A's language preference leaking to Tenant B | **N/A — no such preference exists to leak** | Confirmed no locale field in account/org schema; nothing to isolate |

See [C8-INTERNATIONALIZATION-SECURITY.md](C8-INTERNATIONALIZATION-SECURITY.md) for the full reasoning.

---

## Accessibility — i18n-specific only, per the mission's scope limit

| Check | Classification | Evidence |
|---|---|---|
| Document language attribute present and correct | **PRODUCTION READY** | `lang="en"`, accurate to the actual single-language content |
| Language selector accessible name | **N/A** | No selector exists |
| RTL directional semantics | **N/A** | No RTL support exists |

**C.1's full accessibility certification was not re-run**, per the mission's explicit instruction. Only these three i18n-specific checks were performed.

---

## Performance — i18n-specific only, per the mission's scope limit

| Measure | Classification | Evidence |
|---|---|---|
| Initial locale loading overhead | **N/A** | No locale resources exist to load — zero overhead by construction |
| Language switching overhead | **N/A** | No switch mechanism exists |
| Translation resource loading | **N/A** | No resources exist |

**C.3's full performance audit was not repeated.**

---

## Summary counts

| Classification | Count |
|---|---:|
| PRODUCTION READY | 4 (English content, `lang` attribute, both currency formatters) |
| GENUINE GAP | 7 (i18n library, resource files, selector, detection, persistence, RTL, pluralization) |
| VERIFY | 2 (date/time formatting locale-hint inconsistency, relative time helpers) |
| NOT MEASURED | 1 (general non-currency number formatting) |
| N/A (capability does not exist to test) | 14 (all journey/environment/security/accessibility/performance rows contingent on i18n existing) |
| FIXED | 0 |
| CREDENTIAL BLOCKED | 0 |
| ENVIRONMENT BLOCKED | 0 |
| ARCHIVE | 0 |
