# 18 — Team Structure

**Status of this document:** VERIFIED (current state) + reasonable inference (future hiring needs, clearly labeled as such). Git history and legal/company naming are the primary evidence sources; team composition beyond the founder is not directly evidenced in the repository and is not invented here.

---

## Current Team — VERIFIED

**Solo founder, single-operator build.** Git history shows 487 commits from 2026-04-24 to 2026-07-18 under one primary human identity (`EHTSM`), plus a `root` identity likely representing automated/server-side or AI-assisted commits. No evidence of a multi-person engineering team exists in the commit history (no distinct secondary contributor identities). The legal entity is **ALWALIY TECHNOLOGIES PRIVATE LIMITED** (per `package.json`'s description field).

This matches the product's own stated positioning exactly: *"lets a solo founder operate like a company of 10."* The founder-authored operational documents (`FOUNDER_CHECKLIST.md`, `DAY1_OPERATIONS.md`, `SUPPORT_RUNBOOK.md`, `DISASTER_RECOVERY.md`, `RELEASE_PLAYBOOK.md`, `CUSTOMER_ONBOARDING.md`) are all written in a first-person operator voice, consistently addressing a single reader who is expected to personally run every function — engineering, DevOps, support, and business operations — themselves.

## Roles the Founder Currently Fills (inferred from documented workflows, not stated as a formal org chart)

Based on what the founder-authored docs actually instruct one person to do:

| Function | Evidence this is currently a founder responsibility |
|---|---|
| Engineering / code changes | All commits are from one identity; `RELEASE_PLAYBOOK.md` assumes the reader personally tags and monitors releases |
| DevOps / deployment | `PRODUCTION_DEPLOYMENT_GUIDE.md`, `deploy/*.sh` scripts assume one operator running them manually on the VPS |
| Support | `SUPPORT_RUNBOOK.md` — daily checks, ticket triage, and customer communication templates are all written for a single reader |
| Incident response | `docs/current/INCIDENT_RESPONSE.md`, `DISASTER_RECOVERY.md` — same single-operator assumption |
| Security review | The 2026-07-17 reality-completion audit that grounds most of this documentation set was itself run as a single, self-directed audit mission on the current branch |
| Business/sales/CRM operation | The CRM module is built for one operator managing the pipeline directly (WhatsApp/Telegram automation exists specifically to reduce, not replace, the need for a human sales team) |

**No evidence exists of a design, marketing, or dedicated sales function** distinct from the founder today — the "Growth" screen group (SEO, Content, Social, Email, Referral — see [06_SCREEN_CATALOG.md](06_SCREEN_CATALOG.md)) exists specifically as AI-assisted tooling *for* a solo founder to perform these functions themselves, not evidence that dedicated people already fill these roles.

## Future Hires — Reasonable Planning Guidance, Not Evidenced in the Repository

This section is explicitly forward-looking guidance for a Project Manager planning growth, not a claim about anything documented in the codebase:

| Function | When it likely becomes necessary | Why (grounded in this documentation's own findings) |
|---|---|---|
| **Backend/infrastructure engineer** | Before attempting the database-tenant-isolation project ([12_ROADMAP.md](12_ROADMAP.md) P12) | This is explicitly the largest, most architecturally significant remaining work item — a solo founder attempting it alongside daily operations is a real execution risk |
| **DevOps / release engineer** | Before/during resolving the Electron build blocker (B17) | The native-module packaging issue has already consumed 4+ release-candidate iterations; specialized native-toolchain expertise would likely resolve it faster |
| **Security engineer (part-time/contract acceptable)** | Before any multi-tenant or enterprise launch | The SSRF finding, thin rate-limiting coverage, and the tenant-isolation gap are all real, documented risks best closed with dedicated security attention rather than as a side effect of feature work |
| **Customer support** | When active paid users exceed what a founder can personally support within `SUPPORT_RUNBOOK.md`'s documented 5-minute daily-check cadence | The support runbook itself is designed to be handed off — it's written as an operational procedure, not tribal knowledge |
| **Design** | If per-company white-labeling ([10_17_COMPANY_STRATEGY.md](10_17_COMPANY_STRATEGY.md)) becomes a priority | No per-org branding system exists yet; this is new design + engineering work |
| **Marketing** | Post-closed-beta, if the 50-user cap is lifted and broader acquisition begins | The Growth OS tooling can be operated by a marketing hire directly — it was built to be operator-friendly, not developer-only |
| **Sales** | If the Scale/Enterprise plan (currently ₹0/custom in code, implying manual negotiation) becomes a real revenue line | The self-serve Starter/Growth plans don't need a sales function; a negotiated Enterprise tier typically does |

## Operations Model Implied by the Codebase

The product itself is architected around *reducing* headcount need rather than assuming a large team will operate it — the "Autonomous Workforce," "Company Factory," and various "Org" subsystems ([11_AUTONOMOUS_CAPABILITIES.md](11_AUTONOMOUS_CAPABILITIES.md)) represent real, if partially self-referential, investment in having AI agents fill roles a growing company would otherwise hire humans for. A new Project Manager should read team-growth planning through this lens: **the founder's own product thesis is that this platform should reduce, not follow, the usual headcount curve** — hiring decisions should be weighed against "could this instead be an autonomous-runtime capability we invest in finishing" (per the honest gaps in doc 11) before defaulting to a traditional hire.

---

*Next: [19_RISK_REGISTER.md](19_RISK_REGISTER.md) for the risks a growing team would need to manage.*
