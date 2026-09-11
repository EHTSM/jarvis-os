---
name: api-contract-audit
description: Audit a frontend API call (or set of calls) against its real backend route registration — method, path, params, auth, and response shape. Use when asked to check a frontend/backend contract mismatch, find dead frontend endpoints, find backend capability gaps, or verify a *Api.js file still matches its route. Repo-native, adapted from patterns studied in the Phase B multi-vendor skills audit (no single vendor skill covers this domain directly).
metadata:
  source: "repo-native — no direct vendor equivalent found in Phase B's audit (reports/MULTI-VENDOR-AGENT-SKILLS-INTELLIGENCE-AUDIT.md); informed by general code-review/API-review patterns studied there, not copied from any single skill"
  gap-closed: "Phase C validation (Part C, Scenario 2) found no installed skill matched 'review a frontend/backend API contract for mismatch' — this skill closes that confirmed gap"
---

# API Contract Audit (JARVIS-native)

Verify that a frontend API call and its real backend route agree — on method,
path, parameters, auth requirements, tenant context, and response shape —
using only what the code actually says, never assumption.

## When to use this

- The user asks to check a frontend/backend contract mismatch.
- The user asks whether a frontend `*Api.js` call still has a live backend
  route behind it (a "dead frontend endpoint" check).
- The user asks whether a backend route has any frontend consumer at all (a
  "backend capability gap" check — the route exists but nothing calls it).
- As part of a `code-review` pass (per that skill's §12-referencing check)
  when a route or its corresponding `*Api.js` file changes.

## What to trace, in order

1. **Frontend call site.** Find the exact `_fetch(path, options)` call in the
   relevant `frontend/src/*Api.js` file (per CLAUDE.md §12, these flat files
   are the established convention — do not assume a different fetch wrapper
   exists). Note the exact `path` string, HTTP `method` (default `GET` if
   `options.method` is absent — confirm this against `_client.js`'s actual
   `_fetch` implementation, do not assume), and request body shape.
2. **Backend registration.** Find the matching route in `backend/routes/`.
   Routes are mounted through the central barrel `backend/routes/index.js`
   (CLAUDE.md §10) — start there; its own `router.use(...)` lines carry
   inline comments naming the real mounted paths, which is often the fastest
   confirmation. Then open the actual target route file to confirm the exact
   method/path/handler.
3. **Path/method match.** Confirm the frontend's `path` string and method
   literally match a registered route — including any path parameters
   (`:id`, `:orgId`) and query parameters the handler actually reads via
   `req.params`/`req.query`. A frontend call to a path that doesn't exist in
   any route file is a **dead frontend endpoint** — report it as such, do not
   assume a typo's "intended" target.
4. **Auth requirements.** Check whether the route is behind `requireAuth`/
   `operatorOnly` (directly, or via a barrel-level `router.use(path,
   requireAuth)` gate, per the pattern at `backend/routes/index.js:39`) and
   whether the frontend call expects that (e.g., does it run before a
   session exists, will it correctly handle a 401). Cross-reference CLAUDE.md
   §6's rule that auth must be server-resolved, never client-supplied.
5. **Tenant/org context.** Check whether the route reads `orgId`/
   `primaryOrgId` from server-resolved session state (correct, per CLAUDE.md
   §6) versus expecting it from the frontend request body/headers/query
   (a red flag — flag it, do not assume it's intentional).
6. **Response shape.** Read the actual `res.json({...})` call(s) in the route
   handler — every field the frontend destructures from the response must
   exist in at least one real response path. **Never assume an undocumented
   field exists** because the frontend code reads it — if the handler doesn't
   send it, that's a contract bug to report, not a shape to infer and accept.
7. **Error/success convention.** Confirm the route's error responses follow
   the established `{error, code}` shape that `_client.js`'s `_fetch`
   expects (it throws an `Error` with `.status` and, if present, `.code`
   attached — see `_client.js`'s own inline comments referencing the MFA
   mission's fix for this exact convention). A route returning errors in a
   different shape (e.g. a bare string, or `{message}` instead of `{error}`)
   is a real contract bug.

## False-empty-state risk — check explicitly

Per CLAUDE.md §18, a common JARVIS pattern is:
```js
export async function getX() {
  try { return await _fetch("/x"); }
  catch { return null; }
}
```
This is **structurally unable to distinguish** "the backend legitimately
returned no data" from "the request failed" (network error, 500, auth
failure) — both collapse to the same `null`/empty return. When auditing a
`*Api.js` file, explicitly flag any catch block that swallows the error this
way without at least logging or re-surfacing a distinguishable failure state,
and check whether the calling component then renders a generic "no data"
empty state instead of an honest error state.

## Output format

Use JARVIS's existing report conventions (CLAUDE.md §15): a findings table
with file:line citations for both the frontend call site and backend route,
a CONFIRMED/PLAUSIBLE confidence label per finding (CLAUDE.md §14), and
explicit categorization of each finding as one of: **dead frontend endpoint**,
**backend capability gap** (route exists, no frontend consumer), **response
shape mismatch**, **auth/tenant mismatch**, or **false-empty-state risk**.

## What this must never do

- **Never invent a backend route that doesn't exist** to "explain" a frontend
  call — if no matching route is found after checking the barrel and the
  likely target file, report it as a dead endpoint or an open question, not
  as an assumed route.
- **Never assume an undocumented response field exists** just because the
  frontend reads it — trace the actual `res.json(...)` call; if the field
  isn't there, that's the finding.
- **Never silently treat a caught fetch failure as equivalent to legitimate
  empty data** — always distinguish and report the difference, per the
  false-empty-state section above.
- **Never modify backend routes or response shapes to match frontend
  assumptions** as part of an audit — this skill reports contract mismatches;
  fixing them (if asked) is a separate, explicitly-authorized step per
  CLAUDE.md §19/§22, and the smallest existing-pattern fix (CLAUDE.md §14)
  applies exactly as it would to any other fix.
- **Never expand the audit beyond the named endpoint(s)/file(s)** — stay
  scoped, per CLAUDE.md §14's "stop after the scoped mission" principle.
