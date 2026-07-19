# 17 — Financial Plan

**Status of this document:** Explicitly mixed by design. This repository contains **no financial records, invoices, or hosting bills** — none were found, and none should be expected in a code repository. Every cost figure below is either (A) a real, code-verified price point the product itself charges or is configured to pay, or (B) an industry-standard range for a comparable real-world deployment, clearly labeled as an estimate. Per the mission rules for this documentation set, no exact unverifiable number is invented.

---

## CURRENT VERIFIED COSTS

These are prices and cost drivers directly confirmed in the codebase — not estimates:

| Item | Value | Source |
|---|---|---|
| Starter plan price | ₹999/month (~$12 USD/month) | `backend/services/billingService.js` `PLAN_PRICES` |
| Growth plan price | ₹2,499/month (~$30 USD/month) | `backend/services/billingService.js` `PLAN_PRICES` |
| Scale/Enterprise plan price | ₹0 in code (implies custom/negotiated pricing, not self-serve) | `backend/services/billingService.js` `PLAN_PRICES` |
| Trial length | 7 days, then 24-hour grace period | `billingService.js` `TRIAL_DAYS`/`GRACE_HOURS` |
| Payment processor fees | Razorpay's standard published transaction fees apply (not configurable in this codebase; Razorpay's own published rates apply, not restated here as they are the vendor's rate, not this product's) | Inference from `razorpay` SDK integration |
| PM2 memory ceiling per instance | 512MB restart threshold, 400MB V8 heap cap | `ecosystem.config.cjs` |
| Minimum VPS RAM (founder's own stated requirement) | 2GB | `FOUNDER_CHECKLIST.md` |
| AI request quotas by plan | Trial 200/mo, Starter 2,000/mo, Growth 10,000/mo, Scale unlimited | `billingService.js` `PLAN_QUOTAS` |
| Beta user cap | 50 accounts (`BETA_MAX_USERS`) | `CUSTOMER_ONBOARDING.md`, `betaReadiness.cjs` |

**Development investment to date**: **not calculable from this repository.** No hours-logged, contractor-invoice, or payroll data exists in a code repo, and estimating "person-hours to build 877,621 lines of code" would produce a fabricated-looking precision this documentation set's own rules forbid. What *can* be said: git history shows 487 commits from 2026-04-24 to 2026-07-18 (roughly 12 weeks) under a single primary contributor identity (`EHTSM`), with substantial machine-assisted/AI-assisted development evident throughout (see [21_PROJECT_STATISTICS.md](21_PROJECT_STATISTICS.md)) — this is a solo-founder-paced build, not a funded team's output, but translating that into a dollar "investment to date" figure would require information (contractor costs, the founder's own opportunity cost, AI/tooling subscription costs actually paid) that is not present in this repository and should be supplied by the founder directly if needed for an investor conversation.

## ESTIMATED FUTURE COSTS (industry-standard ranges — not repository-verified)

These are realistic ranges for a product at this stage and architecture, not figures found in the code:

### Monthly Infrastructure (single VPS, current architecture)

| Item | Estimated range (USD/month) | Basis |
|---|---|---|
| VPS (2-4GB RAM, matching the founder's own stated 2GB minimum) | $10–$40 | Standard published pricing from common VPS providers (Hetzner, DigitalOcean, Linode, Contabo) for a 2-4GB instance — not a specific vendor quote from this repo |
| Domain(s) — 3 subdomains under one root domain observed (`ooplix.com`, `app.ooplix.com`, `www.ooplix.com`) | $10–$20/year (~$1–2/month amortized) | Standard `.com` registration/renewal pricing |
| TLS certificates | $0 | Let's Encrypt via certbot — confirmed free, no cost driver here |
| Off-server backup storage (currently NOT set up, per `DISASTER_RECOVERY.md`'s own admitted gap) | $1–$10/month | Standard object-storage pricing (S3/R2/Backblaze) for a modest backup volume — the app already has real code paths for S3/R2 (see [08_CONNECTOR_CATALOG.md](08_CONNECTOR_CATALOG.md)), so adopting one of these for backups would reuse existing connector code |
| **Total infra (current single-VPS scale)** | **~$15–$60/month** | Sum of above |

### AI API Costs

**Highly variable, usage-dependent — no fixed figure applies.** What is verifiable: the product uses Groq (confirmed cost-competitive/often-free-tier for open models) and OpenAI (pay-per-token) as its two live-credentialed providers, with 10 more providers coded but uncredentialed. Real measured behavior from the audit: raw Groq round-trip ~350-450ms per call; a 70-second unattended autonomous window produced 1,585 real outbound AI-provider calls — **this is a meaningful, real, recurring cost driver once autonomous features are enabled in a live deployment**, and its magnitude scales directly with how many autonomous "Org" tick cycles are enabled and how frequently, not with user count alone. A Project Manager should treat AI API spend as a variable operating cost to monitor via the product's own "AI Costs" dashboard screen (see [06_SCREEN_CATALOG.md](06_SCREEN_CATALOG.md)) rather than a fixed line item — no fixed monthly estimate can be responsibly given without knowing which autonomous features will actually be left running continuously in production.

### Domain Costs

Already covered above (~$10-20/year for the current domain footprint).

### Email

Resend (the connector this app is actually built for — `RESEND_API_KEY`/`RESEND_FROM_EMAIL`) has a published free tier for low volume and low per-email pricing beyond that. At the current 50-account beta cap, this is very likely $0–$10/month. **This is currently unprovisioned in the live environment** (blocker B5) — provisioning it is a prerequisite for real user signups, not optional.

### Monitoring

$0 baseline (the app's own `deploy/monitor.sh` + PM2 + structured logging cost nothing beyond the VPS itself). If Sentry/Datadog (both already coded as connectors) are activated for real APM, their standard published free/starter tiers would likely cover this product's current scale — estimate $0–$29/month depending on which tier is chosen.

### Expected SaaS Operating Cost at Current (Closed Beta, ≤50 users) Scale

| Category | Estimated range (USD/month) |
|---|---|
| VPS + domain + backup storage | $15–$60 |
| Email (Resend) | $0–$10 |
| AI API (variable, depends on autonomous feature usage) | $20–$200+ — genuinely wide range; the low end assumes light manual use, the high end assumes autonomous "Org" ticking left running continuously |
| Monitoring (optional) | $0–$29 |
| Payment processing fees | Percentage of transaction volume (Razorpay's published rate), not a fixed cost |
| **Total (excluding AI variable and payment %)** | **~$15–$100/month baseline** |

### Expected Scaling Cost (if moving beyond single-VPS, single-tenant-safe architecture)

This is the point where costs stop being a simple extrapolation, because — as established throughout this documentation ([02](02_CURRENT_PROJECT_STATUS.md), [10](10_17_COMPANY_STRATEGY.md), [19](19_RISK_REGISTER.md)) — the current architecture has **no database-enforced tenant isolation** and PM2 is **explicitly configured single-instance** (in-process singletons are not cluster-safe). Scaling past what one VPS can serve is not primarily a cost question yet — it is an architecture question that must be resolved (database migration, horizontal-scale-safe service design) before "add more servers" is even a valid option. Once that work is done, typical ranges for a real multi-tenant SaaS at, say, 500-5,000 paying users would be in the low-to-mid hundreds to low thousands of USD/month (managed database, load-balanced app servers, CDN, expanded AI spend) — but **this range is a generic SaaS-industry estimate, not derived from this specific codebase's architecture**, and should be revisited once the P12 database-migration roadmap item ([12_ROADMAP.md](12_ROADMAP.md)) is scoped in detail.

---

*Next: [18_TEAM_STRUCTURE.md](18_TEAM_STRUCTURE.md) for who is (and isn't) needed to operate this.*
