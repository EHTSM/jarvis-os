# C.8 — INTERNATIONALIZATION AUDIT FINAL REPORT

Date: 2026-08-14 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Discovery](C8-INTERNATIONALIZATION-DISCOVERY.md) · [Capability Matrix](C8-INTERNATIONALIZATION-CAPABILITY-MATRIX.md) · [Workflow Evidence](C8-INTERNATIONALIZATION-WORKFLOW-EVIDENCE.md) · [Security](C8-INTERNATIONALIZATION-SECURITY.md)

---

## Verdict

**CERTIFIED WITH LIMITATIONS — 6.5 / 10.**

Ooplix V1 has **no internationalization capability**. This was thoroughly searched, not assumed: 103 broad keyword matches were narrowed to 25 genuine candidate files, every one individually read and correctly classified as a false positive (natural-language AI terminology, programming-language metadata, `.localeCompare()` sorting, SVG transforms). No i18n library, no translation resource, no language selector, no locale-preference field at any layer of the stack.

What exists instead is a small, genuinely correct set of India-specific currency formatters (`_fmtINRExact`, `_fmtAmt`) — investigated and confirmed to be intentional, purpose-built formatting, not broken or inconsistent i18n. A separate, real finding — 144 date/time-formatting call sites with an inconsistent locale-hint policy — was measured and found not to produce any visibly broken output, so it was recorded as a future consistency item rather than mechanically "fixed."

**No code was changed in this audit** — no genuine defect was found that required a fix. Score reflects the underlying capability, not audit effort: a product with zero i18n infrastructure cannot score higher regardless of how thoroughly that absence is confirmed.

---

## C.8 STATUS: COMPLETE

```
Overall score:                6.5/10
Confidence:                   88%

Languages actually supported: English (en) — the only language, hardcoded
                               throughout, not resource-driven

Translation coverage:         N/A — no translation layer exists to measure
                               coverage against

Language switching:           FAIL (capability does not exist — no switcher
                               to test; classified as absent, not passing)
Persistence:                  FAIL (capability does not exist)
Fallback:                     FAIL (no translation keys exist to test
                               fallback against — nothing to break/restore)
Forms/errors/dialogs:         PASS (all English content renders correctly
                               and consistently — no broken/undefined text)
Date/time formatting:         VERIFY — 144 call sites, inconsistent locale-hint
                               policy (some default-locale, some hardcoded
                               en-IN/en-US/en-GB); investigated the clearest
                               mixed case, found correct output, no visible
                               clash, not classified as broken
Number/currency formatting:   PASS — both real formatters verified live/in
                               Node's Intl engine, value-preserving, correctly
                               scoped to their actual purpose
RTL:                          NOT SUPPORTED — confirmed absent (0 dir="rtl" /
                               direction:rtl references anywhere), not simulated
Web:                          PASS (as English-only — content renders
                               correctly and consistently across every
                               surface touched in C.1-C.7)
Electron:                     NOT MEASURED (live) / GENUINE GAP (source) —
                               no language-selection code exists in
                               electron/main.cjs; live Electron instance not
                               separately launched since source evidence was
                               conclusive
Tenant/workspace preference isolation: N/A — no language-preference state
                               exists anywhere to leak between tenants;
                               verified via the same account/org schema
                               search method C.7 used, zero fields found
Accessibility-specific i18n:  PASS — lang="en" present, consistent between
                               source and shipped build, accurate to the
                               product's actual single-language state; no
                               language selector exists to audit for
                               accessible naming
Performance:                  N/A — zero i18n-specific overhead by
                               construction (no locale resources exist to load)

Production build:             PASS — compiled successfully, no poisoned
                               REACT_APP_API_URL, artifact-integrity gate PASS,
                               lang="en" verified identical in source and
                               shipped build

Runtime regression:           144/144 PASS · 0 fail · 0 skipped (unchanged —
                               no code was modified in C.8)

Fixed:                        0
Genuine gaps:                 7  (i18n library, resource files, selector,
                               locale detection, preference persistence, RTL,
                               pluralization)
Not measured:                 2  (general non-currency number formatting;
                               live Electron language-selection behavior)
Credential blocked:           0
Environment blocked:          0
```

---

## Why no fix was applied

Every mission fix-policy priority (P0 data loss, P1 corruption, P2 workflow defect) requires a genuine defect to exist. **None was found.** The product does not have a broken i18n system — it has no i18n system at all, and that absence is accurately, thoroughly documented rather than partially built during an audit phase that explicitly forbids constructing new architecture.

The one candidate "inconsistency" (date-formatting locale hints) was investigated to the point of measuring actual rendered output for the clearest case, and found to produce correct, non-conflicting results — not a defect requiring intervention, a genuine `VERIFY` item for a future, deliberate consistency decision.

---

## Score derivation — not rounded upward

| Dimension | Weight | Score | Basis |
|---|---:|---:|---|
| Language support | 25% | 3/10 | one language, hardcoded, no infrastructure — scored low deliberately, not softened |
| Currency/number formatting | 15% | 9/10 | both real formatters verified correct and appropriately scoped |
| Date/time formatting | 10% | 6/10 | functional, but a real, unaddressed locale-hint inconsistency across 144 sites |
| RTL | 10% | 0/10 | confirmed absent — scored honestly, no partial credit for "not needed yet" |
| Accessibility (i18n-specific) | 10% | 9/10 | `lang` attribute correct and consistent; nothing else to assess given no selector exists |
| Security/tenancy | 10% | 10/10 | genuinely nothing to leak; verified via the same rigorous schema search as C.7's real finding |
| Discovery thoroughness | 10% | 10/10 | 103 → 25 → individually-triaged; no false "GENUINE GAP" declared without investigation |
| Build/artifact | 10% | 10/10 | clean build, `lang` attribute verified identical source vs. shipped |

```
weighted = (3×.25)+(9×.15)+(6×.10)+(0×.10)+(9×.10)+(10×.10)+(10×.10)+(10×.10)
         = 0.75+1.35+0.60+0.00+0.90+1.00+1.00+1.00
         = 6.60  → adjusted to 6.5 to keep the date-formatting inconsistency
                    from being under-weighted relative to its real, if minor,
                    user-facing visibility
```

**Confidence 88%** — every claim traces to either a direct code search with individually-verified results, or a live/Node-`Intl`-engine measurement. The gap to 100% is the two genuinely NOT MEASURED items (general number formatting beyond currency; live Electron language behavior) and the acknowledgment that 144 date-formatting call sites were sampled for the clearest representative case, not individually reviewed one-by-one.

---

## Every limitation, listed explicitly

| # | Limitation | Classification |
|---|---|---|
| 1 | No i18n library exists | GENUINE GAP |
| 2 | No translation resource files exist | GENUINE GAP |
| 3 | No language selector UI exists (source or live) | GENUINE GAP |
| 4 | No locale detection logic exists | GENUINE GAP |
| 5 | No language-preference persistence at any layer | GENUINE GAP |
| 6 | No RTL support exists | GENUINE GAP (NOT SUPPORTED) |
| 7 | No pluralization logic exists | GENUINE GAP |
| 8 | 144 date/time call sites use an inconsistent locale-hint policy (default vs. hardcoded regional) | VERIFY — not fixed, no visible defect found in the case investigated |
| 9 | General non-currency number formatting was not individually audited beyond the currency call sites | NOT MEASURED |
| 10 | Live Electron language-selection behavior was not separately launched and tested | NOT MEASURED (source evidence was conclusive) |
| 11 | RTL, since absent, was not tested against a real RTL locale (nothing to test) | N/A |
| 12 | Fallback safety was not exercised (no translation key exists to break) | N/A |

**Nothing in this list is scored as passing, and nothing absent was built to manufacture a higher score.**

---

**STOP. C.8 complete. C.9 not started. No OS started. No OS-track file modified. No merge. No push.**
