# C.3 — PERFORMANCE RECOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`

What changed, why it was the minimal correct change, and how correctness was proven preserved.
**Every fix: MEASURE → ROOT CAUSE → MINIMAL FIX → VERIFY OUTPUT IDENTICAL → RE-MEASURE → REGRESSION → NEGATIVE TEST.**

---

## Fix policy applied

The mission's preferred order was followed exactly:

| Priority | Rule | Applied |
|---|---|---|
| 1 | remove accidental duplicate work | **C3-01** — identical rescan on every poll |
| 2 | correct algorithmic inefficiency | already done in a prior phase; verified not regressed |
| 3 | reduce unnecessary I/O | **C3-01** — 2,900 files / 29.7 MB per call |
| 4 | reduce unnecessary requests | polling was intentional; left alone |
| 5 | optimize existing persistence | measured; already cached; **no change** |
| 6 | optimize existing rendering | no measured defect |
| 7 | **optimize serialization/payloads** | **C3-02** — 1.2 MB shipped uncompressed |
| 8 | cache only where correctness is preserved | both fixes; correctness asserted and negative-tested |

**No new runtime, cache layer, scheduler, queue, database, API layer, orchestration engine or frontend state system was introduced.** Both fixes extend code that already existed.

---

## Files changed — 2 source files, 1 test added

```
M backend/services/engineeringSmellDetector.cjs   C3-01 mtime-keyed repeat-scan cache
M backend/middleware/compress.js                  C3-02 static asset gzip (built-in zlib)
+ tests/security/101-c3-performance-guards.cjs    11 assertions, negative-tested
```

**No existing test modified.** `.env` untouched. No auth, authorization, tenant-isolation or persistence contract touched.

---

## 1 · C3-01 — reuse the scan, never go stale

The cache is keyed on a cheap validity stamp — newest mtime + file count across the scanned tree, mirroring `_walkFiles`' filtering exactly so the stamp covers precisely the files the scan reads.

```
validity stamp : 5–12 ms   (1,814 files)
full rescan    : 1,369–2,339 ms
```

Three correctness boundaries were drawn deliberately, and each is asserted by the regression suite:

- **`dismissed` stays outside the cache.** It is loaded on every call. Caching the *final* result would have made dismissing a smell appear to do nothing — a correctness bug traded for speed.
- **Runtime detectors stay outside the cache.** `_detectStaleMissions`, `_detectBuildFailures` and `_detectBenchmarkDecline` read live state, not files, so they re-run every call.
- **The per-scan `_fileCache` memo is still released.** That is a deliberate memory-leak fix from an earlier phase; the `finally` block was kept as a belt-and-braces guard so a throw during result assembly cannot retain it.

### Proof of correctness, not just speed

```
OUTPUT BYTE-IDENTICAL across 4 runs : true
   3,615 smells · 1,487,055 bytes every run

invalidation, proven with a REAL file change:
   warm cache hit                         :    80 ms
   after adding a file with a real smell  : 1,421 ms   (rescanned, not stale)
   new smell detected                     : yes — console_log_prod, 3,615 -> 3,616
   after removing that file               : 3,616 -> 3,615  (exactly restored)
```

### Result

```
in-process : 2,841 ms -> 81 ms       97.1%
over HTTP  : 1,675.7 ms -> 224.7 ms   86.6%
payload    : 1.42 MB unchanged
```

A 60-second TTL bounds staleness even if mtime resolution ever failed; an observed 1,205 ms request mid-run was the TTL expiring and correctly re-scanning.

---

## 2 · C3-02 — compress what was already meant to be compressed

The middleware already existed and already compressed JSON. It simply never saw static files, because `express.static` does not call `res.json`. The fix extends the same middleware using Node's built-in `zlib`.

```
main.js  : 1,211 KB -> 330 KB   (73%)
main.css :   416 KB ->  68 KB   (84%)
cold first visit: 1,667 KB -> 410 KB   (75%)
```

### Safety properties — each verified live

| Property | Evidence |
|---|---|
| Non-gzip clients still work | `Accept-Encoding: identity` → 200, full 1,239,928 bytes |
| **HTML excluded** | shell still rendered per request with a live nonce: `nonce="hKvPUuF1qjKqsYTIKckm0A=="` |
| SPA actually executes | mounted in a real browser, **0 JS errors**, cold load 645 ms |
| No path traversal | `path.relative` guard rejects anything outside `frontend/build` |
| Cache bounded | ~1.8 MB maximum across all 310 compressible assets |

**The HTML exclusion is the most important decision in this phase.** `index.html` is re-rendered per request to stamp a fresh CSP nonce. A pre-gzipped copy from disk would carry a nonce that does not match the response's CSP header, the browser would block every script, and every visitor would get a blank page. Compressing one small HTML file was not worth that risk — correctness over a few kilobytes.

---

## Regression — no test weakened

| Gate | Before C.3 | After C.3 |
|---|---|---|
| `npm run test:runtime` | 144/144 · 0 fail · 0 skipped | **144/144 · 0 fail · 0 skipped** |
| `91-api-404-boundary` | 5 pass | **5 pass** |
| `92-c11-runtime-defect-regressions` | 9 pass | **9 pass** |
| `93-os2-os3-fake-success-protection` | 6 pass | **6 pass** |
| `96-production-build-artifact-integrity` | 4 pass | **4 pass** |
| `99-c1-accessibility-recovery` | 10 pass | **10 pass** |
| `100-c2-ux-error-truthfulness` | 10 pass | **10 pass** |
| `101-c3-performance-guards` *(new)* | — | **11 pass** |
| Production build | PASS | **PASS** — no poisoned `REACT_APP_API_URL` |

C.1 and C.2 work is intact (suites 99 and 100 green) — no regression pulled either phase back open.

---

## Negative tests — the guards provably fail

Each fix was made unsafe in the way that would matter most, and the suite caught it:

```
cache dismissals too (would break dismissing a smell)
  -> FAILED: dismissed smells must still be loaded on EVERY call — caching the
             final result would make dismissing a smell appear to do nothing

re-include HTML in static gzip (would break the CSP nonce)
  -> FAILED: HTML must NOT be pre-gzipped from disk: index.html is re-rendered
             per request to stamp a fresh CSP nonce ... the browser blocks every
             script and the page is blank

restored -> 11 passed, 0 failed
```

Note both negative tests target **correctness**, not speed. A performance guard that only checks timing would let a fast, wrong implementation through.

---

## What was deliberately NOT done

| Not done | Why |
|---|---|
| Paginate `/coding/smells` | Serialization is 3–4 ms of a 1,676 ms request — it would fix 0.2% of the cost and change the API contract |
| Cache `repo-index.json` | **Already cached** by both readers with a 5-min TTL |
| "Fix" `/business/stats` concurrency | Throughput **rose** 3.4 → 16.3 req/s — normal single-thread queueing, not degradation |
| Chase the 677 MB RSS | Declined 156 → 138 → 60 MB as GC reclaimed; transient, not a leak |
| Remove the 5-minute smell poll | Intentional, and correctly cleared on unmount |
| Introduce a database or new cache layer | Explicitly forbidden; both fixes extend existing code |
| Add a compression dependency | Node's built-in `zlib` was sufficient |
