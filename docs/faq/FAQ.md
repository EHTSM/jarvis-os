# Frequently Asked Questions

## General

**What is Ooplix?**
Ooplix is an AI operating system for solo founders and small teams. It combines a developer workspace, CRM, billing, growth marketing, and autonomous AI agents in one desktop app.

**Is Ooplix open source?**
The core platform is proprietary. We are evaluating open-sourcing specific modules. The Plugin SDK is documented so you can build integrations.

**What AI models does Ooplix use?**
Ooplix uses a smart router with a fallback chain: Groq (primary, fastest), OpenAI (secondary), Anthropic (tertiary). You can bring your own keys (BYOK) and the credit system adapts accordingly.

**Does Ooplix work offline?**
Partially. The editor, Git, and file system features work offline. AI features require an internet connection to reach the model APIs.

---

## Installation

**What are the minimum requirements?**
- Node.js 20+ 
- 2 GB RAM (4 GB recommended for the Electron desktop app)
- Any modern OS: macOS 12+, Windows 10+, Ubuntu 20+

**Do I need a VPS to use Ooplix?**
No. Ooplix runs fully locally on your laptop via Electron. The VPS deployment is for serving the web app to your customers or team.

**Can I run Ooplix on Windows?**
Yes. The backend (Node.js) and Electron app both run on Windows. The deploy scripts are bash — for VPS deployment use Ubuntu.

---

## Authentication

**How do I reset my password?**
Regenerate credentials: `node scripts/generate-password-hash.cjs newpassword` and update `OPERATOR_PASSWORD_HASH` in `.env`, then restart the server.

**Can I have multiple operator accounts?**
Multi-user support is in development. Currently Ooplix supports a single operator account plus workspace members with restricted access.

**What happens if JWT_SECRET changes?**
All existing sessions are invalidated. Users must log in again. Change `JWT_SECRET` only if you believe it has been compromised.

---

## AI & Credits

**How does the credit system work?**
Credits are consumed per AI request. Trial accounts start with 500 credits. Paid plans include monthly credits. You can topup via the billing panel or earn credits through referrals.

**What is BYOK (Bring Your Own Key)?**
If you set `GROQ_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`, AI calls use your key directly and do not consume Ooplix credits.

**Which AI provider is fastest?**
Groq is significantly faster than OpenAI for most tasks (typical response: 0.3–1.5s vs 2–5s). Set `GROQ_API_KEY` for the best experience.

---

## Payments & Billing

**Which payment providers are supported?**
Razorpay (primary, India). Stripe integration is planned for international cards.

**Can I disable payments?**
Yes. Set `DISABLE_PAYMENTS=true` in `.env`. The billing UI remains visible but payment link creation is disabled.

**How do Razorpay webhooks work?**
Set `RAZORPAY_WEBHOOK_SECRET` in your Razorpay dashboard and in `.env`. Ooplix verifies HMAC signatures on every webhook. Without this, payment confirmations may be rejected in production.

---

## Deployment

**What VPS specs do I need?**
- 1 vCPU + 2 GB RAM minimum (DigitalOcean Basic $12/month or equivalent)
- 20 GB SSD (data grows slowly — mostly JSON)
- Ubuntu 22.04 LTS recommended

**How do I update to a new version?**
```bash
cd /opt/jarvis-os && bash deploy/update.sh
```
This pulls the latest code, installs deps, rebuilds frontend, and hot-reloads PM2 (zero downtime).

**How do I back up my data?**
```bash
npm run backup
```
Creates a timestamped `tar.gz` in `backups/`. The PM2 ecosystem config includes a daily automated backup at 02:00.

---

## Troubleshooting

**Server starts but health check fails**
Check logs: `pm2 logs jarvis-os`. Common causes: missing `GROQ_API_KEY`, `PORT` already in use, `.env` not found.

**WhatsApp messages not sending**
Verify `WA_TOKEN` and `WA_PHONE_ID` are set. The token expires every 60 days — rotate it in the Meta developer console.

**Nginx returns 502 Bad Gateway**
The backend is not running. Check: `pm2 status jarvis-os` and `pm2 logs jarvis-os`.

**Frontend shows blank white page**
Rebuild: `npm run build:frontend`. If using a CDN, clear the cache.

---

*Can't find an answer? Join [Discord](https://discord.gg/ooplix) or open a [GitHub Discussion](https://github.com/EHTSM/jarvis-os/discussions).*
