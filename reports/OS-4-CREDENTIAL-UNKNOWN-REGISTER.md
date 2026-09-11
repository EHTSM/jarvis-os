# OS-4 CREDENTIAL / UNKNOWN REGISTER

Date: 2026-08-13
**`.env` untouched. No credential invented. No authentication bypassed. No UNKNOWN promoted to PASS.**

---

## UNKNOWN — operator access required (12)

Gate: `req.user.role !== "operator"` ([authMiddleware.js:88](backend/middleware/authMiddleware.js#L88)).

`OPERATOR_PASSWORD_HASH` is set. The dev passthrough in `auth.js` mints an operator token **only when that hash is unset** — verified live: operator-style login → `401 "Invalid password"`, no cookie issued. Reaching it would require editing `.env`.

| # | OS | Surface | Workflow needing verification | Missing evidence |
|---|---|---|---|---|
| 1 | Hosting | `GET /ops/infra/vps` | list hosts → inspect | is VPS data real or seeded? |
| 2 | Hosting | `GET /deployment/targets` | list → dry-run deploy | are targets real? |
| 3 | Hosting | `GET /deployment/active` | active deployments | live deployment state |
| 4 | Hosting | `GET /ops/health` | health snapshot | composition of health |
| 5 | Hosting | `GET /ops/stats` | counters | whether counters are measured |
| 6 | Hosting | `GET /ops/infra/deployment` | pipeline status | pipeline reality |
| 7 | Hosting | `GET /ops/infra/monitoring` | monitors/alerts | monitor configuration |
| 8 | Hosting | `GET /ops/infra/security` | security posture | scan results |
| 9 | Hosting | `GET /ops/infra/database` | DB + backup status | backup verification |
| 10 | Cloud | `GET /integrations` | connector list → health | the 57-connector claim |
| 11 | Cloud | `GET /integrations/summary` | per-connector status | which are live |
| 12 | Cloud | `GET /vault/dashboard`, `/vault/env/status` | secret inventory | vault health, env diff |

**Hosting 51/80 and Cloud 51/80 encode missing evidence, not proven weakness.**

---

## CREDENTIAL BLOCKED (1 new in scope)

| Capability | Blocker | Behaviour |
|---|---|---|
| Marketplace / plugins | plan tier | `402 {"error":"feature_gated","featureId":"plugins.marketplace"}` — **honest and correct** |

Carried forward from OS-3 (unchanged, out of OS-4 scope): AI quota/invalid key, `SENTRY_DSN`, SMTP, Firebase, SMS, IdP, GitHub, Stripe, Anthropic.

---

## VERIFY — evidence obtainable, not yet obtained (6)

| Capability | What is missing |
|---|---|
| Ecosystem L8 (578 tenants) | ~52% test-harness names; is this intended demo data? |
| Workspace mesh | 17 workspaces / 40 executions — real records, purpose unverified |
| Infra dashboard | byte-identical across tenants — confirm global-by-design |
| Physical / org-network dashboards | reads real; write paths unexercised |
| Extensions runtime | empty — needs a fixture |
| Distribution legacy records | 10 records, 18,780 phantom reach — purge/label decision |

---

## Explicitly not done

- ❌ `.env` not modified
- ❌ operator password not guessed, cracked, or bypassed
- ❌ dev passthrough not enabled by unsetting the hash
- ❌ no UNKNOWN converted to PASS
- ❌ no CREDENTIAL BLOCKED reclassified as a code bug
