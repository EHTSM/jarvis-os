# OOPLIX V1 — Figma File & Wireframe Structure

**File name:** `Ooplix V1 — Audit Suite` · **Type:** Design file
**Purpose:** presentation deck masters, dashboard wireframes, and the diagram component library.

---

## File structure

```
Ooplix V1 — Audit Suite
├── 📄 00 · Cover & Index
├── 📄 01 · Foundations           (tokens, type, colour, grid)
├── 📄 02 · Components            (library)
├── 📄 03 · Deck Masters          (16:9 slide templates)
├── 📄 04 · Executive Dashboard   (wireframes)
├── 📄 05 · Diagram Library
├── 📄 06 · Report Layouts        (A4 print)
└── 📄 07 · Archive
```

---

## Page 01 — Foundations

### Colour variables (collection: `audit`)

| Variable | Light | Dark | Scope |
|---|---|---|---|
| `color/ink` | `#0B1F33` | `#E8EEF4` | Text |
| `color/ink-muted` | `#4A5C6D` | `#9AAABB` | Secondary text |
| `color/line` | `#D8E0E7` | `#2A3947` | Rules, borders |
| `color/surface` | `#FFFFFF` | `#0D1520` | Background |
| `color/surface-alt` | `#F5F8FA` | `#141F2C` | Zebra, panels |
| `color/layer-l1` | `#1F4E79` | `#4E86BE` | Foundation |
| `color/layer-l2` | `#2E75B6` | `#5C9BD9` | Engineering |
| `color/layer-l3` | `#0F9D58` | `#3ECB86` | Intelligence |
| `color/layer-l4` | `#C55A11` | `#E88A44` | Operations |
| `color/layer-l5` | `#7030A0` | `#A76BD1` | Vision |
| `color/layer-l6` | `#BF9000` | `#E5B72E` | Perfection |
| `color/sev-critical` | `#B00020` | `#FF5470` | CRITICAL |
| `color/sev-high` | `#C55A11` | `#E88A44` | HIGH |
| `color/sev-medium` | `#BF9000` | `#E5B72E` | MEDIUM |
| `color/sev-low` | `#4A5C6D` | `#9AAABB` | LOW |
| `color/planned` | `#8A96A3` | `#6E7C8A` | PLANNED — desaturated by design |

### Type styles

| Style | Spec |
|---|---|
| `display/deck` | Georgia 600 · 44/52 |
| `display/report` | Georgia 600 · 32/40 |
| `heading/h1` | Inter 600 · 32/40 |
| `heading/h2` | Inter 600 · 24/32 |
| `heading/h3` | Inter 600 · 19/26 |
| `body/default` | Inter 400 · 16/26 |
| `body/small` | Inter 400 · 13.5/20 |
| `mono/measured` | SF Mono 500 · 14/22 — **measured values only** |
| `caption/evidence` | Inter 400 · 11/16 · ink-muted |

> `mono/measured` exists to make measurement visually distinct from prose. Applied consistently, a reader can scan a page and see which claims are quantitative.

### Grid

| Frame | Grid |
|---|---|
| Slide 16:9 (1920×1080) | 12 col · 80 margin · 40 gutter |
| Dashboard (1440×1024) | 12 col · 48 margin · 24 gutter |
| A4 print (2480×3508 @300dpi) | 6 col · 236 margin |

---

## Page 02 — Components

| Component | Variants | Props |
|---|---|---|
| `Badge/Verdict` | CERTIFIED · CERTIFIED-LIMITED · NOT-CERTIFIED · PLANNED | `label` |
| `Badge/Severity` | CRITICAL · HIGH · MEDIUM · LOW | `count` |
| `Card/Audit` | executed · planned | `id`, `title`, `verdict`, `score`, `findings` |
| `Card/Gap` | critical · high · medium | `id`, `measurement`, `reasonOpen`, `closesIn` |
| `Tile/KPI` | default · emphasis · warning | `label`, `value`, `unit`, `footnote` |
| `Chart/Radar` | 9-axis · 10-axis · 11-axis | `scores[]` |
| `Chart/BarH` | default · severity-stacked | `series[]` |
| `Stat/BeforeAfter` | improvement · regression | `before`, `after`, `metric` |
| `Row/Register` | executed · planned | full register row |
| `Legend/EvidenceClass` | — | executed vs planned key |

### `Card/Audit` — planned variant

The planned variant must differ **structurally**, not only by colour:

- Border: 1.5 px dashed `color/planned`
- Score slot: renders an em-dash, never `0`
- Findings slot: hidden entirely
- Fixed footer chip: "PLANNED — not executed"

**Rationale:** cards get screenshotted out of context. A planned card must remain unmistakably planned in a greyscale screenshot with no legend.

---

## Page 03 — Deck Masters

| Master | Frame | Use |
|---|---|---|
| `M01 Title` | Full-bleed `layer-l1` | Slides 1, 62 |
| `M02 Statement` | Centered, single statement | Slides 2, 21, 41, 42 |
| `M03 Split` | 50/50 content + visual | Slides 3, 8, 10 |
| `M04 Evidence Split` | Hard left/right, executed vs planned | Slide 5 |
| `M05 Finding` | Headline + measurement table + footnote | Slides 22–40 |
| `M06 Full-bleed Diagram` | Edge-to-edge with caption strip | Slides 19, 20, 46, 52, 53, 55, 56 |
| `M07 KPI Row` | 4–5 tile row + supporting chart | Slides 49, 54 |
| `M08 Gap` | Red-bordered, three-block structure | Slides 43, 44, 45 |
| `M09 List` | Numbered, generous leading | Slides 6, 57, 58 |
| `M10 Section Divider` | Quote-weight type on tint | Slides 21, 41 |

**Every master includes:** a footer with document ID + slide number, and a classification chip. Both on a locked layer.

---

## Page 04 — Executive Dashboard Wireframes

```
┌─ Frame: Dashboard / Desktop 1440 ──────────────────────────┐
│  HEADER   title · record date · classification chip        │
├────────────────────────────────────────────────────────────┤
│  KPI ROW   [31 executed]  [116 findings] [3 critical]        │
│            [8.49 mean]  [144/144 regression]               │
├──────────────────────────────┬─────────────────────────────┤
│  Findings by layer (bar-h)   │  Verdict distribution       │
│                              │  9 / 16 / 1                 │
├──────────────────────────────┴─────────────────────────────┤
│  BEFORE / AFTER STRIP  4× Stat/BeforeAfter                 │
├────────────────────────────────────────────────────────────┤
│  CRITICAL GAP PANEL   3× Card/Gap · red border             │
├────────────────────────────────────────────────────────────┤
│  FOOTER   evidence note · "planned audits contribute       │
│           nothing to any figure on this page"              │
└────────────────────────────────────────────────────────────┘
```

Responsive frames: Desktop 1440 · Tablet 1024 (KPI 3+2, charts stack) · Mobile 390 (single column, KPI carousel).

---

## Page 05 — Diagram Library

Vector masters for each Mermaid source, so print output does not depend on runtime rendering.

| Component | Source |
|---|---|
| `Diagram/Timeline` | `01-audit-timeline.mmd` |
| `Diagram/Roadmap` | `02-strategic-roadmap.mmd` |
| `Diagram/Gantt` | `03-gantt-programme.mmd` |
| `Diagram/Dependency` | `04-dependency-graph.mmd` |
| `Diagram/Method` | `05-audit-method-flow.mmd` |
| `Diagram/Architecture` | `06-platform-architecture.mmd` |
| `Diagram/CertRoadmap` | `07-certification-roadmap.mmd` |
| `Diagram/Recovery` | `08-recovery-roadmap.mmd` |
| `Diagram/Maturity` | `09-maturity-model.mmd` |
| `Diagram/Milestones` | `10-milestone-roadmap.mmd` |

**Sync rule:** the Mermaid source is authoritative. When a `.mmd` file changes, the Figma master is regenerated — never edited in isolation, or the two diverge silently.

---

## Page 06 — Report Layouts

A4 masters matching `reports/ENTERPRISE_PDF_REPORT_STRUCTURE.md`: cover, document control, section opener, register table, finding detail, gap detail, appendix table.

**Print constraint:** every layout must survive greyscale. Verify by duplicating the page and applying a saturation-0 layer — severity and PLANNED status must remain distinguishable by weight, dash pattern, and label alone.
