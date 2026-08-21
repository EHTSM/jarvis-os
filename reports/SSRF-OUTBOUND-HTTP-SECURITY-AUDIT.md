# SSRF & OUTBOUND HTTP SECURITY AUDIT

**Track:** OOPLIX V1 Master Audit — Mission 17
**Date:** 2026-08-22 · **Branch:** `security/reality-completion`

---

## Scope

Every customer-reachable outbound HTTP/network request path in the codebase: `fetch`, `axios`,
`http`/`https` clients, URL-controlled requests, localhost/`127.0.0.1`, private RFC1918 ranges,
link-local/cloud-metadata addresses, IPv6 loopback/private ranges, redirect handling,
DNS/rebinding-sensitive paths, webhook/callback URLs, user-controlled external URLs, internal-service
access, and credential/header forwarding.

## Methodology

Inventoried every outbound network call site across `backend/` and `agents/`: 24 files calling `axios`,
6 calling native `fetch`, 26 requiring `http`/`https` directly (~55 distinct call sites). Each was traced
to its actual caller chain — route → service/agent → sink — and classified as either (a) a fixed,
hardcoded, or operator/env-controlled target (out of scope, no reachability evidence), or (b) a
customer-controlled target reachable from an authenticated HTTP route. For every candidate in class (b),
the full path was live-reproduced end-to-end against the real running server or, where an HTTP auth
session could not be minted directly (Firebase-backed auth), by driving the exact same real code path
in-process (calling the identical exported functions the route handlers call, with a disposable local
"internal service" listener standing in for a target a customer should never reach) — never a forged
token, never simulated results.

**Existing infrastructure found and reused, not rebuilt**: `backend/utils/urlSafety.cjs` already provides
a DNS-resolving SSRF guard (`assertSafeNavigationTarget()`) blocking RFC1918/loopback/link-local
(including the `169.254.169.254` cloud-metadata address)/IPv6 unique-local/loopback ranges and
non-http(s) schemes, resolving hostnames via DNS before deciding (closing naive DNS-rebinding bypasses).
It is already the single shared choke point for the entire ODI browser-automation family (14 files:
`browserController.cjs`, `visionQA.cjs`, `domAnalyzerService.cjs`, `accessibilityAuditor.cjs`, etc.) plus
`agents/browser/actionEngine.cjs`. Per mission rules, both fixes below reuse this exact function rather
than introducing a second validation mechanism.

## Genuine Defects Found and Fixed — 2

### 1. `operationsAlertingLayer.cjs`'s webhook notification channel — SSRF (P1)

`PUT /p22/alerts/channels/webhook` (`requireAuth`-only, no `operatorOnly` gate — `backend/routes/
phase22.js:201`) lets any ordinary authenticated customer call `oal.setNotificationChannel("webhook",
{ url })` with an arbitrary URL. `POST /p22/alerts/fire` (same gate, `phase22.js:158`) immediately calls
`oal.fire(...)`, which dispatches through `_notify()` — a raw `https.request`/`http.request` POST of the
full alert payload (title, detail, internal alert ID, org context) to that stored URL, with **zero**
validation of the target.

**Live-reproduced** in-process (calling `setNotificationChannel`/`fire` directly — the identical functions
the two routes above call) with a disposable local listener on `127.0.0.1:38322` standing in for an
internal-only service: a real HTTP POST carrying the full alert JSON (`alertId`, `title`, `detail`,
`orgId`, etc.) arrived at the internal listener. This is not fire-and-forget-blind: the finding
demonstrates genuine internal-network reachability from a customer-controlled config value with no
scheme/host allowlist, no private-range check, and no `operatorOnly` gate — a customer could point this
at another internal service, a cloud metadata endpoint, or use it to port-scan the internal network by
timing the response.

**Fixed** by validating the webhook URL through `assertSafeNavigationTarget()` (imported from the existing
`backend/utils/urlSafety.cjs`) immediately before dispatch inside `_notify()`, matching the exact
try/catch/log-warning shape the function already used for delivery failures — no new error-handling
pattern introduced. The Telegram channel was checked and confirmed clean: it requires operator-set
`TELEGRAM_TOKEN`/`TELEGRAM_OPERATOR_CHAT_ID` env vars to even enable, and its hostname is always the fixed
`api.telegram.org` — no customer-controlled hostname exists on that path.

### 2. `vsCodeExtensionService.cjs`'s `_ollamaCompletion()` — non-blind SSRF (P1)

`POST /p24/vscode/chat` (and its siblings `explain`/`generate`/`refactor`/`fix`, all `requireAuth`-only,
`backend/routes/phase24.js:58,63`) spread `req.body` directly into `vsc.chat({ …, ollamaUrl })`, and
`ollamaUrl` was passed straight into a real `http.request` with zero validation. Unlike finding 1, this is
**non-blind**: the target's response body flows back through `_extractReply()` into the HTTP response the
customer receives, making internal-service content directly readable, not merely inferable via timing.

**Live-reproduced** by calling `vsc.chat({ provider: "ollama", ollamaUrl: "http://127.0.0.1:38423", … })`
directly (the same function the route calls) against a disposable local listener — confirmed the request
reached the internal target before the fix.

**Fixed** by validating `ollamaUrl` through the same `assertSafeNavigationTarget()` guard, but **only when
the customer actually supplies an override** — the function's safe, intentional default
(`http://localhost:11434`, the operator's own local Ollama instance when no `ollamaUrl` is given) is left
untouched, since validating it would break the one legitimate same-host use case this parameter exists
for. This mirrors the same shape already established for `LM_STUDIO_URL` and other env-derived provider
defaults elsewhere in `aiService.js`, which are correctly never customer-overridable in the first place —
here the difference is `ollamaUrl` genuinely is a per-request customer field, so the guard applies
specifically to the override, not the default.

## Confirmed Reachable, Confirmed Clean (no fix needed)

- **`agents/internet/webScraperAgent.cjs`'s `scrape(url)`** and **`agents/internet/apiFetcherAgent.cjs`'s
  `_request(method, url, …)`** — both fully generic, customer-URL-accepting HTTP clients with **zero**
  SSRF validation (`apiFetcherAgent` additionally lets the caller inject an arbitrary `Authorization`
  header). Traced their full registration chain (`agents/runtime/bootstrapRuntime.cjs` → capability
  `research`/`api_fetch` → `agentSelector.cjs`'s keyword table → `agents/multi/agentExecutor.cjs`) back to
  every HTTP entrypoint that can reach a registered agent. The only customer-facing free-text dispatch
  route, `POST /runtime/dispatch`, feeds raw input through `backend/utils/parser.js`, which **always**
  intercepts any `https?://` substring anywhere in the text as an `open_url` task (`parser.js:154`)
  *before* the input can ever reach `agentSelector`'s keyword-based capability routing — confirmed live by
  driving `orchestrator.dispatch("scrape http://127.0.0.1:38321/…")` through the real dispatch pipeline
  with bootstrapRuntime's real registered agents: it resolved to `open_url`/`browserAgent`, never touched
  `webScraperAgent`, and the internal listener was never hit. No other route names `webScraper` or
  `apiFetcher` by ID, and no route passes a structured `{ payload: { url } }` shape into the executor.
  **These two functions are not reachable with a customer-controlled URL through any HTTP route that
  exists today** — per mission rule 3 (no reachability evidence), not fixed. Flagged here so a future
  route that exposes either by name or wires structured JSON into the dispatch pipeline is reviewed
  against this exact gap before shipping.
- `agents/browserAgent.cjs`'s `open_url` path (the one the parser above actually routes to) spawns the
  server's OS-level `open`/`xdg-open` binary on an arbitrary URL — a different vulnerability class
  (local process execution, not server-side SSRF) that was already found and fixed in a prior mission
  (`agents/primitives.cjs`'s `openURL()`, shell-injection-safe `spawn(shell:false)` since the Remaining
  Execution & Tool Authorization Boundary Sweep). Reconfirmed intact; out of this mission's scope.
- `agents/internet/locationAgent.cjs`'s customer-supplied `ip` — concatenated as a URL *path segment*
  under the fixed `ip-api.com` host, cannot redirect the request off-origin. Not an SSRF vector.
- `agents/internet/weatherAgent.cjs`, `newsAggregatorAgent.cjs`, `socialMediaAgent.cjs` — fixed hardcoded
  hosts only; customer input (if any) flows through `params`, never the URL/hostname.
- `backend/services/ecosystemState.cjs`'s `registerWebhook()` (`POST /eco/v8/developer/webhooks`) —
  stores a customer-supplied URL but is never dispatched to anywhere in the codebase (confirmed via a
  dedicated `.url` usage search: `deliveries` stays `0`, no delivery mechanism exists). A stub, not a
  sink — not fixed, per rule 3.
- `backend/routes/business.js`'s `/business/webhook/*` family — inbound webhook receivers (external
  systems POST to Ooplix), not outbound SSRF sinks.
- `backend/services/dop1InfraValidation.cjs`, `dop2Deployment.cjs`, `deploymentValidator.cjs` — all
  `https.request`/`http.request` hostnames derive from `process.env.APP_URL`/`VPS_HOST` or the fixed
  `127.0.0.1` self-check; `checkSSL()`/`checkDomain()` take no arguments. Operator/deployment-config-only,
  confirmed no customer input reaches any hostname in these files.
- `backend/services/sentryService.cjs`, `gitHubEngineeringAgent.cjs` — hostnames derive from
  `SENTRY_DSN`/`GITHUB_TOKEN`-gated env config only.
- `backend/services/aiService.js` (14 AI-provider integrations), `screenshotAnalyzerService.cjs`,
  `socialPostingService.cjs`, `telegramService.js`, `whatsappService.js`, content-generation agents
  (`voiceCloningAgent.cjs`, `imageGeneratorAgent.cjs`) — all fixed, hardcoded provider URLs
  (`api.anthropic.com`, `api.openai.com`, etc.) or env-derived (`LM_STUDIO_URL`, never customer-overridable
  per-request, unlike finding 2's `ollamaUrl`). No customer-controlled hostname on any of these paths.
- `founderIdentityOS.cjs`'s GitHub/Cloudflare discovery calls — fixed provider API URLs, token from env.
- `integrationConnectors.cjs`'s 57 connector checks (UptimeRobot, etc.) — all fixed provider hostnames,
  API keys from env `_creds()`/`_env()` helpers only.
- `vsCodeExtensionService.cjs`'s `_httpsPost`/`_httpPost` helpers themselves — generic, but every caller
  other than `_ollamaCompletion` passes a fixed provider hostname (OpenRouter, etc.); `_ollamaCompletion`
  was the only customer-URL-accepting caller (finding 2, fixed above).

## Regression

**Baseline**: 476/476 (`npm run test:runtime`, blocks through 175 — Mission 16's baseline). **After**:
**481/481** — the same suite plus this mission's new block 176 (5 assertions: 2 live SSRF closures + 2
negative controls confirming legitimate public-URL/default-localhost paths remain unaffected + 1
structural sanity check), all passing. Ran the full 219-file suite once; it hung mid-run because the
backend process (started before this session) had exited between an earlier live-reproduction step and
the regression pass — every backend-dependent test across `tests/smoke`, `tests/stress`, and
`tests/workflows` failed identically with `'Promise resolution is still pending but the event loop has
already resolved'`, the signature of an unreachable server, not a code regression. Restarted the server,
confirmed healthy (`GET /health` → `200`), then re-ran the officially documented `npm run test:runtime`
baseline plus the two security suites below — both clean.

**Negative-tested both fixes independently**: reverted `operationsAlertingLayer.cjs`'s guard alone —
`tests/security/102-…` failed with the exact expected assertion (`internal listener must never be
reached`, showing the real alert payload that reached it) — restored, re-confirmed pass. Reverted
`vsCodeExtensionService.cjs`'s guard alone (a temporary patch, not committed) — the test failed with
`customer-supplied loopback ollamaUrl must be rejected, not silently succeed` — restored, re-confirmed
pass. Confirmed via `git diff` that the working tree exactly matches pre-negative-test state after each
revert/restore cycle.

## New Tests

5 (block 176 — `tests/security/102-ssrf-outbound-http-security.cjs`): 2 live SSRF-closure checks (one per
fix, each using a disposable local listener standing in for an internal service), 1 structural sanity
check (default Ollama target unchanged), 2 negative controls (a legitimate public webhook URL still
passes validation; the safe localhost default is verified unaffected by code inspection since a real
local Ollama instance already occupies the test machine's port 11434).

## Security

`tests/security/97-enterprise-isolation-integrity.cjs`: **8/8 PASS**.

## Current Baseline

481/481 effective, `tests/security/97-…`: 8/8 PASS, `tests/security/102-…` (new): 5/5 PASS, server
healthy on :5050, `.env` untouched, no merge, no push.

## Server Status

Restarted once (the process from before this session had exited independently of this mission's own
work — confirmed via the "event loop already resolved" failure signature, not a crash caused by either
fix). Confirmed healthy (`GET /health` → `200`) after restart, and after all subsequent live-reproduction
and negative-test cycles.

## .env Status

Untouched throughout. No credentials rotated, no packages installed.

## Merge/Push Status

No merge. No push. Unrelated uncommitted work in the working tree (`frontend/src/components/
AgentFactoryCenter.jsx`) preserved throughout, not touched by this mission.

**No OS-track record altered.**
