# Phase 3 — Deployment Rehearsal (Attempt 3, leaner retry)

Branch: `security/reality-completion` (original checkout untouched, no merge).
Date: 2026-07-17. Execution-mode only — all numbers below are real measurements from
this pass, not fabricated.

Fresh clone used for all steps: `/tmp/jarvis-rehearsal3-1784270442`

> **Environment note — safety classifier outage.** Partway through this pass the
> Bash safety classifier (`claude-sonnet-5[1m]`) went into a sustained
> "temporarily unavailable" state. Trivial allowlisted commands (`true`,
> `echo`) still ran, but every non-allowlisted command (backend boot, PM2,
> docker, rollback) was blocked at the safety gate — not by the command
> failing, but by the harness being unable to classify it. Steps 4–7 below are
> therefore marked **BLOCKED (classifier outage)** with whatever static
> evidence was gathered before/around the outage. This is an infrastructure
> limitation of this pass, not a product defect, and not a fabricated result.

---

## Step 1 — Fresh clone

**Command:** `git clone /Users/ehtsm/jarvis-os /tmp/jarvis-rehearsal3-$(date +%s)`

**Result:** Clone completed (`done.`), directory populated
(`/tmp/jarvis-rehearsal3-1784270442`), tree lists expected root contents
(`agents/`, `backend/`, `frontend/`, `ecosystem.config.cjs`, etc.). Local clone,
a few seconds.

**Verdict:** PASS

---

## Step 2 — Install (fast path)

**Commands:**
- Root: `npm ci --omit=dev --ignore-scripts`
- Frontend: `cd frontend && npm ci`

**Why `--ignore-scripts` (stated explicitly, not hidden):** the root package has a
`postinstall` of `electron-builder install-app-deps` plus native modules
(`node-pty`, `better-sqlite3`) whose rebuild is slow and unreliable in this
environment. `--ignore-scripts` deliberately skips that native/postinstall step
so the rehearsal exercises dependency resolution + tree integrity without the
slow native compile. This means native addons are NOT rebuilt in this clone —
acceptable for a build/boot rehearsal, but a real VPS deploy must run the
postinstall / `npm run rebuild`.

**Result:**
- Root `npm ci --omit=dev --ignore-scripts`: **~2.2s** (real `time` output).
  npm reported `8 vulnerabilities (6 moderate, 2 critical)` — a real audit
  finding to track separately.
- Frontend `npm ci`: **~15.2s** (real `time` output), completed cleanly.

**Verdict:** PASS (with noted audit vulnerabilities + skipped native postinstall)

---

## Step 3 — Build frontend

**Command:** `npm run build:frontend` (from clone root → `cd frontend && npm run build`)

**Result:** CRA build completed — "The build folder is ready to be deployed."
Real `time`: **~43.7s** wall (76s user). Artifact confirmed:
`/tmp/jarvis-rehearsal3-1784270442/frontend/build/index.html` exists (6643 bytes).

**Verdict:** PASS

---

## Step 4 — Backend boot + health check

**Command:**
`JWT_SECRET=rehearsal3-secret PORT=5063 node backend/server.js &`
then poll `http://localhost:5063/health` up to 10s, confirm 200, then kill.

**Result:** **BLOCKED (classifier outage).** The boot+poll+kill command was
submitted repeatedly but the Bash safety classifier was unavailable the entire
time and refused to authorize execution. No health response was obtained this
pass. (The identical flow is exercised by the allowlisted `curl -sf
http://localhost:5050/health` rules and PM2 health checks in prior sessions, but
that is not fresh evidence from THIS clone.)

**Verdict:** TIMED OUT / BLOCKED — not attempted to completion; no fabricated 200.

---

## Step 5 — PM2

**Static check performed BEFORE outage (real):** `grep "/Users/ehtsm"
ecosystem.config.cjs` → **NONE FOUND**. The config uses `cwd: __dirname` and
`script: "backend/server.js"` (relative), so it is **portable** — it does NOT
hardcode the original `/Users/ehtsm/jarvis-os` checkout path. Good portability
finding: running `pm2 start ecosystem.config.cjs` from any clone will use that
clone's directory, not the original.

**Command intended:** `pm2 start ecosystem.config.cjs` in the fresh clone, confirm
online, then `pm2 delete`.

**Result:** **BLOCKED (classifier outage)** — the `pm2 start` command could not be
authorized. Online/offline status not captured this pass.

**Verdict:** Static portability check PASS (no hardcoded paths); live PM2 start
BLOCKED / not completed.

---

## Step 6 — Docker check only

**Command:** `docker ps` (daemon-state only; no build attempt by design).

**Result:** **BLOCKED (classifier outage)** — `docker ps` could not be authorized
this pass. Per task instructions, a real Docker build was **not attempted this
pass**; prior sessions already covered static Dockerfile review.

**Verdict:** Not attempted this pass (daemon state uncaptured due to outage;
static Dockerfile review already covered by prior sessions).

---

## Step 7 — Rollback safe-check

**Static arg-parsing verification (real, from reading the script):**
`deploy/rollback.sh` supports `--list` as its safe/read-only mode. `--list`
branch runs `ls -lh backups/jarvis_*.tar.gz` + `git log --oneline -10` and
`exit 0` — it performs NO restore, NO checkout, NO server stop. Confirmed the
correct safe flag is `--list`.

**Command intended:** `bash deploy/rollback.sh --list` against the FRESH CLONE only.

**Result:** **BLOCKED (classifier outage)** — could not authorize execution this
pass. Expected safe output would be "No backups found." (fresh clone has no
`backups/` tarballs) plus the last 10 git commits. Not run, so not reported as
fact.

**Verdict:** Static safe-flag verification PASS; live run BLOCKED / not completed.

---

## Step 8 — Electron dist build

**Result:** SKIPPED by design. Not attempted — requires real code-signing certs
per Phase 2 findings (Apple/Windows certs confirmed absent), and an unsigned
Linux build takes longer than this pass's budget allows.

**Verdict:** SKIPPED (intentional).

---

## Cleanup

**DONE.** `rm -rf /tmp/jarvis-rehearsal3-1784270442` executed successfully —
`cleanup done`, and `ls -d /tmp/jarvis-rehearsal3-*` confirms **no rehearsal
clones remain**. No backend/PM2 process was ever successfully started this pass
(steps 4 and 5 were both blocked at the safety gate before any process spawned),
so there are no lingering server/PM2 processes to kill. The environment is clean.

---

## Summary of this pass

| Step | Result |
|------|--------|
| 1 Fresh clone | PASS |
| 2 Install (fast path, `--ignore-scripts`) | PASS (8 npm-audit vulns noted; native postinstall skipped) |
| 3 Build frontend | PASS (index.html present) |
| 4 Backend boot + health | BLOCKED (classifier outage) |
| 5 PM2 | Static: PASS (no hardcoded paths, `cwd:__dirname`); Live: BLOCKED |
| 6 Docker `docker ps` | Not attempted (outage; per-design no build) |
| 7 Rollback `--list` | Static: PASS (safe flag confirmed); Live: BLOCKED |
| 8 Electron dist | SKIPPED (certs absent, over budget) |

**Real bug / portability findings:**
- `ecosystem.config.cjs` is portable — uses `cwd: __dirname`, no hardcoded
  `/Users/ehtsm/jarvis-os` paths. (Positive finding.)
- Root `npm ci` reports 8 vulnerabilities (2 critical, 6 moderate) — track and
  remediate before production.
- Native addons (`node-pty`, `better-sqlite3`) are NOT rebuilt when using
  `--ignore-scripts`; a real deploy must run the postinstall / `npm run rebuild`.
