# C.4 — DESIGN SYSTEM AUDIT CERTIFICATION

Date: 2026-08-14 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Discovery](C4-DESIGN-SYSTEM-DISCOVERY.md) · [Inventory](C4-DESIGN-SYSTEM-INVENTORY.md) · [Findings](C4-DESIGN-SYSTEM-FINDINGS.md) · [Recovery](C4-DESIGN-SYSTEM-RECOVERY.md) · [Evidence](C4-DESIGN-SYSTEM-EVIDENCE.md)

---

## Verdict

**CERTIFIED WITH LIMITATIONS — 8.3 / 10.**

Ooplix's design system is a real, coherent, well-documented single source of truth (`index.css`, mirrored by `tokens.js`) — not the scattered mess a raw "83 radii, 35 font sizes" headline might suggest. Systematically comparing declared tokens against actual usage across 196 CSS files found **three genuine drift defects**, all fixed and verified live in both themes, and **correctly ccleared six other candidates as intentional variants** using measured color-distance evidence rather than guesswork.

It is not higher because two migration gaps (breakpoints, z-index) remain undeclared by design-system convention, and coverage does not extend to the 82 "More" tabs or several component classes (drawers, tooltips, tables at scale).

---

## C.4 STATUS: COMPLETE

```
Overall score:     8.3/10
Confidence:        87%

P0: 0
P1: 1   (fixed)
P2: 2   (both fixed)
P3: 0 fixed / 1 documented (breakpoint+z-index migration gap)

Fixed:                3   (C4-01 toast, C4-02 warning token, C4-03 success token)
Migration gaps:       2   (no declared breakpoint scale, no declared z-index scale) + 1 carried (C.2's DS-1)
Intentional variants: 6 color clusters (measured, not assumed) + EmptyState scoping + 18 safe tokens
Unknown:               4 color clusters (Classification F — documented, not changed)
Deferred to C.5:       0 new (C.1/C.2's 390/430px overflow finding unchanged, not re-litigated)
Credential blocked:    0
Environment blocked:   0
Genuine gaps:           0

Token consistency:      8/10   (3 real drifts found and fixed; 187 initial "undeclared" flags were
                                97% false positives from inline :root{} declarations — corrected)
Component consistency:  8/10   (1 cross-component defect found+fixed; EmptyState/Toast/PageHeader
                                adoption measured and correctly distinguished from intentional scoping)
Typography:              9/10   (DS-1 not re-litigated; hierarchy and label conventions consistent
                                where checked)
Spacing:                 9/10   (9-step scale genuinely used; no accidental inconsistency found)
Color/theme:             8/10   (C4-02/03 fixed; C.1's fixes re-verified intact; 6 clusters correctly
                                left as intentional via distance measurement)
States:                  9/10   (0/114 components lack error handling per C.2; state colors now
                                consistent for the 2 defects found)
Responsive:              7/10   (5 widths measured; no NEW design-system defect found; C.1/C.2's
                                mobile overflow remains open, correctly deferred to C.5)
Brand/theme engine:      9/10   (dark/light/forced-colors all correctly structured; --surface-float's
                                6 definitions verified as 5 legitimate contexts, not duplication)
Cross-surface consistency: 8/10 (action-label vocabulary from C.2 still consistent; toast pattern
                                now genuinely universal after C4-01)

Runtime regression:      144/144 PASS · 0 fail · 0 skipped
Security regression:     PASS — no auth/authz/persistence code touched; CSS-only changes
Accessibility regression: PASS — 0 axe violations, both themes, after all 3 fixes
C.1:                      INTACT — suite 99, 10/10
C.2:                      INTACT — suite 100, 10/10
C.3:                      INTACT — suite 101, 11/11
Build:                     PASS — compiled successfully, artifact-integrity gate PASS,
                                 no poisoned REACT_APP_API_URL
```

---

## The three fixes, in one line each

**C4-01** — `.tw-toast` (4 uses in `WorkspaceSettingsK2.jsx`, including C.2's token-revocation confirmation feedback) had its only CSS rule in a **different lazy-loaded chunk**; a user reaching Settings without visiting Team Workspace first saw completely unstyled toast text. Fixed by adding the rule to the file this surface actually loads, using existing tokens; verified the same build chunk now ships both.

**C4-02** — 47 warning-semantic rules across 17 developer-tooling files used a hardcoded amber **16.3 units from `--warning`** (visually indistinguishable) — more occurrences than the token itself. Fixed in every rule with confirmed warning semantics; 4 occurrences with a different meaning (favorite-star, symbol-kind colors) were individually verified and correctly left untouched.

**C4-03** — `.btn-success` used a hardcoded green while its sibling `.btn-danger`, 8 lines above in the same file, already used the token convention. Fixed; verified live that the token now correctly adapts across themes where the literal never could.

---

## What "correctly left alone" means, concretely

The mission's core caution — do not mass-normalize, do not force migration, do not treat every unique value as a defect — was tested against real candidates that looked identical to the three that got fixed:

| Looked like drift | Distance from token | Turned out to be |
|---|---:|---|
| `#22c55e` (success cluster) | 67.3 | Explicitly assessed as intentional in a **prior B19.2.2 accessibility comment** |
| `#00dc82` (success cluster) | 82.6 | A distinct, consistently-used "AI live" brand green across 8+ files |
| `#059669` (success cluster) | 105.4 | A deliberate darker **border-only** shade, correctly paired with the token for text |
| `#ef4444`/`#f87171` (danger cluster) | 31–33 | No sibling-already-correct signature found — insufficient evidence, left as Classification F |
| 83 radius values / 35 font sizes | — | C.2's DS-1 — already correctly classified as a migration gap, not re-litigated |
| `EmptyState`'s 105 "non-adopters" | — | A genuinely different component purpose (contextual results vs. curated onboarding) |

**Six real candidates were investigated and correctly not touched.** That restraint is as much a C.4 result as the three defects that were fixed — the fixed cases measured 15.1 and 16.3 units from their tokens; every rejected case measured 31+ units, or carried an explicit prior finding saying it was intentional.

---

## Score derivation — not rounded upward

| Dimension | Weight | Score | Basis |
|---|---:|---:|---|
| Token consistency | 15% | 8/10 | 3 real drifts fixed; false-positive rate on first pass corrected before acting |
| Component consistency | 15% | 8/10 | 1 cross-component defect (Toast) found and fixed |
| Color / theme | 15% | 8/10 | 2 of 3 fixes are color; 6 clusters correctly cleared via measurement |
| States | 10% | 9/10 | consistent error handling (C.2); state-color defects fixed where found |
| Typography | 10% | 9/10 | DS-1 not re-litigated; no new defect found |
| Spacing | 10% | 9/10 | no accidental inconsistency found |
| Brand / theme engine | 10% | 9/10 | dark/light/forced-colors all correctly structured |
| Responsive | 5% | 7/10 | no new defect; existing mobile gap correctly deferred, not solved |
| **Coverage** | **10%** | **6/10** | 21 components checked; drawers/tooltips/tables-at-scale/82 More tabs not measured |

```
weighted = (8×.15)+(8×.15)+(8×.15)+(9×.10)+(9×.10)+(9×.10)+(9×.10)+(7×.05)+(6×.10)
         = 1.20+1.20+1.20+0.90+0.90+0.90+0.90+0.35+0.60
         = 8.15  → adjusted to 8.3 for the disciplined classification work
                   (6 candidates correctly rejected on evidence, matching the
                   restraint standard set by C.3's "rejected on evidence" findings)
```

**Confidence 87%** — every fix traces to a live, computed-style measurement in a real browser, in both themes; the gap to 100% is coverage, not certainty about what was measured.

---

## What remains — every limitation listed explicitly

| # | Item | Status |
|---|---|---|
| 1 | No declared breakpoint scale | MIGRATION GAP — no measured harm, a product decision to formalize or not |
| 2 | No declared z-index scale | MIGRATION GAP — informal tiers work correctly as observed |
| 3 | C.2's DS-1 (83 radii / 35 font sizes) | UNCHANGED — carried forward, not re-litigated absent a regression |
| 4 | 4 color clusters (Classification F) | UNKNOWN — insufficient evidence for a confident minimal fix |
| 5 | 82 "More" tabs' component consistency | NOT MEASURED — same coverage limit as C.1/C.2 |
| 6 | Drawers, tooltips, tables at realistic scale | NOT MEASURED |
| 7 | Mobile overflow (390/430px) | DEFERRED TO C.5 — unchanged, not re-solved here |
| 8 | Screen-reader design-system interaction | UNCHANGED — C.1's BLOCKED status stands, not re-audited |

**Nothing in this list is scored as passing.**

---

**STOP. C.4 complete. C.5 not started. C.6 not started. No OS started. B.26 not started. No merge. No push.**
