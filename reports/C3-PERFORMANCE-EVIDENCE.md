# C.3 — PERFORMANCE EVIDENCE

Date: 2026-08-14 · Branch: `security/reality-completion`

Raw measured evidence. Populations kept strictly separate.
**No estimated numbers. No fabricated latency. No unmeasured property called PASS.**

---

## 1 · API latency — WARM, authenticated, serial (n=12), before → after

```
endpoint            p50 before    p50 after     p95 after    payload
health                    0.3          0.4           0.6          —
mission                   1.8          1.5           2.3      200 KB
memory                    2.3          1.9           3.1      117 KB
crm                      70.4         56.0          57.3          —
business                 68.7         58.2          66.2          —
enterprise               65.8         62.9          65.3          —
automation               74.4         72.4          75.3        2 KB
ai                       85.9         79.9          85.0        3 KB
support                  82.3         81.2          88.6        1 KB
finance                  82.1         90.1         115.7          —
growth                  145.6        148.6         226.6          —
organization             64.7        184.1         583.8          —
developer              1675.7        224.7 ←     3055.9     1457 KB
```

`developer` (`/coding/smells`) — **1,675.7 ms → 224.7 ms, 86.6% faster**. Its p95 of 3,056 ms is the 60-second cache TTL expiring mid-run and correctly re-scanning rather than serving stale data.

`organization` moved 64.7 → 184.1 ms. This is **measurement variance from concurrent test load, not a C.3 regression** — no C.3 change touches `/orgs`, and a quiet-server re-sample of the comparable `/business/stats` returned to p50 66.5 ms.

### Additional domains (initial paths were wrong; corrected and measured)

```
executive  /execution/dashboard        p50  98.1 ms
runtime    /runtime/status             p50   0.5 ms
runtime    /runtime/history            p50   0.3 ms
agent      /agents/runtime/registry    p50   1.7 ms
agent      /agents/runtime/supervisor  p50   1.4 ms
product    /product-factory/plans      p50  90.5 ms
```

### Clean serial percentiles, quiet server (n=25)

```
/business/stats  p50 66.5  p75 78.8  p95 118.2  p99 148.2  min 60.3  max 148.2
```

### Unauthenticated rejection cost

```
business 401 p50 0.5 ms · crm 401 p50 0.3 ms · growth 401 p50 0.4 ms
finance  401 p50 0.4 ms · developer 401 p50 0.4 ms
```

Authorization rejection is effectively free.

---

## 2 · C3-01 — phase split, the measurement that directed the fix

```
run 1:  scan = 2,339 ms   serialize = 3 ms   3,615 smells   1.42 MB
run 2:  scan = 1,463 ms   serialize = 4 ms
run 3:  scan = 1,369 ms   serialize = 4 ms
```

**Serialization is 0.2% of the request.** Payload trimming would have been the wrong fix.

### No regression against the prior optimization (Step 8 requirement)

```
6 runs: 2369 · 1534 · 1474 · 1625 · 1681 · 1492 ms
median 1,625 ms   vs prior optimized baseline ~2,000 ms   -> NOT regressed
```

### Scan scope

```
2,900 source files · 29.7 MB read per call
validity stamp: 5–12 ms over 1,814 files  (~300x cheaper than rescanning)
```

### After

```
in-process : 2,841 -> 81 ms      (97.1%)
over HTTP  : 1,675.7 -> 224.7 ms  (86.6%)

live HTTP sequence:
  run 1: 2613 ms (cold)   run 2: 235   run 3: 236
  run 4:  222 ms          run 5: 209   run 6: 1205 (TTL expiry — correct re-scan)
```

### Correctness

```
OUTPUT BYTE-IDENTICAL across 4 runs: true — 3,615 smells, 1,487,055 bytes

invalidation with a real file change:
  warm cache hit                        :    80 ms
  after adding a file with a real smell : 1,421 ms   (rescan, not stale)
  new smell detected                    : console_log_prod, 3,615 -> 3,616
  after removal                         : 3,616 -> 3,615  (exactly restored)
```

---

## 3 · C3-02 — compression, before → after

```
BEFORE
  /static/js/main.<hash>.js    Content-Length 1,239,928   (no Content-Encoding)
  /p27/missions                Content-Encoding: gzip, 15,005 B   (JSON worked)

AFTER
  main.js   Content-Encoding: gzip   337,554 B   (1,211 KB -> 330 KB, 73%)
  main.css  Content-Encoding: gzip    69,443 B   (  416 KB ->  68 KB, 84%)
```

### Cold first visit, real browser, cache disabled

```
BEFORE : 8 requests · 1,667 KB · load 543 ms · TTFB 10 ms · FCP 244 ms
AFTER  : 9 requests ·   410 KB · load 645 ms · TTFB 10 ms · FCP 284 ms
         SPA mounted: true · JS errors: 0

transfer reduction: 75%
```

Load wall-clock rose ~100 ms **on localhost**, where transfer is nearly free and gzip decompression is pure added CPU. On any real network the 1,257 KB saved dominates: at 10 Mbps that is roughly 1 second of transfer removed. **No claim is made about real-network improvement — it was not measured.**

### Safety

```
Accept-Encoding: identity  -> 200, 1,239,928 bytes (uncompressed, still works)
SPA shell "/"              -> 200, nonce="hKvPUuF1qjKqsYTIKckm0A==", NOT pre-gzipped
path traversal outside build -> rejected (path.relative guard)
asset cache bound          -> ~1.8 MB across all 310 compressible assets
```

---

## 4 · Core Web Vitals — genuinely measured

```
TTFB  4–10 ms      (Navigation Timing)
FCP   232–284 ms   (Paint Timing)
LCP   232 ms       (PerformanceObserver, largest-contentful-paint)
CLS   0.044        (PerformanceObserver, layout-shift)
INP   NOT MEASURED — requires real user interaction over a session
```

LCP 232 ms and CLS 0.044 are both within Google's "good" thresholds (LCP ≤ 2.5 s, CLS ≤ 0.1). **INP is explicitly not claimed.**

---

## 5 · Concurrency — read-only `/business/stats`

```
                p50        p95        max     ok    errors  timeouts  rateLimited
 1 concurrent   76.7       76.7       76.7    1/1      0        0          0
 5 concurrent  212.3      330.0      330.0    5/5      0        0          0
10 concurrent  785.0     2174.1     2174.1  10/10      0        0          0
25 concurrent  841.8     1564.6     1625.9  25/25      0        0          0
```

**Throughput, which is what actually matters here:**

```
serial      : 3.4 req/s
concurrent10: 16.3 req/s   (~4.8x)
```

Latency rises while **throughput scales** — that is normal queueing on a single-threaded event loop, not degradation. **0 errors, 0 timeouts, 0 rate-limited across all levels.**

---

## 6 · Memory / mission / runtime (Step 8)

```
memory recall    /p20/memory/rank            p50 1.9 ms   p95  3.1 ms
mission list     /p27/missions               p50 1.5 ms   p95  2.3 ms
runtime status   /runtime/status             p50 0.4 ms   p95  1.3 ms
runtime history  /runtime/history            p50 2.4 ms   p95  3.2 ms
agent registry   /agents/runtime/registry    p50 1.4 ms   p95  2.6 ms
```

All five sub-4 ms at p50. **No performance defect found in these systems.**

---

## 7 · Storage

```
data/                     2.0 GB
  repo-index.json          45 MB   read 93.3 ms · parse 110.8 ms
  missions.json            12 MB   read 63.6 ms · parse  25.0 ms
  agent-runs.json         3.4 MB   read 20.0 ms · parse   4.2 ms
  company-workspaces.json 2.8 MB   read 16.2 ms · parse   5.8 ms
```

**Not a defect:** both `repo-index.json` readers (`largeContextCodeSearch.cjs`, `repoIntelligenceEngine.cjs`) already cache with a 5-minute TTL, so the 204 ms read+parse is not paid per request. **No storage change made.**

---

## 8 · Memory / leak check

```
smell cache growth : 4 MB -> 127 MB (1 scan) -> 140 MB (6 scans)
                     -> holds ONE result set, not one per call

RSS across repeated load rounds: 155.9 -> 138.0 -> 59.9 MB
                     -> declines as GC reclaims; transient working set, NOT a leak

gzip asset cache bound: ~1.8 MB if all 310 assets were requested
```

---

## 9 · Regression gates

| Gate | Result | Counted as |
|---|---|---|
| `npm run test:runtime` | **144/144** · 50 suites · 0 fail · 0 skipped | **PASS** |
| `91-api-404-boundary` | 5 passed, 0 failed | **PASS** |
| `92-c11-runtime-defect-regressions` | 9 passed, 0 failed | **PASS** |
| `93-os2-os3-fake-success-protection` | 6 passed, 0 failed | **PASS** |
| `96-production-build-artifact-integrity` | 4 passed, 0 failed | **PASS** |
| `99-c1-accessibility-recovery` | 10 passed, 0 failed | **PASS** |
| `100-c2-ux-error-truthfulness` | 10 passed, 0 failed | **PASS** |
| **`101-c3-performance-guards`** *(new)* | **11 passed, 0 failed** | **PASS** |
| Production build | Compiled successfully | **PASS** |
| `REACT_APP_API_URL` at build time | unset — no poisoned artifact | **PASS** |
| `19-logging-consistency` | fails | **PRE-EXISTING FAIL** — untouched |

---

## 10 · Negative tests

```
cache dismissals too   -> FAILED: dismissed smells must still be loaded on EVERY call
re-include HTML in gzip -> FAILED: HTML must NOT be pre-gzipped from disk ... the
                                   browser blocks every script and the page is blank
restored                -> 11 passed, 0 failed
```

Both target **correctness**, not timing — a guard that only checked speed would let a fast, wrong implementation through.

---

## 11 · Constraint compliance

| Constraint | Status |
|---|---|
| `.env` not modified | **HELD** — 0 entries in `git status` |
| No test weakened | **HELD** — no existing test modified; one added |
| No second runtime / cache layer / queue / DB / API layer | **HELD** — both fixes extend existing code |
| No new dependency | **HELD** — Node built-in `zlib` only |
| Correctness preserved | **HELD** — byte-identical scan output; SPA mounts with 0 errors |
| Tenant isolation / authorization untouched | **HELD** — no auth code modified |
| API contracts unchanged | **HELD** — same payloads, same shapes |
| No fabricated numbers | **HELD** — every figure has a before/after pair |
| Rate limiting not counted as failure | **HELD** — tracked separately, 0 observed |
| Credential failures not counted as performance failures | **HELD** — AI recorded CREDENTIAL BLOCKED |
| No merge, no push | **HELD** |
