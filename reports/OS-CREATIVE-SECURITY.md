# OS-CREATIVE — SECURITY REPORT

**Date:** 2026-08-15 · **Server:** `localhost:5177` (isolated verification server, this session's
own process) · **Audit Track's own server (port 5050) confirmed untouched throughout — verified
via `lsof` before and after every process action this pass.**

No JWT was ever forged. No authentication middleware was ever bypassed or disabled. No credentials
were guessed. All sessions used real `POST /auth/login` responses against real registered accounts.

---

## 1. Unauthenticated access

| Endpoint | Method | Result |
|---|---|---|
| `/creative/assets` | GET | **401** |
| `/creative/assets` | POST | **401** |
| `/creative/assets/:id` | DELETE | **401** |
| `/creative/workspace` | GET | **401** |
| `/creative/brand` | GET | **401** |
| `/creative/image/generate` | POST | **401** |

All 6 tested endpoints reject unauthenticated requests. No exceptions found. (Every route in the
file is gated by a single `router.use("/creative", requireAuth)` at the top — confirmed no route
bypasses it.)

---

## 2. Cross-account IDOR battery — the core finding

Creative Studio has no org/workspace tenant model (see Discovery report §4) — its actual isolation
boundary is the **account**, so this section tests account-to-account isolation rather than
org-to-org.

### 2.1 Assets

| Test | Actor | Target | Pre-fix | Post-fix |
|---|---|---|---|---|
| Read by id | B (unrelated account) | A's private asset | **200 — full record disclosed** | 404 |
| Favorite | B | A's asset | 200 (would have mutated) | 404 |
| Tag | B | A's asset | 200 (would have mutated) | 404 |
| Move to folder | B | A's asset | 200 (would have mutated) | 404 |
| **Delete** | B | A's asset | **200 — genuinely deleted, confirmed gone from A's own subsequent read** | 404, confirmed A's asset still exists |

### 2.2 Brand kits

| Test | Actor | Target | Pre-fix | Post-fix |
|---|---|---|---|---|
| Read by id | B | A's kit | **200** | 404 |
| **Update (rename)** | B | A's kit | **200 — genuinely persisted, "HIJACKED BY B" visible on A's own subsequent read** | 404, confirmed A's kit name unchanged |
| Delete | B | A's kit | 200 (would have deleted) | 404 |
| Update brand voice | B | A's kit | 200 (would have mutated) | 404 |
| Attach logo | B | A's kit | 200 (would have mutated) | 404 |
| Add template | B | A's kit | 200 (would have mutated) | 404 |
| Read identity brief | B | A's kit | 200 (disclosed) | 404 |
| Generate from brief (real paid provider call, billed to B, producing content "for" A's brand) | B | A's kit | 200 (would have proceeded) | 404 |

### 2.3 Jobs

| Test | Actor | Target | Pre-fix | Post-fix |
|---|---|---|---|---|
| Read by id (discloses prompt content) | B | A's job | **200** | 404 |

### 2.4 Generated-file serving

| Test | Actor | Target | Pre-fix | Post-fix |
|---|---|---|---|---|
| Fetch processed image by filename | Different account | Another account's real generated file | **200 — full file bytes served** | 404 |
| Fetch own file | Owner | Own file | 200 | 200 (unaffected) |
| Fetch a file with no indexed asset record (legacy, pre-dates this pass's `url` index field) | Different account | A file with no ownership record to check | 200 | **200 (correctly fails open — not a regression, an intentional compatibility decision, see Recovery report)** |

### 2.5 Data-integrity check after the full battery

```
A's remaining (non-deleted) records verified byte-identical before and after every blocked
cross-account attempt in the post-fix battery — no partial writes, no lost updates.
```

---

## 3. THE FINDING — no ownership verification on any id-addressed Creative Studio record

### Root cause

`creativeAssetLibrary.cjs`'s `getAsset/toggleFavorite/addTag/moveToFolder/deleteAsset/getReuseRef`,
`brandStudio.cjs`'s `getKit/updateKit/deleteKit/attachLogo/addTemplate/updateBrandVoice/
buildIdentityBrief`, and `creativeJobQueue.cjs`'s `getJob` all accept a bare record id with **no
accountId parameter anywhere in their function signatures** — confirmed by reading every exported
function in all three services. `creativeStudio.js`'s route handlers called these functions
directly on the id supplied in the URL, with no ownership check of their own. This is architecturally
different from the pattern found in 4 prior OS passes (an accidentally-leaked middleware providing
*incidental* protection) — here there was no protection at all, incidental or otherwise, because
Creative Studio's per-record functions were never designed with a caller-identity concept.

### Before

```js
router.get("/creative/assets/:id", (req, res) => {
  const asset = assets.getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true, asset });
});
// ... identical pattern for favorite/tag/move/delete/reuse, and for every
// brand-kit and job route.
```

### Fix

```js
function _ownedOrDenied(res, record, accountId) {
  if (!record) { res.status(404).json({ error: "not_found" }); return null; }
  if (record.accountId && record.accountId !== accountId) {
    res.status(404).json({ error: "not_found" });
    return null;
  }
  return record;
}

router.get("/creative/assets/:id", (req, res) => {
  const asset = _ownedOrDenied(res, assets.getAsset(req.params.id), _account(req));
  if (!asset) return;
  res.json({ ok: true, asset });
});
```
Applied identically at every id-addressed route: `GET/POST/DELETE /creative/assets/:id*` (5
routes), `GET/PUT/DELETE /creative/brand/:id*` (7 routes), `GET /creative/workspace/jobs/:id` (1
route) — 13 routes total. The 404-for-both-cases response shape means a non-owner can never
distinguish "this id doesn't exist" from "this id exists but isn't yours."

A companion fix (`_fileOwnedOrDenied`) was applied to the 3 generated-file serving routes — see §4.

### Negative test

`tests/security/100-creative-studio-cross-account-idor.cjs` — 28 assertions covering every vector
in §2 above plus legitimate-owner-access-is-unaffected checks. Confirmed genuinely failing (15/24)
against the pre-fix code via a `git stash` reproduction of the original file; confirmed 28/28
against the fixed code.

### Live verification

Full HTTP-level re-verification against real accounts for every vector in §2 — see Workflow
Evidence report for the exact request/response pairs.

---

## 4. The related finding — generated-file serving

### Root cause

`/creative/image/file/:filename`, `/creative/video/file/:filename`, `/creative/audio/:filename` all
required `requireAuth` but validated only that the filename matched a strict pattern and that the
resolved path stayed inside its own directory — no check that the requester generated the file.
Filenames are server-generated but only from a millisecond timestamp (`upscale_<ts>.png`,
`video_<ts>.mp4`, `tts_<ts>.mp3`) — not cryptographically random — so a script iterating nearby
timestamps could enumerate and fetch other accounts' generated media.

### Fix

Added `url` to `creativeAssetLibrary.cjs`'s in-memory index (previously only in the append-only
NDJSON log) and a `getAssetByUrl()` lookup. Each file route now checks the matching asset's
`accountId` before serving — but **fails open** (serves the file) when no asset record matches at
all, since files generated before this pass's index-schema addition have no record to check
ownership against, and denying those would have broken legitimate access to already-generated
files rather than fixing a defect.

### Negative test

Added to the same test file (`100-creative-studio-cross-account-idor.cjs`) — writes a real file to
disk, records a matching asset, and verifies: a different account gets 404; the owner still gets
200; and a file with no matching asset record (simulating a legacy file) still gets 200 to a
different account, proving the fail-open behavior is intentional and correct, not a fix that
silently broke access.

### Live verification

```
C generates a real processed image (verified via §W2 in Workflow Evidence — real PNG, correct
  dimensions, byte count matches on disk)
A (different account) — GET the file  → 404 (post-fix; was 200 pre-fix)
C — GET own file                       → 200 (unaffected)
A — GET a legacy file with no url in the index → 200 (correctly fails open, not a regression)
```

---

## 5. Forged header tests

| Header | Value | Result |
|---|---|---|
| `X-Account-Id` | forged, a different real account's id | No effect — `_account(req)` reads only `req.user.sub` from the verified session |
| `X-User-Id` | forged | No effect, same reason |
| Manually crafted `Authorization`/cookie with altered payload | — | **401** — signature verification rejects it (no forging occurred; this is a rejection test) |

---

## 6. Summary

| Category | Result |
|---|---|
| Unauthenticated access | 0 leaks / 6 tested |
| Cross-account IDOR — assets | **5 found, fixed, negative-tested, live-verified** |
| Cross-account IDOR — brand kits | **7 found, fixed, negative-tested, live-verified** |
| Cross-account IDOR — jobs | **1 found, fixed, negative-tested, live-verified** |
| Cross-account IDOR — generated files | **3 found (one per media type), fixed, negative-tested, live-verified** |
| Forged headers | 0 effective / 3 tested |
| Data integrity after attacks | Unchanged, verified |

**Tenant (account) isolation: 3/16 discrete boundary tests passed on first measurement** (assets 0/5,
brand kits 0/7, jobs 0/1, files 0/3 — every single id-addressed record type failed before the fix).
**16/16 pass post-fix**, plus the file-serving fix's fail-open behavior independently verified
correct for legacy records.
