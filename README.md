# Jarvis OS

Jarvis is a hardened, operator-first Control Center and robust task execution platform. It has evolved from an experimental AGI orchestrator into a strict, synchronous, and highly observable production runtime.

## Authoritative Documentation

To understand the actual, current operational state of Jarvis, you **must** refer to the following root documents:

1. [**Project Status**](PROJECT_STATUS.md): An instant map of what is active, what is optional, and what has been archived.
2. [**Current Runtime Architecture**](CURRENT_RUNTIME_ARCHITECTURE.md): The definitive guide to the active execution flow, task queue, and safe-exec boundaries.
3. [**Runtime Boundaries**](RUNTIME_BOUNDARIES.md): The strict architectural lines separating the core system from optional plugins and legacy code.
4. [**AI Assistant Guide**](AI_ASSISTANT_GUIDE.md): Critical instructions for any AI (Claude, GPT, etc.) interacting with this codebase to prevent documentation drift.

## Documentation Folders

The `docs/` directory has been reorganized to prevent confusion:
- `docs/current/`: Active deployment guides, architecture diagrams, and operator manuals.
- `docs/archive/`: Historical architecture, previous cleanup reports, and legacy AGI experiment documentation. *(Note: All files here are marked with a LEGACY warning header).*
- `docs/experimental/`: Documentation related to isolated or upcoming plugins.

## Quick Start

If you are looking to deploy or run the active system, please see the [Clean Deployment Guide](docs/current/CLEAN_DEPLOYMENT_GUIDE.md) or the [Production Boot Flow](docs/current/PRODUCTION_BOOT_FLOW.md).
