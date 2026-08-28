# 11 — Mission & Automation (Phase 5/1 detail)

## Mission OS

Real lifecycle (`missionOrchestrator.cjs`, `agents/executor.cjs`, `/mission/*`,
`/missions/*`). Two honesty fixes confirmed: `success: !!reply` previously
treated an AI-unavailable sentinel string as success (truthy non-empty
string); 4 stage-monitor branches recorded stage success on unobserved
outcomes.

**Open P0/HIGH, most severe of the three top cross-tenant findings in this
audit**: cross-tenant mission read **and cancel** (a destructive write) —
Tenant A was able to enumerate, read, cancel, and pause/resume a different
tenant's running mission, because `data/missions.json` (2,124 records) has no
ownership field at the data-model level. This is distinct from, and deeper
than, the route-level IDOR that Mission 51's `assertOwnable` fix closed (see
`09_TENANT_ISOLATION.md`) — even a caller who correctly passes the
route-level ownership check on an orgId-less mission can still act on any
mission ID system-wide, since the majority of missions have no orgId to check
against in the first place. Not fixed. Also documented: a lost-update race in
`missionMemory.cjs` causing roughly 58% of a sampled window of missions to
have no history record (404s for missions that genuinely executed).

## Automation OS

`automationService.cjs` (`/automation/*`) + `orgAutomationCenter.cjs`
(`/org-automation/:orgId/*`) + `orgAutomationScheduler.cjs` (real `node-cron`
dispatcher — confirmed via direct read to genuinely match rules against the
current minute using `node-cron`'s own parser, not a stub).

**Empirically measured, not assumed**: only 2 of 6 declared trigger types
(`manual`, `schedule`) have a real dispatcher. `event`/`threshold`/`webhook`
accept validation but never fire. The approval-gate block itself is real, but
the resume half (approve→execute) does not exist anywhere —
`automation:approval:required` is emitted with zero subscribers. This
Automation→Trigger→Runtime flow is the one cross-OS flow the OS-layer
register itself explicitly names as an unfixed "GENUINE GAP," correctly left
unbuilt pending a trigger-model product decision rather than silently claimed
working (see `24_OS_INTEGRATION_MATRIX.md`).

One real fix confirmed in this layer (`AUTO-1`): the 4th confirmed occurrence
of the `security.js`/`admin.js` accidental unscoped-middleware bleed-through
root cause identified across multiple OS passes (see `03_OOPLIX_OS_MAP.md`'s
cross-cutting section).

## n8n/Zapier comparison

Ooplix's own scheduler is real and comparably robust to n8n's core scheduler
at the execution layer, but has no visual workflow-authoring UI (confirmed
still absent as of a 2026-06 spec document that called it "Coming Soon," and
no visual builder component was found built since). See
`23_PRODUCT_REPLACEMENT_MATRIX.md` for the full n8n/Zapier replacement
analysis (YELLOW/RED respectively).

## Verdict

Both layers have real, working core execution mechanics with genuine
production-incident-driven hardening (autonomous loop safety caps, race
serialization in tests). Automation's trigger-type gap and Mission's
unresolved cross-tenant cancel are the two most consequential open items —
the Mission OS one in particular should be treated as a release blocker for
any multi-tenant production claim, since it permits a destructive
cross-tenant write, not merely a read.
