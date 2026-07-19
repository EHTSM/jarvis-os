# 13 — UI/UX Strategy

**Status of this document:** VERIFIED. `DESIGN_SYSTEM_V1.md` was written as a specification (dated 2026-06-07, originally marked "Specification — No code written"); this audit independently confirmed the spec was subsequently implemented — the exact color values from the spec (`--brand-violet: #7c6fff`, etc.) are present in the live `frontend/src/design/tokens.js` file.

---

## Design Philosophy

Per the design system's own stated identity: *"Voice: Precise. Confident. Operational. Never chatty. Visual metaphor: A command bridge — not a dashboard. Every pixel earns its place."* The explicit goal is a "premium instrument panel" feel rather than a typical SaaS landing-page aesthetic — every screen is meant to answer "what is running, what needs my attention, what do I do next," treating the user as an operator rather than a passive dashboard viewer. This is consistent with the product's actual navigation structure: 74 dense, information-forward screens organized into 7 functional groups (see [06_SCREEN_CATALOG.md](06_SCREEN_CATALOG.md)), not a marketing-style marketing site.

## Design System (VERIFIED, implemented)

`frontend/src/design/` contains the live implementation: `tokens.js` (JS mirror of CSS custom properties for Framer Motion/inline styles), `brand.js`, `components.js`, `motion.js`, plus brand assets (`OoplixMark.jsx`, `OoplixWordmark.jsx`, a `logo/` directory).

Confirmed token categories, matching the `DESIGN_SYSTEM_V1.md` specification:
- **Color**: brand (violet `#7c6fff` primary, teal `#4ecdc4` secondary, with hover/active states), canvas layers (multiple dark background depths — `--canvas`, `--surface-0/1/2`), semantic status colors (success/warning/danger/info), text hierarchy (text/dim/faint), semantic fills, borders, glows.
- **Typography**: a defined type scale, font weights, line heights, letter spacing (per the spec's section headers — not independently re-verified value-by-value against the live CSS in this pass).
- **Spacing scale, border radius, shadows/elevation, and a motion system** are all specified and mirrored into `motion.js`/`tokens.js`.

The design is a **single dark theme** by identity ("command bridge"), not a light/dark toggle system — this was not independently contradicted anywhere in the codebase reviewed.

## Accessibility

**Partial, real but not exhaustive.** 170 instances of `aria-*`/`role=` attributes were found across frontend components — real accessibility annotation exists, but this was not verified against a full WCAG audit or automated accessibility test suite (no such test suite was found in `tests/`). Treat accessibility as **present but unaudited** — a reasonable next step before any enterprise-accessibility-compliance claim is made.

## Responsive Strategy

**Partial.** `@media` queries exist in `frontend/src/App.css` (10 occurrences) and `frontend/src/index.css` (4 occurrences) — real responsive behavior exists for at least the primary app shell, but `styles.css` and `polish.css` contain none. Given the product's own "command bridge / instrument panel" identity and its Electron-first distribution model, the design is optimized primarily for **desktop/large-screen use** — this is a reasonable product decision for the stated audience (founders running an operating system, not a mobile-first consumer app), but it should be stated as a deliberate scope choice, not an oversight, when communicating to stakeholders who might expect full mobile parity.

## Founder UX

The founder/operator is the primary designed-for user across almost the entire 74-screen surface — Mission Control, Runtime Console, the Engineering group, the Intelligence group, and the Enterprise group are all built for a single power-user operating the whole system, consistent with the "operate like a company of 10" positioning. The `FOUNDER_CHECKLIST.md`, `DAY1_OPERATIONS.md`, and `SUPPORT_RUNBOOK.md` root-level documents (all founder-authored, 2026-07-17) further confirm this operator-first orientation extends into the operational documentation, not just the UI.

## Customer UX

Thinner today, and honestly so: the primary customer-facing surface is the **closed-beta signup → onboarding → CRM/billing flow** documented in `CUSTOMER_ONBOARDING.md`. There is no evidence in this audit of a separate, simplified "customer" UI mode distinct from the operator-oriented main app — a customer using Ooplix today largely uses the same dense, operator-grade interface as the founder. This is consistent with the earlier finding in [09_SAAS_MODEL.md](09_SAAS_MODEL.md) that "Founder Mode vs. Customer Mode" does not exist as a code-level concept yet.

## Enterprise UX

Real infrastructure exists (Team/RBAC screens, Trust/Compliance center, Executive Dashboard — see [05_FEATURE_CATALOG.md](05_FEATURE_CATALOG.md)), but the product's own internal audit is explicit that an enterprise buyer evaluating "a lot of connectors" would find only a handful genuinely wired and live-tested today (see [08_CONNECTOR_CATALOG.md](08_CONNECTOR_CATALOG.md)). Enterprise UX readiness should be assessed feature-by-feature against the REAL/PARTIAL/SIMULATION labels in this documentation set rather than assumed from screen presence alone — the UI consistently renders real screens for subsystems whose backend depth varies significantly (see [11_AUTONOMOUS_CAPABILITIES.md](11_AUTONOMOUS_CAPABILITIES.md) for the clearest example of this gap, the `*Org` engine family).

---

*Next: [14_INFRASTRUCTURE.md](14_INFRASTRUCTURE.md) for where and how this UI is actually served.*
