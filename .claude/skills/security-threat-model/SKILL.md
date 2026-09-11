---
name: security-threat-model
description: Produce a structured, repo-grounded threat-model report (trust boundaries, assets, abuse paths) for a named JARVIS subsystem, in this repository's own audit-mission report format. Use when asked to threat-model, security-audit, or certify a specific subsystem or route family. Adapted from OpenAI's security-threat-model skill (openai/skills, Apache-2.0) but restructured to match this repo's existing reports/ convention rather than importing a separate format.
metadata:
  source: "adapted from openai/skills (security-threat-model)"
  license-note: "Instructional pattern/technique only; no vendor script copied. Original is Apache-2.0."
---

# Security Threat Model (JARVIS-native format)

Produce a threat-model analysis of a named subsystem, using this repository's
own established report shape (CLAUDE.md §15) rather than a separate,
competing format — this repo already has ~40 prior audit-mission reports
using one consistent structure; this skill standardizes the threat-modeling
*section* of that structure rather than introducing a second one.

## When to use this

- The user asks to "threat-model," "audit," or "certify" a specific
  subsystem, route family, or feature.
- As a structuring aid for the methodology already required by CLAUDE.md §14
  (trace real code path → prove findings live → smallest existing-pattern fix
  → negative-test → stay in scope).

## Structure to produce

1. **Trust boundaries** — enumerate where untrusted input enters the named
   subsystem (HTTP request body/headers/params, file uploads, webhook
   payloads, SSO/OIDC claims) and where it crosses into a more-trusted
   context (route handler → service → database/vault).
2. **Assets** — what this subsystem can read or modify that would matter if
   compromised (credentials via `secretVault.cjs`, other tenants' data via
   `orgId`/`primaryOrgId`, session/JWT issuance, financial data via
   `razorpay`/billing routes, etc.).
3. **Abuse paths** — concretely, per CLAUDE.md §6's own established finding:
   check every sibling route in the same functional family for consistent
   auth/tenant-scoping middleware first (this is the single most-repeated
   real defect class found in this repo's own audit history — an unscoped
   SSE stream, an unscoped operator-only route, an unscoped Firebase/Google/
   Phone login route bypassing org MFA policy, all previously found and
   fixed this exact way). Also check: forged/spoofed header-based org
   resolution (should be structurally impossible — `primaryOrgId` must always
   be server-resolved, never client-supplied, per CLAUDE.md §6), and
   privilege-escalation via a role check missing on a mutation route
   (`operatorOnly` present on siblings but absent here).
4. **Live verification** — per CLAUDE.md §14, prove abuse paths with a real
   HTTP call against a fresh ordinary test account where safe, not just
   static reading.
5. **Findings table** — matching the existing report convention: CONFIRMED/
   PLAUSIBLE, severity, fixed/deferred/decision-required.

## Output format

Match CLAUDE.md §15's existing shape: STATUS, SCORE, CONFIDENCE, inventoried
files/routes, findings, live verification, regression before/after, `.env`
status, merge/push/commit status, limitations. Do not invent a new report
template — extend the existing one.

## What this must never do

- Never introduce a second, parallel report format alongside the existing
  `reports/` convention — this skill exists specifically to standardize the
  threat-modeling *section*, not to replace the whole report shape.
- Never expand a scoped subsystem audit into adjacent subsystems mid-mission,
  per CLAUDE.md §14's "stop after the scoped mission" rule.
- Never mark a finding "fixed" without a negative test (revert → reproduce →
  restore → reconfirm), per CLAUDE.md §14.
- Never touch `.env`, rotate credentials, or commit/push/merge as part of
  producing a threat-model report, per CLAUDE.md §19/§20.
