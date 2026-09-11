# 19 — Risk Register

**Status of this document:** VERIFIED. R1–R16 are drawn directly and near-verbatim from `docs/current/production-risk-register.md`, a rigorous 2026-07-17 audit where every risk is backed by a live test or a direct source citation — the same standard this entire documentation set follows. Additional categories requested by this documentation's own mandate (Legal, broader Operational) that are not covered by that source audit are added below and explicitly marked as **reasonable inference, not code-verified**, consistent with this project's rule against inventing findings.

---

## Technical Risks

| ID | Risk | Severity | Likelihood | Blast Radius | Status |
|---|---|---|---|---|---|
| R1 | SSRF via 3 ODI browser-automation routes — no internal/private-IP validation on client-supplied URLs | **HIGH** | Requires an authenticated account | Internal network reconnaissance; cloud credential leak if deployed on AWS/GCP/Azure with the metadata endpoint reachable | Reported, a subsequent commit (`06e50b2`) appears to address it — verify before relying on this |
| R2 | No database-enforced tenant isolation — all state in flat JSON files | HIGH (multi-tenant) / LOW (single-operator) | Certain if deployed multi-tenant as-is | Cross-tenant data exposure if the (real, tested) app-layer isolation logic ever has a future bug — no database-level backstop exists | UNMITIGATED — architectural, explicitly out of scope for incremental fixes |
| R3 | Rate limiting covers 7 of 126 route files | MEDIUM | Requires a valid account | A single compromised/malicious operator token can hammer expensive AI-backed endpoints with no throttle | PARTIALLY MITIGATED — auth-gated, highest-risk surfaces covered |
| R4 | No CSRF-token layer | MEDIUM | Requires a logged-in victim to visit a malicious page | CSRF on cookie-authenticated state-changing requests | PARTIALLY MITIGATED — `sameSite:strict` covers most realistic vectors |
| R11 | Docker image build unverified by an actual build | LOW | Unknown — static review found no defects across 3 reviews | Deployment via Docker may fail in ways static review can't catch | PARTIALLY MITIGATED — statically correct, never proven live |
| R12 | Real production concurrency (250-1000 users) unverified | UNKNOWN (genuinely, not downplayed) | N/A | Proven clean at 10-100 concurrent connections; behavior beyond that is unmeasured | NOT ASSESSABLE without real staging + load infrastructure |
| R13 | True 24-hour+ stability unverified (only a 5-minute window measured) | UNKNOWN | N/A | A slow memory leak over hours/days cannot be ruled out | NOT ASSESSABLE without extended real-world runtime |
| R15 | `/queue/status` deep metrics endpoint degraded (references an archived module) | LOW | Certain, narrow scope | One metrics endpoint 503s; `/scheduler/status` unaffected | UNMITIGATED, low priority |
| — | `better-sqlite3` native-module ABI mismatch observed in one tested environment | LOW | Environment-dependent | Falls back to JSON store — non-fatal but a real degradation | Fix: `npm rebuild better-sqlite3` in the actual deploy environment |
| — | Disaster-recovery *validator* (`test-restore.cjs`) has a real naming-mismatch bug and would report a false failure even when the underlying restore succeeds | LOW-MEDIUM | Certain, if triggered | Could cause a real incident responder to distrust a working recovery, or waste time diagnosing a non-bug | UNMITIGATED — flagged in this documentation effort |

## Business Risks

| ID | Risk | Severity | Likelihood | Blast Radius | Status |
|---|---|---|---|---|---|
| R7 | Paid plan upgrades cannot complete (Razorpay plan IDs unprovisioned) | MEDIUM | Certain until provisioned | Users cannot upgrade trial → paid even though the base payment path is live | NEEDS CREDENTIAL, not a code gap |
| R8 | 11 connectors code-ready but uncredentialed | LOW individually / MEDIUM in aggregate | Certain until provisioned | Advertised integrations don't function; app honestly reports "not configured" rather than faking success | NEEDS CREDENTIALS — honest degraded state confirmed |
| R5 | Email verification / password reset non-functional (`RESEND_API_KEY` absent) | **HIGH for beta launch specifically** | Certain — will not work until provisioned | Real users cannot verify email or reset a forgotten password | NEEDS CREDENTIAL |
| — | Billing cancellation message/logic discrepancy — UI promises access until period-end, code blocks immediately | LOW-MEDIUM | Certain if a user cancels | Customer-support friction, possible refund/goodwill disputes | UNMITIGATED — found in this documentation effort, see [09_SAAS_MODEL.md](09_SAAS_MODEL.md) |
| — | Marketplace has real code but no evidence of real transaction volume yet | LOW (not a defect, a maturity gap) | N/A | Cannot be relied on as a current revenue line | Expected at this product stage — see [09_SAAS_MODEL.md](09_SAAS_MODEL.md) |

## Security Risks

Covered in full technical detail in [15_SECURITY.md](15_SECURITY.md). Headline items: R1 (SSRF, above), R3/R4 (rate-limiting/CSRF, above), plus:

| Risk | Severity | Status |
|---|---|---|
| `.env.bak.module8` — an untracked file found in the repo root during this documentation effort, appearing to contain a live API key in plaintext, not covered by `.gitignore`'s `.env*` patterns | **HIGH if committed/pushed** | Flagged directly to the user outside this document set — recommend deletion and key rotation if there's any chance it was staged |
| `SECURITY.md` contains factually incorrect claims (bcrypt vs. actual scrypt; "no SSO" vs. actual Firebase OAuth) | LOW technical / MEDIUM reputational if relied on for a compliance or disclosure process | Should be corrected — see [15_SECURITY.md](15_SECURITY.md) |

## Scaling Risks

| Risk | Severity | Basis |
|---|---|---|
| PM2 explicitly configured single-instance (`instances: 1`) — in-process singletons (task queue, learning system, context engine) are not cluster-safe | MEDIUM-HIGH at scale | `ecosystem.config.cjs`'s own code comment: "Never set instances > 1" |
| No database means no horizontal read/write scaling path exists today | Same root cause as R2 | See [10_17_COMPANY_STRATEGY.md](10_17_COMPANY_STRATEGY.md), [12_ROADMAP.md](12_ROADMAP.md) P12 |
| AI API cost scales with autonomous-feature usage, not just user count, and is not yet capped per-organization in a way this audit confirmed | MEDIUM | 1,585 real AI calls observed in a single 70-second unattended window during the audit — see [17_FINANCIAL_PLAN.md](17_FINANCIAL_PLAN.md) |

## Legal Risks (reasonable inference — not code-verified; flagged as such)

**No legal/compliance documentation of substance was found in this codebase beyond the technical `SECURITY.md`/`ROLE_MATRIX.md` files.** The following are standard considerations for a company at this stage, not findings from the repository:

- **Data residency/protection compliance** (e.g. India's DPDP Act, given the company is India-registered per `package.json`'s legal-entity name, and/or GDPR if EU users are accepted) — not evidenced as addressed anywhere in this codebase. Given there is no database and no formal data-retention policy found, a formal privacy policy and data-handling review is a reasonable near-term legal task, independent of the technical tenant-isolation work.
- **Terms of Service / Privacy Policy** — not found in this repository; likely exists elsewhere (e.g. the live website) but was not verifiable from the code.
- **Payment processor compliance** (Razorpay's own KYC/business-verification requirements for live-mode payments) — outside this codebase's scope to verify; a business/legal task for the founder.
- **Misrepresentation risk of the "autonomous business" framing** — this is the one legal-adjacent risk this documentation set can genuinely ground in code: see R9 below, carried over from the technical audit because it has real legal/marketing implications, not just a technical one.

## AI Risks

| ID | Risk | Severity | Likelihood | Status |
|---|---|---|---|---|
| R9 | Autonomous "organization" subsystems are simulation, not real business operation, but are named as if they were | MEDIUM (reputational/legal if misrepresented) | N/A — a factual product-truth risk, not a technical failure risk | MITIGATED BY DISCLOSURE — documented plainly in `known-limitations.md`; the risk is in how the product is marketed, not in the code. **Selling these as live autonomous business/civilization operations to an enterprise buyer would be a factual misrepresentation.** |
| R10 | No true self-correction in autonomous decision-making — a computed "confidence" score is logged but behaviorally ignored | LOW (technical) / MEDIUM (marketing-claim risk) | N/A | MITIGATED BY DISCLOSURE — same pattern as R9. Marketing claims of "self-correcting AI" would not be supportable if scrutinized. |
| — | AI API cost is variable and provider-dependent; a provider outage or quota exhaustion degrades gracefully today (returns a clear "AI backend unavailable" message rather than a silent failure) but has not been tested against a sustained multi-provider outage | LOW | Real provider 429s were observed during the audit's own load testing, handled gracefully | Acceptable as-is; monitor via the AI Costs dashboard |

## Operational Risks (reasonable inference — grounded in the [18_TEAM_STRUCTURE.md](18_TEAM_STRUCTURE.md) finding of a solo-founder operation)

- **Single point of failure in operational knowledge.** All operational runbooks (`SUPPORT_RUNBOOK.md`, `DISASTER_RECOVERY.md`, `DAY1_OPERATIONS.md`) are well-written and clearly intended to be handoff-able, but as of this audit there is no evidence a second person has ever executed them. This is a real continuity risk for a solo-founder operation, mitigated somewhat by the quality of the written runbooks themselves.
- **Off-server backup replication is not yet set up** — the founder's own `DISASTER_RECOVERY.md` calls this "the single biggest gap between 'we have backups' and 'we can actually recover.'" If the VPS is lost entirely, current backups (stored only on that VPS) are lost with it.
- **Desktop distribution is currently non-functional** (B17) — any operational plan that assumes desktop-app users can receive updates via the packaged installer path is currently invalid until this is resolved.

## Top 3 Risks Requiring a Decision Before Any Launch Beyond a Fully-Trusted Internal Team

(Preserved verbatim from the source audit's own prioritization, which this documentation set agrees with after independent review of the same evidence.)

1. **R1 (SSRF)** — the only HIGH-severity item with a real, live-confirmed reachable exploit path (pending verification that the recent fix commit actually closes it).
2. **R2 (tenant isolation)** — architectural; the true blocker for any multi-tenant launch, requires a scoped follow-up project, not a quick fix.
3. **R5 (email verification broken)** — a HIGH-severity blocker specifically for the closed-beta launch that is otherwise given a GO; provisioning one credential resolves it.

---

*Next: [20_FOUNDER_DAILY_WORKFLOW.md](20_FOUNDER_DAILY_WORKFLOW.md) for how the founder manages all of this day to day.*
