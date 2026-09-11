# C.3 — PERFORMANCE FINDINGS

Date: 2026-08-14 · Branch: `security/reality-completion`

Ranked P0–P3. Every finding carries baseline, root cause, fix, after-measurement and improvement.
**No number in this document is estimated. Nothing is claimed without a before/after pair.**

---

## Summary

| Rank | Count | Fixed |
|---|---:|---:|
| **P0** — production-breaking | 0 | — |
| **P1** — major user-facing slowdown | **2** | **2** |
| **P2** — measurable but moderate | 0 | — |
| **P3** — optimization opportunity | 2 | 0 (documented) |
| **Rejected on evidence** (looked like defects, measured fine) | 4 | n/a |

---

## P1 · C3-01 — `/coding/smells` rescanned 2,900 files on every request

**Endpoint:** `GET /coding/smells` · **Component:** `backend/services/engineeringSmellDetector.cjs`

### Baseline

```
warm p50   : 1,675.7 ms      max 2,815 ms
cold       : 3,959.7 ms
payload    : 1.42 MB (3,615 smells)
```

### Bottleneck

Measured by splitting the request into phases:

```
scan = 1,369–2,339 ms      serialize = 3–4 ms
```

**All of the cost is the scan; serializing 1.42 MB is negligible.** The scan reads **2,900 source files / 29.7 MB** per call.

### Root cause

`scan()` had no result reuse. `SmellsPanel.jsx:224` polls this endpoint every 5 minutes (intentionally — the interval is cleared on unmount), so the identical full-repo scan repeated indefinitely per open panel, per user.

The algorithm itself was **already optimized in an earlier phase** and was verified not regressed (median 1,625 ms vs the prior ~2,000 ms baseline). The remaining cost is structural I/O, not algorithmic.

### Fix

An mtime-keyed result cache on the **file-derived** detection only — "remove accidental duplicate work", not a new cache layer. Validity stamp measured at **5–12 ms** versus a 1,369–2,339 ms rescan.

Correctness deliberately preserved:
- `dismissed` is still loaded **per call**, so dismissing a smell still takes effect immediately
- runtime detectors (`_detectStaleMissions`, `_detectBuildFailures`, `_detectBenchmarkDecline`) read live state and are **never cached**
- the per-scan `_fileCache` memo is still released (a deliberate memory-leak fix, not traded away)

### After

```
in-process : 2,841 ms -> 81 ms      improvement 97.1%
over HTTP  : 1,675.7 ms -> 224.7 ms  improvement 86.6%
payload    : 1.42 MB (unchanged)
```

### Correctness evidence

```
OUTPUT BYTE-IDENTICAL across 4 runs: true
  3,615 smells · 1,487,055 bytes every time

invalidation proven with a real file change:
  warm cache hit                        :    80 ms
  after adding a file with a real smell : 1,421 ms  (rescan, not stale)
  new smell detected                    : yes (console_log_prod, 3615 -> 3616)
  after removing the file               : 3,616 -> 3,615  (exactly restored)
```

**Regression:** 144/144 runtime; suites 92, 93, 96, 99, 100 all pass. Locked by suite 101, negative-tested.

---

## P1 · C3-02 — static build assets shipped uncompressed

**Component:** `backend/middleware/compress.js`

### Baseline

```
cold first visit : 1,667 KB over 8 requests
   main.js  1,211 KB   (no Content-Encoding)
   main.css   416 KB   (no Content-Encoding)

meanwhile, JSON API compressed correctly:
   /p27/missions  ~206 KB -> 15,005 B gzipped
```

### Root cause

The middleware only monkey-patched `res.json`. Static files are served by `express.static`, which never calls `res.json`, so **every build asset bypassed compression entirely**.

This was not a false claim — the middleware's own documentation said "gzip for JSON responses". It was a coverage gap.

### Fix

Extended the existing middleware to compress build assets, using Node's built-in `zlib` (**no new dependency, no new architecture**). Compressed bytes are cached in-process keyed on `mtime + size`, so gzip CPU is paid once per asset per deploy rather than per request. Assets are content-hashed, so the cache cannot serve a stale body for a new build.

### After

```
main.js  : 1,211 KB -> 330 KB   73% smaller
main.css :   416 KB ->  68 KB   84% smaller
cold first visit: 1,667 KB -> 410 KB   75% smaller
SPA mounts correctly · 0 JS errors
```

### Safety properties verified

| Property | Result |
|---|---|
| Non-gzip clients still served | `Accept-Encoding: identity` → 200, full 1,239,928 bytes |
| **HTML excluded** so the CSP nonce survives | shell still rendered per request; `nonce="hKvPUuF1..."` present |
| Path traversal outside `frontend/build` | rejected via `path.relative` guard |
| Cache bounded | ~1.8 MB if every one of 310 assets were requested |

**HTML exclusion is the critical one.** `index.html` is re-rendered per request to stamp a fresh CSP nonce; serving a pre-gzipped copy would ship a nonce that does not match the response header, and the browser would block every script — a blank page. This is asserted and negative-tested.

---

## P3 · Documented, not fixed

### P3-1 — `/coding/smells` returns an unbounded 1.42 MB payload

Serialization is only 3–4 ms, so this is **not** a latency defect. But 1.42 MB is a large response for a UI that renders a filtered list. Adding pagination would change the API contract, which the mission forbids doing casually.

**Recorded as an optimization opportunity. Not fixed — the measured cost does not justify an API contract change.**

### P3-2 — `/growth/audiences` at p50 148.6 ms

The slowest non-outlier endpoint, roughly 2x its peers. Real but moderate, and no single dominant cause was identified within C.3's measurement budget.

**Recorded. Not fixed — optimizing without an identified root cause would be guesswork.**

---

## Rejected on evidence — plausible targets that measured fine

The mission requires evidence before optimizing. These four looked like defects and were cleared:

| Candidate | Measurement | Verdict |
|---|---|---|
| 45 MB `repo-index.json` re-read per request | Both readers already cache with a 5-min TTL | **Not a defect** |
| 2.0 GB data directory | Not read on request paths | **Not a defect** |
| `/business/stats` 77 → 842 ms at 25 concurrent | Throughput **rose** 3.4 → 16.3 req/s; 0 errors, 0 timeouts, 0 rate-limited | **Normal queueing**, not degradation |
| 677 MB RSS after load | Declined 156 → 138 → 60 MB as GC reclaimed | **Transient working set, not a leak** |

---

## Credential blocked

**AI providers.** Per Step 9, credential failures are not performance failures. `/ai-ecosystem/creative` responds in **79.9 ms p50** at the application layer; actual provider latency is **CREDENTIAL BLOCKED** and no latency figure is fabricated for it.

---

## Environment blocked / not measured

| Item | Why |
|---|---|
| **INP** | Requires real user interaction over a session; not obtainable from this harness |
| Real-network latency | All measurements are localhost and exclude WAN transfer |
| Sustained soak (hours) | Outside C.3's window |
| Multi-tenant concurrent load | Single audit tenant available |
| Database engine internals | None exists — persistence is file-backed |
| CDN / edge behaviour | Not deployed in this environment |

**None of these is recorded as passing.**
