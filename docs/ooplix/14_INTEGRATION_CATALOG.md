# 14 — Integration Catalog (Phase 7)

## Architecture: probe-only, not sync

`backend/services/integrationConnectors.cjs` (1,676 lines) implements 44 real
`connect*` functions (direct count this session) across 13 phases (A-M: AI,
Git, Infra, Payments, Email, Messaging, Auth, Productivity, Commerce,
Creative, Automation, Monitoring, Project Management), reusing existing
services per its own header comment (never duplicating `aiService.js`,
`gitHubEngineeringAgent.cjs`, `pcs2ExternalPlatforms.cjs`, `sentryService.cjs`,
`storageService.cjs`, `oauthIntegrationLayer.cjs`, `emailService.cjs`,
`paymentService.js`, `localAiRuntime.cjs`, `providerManager.cjs`).

**Every connector's actual job is: check a credential is present → make one
live HTTP reachability/identity probe (`_probe()`, 6s timeout) → record a
status string** (`CONNECTED`/`READY`/`PARTIAL`/`MISSING`) to
`data/integration-connectors.json`, with a 4-hour background health-monitor
tick (`startHealthMonitor`). **None of the 44 functions perform bidirectional
create/read/update/delete against the external product's actual resources**
(confirmed: no `createPage`, `createTicket`, `createBoard`, `uploadDesign`
calls found for any connector). This is the single most important structural
fact in this domain — see `23_PRODUCT_REPLACEMENT_MATRIX.md` for its
consequences.

Count discrepancy flagged, not resolved: prior mission memory says "57+
connectors," `docs/audits/ENTERPRISE-CAPABILITY-MATRIX.md` says "62," direct
grep this session returns 44. Could be drift since either prior count, or a
difference in what was counted (e.g., the 14 AI-provider sub-entries in
`AI_PROVIDERS` counted separately elsewhere).

## Category breakdown (by connector function name, phase-grouped)

| Category | Examples | Real reachability check? | Real sync? |
|---|---|---|---|
| AI (Phase A) | groq, openai, anthropic, gemini, openrouter, deepseek, together, fireworks, cohere, nvidia, ollama, lmstudio, grok, qwen (14 providers) | Yes — real `/models` or equivalent GET | N/A (these ARE the AI backend, not external sync targets) |
| Git (Phase B) | GitHub, GitLab, Bitbucket | Yes | Real GitHub integration exists elsewhere (`gitHubEngineeringAgent.cjs`) — deeper than probe-only for GitHub specifically |
| Infra (Phase C) | Hostinger, Cloudflare, Firebase, Supabase, AWS, Cloudflare R2 | Yes | No |
| Payments (Phase D) | Razorpay, Stripe, Paddle, Lemon Squeezy | Yes | Real webhook handling exists separately (`payment.js`, HMAC-verified) — this is the one category with genuine bidirectional real-money flow, not just probe |
| Messaging (Phase E/F) | WhatsApp, Telegram, Twilio, Discord, Slack, Teams | Yes | WhatsApp/Telegram have real send-message paths elsewhere in the app; Slack/Teams/Discord connectors are probe-only |
| Auth (Phase F) | Google, GitHub, Microsoft, LinkedIn, Apple, Discord (OAuth) | Yes | Real — these back actual login flows, not just probes |
| Productivity (Phase G/H) | Google Workspace, Microsoft 365, Dropbox, Notion | Yes | No — Notion probe-only despite `KnowledgeCenter.jsx`'s superficial naming overlap |
| Commerce (Phase I) | Shopify, WooCommerce, WordPress | Yes | No |
| Creative (Phase J) | Figma, Canva | Yes | No — see `23_PRODUCT_REPLACEMENT_MATRIX.md`, both RED for replacement |
| Automation (Phase K) | Zapier, Make, n8n | Yes | No — Zapier's own connector comment self-documents this limitation |
| Monitoring (Phase L) | Sentry, Datadog, Uptime Monitor | Yes | Sentry has real bidirectional wiring elsewhere (`sentryService.cjs`, see `19_INFRASTRUCTURE.md`) |
| Project Management (Phase M) | Jira, Linear | Yes | No — real HTTP identity probe only, no issue CRUD against either's real API |

## Security posture

Credentials resolve through `secretVault.cjs`'s AES-256-GCM store first, with
an env-var fallback reserved for the platform's own `GLOBAL_ORG` (a previously
real cross-org leak here — a customer org could see the founder's own env-set
API key reported under their own org's status — is confirmed fixed, see
`07_SECURITY_MODEL.md`). No credentials are stored in plaintext anywhere.

## Verdict

The connector layer is real, extensive breadth-wise (44 distinct external
systems), and honestly self-limited in depth. It correctly answers "can Ooplix
reach this service" but not "does Ooplix meaningfully use this service" for
the majority of entries — Payments, Auth, WhatsApp/Telegram, GitHub, and
Sentry are the categories with confirmed deeper, non-probe-only integration
elsewhere in the codebase; the rest (Notion, Figma, Canva, Zapier, Make, n8n,
Jira, Linear, Slack, Teams, Discord as messaging) are reachability-check-only.

See `13_AI_PROVIDER_LAYER.md` for the AI-specific detail and
`23_PRODUCT_REPLACEMENT_MATRIX.md` for downstream product-replacement
consequences.
