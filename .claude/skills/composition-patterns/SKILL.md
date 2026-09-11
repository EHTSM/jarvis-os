---
name: composition-patterns
description: React component composition and design-quality review — compound components, render props, context usage, prop-drilling detection, and component-API clarity. Use when reviewing or writing components under frontend/src/components/ or frontend/src/contexts/. Adapted from Vercel's react-best-practices and composition-patterns skills (vercel-labs/agent-skills, MIT).
metadata:
  source: "adapted from vercel-labs/agent-skills (composition-patterns, react-best-practices)"
  license-note: "Instructional pattern only; no vendor code copied. Original is MIT. Next.js-specific guidance intentionally omitted — this repo uses Create React App, not Next.js."
---

# React Composition Patterns (JARVIS-adapted)

Apply general React composition and component-design review to JARVIS's
frontend, which is Create React App + React 18 with hand-rolled routing (see
CLAUDE.md §3) — no Next.js, no router library, no Redux/Zustand. Only the
framework-agnostic parts of the source patterns apply; do not suggest Next.js
App Router, `next/image`, server components, or any Next.js-specific API.

## When to use this

- Reviewing or writing any component under `frontend/src/components/` (422+
  entries) or a context under `frontend/src/contexts/`.
- Specifically relevant to JARVIS's own tracked frontend-maturity work (prop
  drilling and fake-empty-state bugs were previously found across the ~87
  nav-reachable screens per project history) — this skill formalizes that
  review lens for future passes.

## What to check

1. **Prop drilling** — props passed through 3+ component layers without being
   used at the intermediate layers. Suggest React Context (matching JARVIS's
   existing pattern — CLAUDE.md §3 notes state already goes through Context +
   hooks, not Redux) or component composition (children/render props) instead
   of introducing a new state-management library.
2. **Compound components** — where a component and several tightly-coupled
   sub-components are always used together, check whether a compound-component
   pattern (shared implicit context) would be clearer than a large prop API.
3. **Context misuse** — a Context provider re-rendering all consumers on every
   change when only a subset actually needs a given slice of state; suggest
   splitting into narrower contexts rather than one large one.
4. **Component-API clarity** — overly generic prop names (`data`, `config`,
   `options` as a catch-all), boolean-prop explosion (`isX`/`isY`/`isZ` that
   should be a single `variant` prop), and unclear required-vs-optional prop
   boundaries.
5. **Honest empty/loading/error states** — per CLAUDE.md §18, verify a
   component distinguishes "no data yet" from "data is empty" from "fetch
   failed," rather than collapsing all three into one generic empty state
   (this is the specific bug class previously found in this repo's frontend
   track).

## Output format

For each finding: component file path, the specific pattern issue, and a
concrete refactor suggestion using an existing JARVIS convention (Context +
hooks, not a new library) where applicable.

## What this must never do

- Never suggest introducing Redux, Zustand, MobX, React Router, or Next.js
  APIs — none are used in this repo and CLAUDE.md §3 documents this as a
  deliberate existing choice, not a gap.
- Never rewrite a component's behavior as part of a composition review —
  report the pattern issue; apply the refactor only if separately asked.
- Never flag CRA's `ESLINT_NO_DEV_ERRORS=true` build setting as an issue to
  fix — CLAUDE.md §3 documents this as intentional.
