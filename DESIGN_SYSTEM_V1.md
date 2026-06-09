# DESIGN SYSTEM V1
**Phase:** 39 — Frontend Rebuild Strategy
**Date:** 2026-06-07
**Status:** Specification — No code written
**Scope:** Web + Electron. Backend unchanged.

---

## 1. IDENTITY

**Product name:** Ooplix
**Tagline:** AI Operating System for Your Business
**Voice:** Precise. Confident. Operational. Never chatty.
**Visual metaphor:** A command bridge — not a dashboard. Every pixel earns its place.

The design system must feel like a premium instrument panel, not a SaaS landing page. Users are operators. Every screen answers: "What is running, what needs my attention, what do I do next."

---

## 2. COLOR PALETTE

All values are CSS custom properties. Define on `:root` and `[data-theme="dark"]`.

### 2.1 Brand

```css
--brand-violet:      #7c6fff;   /* Primary accent — violet */
--brand-teal:        #4ecdc4;   /* Secondary accent — teal */
--brand-violet-soft: #9488ff;   /* Hover state */
--brand-violet-deep: #6455e8;   /* Active/pressed */
--brand-teal-soft:   #63d9d1;   /* Hover state */
```

### 2.2 Canvas (Base Layers)

```css
--canvas:            #05070d;   /* True background — deepest layer */
--surface-0:         #080c16;   /* Cards — resting */
--surface-1:         #0b0f1b;   /* Cards — elevated */
--surface-2:         #0e1320;   /* Panels — raised */
--surface-3:         #111828;   /* Dropdowns, popovers */
--surface-float:     #08090f;   /* Modals, overlays */
```

Surfaces use `rgba` when blur is present:
```css
--surface-glass:     rgba(8,  12, 20, 0.92);   /* With backdrop-filter */
--surface-glass-hvy: rgba(5,  8,  16, 0.97);   /* Heavy glass */
```

### 2.3 Text

```css
--text-primary:   #dde2ec;   /* Main content */
--text-secondary: #8994b0;   /* Labels, secondary */
--text-tertiary:  #4a5470;   /* Placeholders, hints */
--text-inverse:   #06080e;   /* On accent fills */
--text-link:      #7c6fff;   /* Links (same as --brand-violet) */
```

### 2.4 Semantic Status

```css
--status-online:    #52d68a;   /* Green — healthy/running */
--status-warning:   #f0b429;   /* Amber — degraded/warning */
--status-error:     #f55b5b;   /* Red — failed/critical */
--status-info:      #5dc8f5;   /* Cyan — informational */
--status-offline:   #4a5470;   /* Dim — unknown/disconnected */
--status-pending:   #a0a8c0;   /* Light — in-progress */
```

### 2.5 Semantic Fills (muted backgrounds for status chips)

```css
--fill-success:   rgba(82, 214, 138, 0.10);
--fill-warning:   rgba(240, 180, 41,  0.10);
--fill-error:     rgba(245, 91,  91,  0.10);
--fill-info:      rgba(93,  200, 245, 0.10);
--fill-accent:    rgba(124, 111, 255, 0.10);
--fill-teal:      rgba(78,  205, 196, 0.10);
```

### 2.6 Borders

```css
--border-subtle:  rgba(255, 255, 255, 0.05);   /* Hairline separator */
--border-default: rgba(255, 255, 255, 0.08);   /* Standard card border */
--border-strong:  rgba(255, 255, 255, 0.12);   /* Emphasis border */
--border-accent:  rgba(124, 111, 255, 0.24);   /* Accent/hover state */
--border-teal:    rgba(78,  205, 196, 0.24);   /* Secondary accent hover */
--border-error:   rgba(245, 91,  91,  0.28);   /* Error state */
```

### 2.7 Glows (box-shadow usage)

```css
--glow-violet: 0 0 28px rgba(124, 111, 255, 0.18);
--glow-teal:   0 0 28px rgba(78,  205, 196, 0.14);
--glow-error:  0 0 24px rgba(245, 91,  91,  0.18);
--glow-green:  0 0 24px rgba(82,  214, 138, 0.14);
```

---

## 3. TYPOGRAPHY

### 3.1 Font Stack

```css
--font-sans: 'Inter', 'SF Pro Display', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace;
```

Load via `@font-face` or Google Fonts. Fallback: system-ui.

### 3.2 Type Scale

```css
/* Display — hero only */
--text-display-xl: 3.5rem;    /* 56px — hero headline */
--text-display-lg: 2.75rem;   /* 44px — section hero */
--text-display-md: 2rem;      /* 32px — panel hero */

/* Headings */
--text-h1: 1.625rem;   /* 26px */
--text-h2: 1.25rem;    /* 20px */
--text-h3: 1.0625rem;  /* 17px */
--text-h4: 0.9375rem;  /* 15px */

/* Body */
--text-body-lg: 1rem;       /* 16px */
--text-body:    0.9375rem;  /* 15px */
--text-body-sm: 0.875rem;   /* 14px */
--text-body-xs: 0.8125rem;  /* 13px */

/* UI Labels */
--text-label:    0.75rem;     /* 12px — nav labels, chips */
--text-label-xs: 0.6875rem;  /* 11px — micro labels */
--text-mono:     0.8125rem;  /* 13px — code, IDs, values */
```

### 3.3 Font Weights

```css
--weight-regular:   400;
--weight-medium:    500;
--weight-semibold:  600;
--weight-bold:      700;
--weight-extrabold: 800;
```

### 3.4 Line Heights

```css
--leading-tight:  1.2;   /* Headings */
--leading-snug:   1.4;   /* UI labels, chips */
--leading-normal: 1.5;   /* Body text */
--leading-relaxed:1.65;  /* Long-form content */
```

### 3.5 Letter Spacing

```css
--tracking-tight:  -0.02em;  /* Large headings */
--tracking-normal:  0;
--tracking-wide:    0.04em;  /* Subheadings, labels */
--tracking-wider:   0.08em;  /* ALL-CAPS micro labels */
--tracking-widest:  0.12em;  /* Status badge text */
```

---

## 4. SPACING SCALE

Base unit: 4px. Never use arbitrary values.

```css
--space-px:  1px;
--space-0-5: 2px;
--space-1:   4px;
--space-1-5: 6px;
--space-2:   8px;
--space-2-5: 10px;
--space-3:   12px;
--space-4:   16px;
--space-5:   20px;
--space-6:   24px;
--space-7:   28px;
--space-8:   32px;
--space-10:  40px;
--space-12:  48px;
--space-14:  56px;
--space-16:  64px;
--space-20:  80px;
--space-24:  96px;
```

---

## 5. BORDER RADIUS

```css
--radius-none:  0;
--radius-xs:    4px;
--radius-sm:    6px;   /* Chips, badges, small inputs */
--radius-md:    8px;   /* Buttons, inputs */
--radius-lg:    12px;  /* Cards */
--radius-xl:    16px;  /* Panels, modals */
--radius-2xl:   20px;  /* Large panels */
--radius-3xl:   28px;  /* Hero cards */
--radius-full:  9999px; /* Pills */
```

---

## 6. SHADOWS & ELEVATION

```css
--shadow-xs: 0 1px 3px  rgba(0, 0, 0, 0.20);
--shadow-sm: 0 2px 8px  rgba(0, 0, 0, 0.26);
--shadow-md: 0 6px 24px rgba(0, 0, 0, 0.30);
--shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.36);
--shadow-xl: 0 28px 72px rgba(0, 0, 0, 0.42);
```

Elevation layers:
| Layer | z-index | Shadow | Use |
|---|---|---|---|
| canvas | 0 | none | Base background |
| card | 1 | --shadow-sm | Metric cards, list rows |
| panel | 10 | --shadow-md | Side panels |
| dropdown | 200 | --shadow-lg | Menus, popovers |
| modal | 500 | --shadow-xl | Dialogs |
| toast | 900 | --shadow-xl | Notifications |
| overlay | 1000 | -- | Full-screen overlays |

---

## 7. MOTION SYSTEM

### 7.1 Easing Curves

```css
--ease-linear:   linear;
--ease-in:       cubic-bezier(0.40, 0.00, 1.00, 1.00);
--ease-out:      cubic-bezier(0.00, 0.00, 0.40, 1.00);
--ease-in-out:   cubic-bezier(0.40, 0.00, 0.40, 1.00);
--ease-spring:   cubic-bezier(0.22, 1.00, 0.36, 1.00);  /* Overshoot spring */
--ease-decelerate: cubic-bezier(0.00, 0.00, 0.20, 1.00); /* Enter transitions */
--ease-accelerate: cubic-bezier(0.40, 0.00, 1.00, 1.00); /* Exit transitions */
```

### 7.2 Duration Scale

```css
--duration-instant: 60ms;   /* Input feedback — immediate */
--duration-fast:    120ms;  /* Hover, micro-interactions */
--duration-normal:  200ms;  /* Standard transitions */
--duration-moderate:300ms;  /* Panel enter/exit */
--duration-slow:    400ms;  /* Page transitions */
--duration-slower:  600ms;  /* Heavy animations */
```

### 7.3 Animation Catalogue

```css
/* Fade in from canvas */
@keyframes fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* Slide up + fade (panel enter) */
@keyframes slide-up-enter {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Scale in (modal enter) */
@keyframes scale-enter {
  from { opacity: 0; transform: scale(0.96) translateY(4px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

/* Pulse (live indicator) */
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.5; transform: scale(0.8); }
}

/* Skeleton shimmer */
@keyframes shimmer {
  from { background-position: -200% 0; }
  to   { background-position:  200% 0; }
}
```

### 7.4 Reduced Motion

Always respect `prefers-reduced-motion`:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 8. COMPONENT TOKENS

### 8.1 Header

```css
--header-height:         52px;     /* Web + Electron shared */
--header-bg:             rgba(5, 7, 13, 0.96);
--header-border:         rgba(255, 255, 255, 0.06);
--header-accent-line:    2px solid var(--brand-violet);
--header-blur:           blur(20px) saturate(1.4);
```

### 8.2 Sidebar Navigation

```css
--sidebar-width:         220px;    /* Expanded */
--sidebar-width-compact: 56px;     /* Icon-only (Electron) */
--sidebar-bg:            rgba(6, 8, 15, 0.98);
--sidebar-border:        var(--border-default);
--sidebar-item-height:   36px;
```

### 8.3 Buttons

```css
/* Size variants */
--btn-height-sm: 28px;   padding: 0 10px;  font-size: --text-label;
--btn-height-md: 34px;   padding: 0 14px;  font-size: --text-body-xs;
--btn-height-lg: 40px;   padding: 0 18px;  font-size: --text-body-sm;
--btn-height-xl: 48px;   padding: 0 24px;  font-size: --text-body;

/* Variants */
--btn-primary-bg:      var(--brand-violet);
--btn-primary-text:    var(--text-inverse);
--btn-secondary-bg:    rgba(255,255,255,0.06);
--btn-secondary-text:  var(--text-primary);
--btn-ghost-bg:        transparent;
--btn-ghost-text:      var(--text-secondary);
--btn-danger-bg:       var(--status-error);
--btn-danger-text:     var(--text-inverse);
```

### 8.4 Inputs

```css
--input-height:       36px;
--input-bg:           rgba(255,255,255,0.04);
--input-border:       var(--border-default);
--input-border-focus: var(--brand-violet);
--input-text:         var(--text-primary);
--input-placeholder:  var(--text-tertiary);
--input-radius:       var(--radius-md);
```

### 8.5 Status Chips / Badges

```css
/* Pattern: .chip--{status} */
--chip-height:      20px;
--chip-padding:     0 6px;
--chip-radius:      var(--radius-sm);
--chip-font-size:   var(--text-label-xs);
--chip-font-weight: var(--weight-bold);
--chip-tracking:    var(--tracking-widest);
```

### 8.6 Cards

```css
--card-bg:          var(--surface-0);
--card-border:      var(--border-default);
--card-radius:      var(--radius-lg);
--card-padding:     var(--space-5);
--card-shadow:      var(--shadow-sm);
--card-hover-border: var(--border-accent);
--card-hover-bg:    var(--surface-1);
```

### 8.7 Live Indicator Dot

```css
/* Usage: <span class="live-dot live-dot--{status}"> */
--dot-size:       6px;
--dot-online:     var(--status-online);
--dot-warning:    var(--status-warning);
--dot-error:      var(--status-error);
--dot-offline:    var(--status-offline);
```

---

## 9. ICON SYSTEM

Use **Lucide React** exclusively. No emoji in navigation or status indicators.

```
Icon sizes:
  --icon-xs:  12px   (status dots, inline text icons)
  --icon-sm:  14px   (nav items, labels)
  --icon-md:  16px   (buttons, chips)
  --icon-lg:  20px   (panel headers)
  --icon-xl:  24px   (section headings, empty states)
  --icon-2xl: 32px   (hero empty states)
```

All icons rendered at `currentColor` — inherit from parent text color.

**Reserved icon mapping (do not diverge):**

| Concept | Icon |
|---|---|
| AI / Chat | `Zap` or `Sparkles` |
| Agents | `Bot` |
| Memory | `Database` |
| Workflows | `GitBranch` |
| DevOps | `Terminal` |
| Monitoring | `Activity` |
| Settings | `Settings` |
| Billing | `CreditCard` |
| Contacts/CRM | `Users` |
| Integrations | `Plug` |
| Knowledge | `BookOpen` |
| Security | `Shield` |
| Pipeline | `BarChart2` |
| Logs | `FileText` |
| Emergency | `AlertTriangle` |
| Online status | `Circle` (filled) |
| Expand/More | `ChevronDown` |
| Close | `X` |
| Back | `ArrowLeft` |

---

## 10. LAYOUT GRID

### 10.1 Content Width

```css
--content-max:       1440px;   /* Maximum outer container */
--content-wide:      1200px;   /* Wide content (tables, dashboards) */
--content-default:    960px;   /* Default reading width */
--content-narrow:     640px;   /* Forms, auth pages */
```

### 10.2 Breakpoints

```css
--bp-xs:   480px;   /* Small mobile */
--bp-sm:   640px;   /* Large mobile */
--bp-md:   768px;   /* Tablet portrait */
--bp-lg:  1024px;   /* Tablet landscape / small desktop */
--bp-xl:  1280px;   /* Desktop */
--bp-2xl: 1536px;   /* Large desktop */
```

### 10.3 App Shell Grid

**Web — main layout:**
```
+--------+---------------------------+
| Sidebar|  Header                   |
| 220px  +---------------------------+
|        |  Main Content             |
|        |  (scrollable)             |
|        |                           |
+--------+---------------------------+
```

**Electron — operator layout:**
```
+--------+---------------------------+
| Sidebar|  Titlebar + Controls      |
| 56px   +---------------------------+
| (icons)|  Panel Grid (4-col)       |
|        |                           |
+--------+---------------------------+
```

**Mobile (< 768px):** Sidebar collapses to bottom tab bar (5 items).

---

## 11. PLATFORM VARIANTS

### 11.1 Web (Public / SaaS)

- Full sidebar with labels
- Header shows trial countdown + upgrade CTA
- Marketing-quality landing page
- Responsive down to 360px

### 11.2 Electron (Operator)

- Compact sidebar (icons only, expand on hover)
- System titlebar hidden — custom draggable header
- Frameless window; traffic lights preserved on Mac
- IPC status indicator always visible in header
- No marketing surfaces — goes straight to app

### 11.3 CSS Class Conventions

```css
/* Applied to <html> or <body> by platform detection */
[data-platform="web"]      { }
[data-platform="electron"] { --sidebar-width: 56px; }
[data-platform="mobile"]   { --header-height: 48px; }
```

---

## 12. COMPONENT PATTERNS

### 12.1 Section Header Pattern

```
[ Icon ] Section Title        [Action Button]
[ Subtitle / description line               ]
───────────────────────────────────────────
```

### 12.2 Metric Card Pattern

```
┌─────────────────────┐
│ Icon  Label      ●  │  ← status dot (live)
│                     │
│ VALUE               │  ← large number
│ ± DELTA  sparkline  │  ← trend
└─────────────────────┘
```

### 12.3 Empty State Pattern

```
         [ Icon — 32px ]
         Title — no data yet
    Subtitle explaining what to do
         [ Primary Action ]
```

### 12.4 Loading Skeleton

Use shimmer animation on placeholder shapes that match the real content's geometry. Never show spinners inside cards — use skeleton rows.

```css
.skeleton {
  background: linear-gradient(
    90deg,
    var(--surface-1) 0%,
    var(--surface-2) 50%,
    var(--surface-1) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.4s var(--ease-linear) infinite;
}
```

### 12.5 Status Chip Pattern

```
[ ● ] ONLINE      green fill
[ ● ] DEGRADED    amber fill
[ ● ] ERROR       red fill
[ ● ] OFFLINE     dim fill
[ ● ] TRIAL       violet fill
```

### 12.6 Coming Soon Banner

```
◎  [Engine Name] — Coming Soon
   This module is under development. Existing UI preserved.
```

---

## 13. ACCESSIBILITY BASELINE

- All interactive elements: minimum 44×44px touch target
- Color contrast: minimum 4.5:1 for body text, 3:1 for UI elements
- Focus ring: `outline: 2px solid var(--brand-violet); outline-offset: 2px`
- `aria-label` on all icon-only buttons
- `role="status"` on live update regions
- `aria-live="polite"` on toast notifications
- No motion for users who prefer reduced motion (see Section 7.4)
- Keyboard navigation: Tab order follows visual order

---

## 14. DO / DON'T

| DO | DON'T |
|---|---|
| Use CSS variables for every value | Hardcode hex colors in JSX |
| Use semantic tokens (`--text-secondary`) | Reference raw values (`#8994b0`) |
| Use Lucide icons consistently | Mix icon libraries |
| Show skeletons on load | Show spinners inside cards |
| Write motion with `prefers-reduced-motion` guard | Assume motion is always OK |
| Use `data-` attributes for state variants | Use className concatenation for theming |
| Align to the 4px grid | Use arbitrary spacing values |
| Use `--radius-lg` for cards | Mix radius values per-component |
| Test at 360px, 768px, 1280px | Test only at full-screen |

---

## 15. FILE STRUCTURE

```
frontend/src/
├── design/
│   ├── tokens.css          ← All CSS custom properties
│   ├── typography.css      ← Type scale + font loading
│   ├── layout.css          ← Grid, containers, breakpoints
│   ├── motion.css          ← Animations + easing
│   └── reset.css           ← Modern CSS reset
├── components/
│   ├── ui/                 ← Shared primitives
│   │   ├── Button.jsx
│   │   ├── Input.jsx
│   │   ├── Badge.jsx       ← Status chips
│   │   ├── Card.jsx
│   │   ├── Skeleton.jsx
│   │   ├── EmptyState.jsx
│   │   ├── Tooltip.jsx
│   │   ├── Dropdown.jsx
│   │   └── Modal.jsx
│   ├── layout/
│   │   ├── AppShell.jsx    ← Sidebar + Header + Main
│   │   ├── Sidebar.jsx
│   │   ├── Header.jsx
│   │   └── PageContainer.jsx
│   └── [domain screens]
```
