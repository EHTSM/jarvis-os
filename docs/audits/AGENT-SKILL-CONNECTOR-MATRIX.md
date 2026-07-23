# Agent / Skill / Connector Matrix

All entries below are backed by file:line evidence gathered by direct code reading — no markdown "phase report" in the repo was used as a source. Where the codebase's own comments admit a limitation, that is quoted directly.

---

## 1. Agent Archetypes (~60 target roles)

Three separate, non-interoperating "agent list" constructs exist in this codebase. They do not share a schema and nothing merges them:

| Construct | File | Count | Nature |
|---|---|---|---|
| Runtime capability registry | `agents/runtime/agentRegistry.cjs`, populated by `agents/runtime/bootstrapRuntime.cjs` | **8** | Real dispatcher: `taskRouter.cjs:10-72` → `agentRegistry.findForCapability()` → `executionEngine.executeTask()` with retries/timeout/circuit breaker/dead-letter queue |
| Supervisor role ticks | `backend/services/agentRuntimeSupervisor.cjs:1064-1074` | **10** | Real `setInterval` ticks reading real services, but every tick stops at creating a mission/task record — no end-action execution |
| Workforce-sim catalogue | `backend/services/skillEngine.cjs:37-82` `AGENT_CATALOGUE` | **27** | Plain data objects (`id, org, skills[], specializations[], confidence, maxConcurrent, teamTypes[]`) — no handler, no execution path. Consumed only by `teamBuilder.cjs`/`workforceDashboard.cjs`/`performanceEngine.cjs`/`capacityPlanner.cjs` |

Additionally, `agents/business/*.cjs` (11), `agents/content/*.cjs` (11), `agents/internet/*.cjs` (11), `agents/multi/*.cjs` (6), `agents/system/*.cjs` (2) = **~41 files** with real per-file logic. Confirmed via exhaustive grep: **zero files under `backend/` `require()` any of these directories.** Completely unreachable from the running server.

### Role-by-role classification

| # | Role | Class | Agent implementation | Skills/tools | Runtime path |
|---|---|---|---|---|---|
| 1 | Founder/CEO | PARTIAL | `agentRuntimeSupervisor.cjs` `agent_executive` tick (`_executiveTick`, line 785) | reads real data, synthesizes summary | mission-creation only |
| 2 | COO | PARTIAL | `skillEngine.cjs:58-59` `bizorg_coo` (data-only) + `businessOrg.cjs:516` tickFn | same | mission-creation only |
| 3 | Strategy | COMPOSABLE NOW | none dedicated | generic mission planner | `missionOrchestrator.cjs` |
| 4 | Executive Intelligence | PARTIAL | `_executiveTick` (agentRuntimeSupervisor.cjs:785) | — | mission-creation only |
| 5 | Project Manager | COMPOSABLE NOW | `_plannerTick` (agentRuntimeSupervisor.cjs:251) | generic mission/task | real (creates/tracks missions) |
| 6 | Risk | COMPOSABLE NOW | none dedicated | generic mission planner | — |
| 7 | Compliance | **MISSING** | none found | none | — |
| 8 | Sales | WORKING (narrow) | `crm` capability (`bootstrapRuntime.cjs:184-203`) | wraps `crmService` | real, but only get_leads/note/reminder |
| 9 | Lead Generation | **MISSING** | not found | — | — |
| 10 | CRM | WORKING (narrow) | same as Sales | `crmService` | real |
| 11 | Marketing | PARTIAL | `_marketingTick` (agentRuntimeSupervisor.cjs:719) | real campaign data read | mission-creation only, no ad-platform execution |
| 12 | Growth | PARTIAL | same as Marketing | — | mission-creation only |
| 13 | Performance Ads | **MISSING** | no ad-platform integration found | — | — |
| 14 | SEO | UNWIRED | `agents/business/seoAgent.cjs` | real logic | unreachable (island) |
| 15 | Social Media | UNWIRED | `agents/internet/socialMediaAgent.cjs`, `agents/content/*` | real logic | unreachable (island) |
| 16 | Customer Success | PARTIAL | `customerSuccessEngine.cjs`, `customerSuccess.cjs` | dashboard/analytics-oriented | reachability as live-dispatched agent not confirmed |
| 17 | Customer Support | PARTIAL | `customerSupportEngine.cjs` | same | same |
| 18 | Product Manager | COMPOSABLE NOW | none dedicated | generic mission/task planner | — |
| 19 | Software Engineer | WORKING | `dev` capability (`bootstrapRuntime.cjs:73-88`) → `agents/devAgent.cjs` | real | real, reachable |
| 20 | Coding | WORKING | same + `agents/dev/*` factory files | real | reachable |
| 21 | QA | PARTIAL | `_testerTick` (agentRuntimeSupervisor.cjs, "monitor regressions") | — | mission-creation only |
| 22 | DevOps | **MISSING (as agent)** | `engorg_devops` skill-tag only (skillEngine.cjs:48) | no execution wiring | — |
| 23 | Cloud Infrastructure | **MISSING (as agent)** | same as DevOps | — | — |
| 24 | Security | PARTIAL | `_securityTick` (agentRuntimeSupervisor.cjs:528) | explicit code comment: "creates missions only, never modify code" | read-only by design |
| 25 | Data Engineer | COMPOSABLE NOW | none dedicated | generic `ai` capability | real |
| 26 | AI/ML | COMPOSABLE NOW | `ai` capability (`bootstrapRuntime.cjs:207-220`) → `aiService.callAI` | real | reachable |
| 27 | Integration | COMPOSABLE NOW | generic `automation` capability | real | reachable |
| 28 | CFO/Finance | WORKING | `billingService.js` (335 lines) | real | reachable via 10+ routes |
| 29 | Accounting | **MISSING** | not found | — | — |
| 30 | Billing | WORKING | `billingService.js` | real | reachable |
| 31 | Payment | WORKING | `paymentService.js` (124 lines, real Razorpay integration line 6) | real | reachable |
| 32 | Treasury | **MISSING** | not found | — | — |
| 33 | Procurement | **MISSING** | not found | — | — |
| 34 | Inventory | **MISSING** | not found | — | — |
| 35 | Supply Chain | **MISSING** | not found | — | — |
| 36 | Logistics | **MISSING** | not found | — | — |
| 37 | Research | UNWIRED | `agents/internet/webScraperAgent.cjs`, `newsAggregatorAgent.cjs` | real logic | unreachable (island) |
| 38 | Knowledge | UNWIRED | same island | — | — |
| 39 | Content/Writer | UNWIRED | `agents/content/scriptWriterAgent.cjs` | real logic | unreachable |
| 40 | Graphic Design | UNWIRED | `agents/content/imageGeneratorAgent.cjs` | real logic | unreachable |
| 41 | UI/UX | **MISSING** | not found | — | — |
| 42 | Video | UNWIRED | `agents/content/videoGeneratorAgent.cjs` | real logic | unreachable |
| 43 | Audio/Voice | UNWIRED | `agents/content/voiceCloningAgent.cjs` | real logic | unreachable |
| 44 | 3D/CAD | **MISSING** | not found | — | — |
| 45 | HR | **MISSING** | not found | — | — |
| 46 | Recruitment | **MISSING** | not found | — | — |
| 47 | Document | **MISSING** | not found | — | — |
| 48 | Legal Workflow | **MISSING** | not found | — | — |
| 49 | Manufacturing | **MISSING** | not found | — | — |
| 50 | Quality Control | **MISSING** | not found | — | — |
| 51 | Maintenance | **MISSING** | not found | — | — |
| 52 | IoT | **MISSING** | not found | — | — |
| 53 | Robotics | **MISSING** | not found | — | — |
| 54 | Energy | **MISSING** | not found | — | — |
| 55 | Geospatial | **MISSING** | not found | — | — |
| 56 | Quant/Market Intelligence | PARTIAL | `agents/internet/marketIntelligenceAgent.cjs`, `competitorTrackerAgent.cjs` | real logic | unwired |
| 57 | Blockchain/Web3 | **MISSING** | not found | — | — |
| 58 | Scientific Research | PARTIAL | `scientificDiscoveryDashboard.cjs` (203 lines) | dashboard/reporting only (`getDashboard`, `getPipelineView`) | not an executing agent |
| 59 | Simulation/Digital Twin | **MISSING** | not found | — | — |
| 60 | Forecasting/Optimization | PARTIAL | `revenueForecastEngine.cjs` | scope limited to revenue | reachable, narrow |

**Totals:** WORKING 6 · COMPOSABLE NOW 6 · PARTIAL 12 · UNWIRED 8 · MISSING 28 (of 60)

---

## 2. Skill Library

No unified tool-calling/function-calling registry exists (`backend/services/aiService.js` `callAI()` is a plain prompt-completion call — no `tools:[...]` schema found passed to any provider).

| Category | Real skills found | Status |
|---|---|---|
| Executive | 0 dedicated (mission-creation ticks only) | PARTIAL |
| Sales | crm capability (narrow: get_leads/note/reminder) | WORKING |
| Marketing | mission-creation only | PARTIAL |
| CRM/Support | crm capability | WORKING (narrow) |
| Engineering | dev, filesystem, terminal | WORKING |
| AI | ai capability (generic prompt completion) | WORKING |
| Data | none dedicated | COMPOSABLE via ai |
| Finance | billingService, paymentService (Razorpay) | WORKING |
| Commerce | none dedicated beyond payment | PARTIAL |
| Operations | automation, browser | WORKING |
| Creative | image/video/voice agents | UNWIRED |
| Knowledge/Research | webScraper/newsAggregator agents | UNWIRED |
| Documents | none | MISSING |
| Physical/Industrial | desktop capability (env-gated, off by default) | PARTIAL (disabled) |
| Advanced Intelligence | ai capability | WORKING |

**Totals:** 8 confirmed WORKING (browser, terminal, automation, dev, filesystem, crm, ai, desktop[off]) · ~10 PARTIAL (agentRuntimeSupervisor role ticks — real read + mission-write, no end-action) · ~41 files UNWIRED (real logic, unreachable) · ~135 tag-strings DEAD (`skillEngine.cjs` `AGENT_CATALOGUE` skill tags, metadata only, feeds an internal workforce-capacity simulation that doesn't drive dispatch).

**Against the ~90-target capability set: 8/90 confirmed working end-to-end.**

---

## 3. Connector Master Audit

Source: `backend/services/integrationConnectors.cjs` (1468 lines) — 13 phases (A–M), 62 connector functions. This is the entire connector surface in the repo; no CRM/support/accounting/shipping/maps/creative-3D/video/audio/blockchain/trading/scientific/mobile-distribution/desktop-signing/IoT connector exists anywhere (confirmed via grep for salesforce/hubspot/quickbooks/zendesk/shippo/blender/autocad/coinbase/web3 — zero hits).

Every connector follows the same shape: check env/vault presence → if present, real HTTP `_probe()` call → map HTTP result to CONNECTED/PARTIAL. **None perform real business transactions** — they are reachability/auth-verification checks only.

### Phase A — AI Providers (`integrationConnectors.cjs:166-301`)

| id | verdict | env vars |
|---|---|---|
| ai:groq | **IMPLEMENTED + CREDENTIALS PRESENT** | GROQ_API_KEY |
| ai:openai | **IMPLEMENTED + CREDENTIALS PRESENT** | OPENAI_API_KEY |
| ai:anthropic | IMPLEMENTED + NEEDS CREDENTIALS | ANTHROPIC_API_KEY |
| ai:gemini | IMPLEMENTED + NEEDS CREDENTIALS | GEMINI_API_KEY, GEMINI_MODEL |
| ai:openrouter/deepseek/together/fireworks/cohere/nvidia/grok | IMPLEMENTED + NEEDS CREDENTIALS | resp. `*_API_KEY` |
| ai:qwen | IMPLEMENTED + NEEDS CREDENTIALS | DASHSCOPE_API_KEY, QWEN_REGION, QWEN_MODEL |
| ai:ollama/lmstudio | IMPLEMENTED (local-only) | none (local runtime) |
| ai:stability, ai:elevenlabs | **CODE EXISTS BUT UNWIRED** — not in `AI_PROVIDERS` map; stale `data/integration-connectors.json` entries reporting "Unknown provider" | n/a |

### Phase B — Git (307-360)
| id | verdict | env vars |
|---|---|---|
| github | NEEDS CREDENTIALS (real probe: /user, /rate_limit) | GITHUB_TOKEN, GITHUB_CLIENT_ID/SECRET, GITHUB_APP_ID |
| gitlab | NEEDS CREDENTIALS (real probe) | GITLAB_TOKEN/GITLAB_ACCESS_TOKEN, GITLAB_HOST |
| bitbucket | NEEDS CREDENTIALS (real Basic-auth probe) | BITBUCKET_USER(NAME), BITBUCKET_APP_PASSWORD/TOKEN |

### Phase C — Infrastructure (366-458)
| id | verdict | env vars |
|---|---|---|
| hostinger | NEEDS CREDENTIALS | HOSTINGER_API_KEY |
| cloudflare | NEEDS CREDENTIALS | CLOUDFLARE_API_TOKEN/CF_API_TOKEN, CLOUDFLARE_ACCOUNT_ID |
| firebase | **PARTIAL/FAKE-ish** — no real network call, only JSON.parse validity of service-account string | FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT |
| supabase | NEEDS CREDENTIALS | SUPABASE_URL, SUPABASE_ANON_KEY/SERVICE_KEY |
| aws (S3) | NEEDS CREDENTIALS (delegates to storageService) | AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY, S3_BUCKET, AWS_REGION |
| r2 | NEEDS CREDENTIALS | R2_ACCESS_KEY_ID/SECRET/BUCKET/ACCOUNT_ID |

### Phase D — Payments (464-527)
| id | verdict | env vars |
|---|---|---|
| razorpay | **IMPLEMENTED + CREDENTIALS PRESENT** | RAZORPAY_KEY_ID/KEY, RAZORPAY_KEY_SECRET/SECRET, RAZORPAY_WEBHOOK_SECRET |
| stripe | NEEDS CREDENTIALS (vault holds a key but no stripe SDK installed; probe uses raw https) | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PUBLISHABLE_KEY |
| paddle | NEEDS CREDENTIALS | PADDLE_API_KEY, PADDLE_VENDOR_ID, PADDLE_WEBHOOK_SECRET |
| lemonsqueezy | NEEDS CREDENTIALS | LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID, LEMONSQUEEZY_WEBHOOK_SECRET |

### Phase E — Email (533-651)
| id | verdict | env vars |
|---|---|---|
| resend | NEEDS CREDENTIALS (real probe) | RESEND_API_KEY |
| sendgrid | NEEDS CREDENTIALS (real probe; real *send* logic separately in `emailService.cjs:143`) | SENDGRID_API_KEY |
| mailgun | NEEDS CREDENTIALS | MAILGUN_API_KEY, MAILGUN_DOMAIN |
| postmark | NEEDS CREDENTIALS | POSTMARK_API_KEY |
| brevo | NEEDS CREDENTIALS | BREVO_API_KEY |
| ses | **PARTIAL/FAKE-MOCK health check** — comment: "cannot probe without sending," always PARTIAL by design | AWS_ACCESS_KEY_ID/SECRET_ACCESS_KEY, AWS_SES_REGION, SES_FROM_EMAIL |
| smtp | PARTIAL (raw TCP connect only, no auth handshake) | SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT |

### Phase F — Messaging (657-789)
| id | verdict | env vars |
|---|---|---|
| whatsapp | IMPLEMENTED, credential present but currently broken (HTTP 400 in live data) | WA_TOKEN/WHATSAPP_TOKEN, WA_PHONE_ID/PHONE_NUMBER_ID, WA_BUSINESS_ACCOUNT_ID, WA_VERIFY_TOKEN, WA_API_VERSION |
| telegram | **IMPLEMENTED + CREDENTIALS PRESENT** | TELEGRAM_TOKEN |
| twilio | NEEDS CREDENTIALS | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER |
| discord (bot) | NEEDS CREDENTIALS | DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_WEBHOOK_URL |
| slack | NEEDS CREDENTIALS | SLACK_BOT_TOKEN, SLACK_CLIENT_ID/SECRET |
| teams | NEEDS CREDENTIALS/OAuth | MICROSOFT_CLIENT_ID/SECRET, TEAMS_WEBHOOK_URL, MS_GRAPH_TOKEN |

### Phase G — Auth/OAuth (795-876)
| id | verdict | env vars |
|---|---|---|
| google | PARTIAL verification depth — only checks Google's public discovery doc, never validates client secret | GOOGLE_CLIENT_ID/SECRET, GOOGLE_REDIRECT_URI |
| github (oauth) | **FAKE-MOCK** — no network call, reports CONNECTED from env presence alone | GITHUB_CLIENT_ID/SECRET, GITHUB_REDIRECT_URI |
| microsoft | PARTIAL verification depth (discovery-doc only) | MICROSOFT_CLIENT_ID/SECRET, MICROSOFT_TENANT_ID, MICROSOFT_REDIRECT_URI |
| linkedin | PARTIAL verification depth (discovery-doc only) | LINKEDIN_CLIENT_ID/SECRET, LINKEDIN_REDIRECT_URL |
| apple | **FAKE-MOCK** — no network call | APPLE_TEAM_ID, APPLE_CLIENT_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY |
| discord (oauth) | **FAKE-MOCK** — no network call | DISCORD_CLIENT_ID/SECRET, DISCORD_REDIRECT_URI |

### Phase H — Productivity (882-997)
| id | verdict | env vars |
|---|---|---|
| google_workspace | PARTIAL — checks OAuth-layer connection list only | GOOGLE_CLIENT_ID/SECRET, GOOGLE_REDIRECT_URI |
| m365 | NEEDS CREDENTIALS/OAuth | MICROSOFT_CLIENT_ID/SECRET, MS_GRAPH_TOKEN |
| dropbox | NEEDS CREDENTIALS | DROPBOX_ACCESS_TOKEN, DROPBOX_APP_KEY/SECRET |
| notion | NEEDS CREDENTIALS | NOTION_API_KEY, NOTION_CLIENT_ID/SECRET |

### Phase I — Commerce (1003-1057)
| id | verdict | env vars |
|---|---|---|
| shopify | NEEDS CREDENTIALS | SHOPIFY_STORE_DOMAIN/DOMAIN, SHOPIFY_ADMIN_TOKEN/ACCESS_TOKEN |
| woocommerce | NEEDS CREDENTIALS | WOOCOMMERCE_URL/WC_URL, WOOCOMMERCE_KEY/WC_CONSUMER_KEY, WOOCOMMERCE_SECRET/WC_CONSUMER_SECRET |
| wordpress | NEEDS CREDENTIALS | WORDPRESS_URL, WORDPRESS_USERNAME, WORDPRESS_APP_PASSWORD |

### Phase J — Creative (1063-1096)
| id | verdict | env vars |
|---|---|---|
| figma | NEEDS CREDENTIALS (duplicated probe also in `pcs2ExternalPlatforms.cjs:735-754`) | FIGMA_ACCESS_TOKEN/FIGMA_TOKEN |
| canva | NEEDS CREDENTIALS | CANVA_CLIENT_ID, CANVA_API_KEY, CANVA_CLIENT_SECRET |

### Phase K — Automation (1102-1155)
| id | verdict | env vars |
|---|---|---|
| zapier | **FAKE-MOCK** — only regex-validates the webhook URL prefix, never pings Zapier | ZAPIER_WEBHOOK_URL/ZAPIER_CATCH_HOOK |
| make (Integromat) | NEEDS CREDENTIALS | MAKE_API_KEY/MAKE_API_TOKEN, MAKE_WEBHOOK_URL/INTEGROMAT_WEBHOOK_URL |
| n8n | NEEDS CREDENTIALS (self-hosted) | N8N_HOST/N8N_BASE_URL, N8N_API_KEY, N8N_WEBHOOK_URL |

### Phase L — Monitoring (1161-1228)
| id | verdict | env vars |
|---|---|---|
| sentry | NEEDS CREDENTIALS (delegates to `sentryService.cjs`, real event send if configured) | SENTRY_DSN, SENTRY_AUTH_TOKEN, SENTRY_ORG |
| datadog | NEEDS CREDENTIALS | DATADOG_API_KEY, DATADOG_APP_KEY, DATADOG_SITE |
| uptime (UptimeRobot) | NEEDS CREDENTIALS | UPTIMEROBOT_API_KEY |

### Phase M — Project Management (1238-1280)
| id | verdict | env vars |
|---|---|---|
| jira | NEEDS CREDENTIALS | JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN |
| linear | NEEDS CREDENTIALS (vault holds one org-scoped key already) | LINEAR_API_KEY |

### Secret storage
- `backend/services/secretVault.cjs` (691 lines): **real AES-256-GCM encryption at rest**, key derived via SHA256(JWT_SECRET), file mode `0600`. On-disk `data/vault.json` confirmed to hold ciphertext, not plaintext. Currently holds 4 secrets: `ai:groq`, `ai:openai`, `pay:stripe`, one org-scoped `issue:linear`.
- `backend/services/secretManagementLayer.cjs` (252 lines): does not store/encrypt anything — pure presence/strength/rotation-age validator over `process.env`, covering only 13 hardcoded keys, far fewer than the 60+ connector env vars above.

### Categories entirely absent (no connector of any kind exists)
CRM (external, e.g. Salesforce/HubSpot), Support/helpdesk (Zendesk/Intercom), Accounting (QuickBooks/Xero), Shipping/logistics (Shippo/EasyPost), Maps/geospatial (Google Maps — referenced as an env var in `pcs2ExternalPlatforms.cjs:347` but explicitly annotated "not referenced in current codebase"), Video platforms, Audio/voice platforms, 3D/CAD tools, Mobile-app-store distribution APIs, Desktop code-signing services, IoT platforms, Blockchain/Web3, Market/trading data feeds, Scientific/deep-tech systems.

**Total: 62 connector functions defined, spanning 13 phases. 3 currently live with real credentials (Groq, OpenAI, Razorpay) + 1 partially-working-but-broken (WhatsApp). 6 are FAKE-MOCK (report success without a real network check): github-oauth, apple-oauth, discord-oauth, zapier, firebase (JSON-parse only), ses (by-design no-probe). Everything else needing credentials has real, working probe logic and would become IMPLEMENTED+CREDENTIALS PRESENT the moment valid keys are supplied — this is the most genuinely "ready after credentials" layer in the whole system.**
