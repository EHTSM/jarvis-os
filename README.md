<div align="center">

<br/>

```
 ██████╗  ██████╗ ██████╗ ██╗     ██╗██╗  ██╗
██╔═══██╗██╔═══██╗██╔══██╗██║     ██║╚██╗██╔╝
██║   ██║██║   ██║██████╔╝██║     ██║ ╚███╔╝
██║   ██║██║   ██║██╔═══╝ ██║     ██║ ██╔██╗
╚██████╔╝╚██████╔╝██║     ███████╗██║██╔╝ ██╗
 ╚═════╝  ╚═════╝ ╚═╝     ╚══════╝╚═╝╚═╝  ╚═╝
```

**The AI Operating System for Solo Founders & Small Teams**

*From idea to deployed product — without an engineering team.*

<br/>

[![Version](https://img.shields.io/badge/version-3.0.0-7c6fff?style=flat-square)](https://github.com/EHTSM/jarvis-os/releases)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-22c55e?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Proprietary-ef4444?style=flat-square)](LICENSE)
[![Build](https://img.shields.io/github/actions/workflow/status/EHTSM/jarvis-os/ci.yml?branch=main&style=flat-square&label=CI)](https://github.com/EHTSM/jarvis-os/actions)
[![Regression](https://img.shields.io/badge/regression-144%2F144-22c55e?style=flat-square)](tests/)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux%20%7C%20VPS-888?style=flat-square)](https://ooplix.com)
[![Security](https://img.shields.io/badge/security-responsible%20disclosure-7c6fff?style=flat-square)](SECURITY.md)

<br/>

[**Website**](https://ooplix.com) · [**Docs**](https://ooplix.com/docs) · [**Quick Start**](#quick-start) · [**API Reference**](docs/api/API_REFERENCE.md) · [**Discord**](https://discord.gg/ooplix)

</div>

---

## What is Ooplix?

Ooplix is a desktop AI operating system that lets a solo founder operate like a company of 10. You describe a goal in plain language. Ooplix plans it, executes it across multiple AI agents, and ships it — from code to deployment to customer communication.

> **It is not a chatbot. It is not a copilot. It is the operating system of your business.**

---

## Feature Overview

<table>
<tr>
<td width="50%" valign="top">

**🤖 Autonomous AI Runtime**
- Goal → plan → execute → deploy in one command
- 11-stage engineering pipeline with quality gates
- 10 specialized agents (planner, reviewer, verifier, strategist)
- Self-healing: detects failures, runs root-cause analysis, applies recovery

**💼 Business OS**
- CRM with WhatsApp + Telegram automation
- Deal pipeline with Razorpay payment links
- Automated follow-up sequences
- Real-time lead intelligence and scoring

**🖥️ Developer Workspace**
- CodeMirror 6 editor (20+ languages)
- Visual Git with mission tracking and AI commits
- AI pair programming (explain, refactor, review, generate)
- Integrated terminal (PTY)

</td>
<td width="50%" valign="top">

**📈 Growth OS**
- Email · SMS · WhatsApp campaign engine
- Audience manager with CRM sync
- Marketing automation builder (visual flows, triggers, conditions)
- 13 built-in templates + template marketplace

**🧠 Knowledge Graph**
- 15 node types, 18 relation types
- Cross-domain reasoning and impact simulation
- Dependency analysis and risk scoring

**🚀 Launch Platform**
- Product Completion Report (100-workflow audit)
- Interactive onboarding (6 role-based paths)
- Academy with 4 learning paths and 6 badges
- Referral system with credit rewards

</td>
</tr>
</table>

---

## Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                        Electron 41 Shell                          │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                     React 18 Frontend                        │ │
│  │  Mission · CRM · Dev Workspace · Growth · Analytics · Git   │ │
│  └─────────────────────────┬────────────────────────────────────┘ │
│                            │ IPC bridge / HTTP                    │
│  ┌─────────────────────────▼────────────────────────────────────┐ │
│  │              Express 5 Backend  (port 5050)                  │ │
│  │                                                              │ │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────┐  │ │
│  │  │ AI Runtime│  │Business OS│  │ Growth OS │  │ Launch  │  │ │
│  │  │ + Agents  │  │ CRM/Deals │  │Email/SMS  │  │Platform │  │ │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └────┬────┘  │ │
│  │        └──────────────┼──────────────┼──────────────┘       │ │
│  │  ┌──────────────────────────────────────────────────────┐    │ │
│  │  │       JSON Persistence (data/)  +  SQLite WAL        │    │ │
│  │  └──────────────────────────────────────────────────────┘    │ │
│  └──────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘

  External: Groq · OpenAI · Anthropic · Razorpay · WhatsApp Cloud · Telegram
```

| Layer | Technology |
|---|---|
| Desktop | Electron 41.4.0 |
| Frontend | React 18.2.0 |
| Backend | Node.js 20 · Express 5.2.1 |
| Database | SQLite (WAL) + JSON flat files |
| AI | Groq · OpenAI · Anthropic (smart router + fallback chain) |
| Process manager | PM2 (fork mode) |
| Deployment | Ubuntu 22/24 · Nginx · Let's Encrypt |
| Payments | Razorpay |
| Messaging | WhatsApp Cloud API · Telegram Bot API |

---

## Quick Start

### Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **npm 9+**
- A free API key from [Groq](https://console.groq.com)

### Local Development

```bash
# 1. Clone
git clone https://github.com/EHTSM/jarvis-os.git
cd jarvis-os

# 2. Install
npm install
npm install --prefix frontend

# 3. Configure
cp .env.production.example .env
# Edit .env — at minimum set GROQ_API_KEY and generate JWT_SECRET:
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"

# 4. Generate operator credentials
node scripts/generate-password-hash.cjs yourpassword
# Paste OPERATOR_PASSWORD_HASH into .env

# 5. Start
npm start                 # backend on :5050
npm run electron:dev      # desktop app (separate terminal)
```

### VPS Production Deployment

```bash
# On Ubuntu 22.04 — as root
git clone https://github.com/EHTSM/jarvis-os.git /opt/jarvis-os
cd /opt/jarvis-os

# First-time setup (Node, PM2, nginx, firewall)
bash deploy.sh --setup

# Configure SSL + domain
bash deploy/https-setup.sh app.yourdomain.com

# Deploy
bash deploy.sh

# Validate
bash deploy/validate-production.sh
```

See [docs/guides/DEPLOYMENT.md](docs/guides/DEPLOYMENT.md) for the complete guide.

---

## Tests

```bash
npm run test:runtime     # 144 regression checks (50 suites)
npm run test:api         # API smoke tests
bash deploy/validate-production.sh   # 30-point production validation
```

---

## Documentation

| Guide | |
|---|---|
| [Quick Start](docs/guides/QUICK_START.md) | Up and running in 5 minutes |
| [Deployment Guide](docs/guides/DEPLOYMENT.md) | VPS · nginx · SSL · PM2 |
| [Configuration Reference](docs/guides/CONFIGURATION.md) | All environment variables |
| [API Reference](docs/api/API_REFERENCE.md) | 100+ REST endpoints |
| [Plugin SDK](docs/api/PLUGIN_SDK.md) | Build custom integrations |
| [Architecture Overview](docs/architecture/OVERVIEW.md) | System design |
| [FAQ](docs/faq/FAQ.md) | Common questions |
| [Academy](docs/academy/README.md) | Learning paths |

---

## Roadmap

| Status | |
|---|---|
| ✅ Shipped | AI Runtime · Mission Control · CRM · Billing · Dev Workspace |
| ✅ Shipped | Business OS · Knowledge Graph · Multi-Agent Collaboration |
| ✅ Shipped | Growth OS · Launch Platform · Founder Journal · ACP-12 |
| ✅ Shipped | Production deployment infrastructure (OP-1) |
| 🔄 Active | Closed Beta — first 100 users |
| 📋 Planned | Mobile app (Android — APK ready) |
| 📋 Planned | Team accounts (multi-seat, RBAC) |
| 📋 Planned | Public plugin marketplace |
| 📋 Planned | White-label / API-only mode |

---

## Security

Found a vulnerability? Please read [SECURITY.md](SECURITY.md) and use our responsible disclosure process. **Do not open a public GitHub issue for security vulnerabilities.**

---

## Contributing

We welcome contributions. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

---

## License

Copyright © 2026 **ALWALIY TECHNOLOGIES PRIVATE LIMITED** · All rights reserved

This software is proprietary. See [LICENSE](LICENSE) for terms.

---

<div align="center">

Built with ♥ by [ALWALIY TECHNOLOGIES](https://ooplix.com/about) · [ooplix.com](https://ooplix.com) · [support@ooplix.com](mailto:support@ooplix.com)

</div>
