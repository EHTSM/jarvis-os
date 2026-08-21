# C.4 — DESIGN SYSTEM DISCOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Inventory](C4-DESIGN-SYSTEM-INVENTORY.md) · [Findings](C4-DESIGN-SYSTEM-FINDINGS.md) · [Recovery](C4-DESIGN-SYSTEM-RECOVERY.md) · [Evidence](C4-DESIGN-SYSTEM-EVIDENCE.md) · [Certification](C4-DESIGN-SYSTEM-CERTIFICATION.md)

---

## Baseline

```
git status          : 77 uncommitted files (carried from C.1/C.2/C.3, not C.4's own)
branch               : security/reality-completion
npm run test:runtime : 144 tests · 50 suites · pass 144 · fail 0 · skipped 0
.env changes         : 0
```

## What the design system actually is

No Tailwind config. No shadcn. The design system is a **hand-authored CSS custom-property system**:

```
frontend/src/index.css        1,026 lines — single declared source of truth
frontend/src/design/tokens.js   138 lines — explicit JS MIRROR of index.css
                                             ("Source of truth remains index.css")
```

`tokens.js`'s own header makes the authority relationship explicit, which is what makes drift between the two a real, checkable finding rather than a judgment call.

### Declared token catalogue (index.css)

```
Color      : canvas/surface (7) · elevation layers (3) · borders (3) · brand (5)
             semantic success/warning/danger/info + muted + border variants (16)
             text (3) · "on-*" contrast pairs for AA compliance (6)
Typography : font-mono, label tracking/size/weight, hero/lead/sub clamp() scales (9),
             display/title/body/caption/micro (5)
Radius     : 7 steps (xs → pill)
Shadow     : 5 elevation levels + 4 glow variants
Spacing    : 9-step scale (4px → 48px)
Motion     : 4 easings, 5 durations
Z-index    : no declared scale — literal values throughout (see below)
Breakpoints: no declared scale — literal values throughout (see below)
```

Plus a **documented legacy-alias layer** (`--fg`, `--bg2`, `--os-void`, `--card-bg` → canonical tokens) — evidence of prior deliberate consolidation work, not current drift.

### Theme structure — verified, not assumed

```
:root                              dark (default)
:root[data-theme="light"]          explicit light choice
@media (prefers-color-scheme:light) system-preference fallback
forced-colors (high-contrast)       dark AND light variants
```

`--surface-float` appearing 6 times is **not duplication** — it is exactly these 5 legitimate contexts (one context, dark+light forced-colors, needed 2 lines).

### Accessibility history already recorded in the tokens themselves

The light-theme block carries **inline, dated remediation history**:

```
B19.2   : semantic colors recalibrated — were 1.70-1.93:1 on white, now clear 4.5:1
B19.2.2 : re-recalibrated against TINTED backgrounds (chips/badges), not just white
B19.2.2 : --accent darkened 2% in dark mode — 4.36-4.46:1 -> 4.52:1 worst case
```

**C.1's fixes were re-verified intact**, not re-audited from scratch: `--surface-float` used correctly in both `CustomerFirstRunWizard.css` and `CommandCenter.css`; the only remaining matches for `--surface-elevated`/`--surface-2, #` are inside C.1's own explanatory comments.

---

## Method

Every finding in this audit followed the same discipline: **compare DECLARED tokens against ACTUAL usage**, not "does this value look unusual." Three passes:

1. **Naive declaration scan** (`^\s*--x:`) — found 187 "undeclared" tokens, almost all false positives from inline `:root { --x: y; }` one-liners my first regex missed.
2. **Corrected declaration scan** (catches `{`/`;`-prefixed inline declarations) — narrowed to 29 real candidates.
3. **Per-token investigation** — for each of the 29, checked (a) is it set inline via `style={{...}}` in the matching JSX, and (b) if never set, is its fallback a literal color (risk) or a dimension/theme-token (safe).

This is the same discipline C.1 used to find C1-D2/D3 (undefined token + hardcoded dark fallback) — applied here systematically across the whole custom-property surface rather than to two known files.

---

## What that method found

**27 of 29 "undeclared" tokens were correctly wired or safely scoped:**

- 9 correctly set inline via `style={{ "--x": value }}` (`--pct`, `--sev`, `--verdict-color`, `--plan-color`, `--score-color`, `--sev-color`, `--lsp-color`, `--cap-color`, `--pack-*`)
- 18 never set inline, but every fallback is a **dimension or a theme-token reference** (`var(--border)`, `var(--surface-base)`, `56px`, `-0.02em`) — never a literal color. **No C1-D2/D3-class risk found.**

**Zero new instances of the C.1 defect pattern** (undefined token + hardcoded-color fallback) were found anywhere in the custom-property layer.

## What else the method found — beyond tokens

Two further passes were run per the mission's Step 8/9 requirements:

- **Shared-primitive adoption.** `EmptyState`/`Toast`/`PageHeader` exist as real shared components, used by 7–9 files each, while 105 components use local "empty" markup and 23 have local toast state. **Investigated before judging**: `EmptyState` is explicitly variant-driven for onboarding-style guidance (`variant="pipeline"`), not a generic wrapper — the 105 local instances are contextual search/filter empty results, a genuinely different need. **Correctly classified E (component-local), not drift.**

- **Semantic state-color literal audit.** Grouped every hardcoded hex found inside a `success`/`warning`/`error`/`danger`-named CSS rule and measured its Euclidean distance from the matching token. This surfaced three real findings (below) and correctly cleared several near-misses as intentional variants.

## Breakpoints and z-index — measured, not scored as broken

```
breakpoints in use (max-width, top 5): 640px(39) 720px(23) 600px(12) 480px(12) 900px(10)
z-index in use (top 5)               : 1(27) 200(26) 9999(12) 100(7) 9000(6)
```

No declared breakpoint scale exists; z-index shows sensible informal tiers (1 / 10 / 100 / 200 / 900–9999 for overlays) despite no formal declaration. **Neither is scored as a defect** — the mission requires evidence of a genuine cross-surface inconsistency causing real confusion, not merely the absence of a formal scale. No such inconsistency was found in the surfaces measured.

---

## Surfaces measured

| # | Area | Method |
|---|---|---|
| Token inventory | declared vs. used across 196 CSS files, corrected for inline `:root{}` declarations |
| Color/theme | dark + light rendered, `--success`/`--warning`/`--danger` distance-from-token analysis |
| Component consistency | EmptyState/Toast/PageHeader adoption measured, not assumed |
| State consistency | success/warning/error hex fragmentation quantified per state |
| C.1 fix integrity | `--surface-float` usage re-verified live, not re-audited from scratch |
| Live rendering | `.tw-toast` and `.btn-success` computed styles checked in a real browser, both themes |
| Build | clean rebuild, artifact-integrity gate, no poisoned `REACT_APP_API_URL` |

**NOT MEASURED (recorded, not scored as passing):** the 82 "More" tabs' internal component consistency (same coverage limit as C.1/C.2); a formal breakpoint/z-index scale audit beyond usage frequency; visual screenshot diffing (computed-style and axe verification were used instead, per the mission's "no claim from source inspection alone" rule).
