# 11 — Autonomous Capabilities

**Status of this document:** VERIFIED. This is the single most carefully-audited claim in the entire product, and this document deliberately mirrors the precision of that audit rather than the more casual "autonomous AI" language used in the README/marketing copy. Where they conflict, the audit wins.

---

## Why This Document Exists

The word "autonomous" appears throughout this codebase — in service filenames, route prefixes, nav labels ("Autonomy Score," "Auto Workflows"), and marketing copy. The 2026-07-17 reality-completion audit specifically investigated what "autonomous" actually means in code, because an earlier product surface risked implying more than the system does. This document preserves that precision: **IMPLEMENTED**, **PARTIAL**, and **PLANNED** are kept strictly separate below, per this document's own mandate.

---

## IMPLEMENTED (live-verified, genuinely autonomous)

These were proven with a live, unattended observation window, not inferred from code reading alone:

- **Observation** — the system genuinely watches its own host state (e.g. `git status`, `pm2 jlist`) without a human trigger.
- **Execution** — a 70-second idle window with zero operator action produced **80 autonomous dispatch batches making 1,585 real outbound HTTP calls to AI providers**. This is real, metered, costly external activity happening with no human in the loop.
- **Recovery / Self-healing** — the same observation window included a self-heal probe that detected and re-executed **5 real failed work cycles**, all self-triggered.
- **The Loop** — the above observation/execution/recovery cycle runs continuously and unattended, confirmed live.

**This is real.** A system that produces 1,585 real paid API calls and heals 5 real failures with zero human input in 70 seconds is not a mock or a demo — it is genuinely running unattended.

## PARTIAL (real code, real activity, but narrower than the name implies)

- **Decision** — correctly wired (subscribes to the same event bus the observers publish to) but stayed quiet in the observed audit windows because host state didn't change again after its first emission. This is **deduplication behavior, not a mock** — but it means "Decision" is not something that was seen actively firing multiple times in the available observation window.
- **Learning, Planning, Memory-writes** — fire on real, unattended timers (this part is genuine), but **consume mostly the system's own historical output rather than fresh external signal**. In other words, the system is learning from itself more than from the world — real activity, but a narrower feedback loop than "learning" usually implies.
- **The "Organization" / "Civilization" subsystems** (Business OS, Enterprise OS, the Autonomous Company/Revenue/Marketing/Support Centers, and roughly 9 other similarly-named engines spanning "Level 2" through "Level Ω" in `backend/server.js`'s boot sequence) — these **do not independently trigger themselves**, and when manually ticked, **only ever read and write their own internal JSON files**. They do not call a real external service, modify real infrastructure, or represent a real company's real operations. The audit's own words, worth preserving verbatim: *"Do not describe these to a customer as 'AI running your business autonomously.' They are internal simulation/scaffolding."*
- **Confidence scoring** — a numeric confidence value is computed and logged by the recovery/decision engines, but it is **behaviorally ignored** — live proof: 5 real self-heal events all chose the identical strategy at the identical static confidence (14%), regardless of the computed number.

## NOT IMPLEMENTED (searched for specifically, not found)

- **True self-correction** — defined precisely by the audit as: recognizing that a prior autonomous decision's judgment was wrong, and choosing a materially different approach *because of that recognition*. This was searched for specifically in the 2026-07-17 audit and **not found anywhere in the codebase**. What exists instead is retry-with-escalation: `executionRecovery.cjs`'s `selectStrategy()` picks a strategy based on attempt count — a static decision tree. This is real, useful recovery behavior, but it is not judgment revision. The audit's own framing: *"This capability is stated plainly as not implemented, not partially implemented."*

## PLANNED (roadmap direction, not yet started)

- Wiring the `*Org` engine family to real external triggers and real external actions (so "autonomous business operations" becomes literally true rather than self-referential), **or** — the audit's explicit alternative — making a deliberate decision to stop describing this engine family as autonomous business operation in customer-facing material until that work is done.
- A genuine self-correction mechanism where computed confidence actually changes future strategy selection, rather than being logged and ignored.
- Broadening the Learning/Planning feedback loop to weight fresh external signal more heavily relative to the system's own historical output.

## What This Means in Practice

If you are a Project Manager fielding a question like *"does Ooplix run my business autonomously?"* — the accurate answer, grounded in this audit, is:

> "It genuinely and verifiably automates real work without you present — it makes real AI calls, executes real recovery, and runs continuously. But the parts of it named after business functions (Autonomous Revenue, Autonomous Marketing, Autonomous Support, etc.) are internal scaffolding that only read and write their own state today — they are not yet plugged into your real revenue, marketing, or support systems. And it does not yet learn from its own mistakes in the sense of revising a prior bad judgment call."

This is the framing `docs/current/known-limitations.md` itself recommends, and this documentation set adopts it as the standard answer.

---

*Next: [12_ROADMAP.md](12_ROADMAP.md) for what's planned to close these gaps.*
