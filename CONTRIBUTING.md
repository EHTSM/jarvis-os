# Contributing to Ooplix

Thank you for your interest in contributing. This document covers everything you need to know to make your first contribution.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Branch Strategy](#branch-strategy)
- [Commit Format](#commit-format)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Pull Request Process](#pull-request-process)
- [What We Accept](#what-we-accept)

---

## Code of Conduct

We expect all contributors to be respectful and constructive. Harassment, discrimination, or hostile behavior will not be tolerated.

---

## Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/jarvis-os.git`
3. **Add the upstream remote**: `git remote add upstream https://github.com/EHTSM/jarvis-os.git`
4. Follow [Development Setup](#development-setup)
5. Create a branch, make your change, open a PR

---

## Development Setup

### Requirements

- Node.js 20+ (`node --version`)
- npm 9+
- macOS, Linux, or WSL2 on Windows

### Install

```bash
cd jarvis-os
npm install
npm install --prefix frontend
cp .env.production.example .env
# Fill in GROQ_API_KEY and generate JWT_SECRET + OPERATOR_PASSWORD_HASH
node scripts/generate-password-hash.cjs yourpassword
```

### Run

```bash
npm start             # backend on :5050
npm run frontend      # React dev server on :3000 (separate terminal)
npm run electron:dev  # Electron app (separate terminal)
```

### Run tests

```bash
npm run test:runtime       # 144 regression checks — MUST pass before every PR
npm run test:api           # API smoke tests
```

---

## Branch Strategy

| Branch | Purpose |
|---|---|
| `main` | Production — only merged via PR, never committed to directly |
| `feature/short-description` | New features |
| `fix/short-description` | Bug fixes |
| `chore/short-description` | Dependency updates, config changes |
| `docs/short-description` | Documentation only |

**Rules:**
- Branch from `main`
- Keep branches short-lived (days, not weeks)
- One logical change per branch
- Delete branch after merge

---

## Commit Format

We use [Conventional Commits](https://www.conventionalcommits.org/). Every commit message must follow this format:

```
<type>(<scope>): <short summary>

[optional body]

[optional footer]
Co-Authored-By: Your Name <email@example.com>
```

### Types

| Type | When to use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `chore` | Build, config, dependency changes |
| `docs` | Documentation only |
| `test` | Adding or updating tests |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `ci` | CI/CD configuration |

### Scope (optional)

Use the affected module: `auth`, `crm`, `runtime`, `frontend`, `growth`, `billing`, etc.

### Examples

```
feat(growth): add SMS campaign scheduling with delay support
fix(auth): prevent JWT replay on logout within token TTL window
docs: add WhatsApp webhook setup to deployment guide
test(runtime): add regression for emergency-stop race condition
chore: bump express from 5.2.0 to 5.2.1
```

### Rules

- **Summary line:** max 72 characters, imperative mood, no period
- **Body:** explain WHY, not what (the diff shows what)
- **Breaking changes:** add `BREAKING CHANGE:` in footer

---

## Coding Standards

### JavaScript / Node.js

- CommonJS (`require`/`module.exports`) for all backend files
- New backend services must use `.cjs` extension
- `"use strict"` at the top of every backend file
- No `var` — use `const` and `let`
- Prefer `async/await` over raw promise chains
- All API routes must use `requireAuth` middleware
- Use `_account(req)` helper for account ID extraction
- No `console.log` in production code — use the logger utility

### Express routes

```js
"use strict";
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

router.use(requireAuth);

router.get("/resource", (req, res) => {
  try {
    res.json({ ok: true, data: getSomeData() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
```

### React / Frontend

- Functional components only (no class components)
- `const BASE = process.env.REACT_APP_API_URL || ""` for all API calls
- All fetches use `credentials: "include"`
- No `window.confirm()` — use the `useConfirm()` hook from `ConfirmDialog.jsx`
- New panels added to `BOTTOM_TABS` in `ElectronWorkspace.jsx`
- New routes added to `NAV_ACTIONS` in `CommandPalette.jsx`
- CSS co-located with component (`ComponentName.css`)

### Data persistence

- All data stored in `data/*.json` — no new databases
- New services write to a named file in `data/`
- Load with try/catch and return a sensible default on file-not-found
- Never write secrets to `data/`

### No-go list

- No `window.alert()`, `window.confirm()`, `window.prompt()`
- No synchronous `fs` operations in request handlers (use async or move to startup)
- No hardcoded API keys or credentials anywhere in source
- No `eval()` or `Function()` constructor
- No new runtime engines, schedulers, or message queues — reuse existing subsystems

---

## Testing

Every PR must pass the full regression suite:

```bash
npm run test:runtime   # must output: pass 144, fail 0
```

If you add a new route or service, add a corresponding test in `tests/runtime/`.

Test file naming: `tests/runtime/your-feature.test.cjs`

Test structure:

```js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("GET /your/route returns 401 without auth", async () => {
  const res = await fetch("http://localhost:5050/your/route");
  assert.strictEqual(res.status, 401);
});
```

---

## Pull Request Process

1. **Pass tests** — `npm run test:runtime` must show `pass 144, fail 0`
2. **Build frontend** — `npm run build:frontend` must succeed with no errors
3. **Fill the PR template** — all checkboxes, screenshots if UI changed
4. **One logical change** — split unrelated changes into separate PRs
5. **Reference issues** — `Closes #123` or `Related to #456`

### Review criteria

- Does it break any existing functionality?
- Does it follow the coding standards?
- Is the commit message correctly formatted?
- Are tests included or updated?
- Is the change documented?

### Merge policy

- All PRs require at least **1 approval**
- CI must pass (build + regression)
- Squash merge is preferred for feature branches

---

## What We Accept

### Yes
- Bug fixes with a clear reproduction case
- Performance improvements with benchmarks
- Documentation improvements
- Test coverage improvements
- Accessibility fixes

### Maybe (open an issue first)
- New features that fit the existing architecture
- New integrations with external services
- UI/UX improvements to existing panels

### No
- New runtime engines, schedulers, or databases
- Breaking API changes without a migration path
- Changes that reduce test coverage
- UI libraries or large new dependencies

---

## Questions?

Open a [Discussion](https://github.com/EHTSM/jarvis-os/discussions) or join [Discord](https://discord.gg/ooplix).

For security issues, see [SECURITY.md](SECURITY.md).
