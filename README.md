# Ooplix

Ooplix is an AI-powered operating system for developers — combining a code editor, AI pair programmer, mission tracker, CRM, billing, and autonomous agent pipeline in one desktop application.

## Requirements

- Node.js 18+
- npm 9+

## Quick Start

```bash
# 1. Install dependencies (rebuilds native modules automatically)
npm install

# 2. Copy environment template and fill in your values
cp .env.example .env

# 3. Start the backend server
node server.js

# 4. In a second terminal, start the desktop app
npm start
```

## Environment Variables

Copy `.env.example` to `.env` and set:

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | Random string ≥ 32 chars for session signing |
| `OPERATOR_PASSWORD_HASH` | Yes | bcrypt hash of your operator password |
| `ALLOWED_ORIGINS` | Yes | Comma-separated list of allowed origins (e.g. `http://localhost:3000`) |
| `PORT` | No | Backend port (default: 3001) |

Generate a bcrypt hash for your operator password:
```bash
node -e "const b=require('bcrypt');b.hash('yourpassword',10).then(console.log)"
```

## Building for Distribution

```bash
# Build frontend
cd frontend && npm run build && cd ..

# Package desktop app (macOS)
npm run dist
```

## Reporting Issues

Use the **Beta Checklist** tab → "Send Feedback" in the app, or email: altamashjauhar@gmail.com

See [CHANGELOG.md](CHANGELOG.md) for release notes.
