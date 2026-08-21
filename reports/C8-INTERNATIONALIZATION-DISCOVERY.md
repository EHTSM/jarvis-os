# C.8 — INTERNATIONALIZATION DISCOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Capability Matrix](C8-INTERNATIONALIZATION-CAPABILITY-MATRIX.md) · [Workflow Evidence](C8-INTERNATIONALIZATION-WORKFLOW-EVIDENCE.md) · [Security](C8-INTERNATIONALIZATION-SECURITY.md) · [Final](C8-INTERNATIONALIZATION-FINAL.md)

---

## Baseline

```
git status           : 153 uncommitted files (carried from C.1-C.7, not C.8's own)
branch                : security/reality-completion
npm run test:runtime  : 144 tests · 50 suites · pass 144 · fail 0 · skipped 0
.env changes          : 0
```

---

## Method — broad search before judgment, per Rule 1

The mission is explicit: do not assume "only English exists" without searching. Every search below was run against the real codebase, and every candidate hit was individually inspected — not counted from a raw grep match count.

### i18n libraries

```
grep -E '"(i18next|react-i18next|react-intl|formatjs|@formatjs|polyglot|lingui|globalize)"' frontend/package.json
  -> 0 matches
```

### Locale/translation file patterns

```
find frontend/src -iname 'locales' -o -iname 'translations' -o -iname 'i18n*' -o -iname 'lang*'
find frontend -iname 'en.json' -o -iname 'es.json' -o -iname 'fr.json' -o -iname '*.lang.json'
  -> 0 matches, either search
```

### Broad keyword search, then individually triaged

A raw search for `language|locale|i18n|translat` across `frontend/src` returned 103 file matches. Narrowing to genuine JS/JSX files (excluding CSS false positives on `font-family`) gave 25 candidates. **Every one of the 25 was read individually** — not sampled, not assumed:

| Pattern found | Count | Verdict |
|---|---:|---|
| "natural language" (AI command interface terminology) | 9 | False positive — refers to conversational AI input, not i18n |
| "programming language" (CodeMirror, repo metadata, GitHub API fields) | 6 | False positive — refers to source-code languages (JavaScript, TypeScript, etc.) |
| `.localeCompare()` for array sorting | 2 | Real API use, but for **alphabetical sort order**, not UI translation |
| SVG `transform="translate(...)"` (regex matched "translat" substring) | 2 | False positive — SVG pan/zoom transform, unrelated |
| "plain language" / "plain-English" (marketing copy, calmer error copy) | 4 | False positive — describes writing style, not a translation feature |
| `language` as a data field name (repo language, GitHub trending filter) | 2 | Real field, but means "programming language" (e.g. "TypeScript"), not UI locale |

**Zero of the 25 files contain genuine internationalization logic.**

### Intl API usage — the one real, working localization surface

```
grep -l 'Intl\.' across frontend/src -> 2 files
  ContactsV2.jsx : Intl.NumberFormat("en-IN", {style:"currency", currency:"INR", ...})
  BusinessOS.jsx : Intl.NumberFormat(undefined, {style:"currency", currency, ...})
```

**Investigated in full, not just found.** `ContactsV2.jsx`'s formatter is named `_fmtINRExact` — it is an **Indian Rupee-specific formatter**, deliberately hardcoded to `en-IN` because that is the locale that produces India's lakh/crore digit-grouping convention (`₹12,34,568`, not `₹1,234,568`) for the ₹ symbol. This is correct currency-specific logic, not a locale defect — it was not written to be a general-purpose multi-locale formatter and was never intended to be one.

`BusinessOS.jsx`'s `_fmtAmt` **is** a general-purpose multi-currency formatter and correctly passes `undefined` as the locale argument — meaning "use the browser's current locale," genuinely locale-aware. Verified live in Node: `Intl.NumberFormat("en-IN",...)` and `Intl.NumberFormat(undefined,...)` both produce correct, value-preserving output for `1234567.89`, `0`, and negative values.

**Conclusion: no inconsistency to fix** — two differently-scoped functions, each correctly implemented for its actual purpose.

### Backend — account/organization schema

```
grep -n 'locale' backend/services/accountService.js backend/services/organizationService.cjs
  -> 0 matches
```

**No locale or language-preference field exists anywhere in the account or organization data model.** No backend endpoint accepts or returns a language preference.

### Document language attribute

```
frontend/public/index.html : <html lang="en">
frontend/build/index.html  : <html lang="en">    (matches source exactly)

grep -rln 'documentElement.lang|documentElement.setAttribute.*lang' frontend/src
  -> 0 matches
```

Static, consistent between source and shipped build, never dynamically altered — accurate given no i18n exists.

### Language selector UI

```
find frontend/src -iname '*languageselect*' -o -iname '*localeselect*' -o -iname '*langswitch*'
  -> 0 matches

live check: Settings page body text scanned for /language|locale|idioma|langue|sprache/i
  -> false (no match, live authenticated session)
```

**No language selector exists in source or in the live, authenticated Settings surface.** `ThemeToggle.jsx` was checked for comparison — it demonstrates the codebase has a working, established pattern for exactly this kind of user-facing, persisted preference selector, so a future i18n implementation would have clear precedent to follow. This is context, not a defect.

### RTL support

```
grep -rln 'dir="rtl"|direction:\s*rtl|\[dir=' frontend/src
  -> 0 matches
```

**No RTL handling exists anywhere** — no CSS logical-property usage audit was needed beyond confirming zero `dir`/`direction:rtl` references exist to test.

### Electron

```
grep -n 'language|locale' electron/main.cjs
  -> 1 match: a.name.localeCompare(b.name)   (alphabetical file sort, not i18n)
```

Same pattern as the frontend — no genuine language-selection or locale-persistence code exists in the Electron main process.

---

## Conclusion of discovery

**Ooplix V1 has no internationalization capability.** This is a genuine, thoroughly-searched finding, not an assumption made from the first search path returning empty. Every candidate signal (103 broad matches → 25 individually-triaged files → 2 real `Intl` API uses, both investigated to their actual purpose) was chased down and resolved, not dismissed on sight.

**No fix was required or attempted** — there is no broken i18n system to recover, no fallback logic to test, no translation completeness to measure, because none of these subsystems exist. Building any of them would be new architecture, explicitly forbidden by this audit's mission.
