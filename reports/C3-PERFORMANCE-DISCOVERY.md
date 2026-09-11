# C.3 — PERFORMANCE DISCOVERY

Date: 2026-08-14 · Branch: `security/reality-completion`
**No merge. No push. `.env` untouched. No test weakened. No OS-track work.**

Companion documents: [Baseline](C3-PERFORMANCE-BASELINE.md) · [Findings](C3-PERFORMANCE-FINDINGS.md) · [Recovery](C3-PERFORMANCE-RECOVERY.md) · [Evidence](C3-PERFORMANCE-EVIDENCE.md) · [Certification](C3-PERFORMANCE-CERTIFICATION.md)

---

## Method

Every number here was measured against the **real authenticated application** on `:5050`. Populations were kept strictly separate — **cold / warm / authenticated / unauthenticated / serial / concurrent** — because mixing them produces percentiles that describe nothing.

Rules followed throughout:

- **No optimization without a before/after measurement.** A code pattern is not a performance defect until measured.
- **429 is not an error.** Rate limiting doing its job was counted separately from failures.
- **Read-only endpoints for concurrency.** No destructive load testing; no mutations against real data.
- **Credential failures are not performance failures.**

---

## What the measurement actually found

### One dominant outlier

Across 17 domains, latency was strongly bimodal:

```
sub-3 ms   : health, mission, memory, runtime status/history, agent registry/supervisor
55-150 ms  : business, crm, enterprise, organization, automation, support, ai,
             finance, executive, product
1,676 ms   : developer  (/coding/smells)   ← 11x the next slowest
```

`/coding/smells` was the only endpoint in a different order of magnitude, and the only one returning a multi-megabyte payload (1.42 MB).

### The cost was not where a code reading would suggest

Rather than assume, the endpoint was split into its two phases:

```
run 1:  scan = 2,339 ms   serialize = 3 ms   3,615 smells   1.42 MB
run 2:  scan = 1,463 ms   serialize = 4 ms
run 3:  scan = 1,369 ms   serialize = 4 ms
```

**Serialization of a 1.42 MB payload costs 3–4 ms — essentially nothing.** The entire cost is the scan, which reads **2,900 source files / 29.7 MB** on every single call.

A tempting "fix" would have been to paginate or trim the payload. That would have addressed 0.2% of the cost.

### The prior optimization was checked, not assumed

Step 8 required verifying the previously optimized ~2.0 s result had not regressed:

```
6 consecutive runs: 2369 · 1534 · 1474 · 1625 · 1681 · 1492 ms
median 1,625 ms   (prior optimized baseline ~2,000 ms)
```

**No regression** — the earlier algorithmic work is holding and has slightly improved. The remaining cost is structural (full-repo I/O), not algorithmic.

### The repeated work was confirmed real, not hypothetical

```
SmellsPanel.jsx:224   setInterval(scan, 5 * 60 * 1000)
```

The panel polls `/coding/smells` every five minutes, and the interval **is correctly cleared on unmount**. Per the mission's rule — *"Do not remove polling merely because polling exists; determine whether it is intentional"* — the polling is intentional and was left alone. The defect is that each poll redoes an identical 2,900-file scan.

### A second finding the API numbers could not show

The API measurements looked healthy, but the **frontend transfer** told a different story:

```
cold first visit: 1,667 KB over 8 requests
   main.js  1,211 KB
   main.css   416 KB
```

Checking compression directly:

```
curl -H 'Accept-Encoding: gzip' /static/js/main.<hash>.js
   Content-Length: 1239928        (no Content-Encoding header)

curl -H 'Accept-Encoding: gzip' /p27/missions
   Content-Encoding: gzip
   Content-Length: 15005          (from ~206 KB)
```

**JSON compressed; static assets did not.** `backend/middleware/compress.js` only monkey-patched `res.json`, and `express.static` never calls it. Every first visit shipped ~1.2 MB that did not need to be sent.

This was **not** a false capability claim — the middleware's own header says "gzip for JSON responses". It was a genuine coverage gap.

---

## What measured fine and was deliberately left alone

The mission's fix policy requires evidence, so several plausible-looking targets were measured and cleared:

| Candidate | Measurement | Verdict |
|---|---|---|
| **45 MB `repo-index.json`** re-read per request | Both readers (`largeContextCodeSearch.cjs`, `repoIntelligenceEngine.cjs`) already cache with a 5-minute TTL | **Not a defect** — no change made |
| **2.0 GB data directory** | Not read per request; large stores are cached | **Not a defect** |
| **`/business/stats` "degrading" 77 → 842 ms at 25 concurrent** | Throughput **rose** 3.4 → 16.3 req/s (~4.8x); 0 errors, 0 timeouts, 0 rate-limiting | **Normal single-thread queueing**, not degradation |
| **677 MB RSS after load** | Declined 156 → 138 → 60 MB across rounds as GC reclaimed | **Transient working set, not a leak** |
| Payload size of `/coding/smells` | Serialization 3–4 ms of a 1,676 ms request | **Not the bottleneck** |
| SmellsPanel 5-minute polling | Intentional; interval cleared on unmount | **Left in place** |

**Four plausible optimizations were rejected on evidence.** That is the point of measuring first.

---

## Surfaces measured

| # | Area | Measured |
|---|---|---|
| 1 | Frontend load | ✔ cold + warm, TTFB/FCP/LCP/CLS |
| 2–3 | Backend / API latency | ✔ 17 domains, p50/p75/p95/p99 |
| 4 | Storage operations | ✔ read + parse cost on the 4 largest stores |
| 5–6 | Server CPU / memory | ✔ RSS tracked across load, leak-checked |
| 7 | Network payloads | ✔ per-endpoint bytes; cold transfer |
| 9–10 | Expensive chains / repeated requests | ✔ found the 5-min smell poll |
| 11 | Unnecessary polling | ✔ assessed, found intentional |
| 12 | Slow endpoints | ✔ one genuine outlier |
| 14–15 | Cold vs warm | ✔ kept as separate populations |
| 16 | Concurrent requests | ✔ 1 / 5 / 10 / 25 |
| 17 | Large payload behaviour | ✔ 1.42 MB scan result |
| 18–20 | Search / mission / memory / runtime | ✔ all sub-4 ms p50 |
| 21–22 | Bundle + production build | ✔ build verified, no poisoned API URL |

**NOT MEASURED (recorded, not scored as passing):** INP (needs real user interaction), sustained multi-hour soak, multi-tenant concurrent load, database engine internals (none — file-backed persistence), CDN/edge behaviour, and real-network latency (all measurements are localhost, so they exclude WAN transfer time).
