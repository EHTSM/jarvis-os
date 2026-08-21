# C.3 — PERFORMANCE BASELINE

Date: 2026-08-14 · Branch: `security/reality-completion`
**Captured BEFORE any C.3 change. `.env` untouched. Environment not altered before measurement.**

Companion documents: [Discovery](C3-PERFORMANCE-DISCOVERY.md) · [Findings](C3-PERFORMANCE-FINDINGS.md) · [Recovery](C3-PERFORMANCE-RECOVERY.md) · [Evidence](C3-PERFORMANCE-EVIDENCE.md) · [Certification](C3-PERFORMANCE-CERTIFICATION.md)

---

## Gate baseline

```
npm run test:runtime : 144 tests · 50 suites · pass 144 · fail 0 · skipped 0 · 6,676 ms
backend health       : 200 in 5.4 ms
server               : pid 15388 · rss 27.6 MB · cpu 0.0% · uptime 1h37m
branch               : security/reality-completion
.env changes         : 0
```

## Frontend build baseline

```
main.js       : 1,211 KB
main.css      :   416 KB
lazy chunks   : 164
total build   : 7.3 MB
```

## API latency baseline — WARM, authenticated, serial (n=12 each)

Populations kept separate: cold / warm / unauth / concurrent are never mixed.

```
endpoint        p50 ms    p95 ms     max ms   payload
health              0.3       0.6        0.6        —
mission             1.8       2.2        2.2    200 KB
memory              2.3     837.6      837.6    118 KB
business           68.7      80.8       80.8        —
crm                70.4     128.8      128.8        —
enterprise         65.8      68.1       68.1        —
organization       64.7      70.8       70.8        —
automation         74.4      80.1       80.1      2 KB
support            82.3      91.1       91.1      1 KB
ai                 85.9      98.3       98.3      3 KB
finance            82.1     1319       1319         —
growth            145.6     212.4      212.4        —
developer        1675.7     2815       2815     1456 KB   ← outlier
```

Four endpoints returned 404 on my first path guesses (`/exec/dashboard`, `/runtime/tasks`, `/agents`, `/product-factory/products`). **Those were my errors, not gaps** — the real routes were located and measured, so no domain went unmeasured:

```
executive  /execution/dashboard        p50  98.1 ms
runtime    /runtime/status             p50   0.5 ms
runtime    /runtime/history            p50   0.3 ms
agent      /agents/runtime/registry    p50   1.7 ms
agent      /agents/runtime/supervisor  p50   1.4 ms
product    /product-factory/plans      p50  90.5 ms
```

## Cold (first authenticated hit, separate population)

```
developer  /coding/smells   3,959.7 ms   1,490,565 B
executive  /execution/dashboard  153.1 ms
organization /orgs               515.0 ms
support    /co3/feedback         690.3 ms
```

## Unauthenticated rejection cost

```
business 401 p50 0.5 ms · crm 401 p50 0.3 ms · growth 401 p50 0.4 ms
finance  401 p50 0.4 ms · developer 401 p50 0.4 ms
```

Authorization rejection is effectively free — the boundary is not a performance cost.

## Concurrency baseline — read-only `/business/stats`

```
 1 concurrent  p50    84.2  p95    84.2  ok  1/1   errors 0  timeouts 0  rateLimited 0
 5 concurrent  p50   191.0  p95   315.1  ok  5/5   errors 0  timeouts 0  rateLimited 0
10 concurrent  p50   411.0  p95   651.9  ok 10/10  errors 0  timeouts 0  rateLimited 0
25 concurrent  p50   894.7  p95  1572.5  ok 25/25  errors 0  timeouts 0  rateLimited 0
```

## Frontend baseline

```
warm (browser cache) : TTFB 4 ms · FCP 232 ms · LCP 232 ms · CLS 0.044 · load 457 ms
cold (cache disabled): TTFB 10 ms · FCP 244 ms · load 543 ms · 8 requests · 1,667 KB
   largest: main.js 1,211 KB · main.css 416 KB
```

**Core Web Vitals were genuinely measured** via `PerformanceObserver` (LCP, CLS) and the Navigation Timing API (TTFB). **INP was NOT MEASURED** — it requires real user interaction over a session and is not obtainable from this harness.

## Storage baseline

```
data/                     2.0 GB
  repo-index.json          45 MB   read 93.3 ms · parse 110.8 ms
  missions.json            12 MB   read 63.6 ms · parse  25.0 ms
  agent-runs.json         3.4 MB   read 20.0 ms · parse   4.2 ms
  company-workspaces.json 2.8 MB   read 16.2 ms · parse   5.8 ms
```
