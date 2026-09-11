# 21 — Project Statistics

**Status of this document:** VERIFIED. Every figure below was computed directly against the repository at the time of writing (2026-07-18) via `find`/`wc`/`ls`, not estimated or carried over from a prior self-report. Where this documentation's earlier sections cite a stale or inconsistent figure found *in* the codebase (e.g. the "57 connectors" discrepancy), this document reports the number this audit actually counted, and cross-references the reconciliation.

---

## Codebase Scale

| Metric | Count |
|---|---|
| Total JS-family files (`.js`, `.jsx`, `.cjs`, `.ts`), excluding `node_modules` | 3,605 |
| Total lines of code (`.js`/`.jsx`/`.cjs`, excluding `node_modules`) | 877,621 |
| — Backend (`backend/`) | 184,152 lines |
| — Frontend source (`frontend/src/`) | 161,273 lines |
| — Agents runtime (`agents/`) | 86,002 lines |
| — Tests (`tests/`) | 95,991 lines |
| `.cjs` files (CommonJS, the dominant backend module format) | 2,152 |
| `.js` files | 947 |
| `.jsx` files (React components) | 496 |
| `.ts`/`.tsx` files | 10 (TypeScript is installed but effectively unused — see [03_TECHNOLOGY_STACK.md](03_TECHNOLOGY_STACK.md)) |
| `.json` files (excluding `node_modules`) | 2,631 |
| `.md` files (excluding `node_modules`) | 693 |
| Shell scripts (`.sh`) | 32 |

## Routes

| Metric | Count |
|---|---|
| Route files in `backend/routes/` | 127 |
| Route files requiring authentication | 126 of 127 (only health checks, login/register, and webhooks are intentionally public) |
| Route files with rate-limiting middleware applied | 7 of 126 (accounts, auth, browser, jarvis, odi, runtime, whatsapp) |

## Components

| Metric | Count |
|---|---|
| Frontend component files (`frontend/src/components/`) | 441 |
| Navigable screens in the app's own navigation registry | 74 (6 primary tabs + 68 secondary/overflow tabs across 7 functional groups) |
| Screens removed from all navigation paths (2026-07-17 audit) | 14 |
| Frontend API wrapper modules (`*Api.js`, `_client.js`, `api.js`) | ~29 |

## Services

| Metric | Count |
|---|---|
| Backend service files (`backend/services/`) | 367 |
| — Classified as business logic (real) | 287 |
| — Classified as local execution (real) | 24 |
| — Classified as real external integration (verified live vendor calls) | 19 |
| — Classified as infrastructure | 3 |
| — Classified as honestly-labeled simulation (`mock:true`) | 34 |
| Agent runtime modules (`agents/runtime/`) | 323 |
| Top-level entries in `agents/` | 27 |

## Connectors

See [08_CONNECTOR_CATALOG.md](08_CONNECTOR_CATALOG.md) for the full reconciliation of the multiple connector-count figures found in this codebase.

| Figure | What it counts |
|---|---|
| 17 | Named, user-facing third-party services the mission-tracking audit evaluates individually |
| 47 | Distinct connector IDs in the live-probe registry (`integrationConnectors.cjs`), independently counted in this documentation effort |
| 54 | Entries in the encrypted-credential vault's `KNOWN_CONNECTORS` list (`secretVault.cjs`) — a different registry from the live-probe one |
| 3 | Connectors live-CONNECTED with real credentials today (Razorpay, Telegram, OpenAI) |

## Agents

The runtime distinguishes a smaller functional core (task routing, priority queue, agent registry, execution history — the modules directly exercised by `npm run test:runtime`) from a much larger surrounding layer of specialized/narrow modules (sales, marketing, SEO, support, research, dev, devops, analytics, content agents, plus "maturity/audit/intelligence/resilience" modules). The 323-file count in `agents/runtime/` reflects this full layered structure, not 323 independently-operating autonomous agents — see [11_AUTONOMOUS_CAPABILITIES.md](11_AUTONOMOUS_CAPABILITIES.md) for what "agent" and "autonomous" verifiably mean in this codebase.

## Automations

Rule-based and scheduled automation is implemented via `node-cron` (`backend/services/automationService.js`/`.cjs`, `agents/automation/`) and the AI mission/orchestration pipeline (`missionOrchestrator.cjs` — 228+ real missions observed persisted during the 2026-07-17 live audit, with 19 active and 95 total subtasks at one measured point).

## Data & Persistence

| Metric | Count |
|---|---|
| Top-level files under `/data` | 408 |
| Subdirectories under `/data` | 18 |
| Total entries under `/data` | ~451 |
| SQLite tables (the only relational storage in the app) | 2 (`tasks`, `migration_log`) |

## Testing

| Metric | Count |
|---|---|
| Test files across `tests/` (13 subdirectories) | 201 |
| — `tests/legacy/` | 74 |
| — `tests/runtime/` | 53 |
| — `tests/integration/` | 15 |
| — `tests/burnin/` | 14 |
| — `tests/stress/` | 14 |
| — `tests/workflows/` | 10 |
| — `tests/smoke/` | 9 |
| — `tests/operator/` | 4 |
| — `tests/security/` | 2 |
| — `tests/stability/` | 2 |
| — `tests/evaluation/` | 2 |
| — `tests/profiling/` | 1 |
| — `tests/chaos/` | 1 |
| CI-blocking regression checks (`npm run test:runtime`) | 144/144 passing, confirmed live multiple times in the 2026-07-17 audit |

## Git History

| Metric | Value |
|---|---|
| Total commits | 487 |
| Commit date range | 2026-04-24 to 2026-07-18 (~12 weeks) |
| Contributor identities | 2 (`EHTSM`, `root` — the latter likely automated/AI-assisted) |
| Branches (local + remote) | 13 |
| Tags | 15 (`v1.0.0-rc1` through `rc8`, plus 7 milestone/backup tags) |

## Root-Level Self-Report Documents

Over 150 root-level `.md` "report"/"certification"/"audit" files exist (e.g. `FINAL_PRODUCTION_CERTIFICATION.md`, `GO_LIVE_CERTIFICATION.md`, `RC1_AUDIT.md` through `RC4`), most following a repeated template of executive summary + numeric readiness score + GO/NO-GO verdict. **This documentation set does not treat that volume as evidence of maturity** — per the findings woven throughout this document set, numeric "readiness scores" in these self-reports should be treated as self-assessed and unverified unless independently cross-checked, which is exactly what the 2026-07-17 reality-completion audit (this documentation's primary source) did, and what this documentation set has deferred to throughout.

---

*Next: [22_EXECUTIVE_SUMMARY.md](22_EXECUTIVE_SUMMARY.md) — the complete picture in one document.*
