# OS-CREATIVE — WORKFLOW EVIDENCE

**Date:** 2026-08-15 · **Server:** `localhost:5177` · **Auth:** real `POST /auth/login` sessions
only — no JWT forged, no auth bypassed.

**Accounts used (all real, registered via `POST /accounts/register`):**

| Account | Purpose |
|---|---|
| `creativea@test.local` | Primary workflow account ("A") |
| `creativeb@test.local` | Cross-account attacker ("B") — genuinely unrelated to A |
| `creativec@test.local` | Fresh account for credential-independent capability tests ("C") — used once A's trial credits were exhausted by real usage |

---

## Chain verified

```
Frontend (CreativeStudio.jsx, 7 tabs)
  → Express route (/creative/*, requireAuth + 30req/60s rate limit)
  → creativeRouter.cjs (intent → capability → provider → credit reservation)
  → creativeAssetLibrary.cjs / brandStudio.cjs / creativeJobQueue.cjs
    (data/creative-assets.ndjson+index, data/brand-kits.json, data/creative-jobs.json)
  → real generator agents (imageGeneratorAgent/videoGeneratorAgent/voiceCloningAgent/
    imageProcessorAgent) OR honest text-only fallback
  → JSON response
```

---

## W1 — Real asset creation, mutation, and read-back

```json
POST /creative/assets
{"type":"image","prompt":"CreativeOS Postfix Asset A","folder":"probe"}
→ {"ok":true,"asset":{"id":"ast-...7phx","accountId":"ee52...","folder":"probe",...}}

GET /creative/assets/ast-...7phx  (A)
→ 200, full record, correct owner
```

Ground-truth verification: `data/creative-asset-index.json`'s `idx.assets[id]` byte-matches the
API response for `folder`/`favorite`/`tags` after each mutation (tag, favorite, move — see §W4).

---

## W2 — Real, byte-producing image processing (the closest analog to "export")

```json
POST /creative/image/upscale
{"imageUrl":"https://httpbin.org/image/png","scale":2}
→ {"ok":true,"generated":true,"url":"/creative/image/file/upscale_....png",
   "output":{"via":"sharp","originalWidth":100,"originalHeight":100,
             "outputWidth":200,"scale":2,"format":"png","sizeBytes":31441}}
```

### Independently verified — not trusting the API's own "generated:true" claim

```
$ ls -la data/processed-images/upscale_....png
-rw-r--r--  31441 bytes

$ curl -o downloaded.png .../creative/image/file/upscale_....png
200, size=31441 (exact match)

$ file downloaded.png
PNG image data, 200 x 200, 8-bit/color RGB, non-interlaced
```

**Real file, correct format, correct new dimensions (2x scale), usable content — not a fabricated
success.** A source fetch failure (tested separately with a malformed source) correctly returned
`generated:false` with the real underlying HTTP error, never a fake success.

---

## W3 — Honest credential-blocked generation (no fabricated output)

```json
POST /creative/image/logo
{"prompt":"CreativeOS persistence probe logo"}
→ {"ok":true,"generated":false,"url":null,
   "output":{"generationError":"Request failed with status code 401", ...}}
```
The real DALL-E 3 call genuinely executed and genuinely failed (no OpenAI credential configured in
this environment) — the response never claims an image was produced. Consistent with the honest
credential-blocked pattern documented in every prior OS pass this session.

```json
POST /creative/social/generate {"platform":"instagram","brief":"..."}
→ 502 {"error":"AI backend unavailable. Check provider API keys in your .env file."}
```
Same honest pattern for the social caption generator.

---

## W4 — Real mutation chain (tag → favorite → move → verify)

```
POST /creative/assets/:id/tag    {"tag":"persistence-probe"}  → tags: ["persistence-probe"]
POST /creative/assets/:id/favorite                            → favorite: true
POST /creative/assets/:id/move   {"folder":"probe-persist"}   → folder: "probe-persist"
```
Ground truth (`data/creative-asset-index.json`, direct read): `folder: "probe-persist"`,
`favorite: true`, `tags: ["persistence-probe"]` — exact match to the API's own responses.

---

## THE SECURITY FINDING — no ownership check on any id-addressed record

### Reproduction (pre-fix, real accounts, real HTTP)

```
A creates asset ast-...uy3y (private, no sharing feature exists)
B (genuinely unrelated account) —
  GET    /creative/assets/ast-...uy3y     → 200  (full record disclosed)
  DELETE /creative/assets/ast-...uy3y     → 200  {"ok":true}

A —
  GET    /creative/assets/ast-...uy3y     → 404  "not_found"   (permanently gone)
```

```
A creates brand kit bk-...eir ("CreativeOS Probe Brand A")
B —
  PUT /creative/brand/bk-...eir  {"name":"HIJACKED BY B"}   → 200, persisted

A —
  GET /creative/brand/bk-...eir                              → name: "HIJACKED BY B"
```

```
A creates job job-...8ac (real prompt content)
B —
  GET /creative/workspace/jobs/job-...8ac   → 200  (prompt content disclosed)
```

**Root cause:** `creativeAssetLibrary.cjs`, `brandStudio.cjs`, `creativeJobQueue.cjs` all key their
getters/mutators purely by the record's own generated id — none of their function signatures accept
an `accountId` to check against. `creativeStudio.js` performed no ownership check of its own before
calling them.

### Fix

Added `_ownedOrDenied(res, record, accountId)` to `creativeStudio.js` — the only place with an
`accountId` to check against. Applied at every id-addressed asset, brand-kit, and job route (read,
write, delete): returns 404 both when the record doesn't exist and when it belongs to someone else,
so a non-owner can never distinguish "doesn't exist" from "exists but isn't yours."

### Live re-verification (post-fix, real accounts, real HTTP)

```
B — GET /creative/assets/ast-...7phx        → 404
B — DELETE /creative/assets/ast-...7phx     → 404
A — GET /creative/assets/ast-...7phx        → 200  (unaffected)

B — PUT /creative/brand/bk-...5h8 {"name":"HIJACK2"}  → 404
A — GET /creative/brand/bk-...5h8                      → name unchanged

B — GET /creative/workspace/jobs/job-...t1t  → 404
A — GET /creative/workspace/jobs/job-...t1t  → 200  (unaffected)
```

Full battery (5 asset vectors, 7 brand-kit vectors, 1 job vector) — all 13 blocked post-fix, 0
regressions to legitimate same-owner access. Detail in Security report.

---

## A related finding — generated-file serving had the same gap

```
C generates upscale_....png (real, verified in §W2)
A (different account) — GET /creative/image/file/upscale_....png  → 200 (pre-fix)
```
Filenames are only a millisecond timestamp, not cryptographically random — `requireAuth` alone let
any authenticated account fetch another account's generated file. Fixed by adding `url` to the
asset index and gating on the matching asset's `accountId`, failing open (not denying) only when no
asset record can be matched at all — verified this correctly preserves access to files that predate
this pass's index-schema addition.

```
Post-fix: A — GET /creative/image/file/upscale_....png (C's file)  → 404
          C — GET (own file)                                        → 200
          A — GET a legacy file with no indexed url                 → 200 (correctly fails open)
```

---

## Persistence — verified across a real restart

```
Before restart: asset ast-...xvyv — folder:"probe-persist", favorite:true, tags:["persistence-probe"]
[server killed via exact-PID lsof verification, restarted clean]
After restart:  identical — folder:"probe-persist", favorite:true, tags:["persistence-probe"]
                brand kit bk-...eir — name intact
                job job-...ptm — status:"complete", prompt intact
```

---

## Cleanup — every test artifact removed before stopping

```
Deleted via real DELETE calls: 5 assets, 2 brand kits (creativea/creativeb),
  3 assets (creativec — including the real generated PNG file, removed from disk)
Verified: 0 remaining test assets/kits for any of the 3 test accounts
Job records: 4 remain (no delete endpoint exists anywhere in the API — same honest
  limitation already documented for the Automation OS job queue in the prior pass;
  left as evidence, not orphaned test infrastructure)
```

---

## Build

```
CI=false npm run build:frontend → succeeds
0 poisoned test-port URLs found in the built bundle (grepped for :5177/:5166/:5155/:5144/:5133)
```
No frontend file changed this pass.

---

## Regression

| Suite | Result |
|---|---|
| `npm run test:runtime` | **144/144** (baseline and final — identical) |
| `tests/security/100-creative-studio-cross-account-idor.cjs` (new, this pass) | **28/28** |
| `tests/security/11-credit-reservation-race.cjs` | **7/7** |
| `tests/security/66-social-content-generate-fake-success-empty-caption.cjs` | **3/3** |
| `tests/security/84-marketing-growth-creative-ux-consistency-...-asset-stats-scoping.cjs` | Creative-specific assertions: **12/12**; 3 unrelated pre-existing GrowthOS.css failures confirmed out of scope (not touched this pass) |

No test was modified, skipped, or weakened. New negative test (#100) confirmed to genuinely fail
(15/24 failures) against the pre-fix code via a `git stash` reproduction, then confirmed passing
(28/28, after adding file-serving coverage) against the fixed code.
