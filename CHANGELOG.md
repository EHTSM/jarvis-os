# Ooplix Changelog

## [3.0.0] — 2026-06-18 — Public Beta

### First External Release

Ooplix is an AI-powered operating system for solo founders and small teams. This is the first version shipped to external beta users.

### What's Included

**Core Platform**
- AI runtime with task queue, agent registry, and self-healing loop
- Mission Control — create, track, and complete engineering goals end-to-end
- CRM — lead pipeline with WhatsApp and Telegram follow-up automation
- Billing integration — Razorpay payment links, webhooks, trial management

**Developer Workspace (Electron)**
- CodeMirror 6 editor with syntax highlighting for 20+ languages
- File Explorer with create/rename/delete via right-click context menu
- Integrated terminal (PTY)
- Visual Git — stage, commit, branch, diff, and rollback with mission tracking
- AI Pair Programming — explain, refactor, generate, review with right-click

**Engineering Pipeline (I7/I8)**
- Autonomous 11-stage engineering pipeline (goal → patch → build → test → review → commit)
- Autonomous deployment with health verification and auto-rollback
- 5 quality gates with operator approval workflow

**Business OS (B1–B5)**
- Entity model: Contacts, Companies, Deals, Tasks, Interactions
- 5 automation templates (lead nurture, deal pipeline, follow-up sequences)
- 11 intelligence rules with confidence scoring
- External integrations: WhatsApp, Telegram, Razorpay, email, calendar, webhooks

**Multi-Agent Collaboration (I4–I6)**
- 10 specialized agents (planner, reviewer, verifier, strategist, etc.)
- Handoff chains, parallel execution groups, approval gates
- Real-time collaboration dashboard

**Knowledge Graph (Q1–Q2)**
- 15 node types, 18 relation types
- Graph reasoning: impact simulation, dependency analysis, recommendations

### Known Limitations (Beta)

- macOS arm64 build only (Apple Silicon). Intel Mac and Windows builds available but untested externally.
- `better-sqlite3` shadow-write silently disabled on architecture mismatch — JSON queue remains authoritative.
- CRM uses JSON file storage — concurrent webhook traffic may cause race conditions under high load.
- Payment webhook HMAC requires `rawBody` middleware; falls back to re-serialized JSON if absent.

### Reporting Issues

Use the **Beta Checklist** tab → "Send Feedback" button, or email: altamashjauhar@gmail.com

---

## [2.x] — Internal Releases

See git log for internal development history.
