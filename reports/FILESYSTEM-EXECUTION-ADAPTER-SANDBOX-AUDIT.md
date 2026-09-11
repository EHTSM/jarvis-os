# FILESYSTEM EXECUTION ADAPTER SANDBOX SECURITY AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

`agents/runtime/adapters/filesystemExecutionAdapter.cjs` — flagged DECISION REQUIRED by the prior Agent
Runtime Execution-Boundary Triage. Deep-audited per the mission's explicit instruction not to assume
safety merely because a real sandbox mechanism exists, nor vulnerability merely because it's custom.

## Caller Chain

`POST /jarvis` (`requireAuth` only, no operator gate) → `backend/utils/parser.js` (parses `"read file
<path>"` / `"create file <path> with <content>"` chat messages with **zero path validation**, capturing
`\S+` verbatim) → `agents/toolAgent.cjs`'s `case "read_file"`/`case "create_file"` → `executionAdapter
Supervisor.routeExecution({ adapterType: "filesystem", ... })` → `filesystemExecutionAdapter.cjs`'s
`readFile`/`writeFile`. The sandbox root is configured **once, at server boot**, by `bootstrapRuntime.cjs`
(required from `backend/server.js`) as `path.resolve(__dirname, "../..")` — **the entire project
directory** — with `writeAllowed: true`. No org-scoping, no per-task/per-tenant sandbox narrowing exists
anywhere in this chain; it is a single, platform-wide, whole-codebase sandbox reachable by any ordinary,
authenticated customer.

## Genuine Vulnerabilities Found — 3, all proven live

**1. Protected-path denylist selectively unenforced on reads (P0, most severe).**
`_isProtectedPath()` — an existing, real mechanism — was checked by `writeFile`, `deleteFile`, and
`makeDir`, but **never** by `readFile`, `readDir`, `fileExists`, or `statFile`. Live-reproduced, direct
module call: `readFile('.env')` returned the real, live production `.env` file's full content (confirmed
present: `KEY`/`SECRET`/`TOKEN`/`PASSWORD`-pattern strings, without ever printing or logging the actual
secret values). Live-reproduced through the real, full HTTP chain with a fresh, ordinary customer account
(`POST /jarvis`, `{"message":"read file package.json"}` as a harmless proof of full reachability) and,
after the fix, the equivalent `.env`/`data/vault.json` attempts were re-verified to correctly fail on the
live restarted server — deliberately not exercised with the real `.env` payload over the network to avoid
transiting actual secret content through any logs, even transiently.

**2. `data/` directory under-protected (P0).** `PROTECTED_DIRS` listed only the single file
`data/deploy_meta.json`, not the directory itself. `data/` holds ~20 real credential/session/token/
account-adjacent stores. Live-reproduced: `readFile('data/local-accounts.json')` (real user password
hashes) and `readFile('data/vault.json')` (the real encrypted credential vault) both returned full file
content before the fix.

**3. Symlink-based sandbox escape (both direct-file and parent-directory forms).**
`_sandboxResolve()`'s containment check (`path.resolve()` + `startsWith()`) is purely lexical — it never
follows symlinks. Live-reproduced in an isolated test sandbox (no real project files touched): a symlink
placed inside the sandbox pointing to a file outside it let `readFile()` return the outside file's real
content; a symlinked directory let `writeFile()` land a new file at the real external location. **Not
currently exploitable in this live repository** — confirmed via `find` that zero symlinks exist anywhere
in the actual sandboxed project tree outside `node_modules/.bin` (already covered by the `node_modules`
protected prefix), and this adapter exposes no primitive (`fs.symlinkSync`) that could create one. Fixed
as genuine defense-in-depth regardless, since a symlink could be introduced by any other process without
this adapter's own knowledge, and the mission explicitly named "realpath vs lexical path checks" as a
required audit item.

## Fixes

All in `filesystemExecutionAdapter.cjs`, reusing the file's own existing mechanisms — no new sandbox
framework:

1. Added `_isProtectedPath(check.resolved)` to `readFile`, `readDir`, `fileExists`, `statFile` — the
   identical check already used by the write-side operations, applied consistently instead of
   selectively.
2. Changed `PROTECTED_DIRS`'s `"data/deploy_meta.json"` entry to the bare `"data"` directory entry —
   `_isProtectedPath()`'s existing prefix-matching logic (`rel === p || rel.startsWith(p + "/")`) then
   correctly protects everything under `data/`, matching how `node_modules`/`.git`/`backend/utils` are
   already protected as whole directories, not enumerated file-by-file.
3. Added `_nearestExistingAncestor(p)` (walks up the path chain to the first component that actually
   exists — necessary because `fs.realpathSync()` throws `ENOENT` for a not-yet-created file, so a brand
   new file's *own* path can't be directly realpath-checked; its nearest real ancestor directory is what
   actually determines where the write lands) plus a realpath-containment check in `_sandboxResolve()`:
   the nearest existing ancestor's `fs.realpathSync()` result must itself stay inside the sandbox root's
   own `fs.realpathSync()` result. Verified this correctly allows symlinks that stay *within* the sandbox
   (not over-blocking legitimate internal symlink use) while rejecting both escape shapes.

## Live Verification

All 3 fixes verified at multiple levels: direct module calls with the exact payload that proved each
vulnerability (confirmed inert post-fix); an isolated-sandbox reproduction for both symlink-escape shapes
(file-level and directory-level), confirmed the internal-symlink case remains correctly permitted; the
real, live, restarted production server via the actual HTTP chain with a freshly registered ordinary
customer account — `"read file .env"` and `"read file data/vault.json"` both now correctly fail with no
content exposed, while `"read file package.json"` (a genuinely non-sensitive file) continues to succeed
with real content, confirming zero regression on legitimate use.

## Classification

**GENUINELY VULNERABLE** (now fixed) — not clean, not merely theoretical. The `.env`/`data/vault.json`/
`data/local-accounts.json` read-bypass was live, real, and reachable by any ordinary authenticated
customer with zero operator gate, through a plain chat message, before this mission's fix. The symlink-
escape vector is real but currently dormant (no exploitable symlink exists in this repository today) —
closed as defense-in-depth per the mission's explicit audit requirement.

**Authorization model**: this adapter and its one real caller chain (`toolAgent.cjs`'s chat-driven file
tools) have **no org-scoping, no operator gate, and no per-tenant sandbox narrowing** — every authenticated
customer shares the identical, whole-project-directory sandbox. Whether this broad customer-facing
reachability is itself the intended product boundary (vs. this feature deserving an `operatorOnly` gate,
matching the pattern already applied to the terminal chat tool's underlying execution adapter in the
prior mission) is a genuine, separate product-boundary question this audit did not have the evidence to
resolve unilaterally — flagged as **DECISION REQUIRED** for a future mission, not silently assumed either
way, per this mission's own "do not change product boundaries without evidence" instruction.

## Regression

**Before:** 397/397. **After:** 407/407 (clean run). **New tests:** 10 (block 160) — 3 structural + 7
live, covering all 3 fixes with direct reproductions in both the real project sandbox and fully isolated
test sandboxes, plus the real parser/chat-message chain. **Negative-tested**: reverted the fix, confirmed
7 of 9 security-relevant targeted tests failed for the exact expected reasons (the 2 that still passed
tested invariants the vulnerability never touched — legitimate reads and internal-symlink handling),
restored, confirmed all 10 passed again. Production build: PASS.
`tests/security/97-enterprise-isolation-integrity.cjs`: 8/8 PASS. `.env` untouched (confirmed both via
`git status` and via the fix itself, which now correctly prevents this exact file's content from ever
being read through the audited path). Server restarted once (required to load the fix — the module is
`require()`-cached at server boot via `bootstrapRuntime.cjs`), confirmed healthy immediately after, then
re-verified all 3 fixes live via real HTTP requests with a fresh customer account against the restarted
production server.

**No OS-track record altered.**
