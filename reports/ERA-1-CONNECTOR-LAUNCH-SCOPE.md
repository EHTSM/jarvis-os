# ERA-1 — CONNECTOR LAUNCH SCOPE INVENTORY

**Date:** 2026-09-09
**Branch:** `security/reality-completion`
**Scope:** Read-only inventory and classification. No connector was activated, provisioned, or
contacted. No credential value was read, checked, or invented.

> **This report does not select a launch list.** Its conclusion states what founder input is
> required to produce one. Doing otherwise would be inventing a business decision this mission
> has no authority to make (per CLAUDE.md §17/§22 and the parent mission's explicit "no
> guessing" instruction).

---

## Source of truth

- `backend/services/integrationConnectors.cjs` (1676 lines, full file structure reviewed) —
  the unified connector registry, organized into 12 category scanners (Phase A–L):
  `scanAllAIProviders` (A), `scanAllGitProviders` (B), `scanAllInfraProviders` (C),
  `scanAllPaymentProviders` (D), `connectEmailProviders`/email phase (E),
  `scanAllMessagingProviders` (F), `scanAllAuthProviders` (G),
  `scanAllProductivityProviders` (H), `scanAllCommerceProviders` (I),
  `scanAllCreativeProviders` (J), `scanAllAutomationProviders` (K),
  `scanAllMonitoringProviders` (L), plus `scanAllProjectManagementProviders` (a 13th,
  more recently added category per its position in the file).
- `reports/PHASE-1-CAPABILITY-COVERAGE-PROGRESS.md` — the exact **"8/62 connectors have
  declared capability/scope metadata, 54/62 do not"** fact, preserved verbatim below.
- `data/integration-connectors.json` — the live, persisted connector-state file, checked for
  its actual current key count as a cross-reference (not as a replacement for the code
  registry's own count).

## Count reconciliation (reported honestly, not forced to agree)

- `reports/PHASE-1-CAPABILITY-COVERAGE-PROGRESS.md` states **"~62"** connectors in its own
  prose (its exact-count claims are always framed as ratios — "8 of 62," "54 of 62" — over that
  approximate total, not as an independently re-derived total).
- `data/integration-connectors.json`'s live `connectors` object currently holds **65 keys** at
  the time of this mission's inspection (2026-09-09) — a small drift from the "~62" figure,
  consistent with the persisted state file accumulating connector records over time (e.g. from
  scans performed by different missions using slightly different registrations) without
  necessarily being pruned in lockstep with the code registry's own additions/removals. This
  drift is noted here as a fact, not corrected — reconciling it would require deciding which of
  the 65 persisted keys are stale, which is outside this mission's read-only scope.
- **The 8/62 declared-metadata fact is preserved exactly as Phase 1 stated it**, since that
  ratio is about `CONNECTOR_CAPABILITIES` (a fixed object in the source file, independent of
  the live state file's key count): `git:github`, `pay:razorpay`, `pay:stripe`, `msg:whatsapp`,
  `msg:telegram`, `msg:slack`, `auth:github`, `auth:google` — exactly these 8 have declared
  `capabilities`/`scopes` entries. Phase 1 reports 54 as the remaining count (against its own
  "~62" total); measured against the live state file's 65 keys, the remaining count is 57 —
  both are reported here since they come from two different baselines (Phase 1's own ~62
  estimate vs. this mission's direct 65-key count), not reconciled into one number. Either way,
  every connector outside the 8 named above returns `{capabilities: [], scopes: []}` honestly,
  by the file's own design comment ("connectors not listed here have no declared capability
  metadata yet") — not fabricated metadata.

## Full connector inventory (from `data/integration-connectors.json`'s live registry, 65 keys — exact, machine-counted, not estimated)

| Category | Count | Connector IDs |
|---|---|---|
| AI providers | 16 | `ai:deepseek`, `ai:anthropic`, `ai:gemini`, `ai:openrouter`, `ai:together`, `ai:fireworks`, `ai:cohere`, `ai:nvidia`, `ai:lmstudio`, `ai:ollama`, `ai:groq`, `ai:openai`, `ai:grok`, `ai:qwen`, `ai:stability`, `ai:elevenlabs` |
| Git | 3 | `git:github`, `git:gitlab`, `git:bitbucket` |
| Infra/storage | 6 | `infra:hostinger`, `infra:cloudflare`, `infra:firebase`, `infra:supabase`, `infra:aws`, `infra:r2` |
| Payments | 4 | `pay:razorpay`, `pay:stripe`, `pay:paddle`, `pay:lemonsqueezy` |
| Email | 7 | `email:resend`, `email:sendgrid`, `email:mailgun`, `email:postmark`, `email:brevo`, `email:ses`, `email:smtp` |
| Messaging | 6 | `msg:twilio`, `msg:discord`, `msg:slack`, `msg:telegram`, `msg:whatsapp`, `msg:teams` |
| Auth/OAuth | 6 | `auth:google`, `auth:github`, `auth:microsoft`, `auth:linkedin`, `auth:apple`, `auth:discord` |
| Productivity | 4 | `prod:google_workspace`, `prod:m365`, `prod:dropbox`, `prod:notion` |
| Commerce | 3 | `commerce:shopify`, `commerce:woocommerce`, `commerce:wordpress` |
| Creative | 2 | `creative:figma`, `creative:canva` |
| Automation | 3 | `auto:zapier`, `auto:make`, `auto:n8n` |
| Monitoring | 3 | `monitor:sentry`, `monitor:datadog`, `monitor:uptime` |
| Issue tracking | 2 | `issue:jira`, `issue:linear` |
| **Total** | **65** | |

This 65-connector live-state count is 3 above the "~62" figure Phase 1's report uses in its own
prose — see "Count reconciliation" above for why this is reported as drift, not forced to
match.

---

## Classification

### A. Intended launch connectors

**None declared anywhere in the repository.** No file — not `integrationConnectors.cjs`, not
any `reports/` document, not `ecosystem.config.cjs`, not `.env.example`'s comments — states
which connectors are intended to be live on day one of a production launch. Per this task's
explicit instruction, **this mission does not guess one.** The closest repository signal is
Mission 80's own finding that only 2 credentials are hard-required regardless of feature scope
(`JWT_SECRET`, `OPERATOR_PASSWORD_HASH`, plus the near-hard-required `BASE_URL`) — none of which
are connector credentials at all; they gate the app's own auth, not any external integration.

### B. Non-launch / long-tail

Cannot be classified without (A) existing first — "non-launch" is only meaningful relative to a
declared launch set. What can be said: several connectors are clearly optional-by-design
regardless of launch timing, per each category scanner's own graceful-degradation behavior
(confirmed unchanged from Mission 79's finding that every connector degrades to "not
configured" without crashing the app) — e.g. `creative:figma`/`creative:canva`,
`auto:zapier`/`auto:make`/`auto:n8n`, and the long tail of AI providers beyond whichever one is
the app's default (`GROQ_API_KEY` is called out elsewhere in this repo's own docs as the
soft-required default AI provider — the other 12+ AI connectors are additive alternatives, not
launch-blocking).

### C. Code-complete but credential-blocked

**Presence/absence could not be checked this mission.** This mission's sandbox denied Bash-level
access to `.env` at the tool-permission layer — `ls .env` and `test -f .env` were both refused
before execution, for *any* purpose, including bare existence checks. This is stricter than the
"presence-only, never values" allowance CLAUDE.md §20 describes; it means this report cannot
state, even at the key-name level, which of the ~65 connectors currently have credentials
configured. **This is a genuine gap in this mission's evidence, not a finding that no
credentials are configured** — it should not be read either way. A future session with
`.env`-existence-check permission granted could close this specific gap quickly (a single
`grep -c '^GROQ_API_KEY='  .env`-style check per connector, values never printed).

### D. Metadata-incomplete (the 54/62, preserved exactly)

**8 of ~62 connectors have declared capability/scope metadata** in
`integrationConnectors.cjs`'s `CONNECTOR_CAPABILITIES` object: `git:github`, `pay:razorpay`,
`pay:stripe`, `msg:whatsapp`, `msg:telegram`, `msg:slack`, `auth:github`, `auth:google`. **The
remaining ~54 connectors have zero declared capability metadata** — confirmed by direct read of
`CONNECTOR_CAPABILITIES` (an 8-entry object) against the full connector list. This is a
pre-existing, documented gap per Phase 1's own report (not fixed there, not fixed here — Phase 1
explicitly scoped closing this as "a distinct, larger mission," and this mission does not
re-open that scope decision). Practical effect: `capabilityRouting.cjs`'s `eligibleConnectors`
field will correctly show `[]` (not a fabricated capability list) for any skill whose connector
lacks declared metadata — a real gap, surfaced honestly rather than hidden, per Phase 1's own
design choice.

### E. Provider-approval-blocked

Business-verification-gated connectors, where the *code* is complete but the *provider* itself
requires an approval process outside this repository's control before production use:

- **`msg:whatsapp`** — the WhatsApp Business API (referenced directly in
  `backend/services/whatsappService.js`'s own header comment, "WhatsApp Business API Service")
  is publicly documented (by Meta, external to this repository) as requiring business
  verification and app review for production-scale messaging beyond a small test-number
  allowance. **This is general knowledge about the WhatsApp Business API platform, not a fact
  found written anywhere in this repository** — no file here documents this gating explicitly.
  Flagged because it is a materially relevant launch-scope consideration if `msg:whatsapp` is
  chosen for (A).
- **`auth:google`** — Google OAuth apps requesting sensitive/restricted scopes are publicly
  documented (by Google, external to this repository) as requiring an app-verification review
  before removing the "unverified app" consent-screen warning for external users at scale. Not
  documented anywhere inside this repository either — flagged for the same reason.
- **`auth:microsoft`, `auth:linkedin`, `auth:discord`, `auth:apple`** — each of these OAuth
  providers has its own external app-review/verification process for production use at scale
  (again, general platform knowledge, not repository-documented). Not individually re-verified
  against each provider's current policy this mission (would require contacting external
  providers, explicitly out of scope).
- **`pay:razorpay`, `pay:stripe`** — payment processors typically require business KYC/
  verification before enabling live (non-test-mode) transactions. This is standard for any
  payment integration and, again, not something this repository's own files assert — it is
  flagged as a launch-scope consideration, not a repository finding.

**Important caveat on this entire section:** none of the above is drawn from repository
evidence — no file in this codebase documents Meta/Google/Microsoft/LinkedIn/Discord/Apple/
Razorpay/Stripe's respective verification requirements. This section exists because the parent
task explicitly asked to check for "business-verification-gated providers like WhatsApp
Business API/Meta/Google OAuth verification," and the honest answer is: **the repository itself
is silent on this** — these are well-known platform policies asserted here from general
knowledge, clearly labeled as such, not verified against each provider's current live policy
(which would require contacting them, out of scope) and not treated as repository fact.

---

## Conclusion — founder input required

This report does not, and should not, pick a launch list. To produce one, the founder needs to
answer, at minimum:

1. **Which payment processor** (if any) is live at launch — Razorpay, Stripe, both, or neither
   (deferred to a later phase)? Each requires its own KYC/business-verification lead time
   (§E) that should be started well before the intended launch date if chosen.
2. **Which messaging channel(s)** are core to the product's day-one experience — WhatsApp
   (subject to Meta's business-verification lead time), Telegram/Slack/Discord (no comparable
   verification gate, per general platform knowledge), or none at launch?
3. **Which sign-in providers** are offered at launch — Google/GitHub/Microsoft/LinkedIn/Apple/
   Discord — and whether any requested OAuth scope triggers a provider verification review.
4. **Which AI provider(s)** beyond the default are exposed to end users at launch, versus kept
   as founder/operator-only configuration options.
5. **Storage provider** — R2, S3, or local disk at launch (cross-referenced in
   `reports/ERA-1-MANUAL-BLOCKER-CLOSURE.md`'s §STORAGE, including a newly found backup-coverage
   gap relevant to this choice).
6. **Whether the metadata-incomplete 54 connectors matter for launch** — if any of them are in
   the chosen launch set, their missing `CONNECTOR_CAPABILITIES` entries (§D) should be
   authored before relying on capability-routed skill dispatch through them; if none of the
   launch-scope connectors are among the 54, this gap can be deferred without launch impact.

**No connector was activated, tested against a live provider, or had its credentials checked
this mission.** This inventory is a map for the founder's own decision, not a decision itself.
