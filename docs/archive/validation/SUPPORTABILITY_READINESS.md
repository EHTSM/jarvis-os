# SUPPORTABILITY_READINESS.md

## Beta Operator Guide
- Introduction, first-run steps, core actions.
- Clear success and error toast messages.
- All actions have visible feedback.

## Troubleshooting Checklist
- Check health dot and reconnect banner.
- Review error toast logs via Logs tab.
- Verify JWT persists via cookie on refresh.
- Verify queue updates after task dispatch.

## Incident Recovery Flow
- Identify failure via toast or banner.
- Use manual retry button for reconnect.
- Cancel pending tasks via Cancel button.
- Restore from backup if needed (see ROLLBACK_RECOVERY_CHECKLIST.md).

## Common Failure Explanations
- Price validation error → missing ₹ symbol.
- Reconnect delay >30 s → network reconnection issue.
- Duplicate dispatch prevented by busy flag.

## Recovery Escalation
1. Operator self‑resolve via steps above.
2. Support via security@jarvis-os.example.com.
3. Full rollback via ROLLBACK_RECOVERY_CHECKLIST.md.

All support flows preserve operator authority and deterministic behavior.

## Findings
- The Beta Operator Guide is 24 pages, causing information overload.
- The troubleshooting checklist is a live Google Doc, not easily discoverable.
- Incident flowchart rendering fails on the internal wiki.
- Failure explanations are scattered across code comments.
- Escalation contacts are maintained separately in Confluence.


## Recommendations (Minimal Impact)
- Trim the Operator Guide to ≤ 8 pages, focusing on UI navigation, emergency stop, and where to find help.
- Create a markdown checklist (`SUPPORTABILITY_CHECKLIST.md`) and link it from the Help tooltip.
- Export the incident flowchart as a static PNG and embed it in the guide.
- Gather failure explanations into a one‑page cheat‑sheet (`FAILURE_EXPLANATIONS.md`).
- Add a “Contact Support” section at the bottom of the Beta Operator Guide with direct Slack links and phone numbers.
