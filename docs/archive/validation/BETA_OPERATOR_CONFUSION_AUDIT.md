# BETA_OPERATOR_CONFUSION_AUDIT.md

## Objective
Identify points where a beta operator may become confused or make mistakes while using Jarvis, without proposing fixes.

## Findings

### 1. Onboarding Flow
- **Three free‑form fields** (business, product, price) provide only placeholder examples. No inline validation or required format hints.
- **Currency ambiguity** – the placeholder shows `₹999` but the field accepts any string; operators may omit the symbol, causing downstream pricing errors.
- **Back navigation** – the “← Back” button appears only after the first step; there is no confirmation when leaving the onboarding mid‑process, risking loss of entered data.

### 2. Navigation & Layout
- **Mobile tab bar** hides the bottom navigation when the `OperatorConsole` expands, making it hard to switch tabs on small screens.
- **Activity panel height** can push the bottom tab bar off‑screen on phones, forcing vertical scrolling just to change tabs.
- **Status indicators** – the green/red status dot and the “Reconnecting…” banner are separate; both can be visible simultaneously, confusing the true connectivity state.

### 3. Action Feedback
- **Task dispatch** shows a toast “Task queued (ID: …)” but the cancel button does not emit a toast, leaving users unsure if the cancellation succeeded.
- **Emergency stop** is a red button always present; after clicking it the UI does not show any guidance on how to resume, only a hidden “Resume” button appears when the backend reports `critical`.
- **Error toasts** display a short message with no link to the detailed log entry, making it hard for operators to locate the underlying cause.

### 4. Input Controls
- **Submit buttons** are disabled only after the async call starts; a rapid double‑click before the flag is set can send duplicate requests.
- **Login form** lacks an explicit ARIA label for the password field; screen‑reader users may not hear the purpose of the input.

### 5. Session Persistence
- **Auth token** lives only in memory; a page reload forces a full re‑login, aborting any in‑progress tasks without warning.
- **History buffer** caps at 300 entries; after a long session older events disappear, preventing operators from reviewing earlier actions.

## Summary
The beta experience presents several friction points: ambiguous onboarding inputs, overlapping connectivity signals, missing confirmation for cancellations and emergency recovery, and mobile layout constraints that can hide navigation controls. These issues are likely to cause confusion, duplicate actions, or loss of context for early users.
