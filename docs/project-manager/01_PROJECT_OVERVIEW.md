# 01 — Project Overview

**Status of this document:** VERIFIED (product identity, licensing, positioning) + PLANNED (long-term vision framed as company intent, not shipped capability). Every claim is traceable to a repository source. Where the founder's own stated intent is the source (not code), this is marked explicitly.

---

## What Is Ooplix?

**Ooplix** is the product/brand name for this codebase. Per `package.json`:

> "Ooplix — AI Operating System for Solo Founders & Small Teams by ALWALIY TECHNOLOGIES PRIVATE LIMITED"

Per the project's own README: *"Ooplix is a desktop AI operating system that lets a solo founder operate like a company of 10. You describe a goal in plain language. Ooplix plans it, executes it across multiple AI agents, and ships it — from code to deployment to customer communication."*

Concretely, and VERIFIED against the code: Ooplix is a full-stack application — an Express 5 backend (127 route files), a React 18 frontend (74 navigable screens across 7 functional groups), and an Electron desktop shell — that bundles together:

- A CRM and business-operations layer (deal pipeline, leads, WhatsApp/Telegram automation, payments)
- A developer workspace (code editor, visual git, AI pair-programming, terminal)
- An AI mission/agent runtime (goal → plan → execute → track)
- A large number of "autonomous organization" subsystems modeling business functions (engineering, sales, support, knowledge, evolution, governance, etc.) — see [11_AUTONOMOUS_CAPABILITIES.md](11_AUTONOMOUS_CAPABILITIES.md) for the honest READY/PARTIAL/SIMULATED breakdown of these

It ships as both a web/VPS-hosted product (`ooplix.com`) and a packaged Electron desktop app (macOS/Windows/Linux — see [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md) for the current build/release state, which has open blockers).

## What Is "Jarvis" / "JARVIS-OS"?

**JARVIS-OS** is the internal/engineering name for the same codebase (`package.json` `name: "jarvis-os"`, the git repository's own name, and the name used throughout backend service filenames, internal docs, and the project's persistent memory system). "Ooplix" is the external brand; "JARVIS-OS" is what the code and its internal documentation call itself. The two terms refer to the same single system — there is no separate "Jarvis" product distinct from Ooplix in this repository.

## Why Was It Built?

This is the founder's stated intent, captured in the product's own positioning material (README, root-level operational docs) — VERIFIED as *stated intent*, not independently verifiable as *market fact*:

> "It is not a chatbot. It is not a copilot. It is the operating system of your business."

The founder-authored operational docs (`FOUNDER_CHECKLIST.md`, `CUSTOMER_ONBOARDING.md`, `RELEASE_PLAYBOOK.md` — all added 2026-07-17) describe a single-operator or small-trusted-team product aimed at founders who want to run engineering, CRM, growth, and operations from one interface without hiring a full team for each function. The product's own `docs/current/known-limitations.md` (a rigorous, code-verified internal audit — see [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md)) is explicit that the "autonomous organization" framing should not be oversold: the system genuinely automates real work (verified: 1,585 real outbound AI-provider calls observed in a 70-second unattended window, real self-healing recovery of failed work cycles) but the more ambitious "AI runs your business autonomously" framing for many of the "Org" subsystems is internal scaffolding, not live autonomous operation of a real business. This document treats that distinction as load-bearing throughout — see [11_AUTONOMOUS_CAPABILITIES.md](11_AUTONOMOUS_CAPABILITIES.md).

## Vision (Founder-Stated)

Drawing from the product's positioning and the `10_17_COMPANY_STRATEGY.md` mandate for this documentation set: the long-term vision is a platform from which a single founder can conceive, build, launch, and operate multiple companies — the README's "company of 10" framing extended, per the founder's own intent for this documentation project, to eventually operating up to 17 companies from one platform. **This is PLANNED / founder-stated intent.** As of this audit:

- Real, code-verified: a "Company Factory" feature exists (`backend/routes/companyFactory.js`, `frontend/src/components/CompanyFactoryCenter.jsx`) that lets an operator create a company record from an idea, track it through a lifecycle (planning → building → testing → launch → growth → scale → maintenance), and view per-company dashboards.
- Not yet real: true operational multi-tenancy with database-enforced isolation between companies/organizations. The system's own current-state audit (`docs/current/v1-final-reality-report.md`) states plainly: *"No database-enforced tenant isolation — all state in flat `data/*.json` files."* This is the single largest piece of remaining architecture work standing between today's system and the 17-company vision. See [10_17_COMPANY_STRATEGY.md](10_17_COMPANY_STRATEGY.md) for the full gap analysis.

## Mission (Founder-Stated)

To let a solo founder or a very small team accomplish what would otherwise require a full engineering, operations, and growth staff — using AI agents to plan and execute real work (code changes, customer communication, business process execution) rather than only chat-assist a human doing the work themselves.

## Philosophy

Two philosophies are directly evidenced in the repository, not just claimed:

1. **"Reality over appearance."** The current `security/reality-completion` branch (the branch this documentation was generated from) exists specifically to audit and correct places where the product's UI or documentation overstated what the code actually does — see `docs/current/v1-final-reality-report.md`, which removed 14 frontend pages that either showed fabricated example data or pointed at backend routes that don't exist, and which explicitly instructs: *"if simulation but used by UI, report exactly why"* rather than disguise it. This documentation set inherits that same standard.
2. **"Honest degradation over silent failure."** Verified repeatedly across the connector system (`docs/current/production-credential-verification.md`): unconfigured integrations report `MISSING`/`READY` (not connected) rather than faking a successful connection. The billing/feature-gating system returns explicit `402`/`feature_gated` responses with an upgrade path rather than silently allowing or silently failing.

## Long-Term Goal

Per the founder's stated direction for this documentation project and the product's own trajectory (Company Factory, Workspace Mesh, Organization Network subsystems — see [04_SYSTEM_ARCHITECTURE.md](04_SYSTEM_ARCHITECTURE.md)): a platform where one founder can launch and run a portfolio of businesses (up to 17, per the founder's stated target), sharing one AI runtime, one knowledge base, and one operating system, while keeping each company's branding, customers, billing, and analytics separate. **This is the direction the codebase's own architecture points toward (Company Factory, Workspace Mesh, and Organization Network subsystems exist in code today), but the tenant-isolation work required to make it safe for real, unrelated companies/customers has not been done.** A new Project Manager should treat this as the top strategic gap to plan around — see [19_RISK_REGISTER.md](19_RISK_REGISTER.md) R2.

---

*Next: [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md) for exactly what is real today.*
