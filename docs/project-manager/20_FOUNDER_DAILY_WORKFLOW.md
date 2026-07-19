# 20 — Founder Daily Workflow

**Status of this document:** VERIFIED against the founder's own operational documentation (`SUPPORT_RUNBOOK.md`, `DAY1_OPERATIONS.md`, `RELEASE_PLAYBOOK.md`, `FOUNDER_CHECKLIST.md` — all authored 2026-07-17) and the product's own screen catalog. This document synthesizes what these sources actually instruct, rather than inventing a generic "founder's day" template.

---

## Morning — Daily Checks (per `SUPPORT_RUNBOOK.md`, ~5 minutes)

```bash
bash deploy/monitor.sh
```

This single command confirms, in one pass: PM2 process status, `/health` response, memory usage, CRM pipeline state, and connector health. The runbook explicitly frames this as the first thing to run each day. A second invocation with `--errors` surfaces recent error-log activity specifically.

## Development

For engineering work, the product's own **Eng Workspace** screen group is the intended daily tool: an integrated CodeMirror 6 editor, visual git with mission tracking and AI-assisted commits, and an AI pair-programming Copilot (chat, patch preview/apply/undo, code review, refactor) — all live, real features (see [07_AI_CAPABILITIES.md](07_AI_CAPABILITIES.md)). The founder's own dogfooding is evidenced directly in the current branch's commit history: the "reality completion" audit that grounds most of this documentation set was itself run as a self-directed engineering session using this same workspace and Copilot tooling.

Recent real-world engineering pattern observed in the current branch's commits (Module 4 through Module 8): identify a backend capability that already exists but is either unreachable from the UI, blocked by a dead auth import, or blocked by a field-mismatch bug — fix the wiring, then browser-test the result with a real Playwright script before considering it done (`verify_module8.js`/`verify_module8b.js` in the repo root are real examples of this verification step, not test-suite artifacts).

## Business

The **CRM / Pipeline** screens (primary nav tabs `clients`, `insights`, plus the full `business` CRM module) are the daily business-operations surface — live-tested end to end: lead capture, deal pipeline, WhatsApp/Telegram automated follow-up. `SUPPORT_RUNBOOK.md` documents the common ticket types a founder should expect to triage personally at this stage: missing verification emails, payment-received-but-no-access cases, and WhatsApp automation not responding — each with a documented diagnosis path.

## Marketing

The **Growth** screen group (SEO, Content, Social, Email, Referral, Launch, Partners, AI Costs — see [06_SCREEN_CATALOG.md](06_SCREEN_CATALOG.md)) is built specifically as AI-assisted tooling for a solo founder to perform marketing functions without a dedicated marketing hire — consistent with the product's own "operate like a company of 10" thesis.

## Deployments

Per `RELEASE_PLAYBOOK.md`: push to `main` (CI must pass — the 144-check regression suite, real frontend build, deploy-script syntax check), tag a release (`v[0-9]*.[0-9]*.[0-9]*`) when ready to ship, then manually run `npm run deploy:update` on the VPS to pull and apply it. **This manual final step is a deliberate, documented part of the process** — CI does not auto-deploy. `DAY1_OPERATIONS.md` additionally instructs walking the full customer-onboarding journey personally with a real, founder-controlled email address before announcing any launch — not just checking that the deploy succeeded technically.

## AI

The founder has direct access to the same 12-provider AI router the product exposes to customers (`chat` primary tab, plus the Command Console and Jarvis Brain screens in the Intelligence group) — used both as a product feature and, per the observed commit pattern, as an actual development tool for the founder's own engineering work.

## Reviews

The most rigorous review activity evidenced in this repository is the periodic "reality completion" / production-readiness audit pattern — a self-directed, execution-mode review that live-tests claims against the running application rather than trusting prior documentation. The 2026-07-17 audit that grounds most of this documentation set is the most recent and most thorough example. **This documentation set recommends this same audit pattern be repeated periodically** (e.g. before each major release) rather than treating any point-in-time status document — including this one — as permanently current. See [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md) for the freshness caveat.

## Planning

`RELEASE_BLOCKERS.md` and `docs/current/v1-production-checklist.json`'s `estimatedEffortRemaining` are the founder's own current, honest planning inputs — both explicitly avoid percentage/time-estimate language in favor of concrete, scoped work items (see [12_ROADMAP.md](12_ROADMAP.md), which is built directly from these sources). A Project Manager stepping into this role should treat these two files, refreshed periodically via a repeat of the same audit methodology, as the primary planning input rather than any single historical "Phase N complete" report — this repository contains many of the latter, and the most recent audit found several of them to have overstated completion relative to what a live test actually showed.

## A Note on Handoff

This entire documentation set exists so that a new Project Manager does not need to re-derive any of the above from scratch. The single most important habit to inherit from the founder's own working style, visible throughout the current branch's commit history and the `docs/current/` audit trail: **verify claims against the running application before repeating them**, and **state plainly what was not verified** rather than rounding up. This is the standard every document in this set was held to, and it is the standard this project's own culture already operates by — not a new practice being imposed from outside.

---

*Next: [21_PROJECT_STATISTICS.md](21_PROJECT_STATISTICS.md) for the raw numbers behind everything above.*
