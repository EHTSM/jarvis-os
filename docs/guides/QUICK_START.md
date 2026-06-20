# Quick Start

Get Ooplix running in under 5 minutes.

## Prerequisites

- **Node.js 20+** — [nodejs.org](https://nodejs.org)
- **npm 9+**
- A free API key from [Groq](https://console.groq.com) (takes 1 minute to get)

## 1. Install

```bash
git clone https://github.com/EHTSM/jarvis-os.git
cd jarvis-os
npm install
npm install --prefix frontend
```

## 2. Configure

```bash
cp .env.production.example .env
```

Open `.env` and set at minimum:

```env
GROQ_API_KEY=gsk_your_key_here
NODE_ENV=development
BASE_URL=http://localhost:5050
```

Generate auth credentials:

```bash
node scripts/generate-password-hash.cjs yourpassword
```

Paste the output (`JWT_SECRET` and `OPERATOR_PASSWORD_HASH`) into `.env`.

## 3. Start

```bash
# Terminal 1 — backend
npm start

# Terminal 2 — desktop app
npm run electron:dev
```

The Ooplix desktop app opens. Log in with the password you set in step 2.

## What's next?

- Read the [Deployment Guide](DEPLOYMENT.md) to put Ooplix on a VPS
- Explore the [API Reference](../api/API_REFERENCE.md)
- Join [Discord](https://discord.gg/ooplix) for help

## Troubleshooting

**Server won't start**
- Run `node scripts/check-startup-env.cjs` to validate your `.env`
- Check `logs/pm2-err.log` for errors

**Can't log in**
- Regenerate credentials: `node scripts/generate-password-hash.cjs newpassword`
- Make sure `JWT_SECRET` and `OPERATOR_PASSWORD_HASH` are both set in `.env`

**Groq API errors**
- Verify your key at [console.groq.com](https://console.groq.com)
- The key must start with `gsk_`
