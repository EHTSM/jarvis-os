# OPERATOR BETA GUIDE

## Getting Started
- Log in with your operator password (case-sensitive)
- Profile setup required: business type, product/service, pricing
- Pricing format: `₹999`, `₹5000/month`, or `₹15,000 per project`

## Key Controls
- **Emergency Stop**: Red button halts all tasks. Click "Resume" below to restore.
- **Cancel Task**: Aborts pending operations. Green toast confirms success.
- **Live Status**: Green dot = connected, red dot = offline, banner = reconnecting.

## Critical Feedback
- Success: "Task queued (ID: ...)" → task accepted
- Error: "Error: ..." → check Logs tab for details
- Cancel: No toast → click again or reload page

## Mobile Tips
- Touch targets are 44px minimum (compliant)
- Swipe between tabs to navigate
- Reconnect banner shows manual retry button

## Beta Limitations
- History limited to last 12 hours of activity
- No duplicate task prevention on very rapid clicks
- Session survives page refresh but not browser close

## Support
- For errors: check Logs tab, click error toasts to jump to details
- If stuck: click "Retry Connection" banner, refresh as last resort
- Report issues via GitHub issues with console logs

## Beta Testing Focus Areas
1. Reconnect behavior during network drops
2. Onboarding validation success/failure cases
3. Mobile usability (especially touch targets)
4. Session persistence through refresh
5. Duplicate task occurrence