# C.4 — DESIGN SYSTEM INVENTORY

Date: 2026-08-14 · Branch: `security/reality-completion`

Actual production usage, measured. Not every unique value is treated as a defect.

---

## Colors

| Semantic role | Dark token | Light token | Notes |
|---|---|---|---|
| background | `--bg` `#05070d` | `#f4f5f8` | |
| surface | `--surface` / `-2` / `-hover` | mirrored | |
| surface elevated | `--surface-base/-raised/-float` | mirrored | 3-tier elevation, documented purpose per tier |
| text | `--text` `#dde2ec` | recalibrated | |
| muted text | `--text-dim`, `--text-faint` | recalibrated | |
| border | `--border`, `-hover`, `-strong` | recalibrated | |
| primary/accent | `--accent` `#8072ff`, `--accent2` `#4ecdc4` | recalibrated | B19.2.2 AA fix already applied |
| success | `--success` `#52d68a` | `#1c7643` | B19.2.2 tuned against tinted backgrounds |
| warning | `--warning` `#f0b429` | `#8c650a` | |
| danger | `--danger` `#f55b5b` | `#d20c0c` | |
| information | `--info` `#5dc8f5` | recalibrated | |
| focus | inherits `--accent`/`--border-hover` | mirrored | |
| disabled | `--text-faint` + reduced opacity (component-local) | mirrored | |

**Fragmentation measured, not assumed:**

```
success  : 9 distinct literal hex in "success"-named rules
           #52d68a(5, =token) #4ade80(1, 15.1 from token — FIXED)
           #22c55e(1, 67.3) #00dc82(1, 82.6) #059669(1, 105.4) — intentional, LEFT
warning  : 10 distinct — #fbbf24(14, 16.3 from token — FIXED, warning-semantic only)
           #f0b429(12, =token) #eab308(8) #f59e0b(3) — not swept, insufficient evidence
danger   : 14 distinct — #f55b5b(22, =token) #ef4444(8, 33.1) #f87171(7, 31.3)
           #7f1d1d(8, 147.0 — deliberate dark bg) #dc2626(1, 79.0) — LEFT, insufficient evidence
```

---

## Typography

```
font sizes in production CSS : 35 distinct px values (C.2's DS-1, re-confirmed unchanged)
clamp() fluid scales         : 9 (hero-xxl/xl/lg, lead, sub, display, title, body, caption, micro)
heading hierarchy            : h1/h2/h3 + .page-title/.section-title conventions, consistent
label convention             : --label-size (11px) / --label-weight (700) / --label-tracking — used
                                consistently across badge/chip/tag components
```

**Not re-litigated.** C.2's DS-1 finding (83 radii / 35 font sizes = a documented migration gap, not a defect) stands. C.4 did not re-measure or re-classify it — the mission explicitly forbids re-running C.1/C.2 work without a discovered regression, and none was found.

---

## Spacing

```
declared scale : --space-1 (4px) through --space-12 (48px), 9 steps
usage          : the scale is genuinely used in most shared surfaces (dialogs, panels, cards);
                 component-local literal padding (e.g. "13px 18px") is common in feature-specific
                 dashboards and was NOT flattened — no evidence any specific instance is accidental
```

No page-gutter or dialog-spacing inconsistency was found that created measurable user confusion. **No spacing change was made.**

---

## Shape

```
radius  : 7-step scale (--radius-xs 6px → --radius-pill 999px), widely used alongside
          literal values (C.2's DS-1 — 83 distinct values, unchanged, migration gap)
shadow  : 5 elevation levels + 4 glow variants, consistently used for depth
border  : 3-tier (--border / -hover / -strong), consistently used
```

**No radius/shadow/border change was made** — no evidence of accidental (vs. intentional) variation beyond what C.2 already documented.

---

## Layout

```
z-index     : no declared scale; informal tiers observed (1/10/100/200/900-9999 for overlays)
breakpoints : no declared scale; 640/720/600/480/900px most common, no canonical set
container   : 960px max-width used consistently for settings-style panels
```

Both recorded as **DESIGN-SYSTEM MIGRATION GAP** candidates — real absence of a formal scale — but **no cross-surface inconsistency causing measurable confusion was found**, so neither was fixed. See Findings.

---

## Interaction states

```
hover/active/focus  : consistently implemented per-component using --dur-fast/--ease-out
disabled             : consistently rendered via reduced opacity + var(--text-faint)
selected              : component-local, semantically consistent where checked
loading               : skeleton pattern (C.3's C3-04 area) — consistent shape, verified working
```

---

## Motion

```
easings   : 4 (--ease-out/-in/-std/-spring) — used consistently for their documented purpose
durations : 5 (--dur-instant 80ms → --dur-slow 360ms) — used consistently
reduced-motion : @media (prefers-reduced-motion: reduce) respected in every file checked,
                 including the C4-01 fix (added the same guard TeamWorkspace.css already had)
```

---

## Responsive

```
measured widths: 390 / 430 / 768 / 1024 / 1440 (per mission Step 11)
```

See Findings — one shared-component defect (`.tw-toast` unstyled outside its own chunk) was **not** width-dependent, so it is not a responsive finding; it reproduces identically at every width. No width-specific design-system defect was found. Mobile overflow (390/430px) remains **deferred to C.5**, unchanged from C.1/C.2.

---

## Component consistency — 21 components checked

| Component | Shared primitive exists? | Adoption | Verdict |
|---|---|---|---|
| Button | No — per-file classes (`.btn-*`, `.pv2-btn`, etc.) | N/A | Consistent token usage where checked (`.btn-success` fixed) |
| Input / Select | No — per-file classes | N/A | Consistent pattern (label + `htmlFor`, per C.1) |
| Checkbox / Radio / Switch | Component-local (`.ws-toggle`) | N/A | Consistent within scope checked |
| Tabs | App-shell `.tab` class, used globally | Universal | Consistent |
| Dialog | `ConfirmDialog.jsx` / `useConfirm` | Used by 3+ panels (C.2 added a 4th) | Consistent pattern |
| Drawer | Not measured | — | NOT MEASURED |
| Dropdown / Menu | Component-local | — | Not flagged |
| Tooltip | Not measured | — | NOT MEASURED |
| Card | Token-based (`--surface-base`, `--radius`) | Widespread | Consistent |
| Table | Not measured at scale (no seeded dataset) | — | NOT MEASURED |
| Badge | `.k2-badge--green/red/dim` and per-file equivalents | Consistent semantic mapping | Consistent |
| Alert | Component-local | — | Consistent where checked |
| **Toast** | `Toast.jsx`/`.css` (7 adopters) + local state (23) | **`.tw-toast` bypassed both — FIXED (C4-01)** | **Was drift, now fixed** |
| EmptyState | `EmptyState.jsx` (9 adopters, variant-driven) + 105 local instances | Different purposes — correctly separate | Intentional (Classification E) |
| Loading/Skeleton | Consistent shape; C.3 fixed the one infinite-loading defect | — | Consistent |
| ErrorState | `CmdPanelError` + local patterns; 0/114 components lack error handling (C.2) | — | Consistent |
| PageHeader | `PageHeader.jsx` (9 adopters) | Partial — not universal, no evidence of harm | Intentional/component-local |
| Search | More-menu search + palette search (C.1/C.2 aligned aliases) | Consistent | Consistent |
| Command Palette | Single shared component | Universal | Consistent |

**One genuine cross-component defect found and fixed: Toast (C4-01).** All others measured consistent, intentionally scoped, or not measured (recorded honestly).
