# BETA RELEASE NOTES

Version: 3.0.0-beta
Date: 2026-05-17

## Summary
This is the first controlled public beta release of Jarvis OS.
All core runtime components are frozen; only UI/UX safety fixes applied.

## Key Changes
- Added duplicate execution prevention (busy flag guard).
- Enhanced reconnect clarity with manual retry button.
- Validated onboarding price field (requires ₹ symbol).
- Improved session continuity via HTTP-only JWT cookie.
- Increased touch target size to 44px for mobile usability.
- Linked error toasts to log entries for faster debugging.
- Added guidance text after emergency stop.

## Known Limitations
- Price validation accepts any string after ₹ symbol.
- History buffer capped at 600 entries (~12 hours).
- Mobile haptic feedback unavailable on some browsers.
- Token revocation propagates only on next health check.

## Beta Testing Focus
1. Reconnect behavior under network loss.
2. Onboarding validation success and failure.
3. Mobile touch target accuracy.
4. Session persistence through page refresh.
5. Duplicate task prevention.

## Support
Refer to OPERATOR_BETA_GUIDE.md for troubleshooting.
Report issues via GitHub issues with console logs.
