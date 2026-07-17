# Known Limitations — Ooplix / JARVIS-OS V1

**Date:** 2026-07-17
**Purpose:** A plain-language, verified list of what does not yet work as a casual reading of the product's feature names might suggest. Every item here is derived from live testing, not assumption. Intended for internal use when scoping what can honestly be told to a beta user or enterprise evaluator.

---

## Features that are real but not autonomous in the way their names imply

The system genuinely observes its own host, executes real work, and recovers from real failures with zero human input — this was proven live, not assumed (a 70-second idle window with no operator action produced 1,585 real outbound AI-provider API calls and a real self-healing recovery of 5 failed work cycles).

However, the "organization" and "civilization" subsystems (Business OS, Enterprise OS, Autonomous Company/Revenue/Marketing/Support Centers, and 9 other similarly-named engines) do **not** independently trigger themselves and, when they do run, only ever read and write their own internal JSON files — they do not call a real external service, modify real infrastructure, or represent a real company's real operations. Do not describe these to a customer as "AI running your business autonomously." They are internal simulation/scaffolding.

The system also does not exhibit **true self-correction** — it retries failed work and escalates its retry strategy by attempt count, but it does not ever recognize that an earlier autonomous decision's judgment was wrong and choose a materially different approach because of that recognition. A computed "confidence" score exists in the logs but does not change behavior. Do not describe the product as "learning from its mistakes" at the decision level — this was specifically searched for and not found.

## Frontend pages that were removed from navigation

14 pages were found to either show fabricated example data with no real backend behind them, or point at a backend that was never built. All 14 have been removed from the app's navigation, search, and command palette so a user cannot reach them — they no longer appear anywhere in the product:

- **10 pages showed fake data as if live** (including fabricated example customer names): Enterprise CRM, Knowledge Center, Autonomous Company/Revenue/Marketing/Support Centers, Data Ownership, Disaster Recovery, Mobile Platform, Community.
- **4 pages pointed at a backend that doesn't exist:** Developer OS, Personal OS, Enterprise OS, Memory OS v2.

If any of these are needed for a future release, they require either real backend work (for the 4 broken ones) or a decision to ship them as clearly-labeled demo/preview content rather than live data (for the 10 fake-data ones) — neither has been done, by design, to avoid shipping fabricated data as real.

## Connectors that are not usable yet

Of 17 named third-party integrations, only **3 are proven working right now with real credentials**: Razorpay (payments), Telegram (bot messaging), OpenAI (AI). The underlying code for 11 more (GitHub, Google, Slack, Discord, Stripe, Notion, Anthropic, Gemini, Cloudflare, AWS, Supabase) is real and correct but has no API key configured in this environment — provisioning a real key is the only remaining step for each. WhatsApp has a real, valid access token but the wrong type of phone-number identifier configured, so it currently fails a live status check.

**Not built at all, regardless of credentials:** PayPal (zero code), and real Gmail/Calendar/Drive access (the app only requests OAuth permission scopes for these but never makes a real API call to any of the three services).

## Security items to be aware of before wider exposure

- The system has no CSRF-token layer. It relies on a strict same-site cookie policy, which covers the overwhelming majority of realistic attack scenarios for this kind of app but is not a complete substitute for a token-based defense.
- Three routes related to the browser-automation/design-analysis feature (`/odi/interactions/analyze`, `/odi/editor/start`, `/odi/observer/cycle`) let a logged-in user direct the server's browser to visit any URL, including internal network addresses, with no restriction. This requires a valid login to reach and is rate-limited, but should be fixed before allowing any user outside a fully-trusted team to access this feature.
- Rate limiting (protection against a single account making too many requests too fast) currently only covers login, registration, and a handful of expensive endpoints — most of the API surface has no per-account request cap beyond requiring a valid login.

## Data storage

All application data (accounts, organizations, workspaces, missions, billing state) is stored in flat files on disk, not a database with enforced per-tenant isolation boundaries. For a single operator or a small trusted team this is not a practical problem. For a public multi-tenant product serving unrelated customers on shared infrastructure, this is the single largest piece of remaining engineering work, and it is architectural — not something patchable in a quick fix.

## What was verified to genuinely work end-to-end

Sign-up, login, workspace creation, trial billing status, plan-based feature gating, AI chat requests, connector status reporting, and mission (project) creation and execution were all tested live this session with real accounts and real data, and all worked correctly.
