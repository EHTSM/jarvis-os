# C.4 — DESIGN SYSTEM FINDINGS

Date: 2026-08-14 · Branch: `security/reality-completion`

Ranked P0–P3. Every finding classified A–F per the mission's taxonomy.
`A` true duplicate · `B` true drift · `C` intentional variant · `D` migration gap · `E` component-local · `F` unknown

---

## Summary

| Rank | Count | Fixed |
|---|---:|---:|
| **P0** | 0 | — |
| **P1** | 1 | 1 |
| **P2** | 2 | 2 |
| **P3** | 0 fixed / 1 documented | 0 |
| **Classification C (intentional, left alone)** | 6 clusters | n/a |
| **Classification E (component-local, correctly scoped)** | 1 major (EmptyState) + 18 tokens | n/a |
| **Classification D (migration gap, documented only)** | 2 (breakpoints, z-index) | 0 |

---

## P1 · C4-01 — `.tw-toast` unstyled outside its own chunk

**Classification: B — true design-system drift.**

`WorkspaceSettingsK2.jsx` uses `className="tw-toast"` **4 times** (Sessions and Tokens panels — including the C.2 confirmation-dialog feedback for token revocation) but has **no CSS file of its own**. Every `k2-*` class is supplied by `WorkspaceSettings.css`, loaded when `WorkspaceSettings.jsx` imports its panels. `.tw-toast`'s only rule lived in `TeamWorkspace.css` — a **separate lazy-loaded chunk**.

**Verified live**, not assumed:

```
build chunk shipping k2-tokens-panel : 3297.45eadfcf.chunk.css
build chunk shipping .tw-toast rule  : 7070.b71fbcba.chunk.css   ← different chunk

injecting .tw-toast without visiting Team Workspace first:
  position: static · background: transparent · border: none · radius: 0 · padding: 0
```

Any user who opens Workspace Settings without having separately visited Team Workspace in that session sees **completely unstyled feedback text** for actions like "Token revoked."

**Fix:** added `.tw-toast` to `WorkspaceSettings.css` — the file this surface actually loads — using existing tokens (`--surface-high`/`-base`, `--border`, `--text`, `--radius-pill`, `--dur-enter`/`--ease-spring`) and the exact visual rule `TeamWorkspace.css` already established, including its `prefers-reduced-motion` guard. No new pattern invented.

**Verified after fix:** navigating to Settings through the real UI (no prior Team Workspace visit) loads a stylesheet containing `.tw-toast`; the rule is confirmed present in the same build chunk that ships `k2-tokens-panel`.

---

## P2 · C4-02 — developer-tooling warning color bypassed the token

**Classification: B — true design-system drift.**

**47 occurrences across 17 developer/engineering-tooling files** (DOP1/DOP2 Dashboards, AutonomousOps, CredentialDashboard, DecisionsPanel, SmellsPanel, PatchPreviewPanel, EngineeringConsole, RuntimeDebugger, VisualArchitecture, and others) used a hardcoded `#fbbf24` for warn/medium-severity/degraded/pause states — **more occurrences than the `--warning` token itself (12)**.

```
distance from --warning (#f0b429): 16.3 on a 0-441 scale — visually indistinguishable
```

The clearest signal: several of these same files already used `var(--warning-muted)` for the **background** half of the identical badge, with the literal hex only on the **text**:

```css
.smell-sev-badge--medium { background: var(--warning-muted); color: #fbbf24; }
```

**Fix:** replaced `#fbbf24` with `var(--warning)` in every rule confirmed to carry warning/medium-severity/degraded/pause/alert semantics.

**Deliberately excluded** — same hex, different meaning, confirmed by individual inspection:

| File | Rule | Actual meaning |
|---|---|---|
| `FileExplorer.css` | `.file-explorer__fav-btn--on` | favorited/starred state |
| `SymbolPanel.css` | `.sp-row--function .sp-row__icon` | function-type syntax color |
| `CodeEditorPane.css` | `.cep-breadcrumb__sym` | symbol-kind indicator |
| `FuzzyFinder.css` | `.ff-item__kind` | symbol-kind indicator |

These four were checked individually and left untouched — a blind find-and-replace would have silently changed unrelated UI meaning.

---

## P2 · C4-03 — `.btn-success` bypassed its own sibling's convention

**Classification: B — true design-system drift.**

```css
.btn-danger {                          /* 8 lines above, ALREADY correct */
  color: var(--danger);
}
.btn-success {                         /* used a literal instead */
  color: #4ade80;                      /* 15.1 from --success (#52d68a) — near-identical */
}
```

The two classes sit adjacent in `App.css`, share identical structure, and one already followed the token convention — the clearest possible signature of an accidental miss rather than a deliberate choice.

**Fix:** `color: var(--success)`. **Verified live in both themes:**

```
dark  : rgb(82, 214, 138)  = #52d68a  (exact token match)
light : rgb(28, 118, 67)   = #1c7643  (the B19.2.2-recalibrated light token)
```

The hardcoded literal would never have adapted to light mode; the token now does.

---

## Classification C — intentional variants, correctly left alone

Distance-from-token was the deciding evidence in every case below. All measure **substantially farther** from their nearest semantic token than the two fixed defects (15.1–16.3), and each shows a consistent, deliberate usage pattern rather than accidental drift.

| Color | Distance from token | Where used | Why intentional |
|---|---:|---|---|
| `#22c55e` | 67.3 from `--success` | status dots, "online" indicators, 20+ files | B19.2.2 comment explicitly documents this as an **assessed, intentional dark-mode choice** — re-litigating it would contradict a prior accessibility phase's own finding |
| `#00dc82` | 82.6 from `--success` | AI "live" badges (JarvisBrainCenter, AutonomyScoreCenter, AgentActionCenter) | A distinct brand-adjacent "AI is active" green, used consistently across 8+ files for one specific meaning |
| `#059669` | 105.4 from `--success` | **borders only**, paired with `var(--success)` text/background in 15+ files | Deliberate darker-shade border convention — `.risk--low { color: var(--success); border-color: #059669; }` — token used correctly where it belongs, distinct shade used correctly where a darker border reads better |
| `#eab308`, `#f59e0b` | not measured individually | scattered warning-adjacent uses | Distance and volume did not clear the bar that made `#fbbf24` unambiguous; **left as Classification F (insufficient evidence)**, not swept |
| `#ef4444`, `#f87171` | 33.1 / 31.3 from `--danger` | scattered, one already paired with `var(--danger)` for text | No "sibling already uses the token" signature found (unlike C4-03); insufficient evidence for a confident minimal fix |
| `#7f1d1d`, `#fca5a5` | 147.0 / 104.9 from `--danger` | dark alert backgrounds, pale tint variants | Clearly deliberate shade variants (a near-black maroon background, a pale pink tint), not near-misses |

**None of these was changed.** Flattening them would have violated the mission's explicit prohibition on mass-normalizing every unique value.

---

## Classification E — component-local, correctly scoped

- **18 CSS custom properties** with no inline setter, all falling back to a dimension or a theme-token reference (never a literal color) — safe by construction, no C1-D2/D3-class risk.
- **`EmptyState.jsx`** — explicitly variant-driven for curated onboarding guidance (`variant="pipeline"`); the 105 components with local "empty" markup serve a genuinely different need (contextual search/filter results), not a missed adoption.
- **9 inline-set custom properties** (`--pct`, `--sev`, `--verdict-color`, `--plan-color`, `--score-color`, `--sev-color`, `--lsp-color`, `--cap-color`, `--pack-*`) — a standard, correctly-used CSS idiom for per-instance JS-driven styling.

---

## Classification D — migration gaps, documented only

| Gap | Evidence | Why not fixed |
|---|---|---|
| **No declared breakpoint scale** | 640/720/600/480/900px most common; dozens of literal values | No measured cross-surface inconsistency causing user confusion. Declaring a formal scale is a product-wide decision the mission says not to force. |
| **No declared z-index scale** | Informal but sensible tiers (1/10/100/200/900–9999) | Same — works correctly as observed; formalizing it is a migration decision, not a bug fix. |
| **83 radii / 35 font sizes** (C.2's DS-1) | Unchanged — re-confirmed, not re-litigated | Already correctly classified by C.2; C.4 did not reopen it absent a discovered regression. |

---

## Classification F — insufficient evidence

`#eab308`/`#f59e0b` (warning-adjacent) and `#ef4444`/`#f87171` (danger-adjacent) did not show the decisive "sibling class already uses the token" or "same rule mixes token background with literal text" signature that made C4-01/02/03 unambiguous. **Documented, not changed** — guessing at a fix here would have violated the mission's evidence requirement.

---

## Deferred to C.5 — recorded, scope not expanded

No mobile-specific design-system defect was found in C.4. The `.tw-toast` fix reproduces identically at every width (it is a chunk-loading defect, not a responsive one), so nothing new is added to C.1/C.2's existing 390/430px overflow finding, which remains assigned to C.5 unchanged.

## Deferred to Accessibility — none

No accessibility-only defect was found that C.1 had not already addressed; C.1's fixes were re-verified intact, not re-audited.
