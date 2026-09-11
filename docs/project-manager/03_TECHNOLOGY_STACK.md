# 03 — Technology Stack

**Status of this document:** VERIFIED against `package.json` (root, frontend, electron), `.github/workflows/`, and direct source inspection. All version numbers below are read directly from dependency manifests, not inferred.

---

## Frontend

| Component | Technology | Evidence |
|---|---|---|
| Framework | React 18.2.0 | `frontend/package.json` |
| Build tool | Create React App (`react-scripts` 5.0.1) | `frontend/package.json` scripts (`react-scripts start/build`) |
| Language | Plain JavaScript / JSX | 0 `.ts`/`.tsx` files exist in `frontend/src` despite `typescript@^4.9.5` being a listed dependency; no `tsconfig.json` anywhere in the repo. TypeScript is installed but unused. |
| Code editor component | CodeMirror 6 (`@codemirror/*` suite: commands, lang-css/html/javascript/json/markdown/python/xml, language, search, state, theme-one-dark, view) | `frontend/package.json` |
| Terminal emulator | xterm.js 5.3.0 + fit/search/web-links addons | `frontend/package.json` |
| Animation | Framer Motion 12.40.0 | `frontend/package.json` |
| Auth (web) | Firebase JS SDK 10.14.1 | `frontend/package.json`, `frontend/src/firebaseService.js` |
| Dev proxy | CRA `"proxy": "http://localhost:5050"` | `frontend/package.json` |
| Component count | 441 files under `frontend/src/components/` | Direct count |
| API wrapper files | ~29 (`api.js`, `_client.js`, `authApi.js`, `businessApi.js`, `crmApi.js`, `runtimeApi.js`, `telemetryApi.js`, `billingApi.js`, plus `phase18Api.js` … `phase27Api.js` and others) | Direct listing |

## Backend

| Component | Technology | Evidence |
|---|---|---|
| Runtime | Node.js ≥ 18 (engines field); actively developed against Node 20 | `package.json` engines, `.github/workflows/ci.yml` uses Node 20 |
| Web framework | Express **5.2.1** (not Express 4 — several stale internal docs incorrectly say Express 4) | `package.json` dependencies |
| Module system | CommonJS (`"type": "commonjs"`) | `package.json` |
| HTTP client | axios 1.16.0, node-fetch 3.3.2 | `package.json` |
| Scraping | cheerio 1.2.0 | `package.json` |
| Scheduled jobs | node-cron 4.2.1 | `package.json` |
| Terminal/PTY | node-pty 1.1.0 (used by the in-app terminal and Electron; also the root cause of the current desktop-build blocker — see B17 in [02](02_CURRENT_PROJECT_STATUS.md)) | `package.json` |
| Browser automation | Playwright 1.60.0 | `package.json` |
| Messaging | node-telegram-bot-api 0.63.0; WhatsApp via raw Graph API HTTP calls (no SDK) | `package.json`, `backend/services/whatsappService.js` |
| Payments | razorpay 2.9.6 (the only payment SDK in the codebase — no Stripe/PayPal SDK present) | `package.json` |
| AI SDKs | groq-sdk 1.1.2, openai 6.34.0 — **note:** Anthropic and Gemini are supported in code but called via raw HTTP/axios, not their official SDKs; no `@anthropic-ai/sdk` or `@google/generative-ai` package is installed despite both providers being fully functional in `aiService.js` | `package.json`, `backend/services/aiService.js` |
| Auth | Hand-rolled JWT (HS256) via Node's built-in `crypto.createHmac`/`timingSafeEqual` — **no `jsonwebtoken` package**. Password hashing via `crypto.scryptSync` — **no `bcrypt` package** (contradicts `SECURITY.md`, which claims bcrypt; see [15_SECURITY.md](15_SECURITY.md)) | `backend/middleware/authMiddleware.js`, `backend/routes/auth.js` |
| Rate limiting | Custom in-memory limiter (`backend/middleware/rateLimiter.js`) — no `express-rate-limit` package | `package.json` (absent), source read |
| CORS | `cors` 2.8.6, allowlist-based | `package.json`, `backend/server.js` |

## Database

| Layer | Technology | Evidence |
|---|---|---|
| Primary persistence | **Flat JSON files** — 408 top-level files + 18 subdirectories under `/data`, one independent JSON store per subsystem | Direct count of `data/` |
| Relational/embedded DB | SQLite via `better-sqlite3` 12.10.0, WAL mode — used narrowly for a single `tasks` table (task queue) + `migration_log` table | `backend/db/sqlite.cjs` |
| No general-purpose DB | Confirmed absent: no MongoDB/Mongoose, no PostgreSQL/`pg`, no Sequelize/Prisma/TypeORM | grep across `package.json` and `backend/` |

**This is the single most consequential architectural fact in the stack**: there is no database-enforced multi-tenant isolation boundary. See [02_CURRENT_PROJECT_STATUS.md](02_CURRENT_PROJECT_STATUS.md) blocker B2 and [19_RISK_REGISTER.md](19_RISK_REGISTER.md) R2.

## AI

12 providers implemented as adapter functions in `backend/services/aiService.js` (906 lines), each making direct HTTP calls (no SDK dependency for most):

| Provider | Live-credentialed today? |
|---|---|
| Groq | Yes — `GROQ_API_KEY` present, live-CONNECTED |
| OpenAI | Yes — `OPENAI_API_KEY` present, live-CONNECTED |
| Anthropic (Claude) | Code-ready, no key in this environment |
| Google Gemini | Code-ready, no key in this environment |
| OpenRouter | Code present — an independent audit (`AI_PROVIDER_AUDIT.md`) found this provider not fully working as of its writing |
| DeepSeek, Together, Fireworks, Cohere, NVIDIA | Code-ready, no key in this environment |
| Ollama, LM Studio | Local-runtime providers, no key needed, require the local service running |

Routing: `_providerOrder()` builds a fallback chain (`LLM_PROVIDER` env var promotes one provider to first position), `callAI()`/`chat()` iterate the chain on failure. `routeByCapability()` maps task types (reasoning, coding, fast, cheap, creative, analysis) to a preferred provider order. Tool/function-calling is implemented natively for 4 providers (OpenAI, OpenRouter, Claude, Gemini). See [07_AI_CAPABILITIES.md](07_AI_CAPABILITIES.md) for full detail, including a documented, code-verified bug where the `LLM_PROVIDER` env var and per-request `opts.model` overrides are not fully respected by the routing logic (`AI_PROVIDER_AUDIT.md`).

## Electron (Desktop)

| Component | Technology | Evidence |
|---|---|---|
| Version | Electron ^41.4.0 | `package.json` devDependencies |
| Builder | electron-builder ^25.1.8 | `package.json` |
| Entry point | `electron/main.cjs` (1,633 lines) — a legacy `electron/main.js` also exists but is not the declared entry point | `package.json` `"main"` field |
| Native modules | node-pty, better-sqlite3 (asar-unpacked; everything else packed into `app.asar`) | `package.json` build config |
| Security posture | `contextIsolation: true`, `nodeIntegration: false` on all windows, filesystem IPC allowlist, external-navigation guard, restrictive permission handler | `electron/main.cjs` |
| Targets | macOS (dmg, arm64+x64), Windows (nsis, x64), Linux (AppImage, x64) | `package.json` build config |
| **Current build status** | **Broken** — `node-pty`'s native module rebuild hangs indefinitely during `electron-builder` packaging on all 3 platforms, reproduced in both real CI and locally. No installer has ever been successfully produced by the real pipeline. | `RELEASE_BLOCKERS.md` B17 |

## Infrastructure & Deployment

| Layer | Technology | Evidence |
|---|---|---|
| Process manager | PM2 (fork mode, single instance — explicitly not cluster-safe per in-process singletons) | `ecosystem.config.cjs` |
| Reverse proxy | nginx (TLS 1.2/1.3, HSTS, per-zone rate limiting) | `nginx.conf` |
| TLS | Let's Encrypt / certbot | `deploy/setup-vps.sh` |
| Target OS | Ubuntu 22.04/24.04 | `deploy/setup-vps.sh` |
| Containerization | Docker (`Dockerfile.production`, `docker-compose.prod.yml`) — well-built but **not the actual production path**: zero references in CI, only ever touched in a single historical commit, never proven by a real build in any audited environment | Source read, `git log`, CI grep |

See [14_INFRASTRUCTURE.md](14_INFRASTRUCTURE.md) for full deployment detail.

## DevOps / CI

| Component | Technology | Evidence |
|---|---|---|
| CI | GitHub Actions — `.github/workflows/ci.yml` (Security Audit, 144-check Regression Suite, Frontend Build, deploy-script syntax/shellcheck, production-validation warn-pass) | Direct read |
| Release | GitHub Actions — `.github/workflows/release.yml`, triggers on `v[0-9]*.[0-9]*.[0-9]*` tags, packages a server tarball for VPS deployment | Direct read |
| No CI Docker build | Confirmed — zero Docker references in either workflow | grep |
| No CI auto-deploy | Confirmed — CI builds and packages artifacts only; deployment to the VPS is a manual operator step (`npm run deploy:update`) | Direct read |

## Testing

| Layer | Technology | Evidence |
|---|---|---|
| Test runner | Node's built-in `node --test` (no Jest/Mocha as a direct root dependency; CRA brings its own Jest for frontend `npm test`, unused directly by this project's test scripts) | `package.json` scripts |
| Test suite scale | 201 files across 13 subdirectories (`tests/smoke`, `security`, `integration`, `runtime`, `workflows`, `legacy`, `burnin`, `stability`, `profiling`, `evaluation`, `chaos`, `operator`, `stress`) | Direct count |
| Headline regression suite | `npm run test:runtime` — 8 files, asserted at **144/144 passing** in CI (`tests 144, pass 144, fail 0`) | `.github/workflows/ci.yml`, `docs/current/phase7-9-performance-devops.md` |
| Security-specific tests | Only 2 files (`tests/security/`) — narrowly scoped to injection attacks and WhatsApp webhook auth | Direct count |
| Browser E2E | Playwright — used both for the test suite and for ad hoc verification scripts (`verify_module8.js`/`verify_module8b.js` in repo root, currently untracked) | Direct read |

## Security Libraries

No `helmet` package — security headers (CSP with per-request nonce, HSTS, X-Frame-Options, etc.) are hand-rolled middleware in `backend/server.js`. No `express-rate-limit` — custom in-memory limiter. No `jsonwebtoken` — hand-rolled JWT. No `bcrypt`/`bcryptjs` — `crypto.scryptSync`. This is a consistent pattern across the codebase: security-critical primitives are implemented directly against Node's `crypto` module rather than via third-party security packages. See [15_SECURITY.md](15_SECURITY.md) for the implications.

## Languages

| Language | Scope |
|---|---|
| JavaScript (CommonJS `.cjs` + `.js`) | Backend, agents runtime, most services |
| JavaScript (JSX) | Frontend components |
| TypeScript | Installed as a frontend dependency, **entirely unused** (0 files) |
| Dart | `flutter/` directory exists — a separate mobile client (see [Mobile App Module memory](../../.claude — not part of this web/desktop stack) |
| Shell | 32 `.sh` scripts (`deploy/`, root-level setup/backup scripts) |

---

*Next: [04_SYSTEM_ARCHITECTURE.md](04_SYSTEM_ARCHITECTURE.md) for how these pieces fit together.*
