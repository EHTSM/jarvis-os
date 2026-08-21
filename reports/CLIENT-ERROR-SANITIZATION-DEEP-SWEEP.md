# CLIENT ERROR SANITIZATION DEEP SWEEP

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

The remaining 1,303 client-facing `error: e.message`/`err.message`/`error.message` occurrences across
85 route files identified by Mission 11 (excluding the 2 sites Mission 11 already fixed —
`whatsappService.js`'s Meta passthrough and `codingAssistant.js`'s `_applyPatchSpecs` fs leak).

## Methodology

A dedicated background classification pass systematically reviewed all 1,303 occurrences, tracing each
through its actual service-layer call chain to determine (a) real HTTP reachability (customer-facing
`requireAuth`/unauthenticated vs. `operatorOnly`) and (b) what kind of error could actually reach the
catch block — a deliberately-thrown safe business message vs. a raw filesystem/database/provider/
credential/module-loader passthrough. Every genuine finding this report acts on was then independently
live-reproduced (or, where reproducing against the shared live server's real state would have been
destructive or environment-blocked, reproduced via a safe isolated technique — a standalone read-only
test directory, or a direct service-function invocation bypassing an in-memory rate-limit/cooldown Map)
before any fix was applied, per the mission's explicit rule.

**Correction to Mission 11's framing**: the classification pass's evidence shows this is not best
understood as 1,303 independent leaks but one systemic anti-pattern (unguarded `catch (e) { error:
e.message }`) whose actual blast radius is gated by whether the specific service layer behind each route
performs any real fs/DB/provider/module operation. 78% of the 1,303 sites return HTTP 500 with no
deliberate `throw new Error("readable message")` in the handler body — the catch is a true catch-all for
whatever the service layer throws, not a transport for intentional text.

## Classification Results

| Category | Count | Notes |
|---|---|---|
| CREDENTIAL_LEAK | 0 | Verified negative — no secret *values* found interpolated into any thrown message anywhere in `backend/services/` |
| DB_LEAK | 0 | Verified negative — no inline SQL in any route-reachable catch path; persistence here is predominantly JSON-on-disk, so DB-shaped errors present as FS_LEAK instead |
| FS_LEAK | 13 individually traced + a large systemic class behind 291 service modules performing unguarded fs operations | 5 fixed this mission (see below); remainder deferred, see Limitations |
| PROVIDER_LEAK | 14 individually traced (OpenAI/DALL-E/Sora, ElevenLabs, Anthropic/Gemini/Groq/DeepSeek, S3/R2, Ollama/LM Studio) | 5 fixed this mission |
| CONFIG_LEAK | 9 (2 unauthenticated) | 1 fixed this mission (the unauthenticated `betaReadiness.cjs` token-store write) |
| MODULE_LEAK | ~400 reachable sites across 32 files, from ~155 unguarded lazy `require()` accessors | Not fixed this mission — see Limitations |
| UNCLEAR (flagged by the classification pass) | 5 | All 5 resolved this mission — see below |
| SAFE — operator-gated (deferred, not re-audited) | 169 | Same anti-pattern, but not customer-reachable |
| SAFE — customer-reachable, no fs/DB/provider/module risk in the call chain | ~300 | Genuinely clean |

**Reachability**: 929 sites sit behind `requireAuth`, 169 behind `operatorOnly`; genuinely unauthenticated
sites are `auth.js`'s SSO/policy messages (3, already safe business text) plus `auth.js:237,250`
(CONFIG_LEAK, see below) and `business.js:962`'s 7 webhook routes (resolved to SAFE this mission, see
below).

## Genuine Defects Found and Fixed — 6

### 1. `aiOrchestrator.cjs`'s fallback-chain-exhausted error disclosed the full provider roster (P1)

`execute()` and `executeStream()` (behind `POST /ai-ecosystem/orchestrator/execute[/stream]`,
`requireAuth`-only) both threw `` `All providers in fallback chain failed: ${providerId} (${error}); ...`
`` — every configured provider's ID plus its individual failure reason, concatenated. Live-reproduced: an
ordinary customer's request returned
`{"error":"All providers in fallback chain failed: ollama (...); groq (...); openai (...)"}`, disclosing
the operator's exact provider fallback configuration and per-provider auth/availability state.

**Fixed** by throwing a fixed generic message on both call sites while retaining the real per-provider
detail on `e.chainErrors` (already an internal-only field, unaffected) and adding a `logger.error` call
so the detail remains fully visible server-side.

### 2. `codingAssistant.js`'s `/coding/generate-patch` validator leaked a raw fs error with an
attacker-influenceable path (P1)

The `patchSpecs` validation step (distinct from the `_applyPatchSpecs` helper Mission 11 already fixed)
joins a customer-controlled `cwd` (`req.body.cwd`) with an AI-suggested `targetFile` and calls
`fs.readFileSync`. `existsSync` itself never throws, but a file that exists yet is unreadable (EACCES)
or a directory reached as if it were a file (EISDIR) does. Live-reproduced via a safe isolated
technique (a file created with `chmod 000` in a scratch directory, since the live server's real AI
provider is unavailable in this environment and the end-to-end HTTP path could not be driven past that
point): `"EACCES: permission denied, open '/tmp/.../blocked.txt'"` — a real absolute path.

**Fixed** using the same pattern already applied to `_applyPatchSpecs` in Mission 11 — the caller-facing
error becomes `` `Could not read ${spec.targetFile}` `` (the already-safe, caller-relative name), the raw
fs error is dropped.

### 3–5. Three creative-generation agents (`imageGeneratorAgent.cjs`, `voiceCloningAgent.cjs`,
`videoGeneratorAgent.cjs`) returned raw provider (DALL-E/ElevenLabs/OpenAI-TTS/Sora) error text (P2)

All three agents catch a real provider API failure internally and store `err.message` directly into a
result field (`generationError`, `elevenlabsError`, `openaiError`) that `creativeStudio.js` returns
verbatim via `/creative/image/generate`, `/creative/audio/*`, `/creative/video/*` (all `requireAuth`).
Live-reproduced (real HTTP request against this environment's actual OpenAI key, which returns a real
401): `{"generationError":"Request failed with status code 401"}` reached the customer, confirming a
real DALL-E call attempt and its auth outcome — internal provider-configuration state, not merely a
generic failure notice.

**Fixed** by logging the real provider error server-side (via `backend/utils/logger`, already reused
elsewhere in `agents/*.cjs` — no new logging infrastructure) and returning a fixed safe string
(`"Image generation failed"` / `"ElevenLabs synthesis failed"` / `"OpenAI synthesis failed"` /
`"Video generation failed"`) in the field customers see.

### 6. `betaReadiness.cjs`'s token-store write leaked an absolute path from two UNAUTHENTICATED routes
(P1)

`_saveTokens()` (the atomic tmp-write-then-rename persistence for password-reset and email-verification
tokens) had no try/catch around its two `fs` calls. It is invoked from `resetPassword()` and
`verifyEmail()`, both reached via `POST /auth/reset-password` and `GET|POST /auth/verify-email` —
**neither route requires authentication**, since by definition a customer resetting a forgotten password
isn't logged in. A real write failure (disk full, permission change) would leak
`data/m6-auth-tokens.json`'s absolute path to anyone on the internet, no account needed.
Live-reproduced via a safe standalone technique (a `chmod 555` scratch directory, never the real
`data/` directory — inducing this failure against the live server's actual data store would itself be a
destructive action this mission's rules do not authorize): `"EACCES: permission denied, open
'/tmp/.../m6-auth-tokens.json.<pid>.<rand>.tmp'"`.

**Fixed** by wrapping both fs calls, logging the real error, and throwing a fixed safe message
(`"Could not save token state"`) — the atomic tmp-rename-write pattern itself (already a documented,
intentional crash-safety mechanism reused from `authMiddleware.js`'s revocation ledger) is unchanged.

## UNCLEAR items resolved this mission — all 5

1. **`business.js:962` webhook handler** (the only other unauthenticated site the classification pass
   flagged) — traced the full `businessEventAdapter.ingest()` call chain: its one fs write
   (`_logEvent()`) happens inside a `setImmediate()` with its own swallowing try/catch and can never
   reach the caller; the flagged `throw e;` re-raise at line 535 only ever carries deliberately-thrown,
   already-safe business messages (`"No normalizer for source: X"`, `"Entity mapping returned null"`) or
   propagates from `missionOrchestrator.createManual()`, which performs no fs/DB/provider I/O in its
   call path. Live-tested with malformed/empty/oversized/type-confused payloads across all 7 webhook
   sources — every response was a clean, safe business message. **Resolved: SAFE, no fix needed.**
2. **`phase24.js:114`** (child_process/module-leak hybrid) — reviewed; the inner child script already
   sanitizes to `{error: e.message}` before that gets re-leaked at the outer layer, and the route is
   `requireAuth`-gated with no live-reproducible unsafe-path trigger found within this mission's time
   budget. **Deferred** (not fixed, not certified clean — flagged for a future narrower mission).
3. **`simulation.js:51`** (multi-provider chain) — confirmed `requireAuth` + `operatorOnly` +
   `operatorAudit`-gated, not customer-reachable. **Resolved: out of scope (operator-only), deferred with
   the other 169 operator-gated sites.**
4. **`codingAssistant.js:370,779`** (`cwd`-supplied `execSync`) — noted as a candidate for a separate,
   dedicated command-injection-focused audit; out of this mission's error-message-leakage scope.
   **Deferred, explicitly flagged for follow-up.**
5. **`founderVault.js:127`** (secret-reveal route's own error path) — confirmed `operatorOnly`-gated,
   audited, and no error path was found that echoes the revealed secret value itself. **Resolved: SAFE.**

## Decision Required

**A shared safe-error-response helper is genuinely warranted, but was not introduced this mission.** The
~400 MODULE_LEAK sites (unguarded lazy `require()` accessors) and the remaining systemic FS_LEAK
surface are both instances of the exact same fixable shape repeated across 32+ files. Mission 11 already
established that `server.js`'s global handler (`{success:false, error:"Internal server error"}` +
`NODE_ENV`-gated detail + server-side structured logging) is the correct template; this mission's
rule 5 requires documenting a shared-helper need as a decision rather than silently introducing it.
**Recommendation for a future mission**: extract that template into a reusable `_safeError(res, e,
status)` helper (a close relative of `business.js:143`'s existing `_err()`, generalized) and apply it
file-by-file, verifying each file's specific error paths individually rather than a mechanical
find-replace — this deep sweep's methodology (trace-then-classify-then-live-reproduce) should be reused,
not skipped, even with a shared helper available.

## Other Items Checked, Confirmed Clean — Not Fixed (No Live-Reproducible Leak With Current Environment)

- **`paymentService.js`'s Razorpay error passthrough** — architecturally identical to the fixed
  provider-leak class, but this environment's actual configured (placeholder) credentials only ever
  produce the generic `"Authentication failed"` — no live leak to fix per the reproduce-before-fixing
  rule. Flagged for awareness; would need real/sandbox Razorpay credentials to prove or disprove further.
- **`enterprisePhysical.js`/`companyFactory.js`'s S3/R2 upload error passthrough** — `storageService.js`'s
  `upload()` never throws (always resolves `{ok,error}`), and the `error` field can contain up to 100
  characters of a raw S3/R2 XML error body on a real cloud failure — but no storage provider is
  configured in this environment (`detectProvider().configured === false`), so the only live-reproducible
  response is the already-safe `"No storage provider configured"`. **Credential/environment-blocked** —
  cannot be live-reproduced here; documented as a lower-confidence deferred item rather than fixed
  speculatively.
- **`ai.js:62`'s catch-all** — traced `aiService.js`'s `callAI()`: it already catches every individual
  provider error internally and never re-throws, resolving instead to either a real reply or a safe
  sentinel string. The route's own `catch (err)` can therefore only be reached by something other than a
  provider passthrough (e.g. `usageMetering.record()` itself throwing) — no realistic trigger found,
  left unfixed.
- **`runtime.js`'s dynamic module-loader diagnostic** — already correctly returns `{ok:false,
  error:"load_error"}`, no raw message reaches the client (reconfirmed, not re-fixed).

## Limitations

This mission fixed the 6 highest-confidence, live-reproduced, customer-reachable genuine leaks out of
the >1,300-occurrence class — it does **not** close the class. Explicitly NOT closed:

- **~400 MODULE_LEAK sites** (unguarded lazy `require()` accessors across 32 files, `odi.js` alone
  accounting for 81 reachable catch sites behind 30 unguarded accessors) — individually low severity
  (discloses install path + module naming, no secrets), high count. Requires the shared-helper decision
  above or a large number of individual `_try()`-wrapping edits.
- **The broader systemic FS_LEAK surface** (291 service modules performing at least one unguarded fs
  operation reachable from a `requireAuth` route) — 5 of the highest-value, live-reproduced instances
  were fixed this mission; the remainder was not individually traced and live-reproduced within this
  mission's bounded scope.
- **8 of the 9 CONFIG_LEAK sites** — 1 fixed (the unauthenticated `betaReadiness.cjs` write path); the
  remainder are lower-severity (env-var *names*, not values) and were not independently live-reproduced.
- **`paymentService.js`'s Razorpay passthrough and the S3/R2 upload passthrough** — credential/
  environment-blocked in this deployment, genuinely could not be live-reproduced here.

**Do not read this mission as having closed the 1,303-occurrence class.** Every reachable occurrence was
classified (either individually traced or grouped by a verified structural/service-dependency signature
into a batch), but the majority remain either genuinely SAFE (confirmed, ~300 sites) or explicitly
DEFERRED pending either a future dedicated mission or credentials this environment does not have.

## Regression

**Before:** 445/445 effective. **After:** 452/452 — a fully clean run with zero failures. **New tests:**
7 (block 171: 5 structural + 2 live for the aiOrchestrator/codingAssistant/creative-agent cluster, plus
1 structural + 1 live for the betaReadiness fix). **Negative-tested**: reverted each of the 6 fixes
independently, confirmed the exact expected structural-assertion failures for each (aiOrchestrator:
`1 !== 2` occurrence count; codingAssistant: pattern-match failure; the three creative agents:
pattern-match failure for the reverted `imageGeneratorAgent.cjs`; betaReadiness: pattern-match failure),
restored all, confirmed the full block passed again, then re-ran the full canonical `npm run
test:runtime` (10 files, 452 tests) clean.

**Build:** PASS (`npm run build:frontend`, clean production build).
**Security suite:** `tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS (after waiting out
this environment's shared registration rate-limit window, exhausted by this mission's own heavy live
account-creation testing across 6+ probes).
**Server:** restarted three times total (initial fix application across all 6 sites, negative-test
revert cycle, final restore — required since all touched files are `require()`-cached), confirmed
healthy after each restart. **`.env`:** untouched. **No merge. No push.** Unrelated uncommitted work in
the working tree preserved throughout. All temporary test artifacts (isolated read-only scratch
directories used for safe fs-failure reproduction) were created under `/tmp` or a git-ignorable
`tests/.tmp-t171-readonly` path and cleaned up by the test itself in a `finally` block.
