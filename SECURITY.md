# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.0-rc1 (current, per package.json) | ✅ Active security support |
| Earlier pre-release tags | ❌ End of life |

This table previously claimed a "3.x" current version that does not match `package.json`. Corrected 2026-08-23 (Mission 38) to match `package.json`'s real version string exactly. We release security patches for the current version only. If you are running an older tag, upgrade before reporting.

---

## Responsible Disclosure

We take security seriously. If you discover a vulnerability in Ooplix, please report it responsibly.

### How to report

**Email:** [security@ooplix.com](mailto:security@ooplix.com)

Include in your report:
- A description of the vulnerability
- Steps to reproduce
- The potential impact
- Your recommended fix (optional)
- Whether you want credit in the advisory

We will acknowledge your report within **48 hours** and provide a resolution timeline within **5 business days**.

### Please do NOT

- Open a public GitHub issue for security vulnerabilities
- Disclose the vulnerability publicly before we have had a chance to patch it
- Exploit the vulnerability in production systems
- Access, modify, or delete data belonging to other users

### Safe harbour

We will not pursue legal action against researchers who:
- Report vulnerabilities in good faith through the process above
- Do not access or exfiltrate user data beyond what is needed to demonstrate the issue
- Do not disrupt service availability
- Give us reasonable time to fix before public disclosure

---

## Security Architecture

### Authentication
- JWT tokens with configurable secret (`JWT_SECRET` — min 32 bytes enforced)
- bcrypt password hashing (cost factor 12)
- HttpOnly, SameSite=Strict cookies
- All operator API routes gated by `requireAuth` middleware
- Rate limiting: auth routes limited to 10 requests/minute per IP

### Data Protection
- Production secrets belong in `.env` only — never committed to source control
- `.env` itself is gitignored at the repository root and has never been committed
- **Known past incident:** a live-format Razorpay key pair and a Firebase web API key were pasted into tracked markdown documentation files (not `.env`) during earlier launch-readiness audits. Found and redacted 2026-08-05 (see Disclosure History below) — the Razorpay key was independently confirmed dead (401 from Razorpay's live API) before and after redaction. Docs must never contain literal credential values going forward; use a placeholder and point to `.env.example` or this file instead.
- Webhook HMAC verification for Razorpay (`RAZORPAY_WEBHOOK_SECRET`)
- Webhook verification token for WhatsApp (`WA_VERIFY_TOKEN`)

### Network
- Nginx: TLSv1.2+1.3 only, HSTS (63 million seconds), OCSP stapling
- Firewall: UFW with only ports 22, 80, 443 open; port 5050 never exposed externally
- Security headers: X-Frame-Options DENY, X-Content-Type-Options nosniff, CSP, Referrer-Policy

### Infrastructure
- PM2 runs as non-root `jarvis` user
- `DISABLE_X_POWERED_BY=1` removes Express version header
- Operator audit trail logged for all privileged actions

### Known Limitations

| Area | Status |
|---|---|
| SSO / OAuth provider login | Not implemented — JWT only |
| 2FA | Not implemented in v3 |
| End-to-end encryption for stored data | Not implemented |
| SOC 2 / ISO 27001 | Not certified (planned for enterprise tier) |

---

## Security Checklist for Self-Hosters

Before going live, verify:

- [ ] `JWT_SECRET` is at least 32 random bytes
- [ ] `OPERATOR_PASSWORD_HASH` is set (not default)
- [ ] `.env` has permissions `600` (`chmod 600 .env`)
- [ ] Port 5050 is NOT open in your firewall (nginx handles all external traffic)
- [ ] `RAZORPAY_WEBHOOK_SECRET` is set if using payments
- [ ] `NODE_ENV=production` is set
- [ ] HTTPS is configured (`BASE_URL` starts with `https://`)

Run `bash deploy/validate-production.sh` to audit all of the above automatically.

---

## Disclosure History

Internal findings from the Zero-Trust Competitor Remediation pass — no external report was received; these were found via independent code audit and confirmed by live reproduction before fixing.

| Date | Severity | Description | Status |
|---|---|---|---|
| 2026-08-05 | Critical | Shell command injection in `desktopController.cjs` (launchApp/focusWindow/openPath/clipboardWrite) — any authenticated user could execute arbitrary OS commands via unescaped string interpolation into `execSync`. | Fixed — replaced with `execFileSync(bin, argvArray)`, no shell invocation. |
| 2026-08-05 | Critical | Cross-tenant IDOR in `platformOrg.js` — any authenticated user could read/export/clone/retire any other account's private "Artificial Organization Platform" org by ID; `ownerId` was also spoofable via request body on creation. | Fixed — ownership bound server-side to `req.user.sub`, `_requireOrgOwner` gate added to all id-scoped routes. |
| 2026-08-05 | Critical/High | Cross-tenant IDOR in `workforce.js`'s `GET /workforce/org/:orgId/workers` — disclosed any org's human+AI worker roster (real account ids, org roles) to any authenticated user. | Fixed — reuses existing `attachOrg`/`requireOrgMember` middleware. |
| 2026-08-05 | Medium | Live-format Razorpay key pair and Firebase web API key committed in plaintext across 6 tracked markdown files. | Fixed — redacted from all 6 files. Razorpay key independently confirmed dead (HTTP 401) both before and after. Note: values remain in git history prior to this commit; history rewrite was not performed as part of this pass. |
| — | — | No further disclosures | — |

---

*This policy is effective as of 2026-06-01 and applies to all Ooplix software maintained by ALWALIY TECHNOLOGIES PRIVATE LIMITED.*
