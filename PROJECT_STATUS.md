# Jarvis Project Status

> [!IMPORTANT]
> **CURRENT MODE: DEPLOYMENT SAFETY**
> Focus: Production synchronization reliability and deterministic build safety.
> Avoid: Feature expansion, architecture changes, and visual redesign.

> [!NOTE]
> This document provides an instant, at-a-glance view of the operational state of all Jarvis subsystems.

## 🟢 ACTIVE PRODUCTION SYSTEMS
These systems are live, heavily tested, and relied upon for daily operations. Modifying them requires strict safety protocols.
- **Operator Dashboard (React Frontend)**: Unified Grid, SSE Telemetry, Modular Widgets (`src/components/operator/`).
- **Core HTTP API (`server.js`)**: REST and SSE endpoints.
- **Priority Task Queue (`taskQueue.cjs`)**: Sync/Async execution buffering.
- **Task Dispatcher / Executor (`executor.cjs`)**: Safe, strict routing logic.
- **Runtime Governor (`governor.cjs`)**: Memory limits and E-STOP functionality.
- **Auth System**: Basic JWT + Environment-variable password hashing.

## 🟡 OPTIONAL PLUGINS
These systems are functional but are not required for the core runtime to operate. They exist in `/plugins/`.
- **Local Desktop Control (`/plugins/local-desktop`)**: Screen capture and native interaction (requires `robotjs` peer dependency, normally omitted in headless production).
- **Voice Agent (`/plugins/voice-control`)**: Experimental speech-to-text integration.

## 🟠 EXPERIMENTAL ARCHIVES
These systems are preserved for future research but are explicitly disconnected from the active runtime execution paths. Located in `/experimental/`.
- **Evolution Runtime**: Code-mutating self-improvement loops.
- **Autonomous Research Agents**: Unsupervised web-scraping swarms.
- **Context Engine**: Vector-based long-term memory embeddings.

## 🔴 REMOVED / LEGACY SYSTEMS
These concepts have been permanently abandoned and their code deleted.
- **500-Agent Orchestration Engine**: Unsafe and unmanageable.
- **Auto-Bootstrapping Agents**: Any system that registers itself without operator approval.
- **Unsandboxed Code Generators**: All code modification must now go through a human approval step.
