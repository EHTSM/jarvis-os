# OAuth Setup Guide — JARVIS-OS / Ooplix

**Backend status: FULLY IMPLEMENTED — all flows production-ready.**

Flows verified: authorization URL → state/CSRF nonce → callback → token exchange → AES-256-GCM encrypted storage → auto-refresh (5 min before expiry) → remote revoke → session logout (cookie clear).

Code: `backend/services/oauthIntegrationLayer.cjs` | Routes: `backend/routes/phase21.js`

**Only provider credentials (client ID + secret) are still needed.**

---

## Verified Flow Architecture

```
Browser              JARVIS Backend           Provider (Google / GitHub)
  │                       │                            │
  ├─GET /oauth/google/url─►│ state nonce (5-min TTL)   │
  │◄─{ url, state }────────┤                            │
  │                        │                            │
  ├─redirect to provider──────────────────────────────►│
  │◄───────────────────────────────── code + state ─────┤
  ├─GET /oauth/google/callback?code&state               │
  │                        ├─POST /token (exchange)────►│
  │                        │◄────────────── tokens ─────┤
  │                        │ encrypt + persist locally  │
  │◄─redirect /?oauth=google&status=connected           │
```

| Flow | Route | Auth |
|------|-------|------|
| Get auth URL | `GET /oauth/:provider/url` | Required |
| Handle callback | `GET /oauth/:provider/callback` | Open (browser redirect) |
| Refresh token | `POST /oauth/:provider/refresh` | Required |
| Revoke / disconnect | `DELETE /oauth/:provider/revoke` | Required |
| List connections | `GET /oauth/connections` | Required |
| Provider status | `GET /oauth/status` | Required |
| Logout (session) | `POST /auth/logout` | Open |

---

## Security Properties (Implemented)

| Property | Implementation |
|----------|---------------|
| CSRF | Cryptographic state nonce, 5-min server-side TTL |
| Token storage | AES-256-GCM, key derived from JWT_SECRET |
| Auto-refresh | Transparent, triggered 5 min before expiry |
| Revocation | Local delete + provider remote endpoint |
| Session logout | `clearCookie(jarvis_auth)` on POST /auth/logout |

---

## Callback URL pattern

All OAuth providers redirect to:

```
https://<your-domain>/oauth/<provider>/callback
```

For local testing:
```
http://localhost:5050/oauth/<provider>/callback
```

---

## 1. Google OAuth

**Required for:** Google login, Gmail tool, Google Drive tool.

### Steps

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use existing): **Ooplix**
3. Enable APIs:
   - Go to **APIs & Services → Library**
   - Enable: **Google+ API**, **Gmail API**, **Google Drive API**
4. Create OAuth credentials:
   - **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Name: `Ooplix Production`
   - Authorised redirect URIs:
     ```
     https://app.ooplix.com/oauth/google/callback
     http://localhost:5050/oauth/google/callback
     ```
5. Copy **Client ID** and **Client Secret**
6. Configure OAuth consent screen:
   - User type: **External**
   - App name: `Ooplix`
   - Support email: `altamashjauhar@gmail.com`
   - Scopes: `openid`, `email`, `profile`, `gmail.readonly`, `drive.readonly`

### Add to `.env`

```env
GOOGLE_CLIENT_ID=<paste-client-id>
GOOGLE_CLIENT_SECRET=<paste-client-secret>
GOOGLE_REDIRECT_URI=https://app.ooplix.com/oauth/google/callback
```

---

## 2. GitHub OAuth

**Required for:** GitHub login, GitHubEngineeringAgent (repo read/write, PRs, issues).

### Steps

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - Application name: `Ooplix`
   - Homepage URL: `https://ooplix.com`
   - Authorization callback URL: `https://app.ooplix.com/oauth/github/callback`
4. Click **Register application**
5. Copy **Client ID**
6. Click **Generate a new client secret** → copy **Client Secret**

### Personal Access Token (for GitHubEngineeringAgent)

The agent also needs a PAT for autonomous actions (create issues, PRs):

1. [Generate PAT](https://github.com/settings/tokens/new)
2. Scopes: `repo`, `read:user`, `read:org`
3. Name: `Ooplix Engineering Agent`

### Add to `.env`

```env
GITHUB_CLIENT_ID=<paste-client-id>
GITHUB_CLIENT_SECRET=<paste-client-secret>
GITHUB_REDIRECT_URI=https://app.ooplix.com/oauth/github/callback
GITHUB_TOKEN=<paste-personal-access-token>
```

---

## 3. Slack OAuth

**Required for:** Slack notifications, posting to channels.

### Steps

1. Go to [Slack API](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. App name: `Ooplix`, Workspace: your workspace
3. Go to **OAuth & Permissions**:
   - Add redirect URL: `https://app.ooplix.com/oauth/slack/callback`
   - Add bot token scopes:
     - `channels:read`, `chat:write`, `files:write`, `users:read`
4. Go to **Basic Information** → **App Credentials**
5. Copy **Client ID** and **Client Secret**
6. Click **Install to Workspace** → copy **Bot User OAuth Token** (`xoxb-...`)

### Add to `.env`

```env
SLACK_CLIENT_ID=<paste-client-id>
SLACK_CLIENT_SECRET=<paste-client-secret>
SLACK_REDIRECT_URI=https://app.ooplix.com/oauth/slack/callback
SLACK_BOT_TOKEN=xoxb-<paste-bot-token>
```

---

## 4. Notion OAuth

**Required for:** Saving content, creating pages autonomously.

### Steps

1. Go to [Notion Integrations](https://www.notion.so/my-integrations) → **New integration**
2. Name: `Ooplix`, Associated workspace: your workspace
3. Capabilities: **Read content**, **Update content**, **Insert content**
4. Go to **Distribution** tab → toggle **Public integration** → **Submit**
5. Fill required OAuth fields:
   - Redirect URI: `https://app.ooplix.com/oauth/notion/callback`
6. Copy **OAuth client ID** and **OAuth client secret**

### Add to `.env`

```env
NOTION_CLIENT_ID=<paste-client-id>
NOTION_CLIENT_SECRET=<paste-client-secret>
NOTION_REDIRECT_URI=https://app.ooplix.com/oauth/notion/callback
```

---

## 5. Apple OAuth (placeholder — not yet implemented)

Apple Sign-In requires:
- Apple Developer account ($99/year)
- App ID with Sign In with Apple enabled
- Service ID for web flow
- Private key (`.p8` file)

**Current status:** Not implemented in this codebase. Requires `apple-signin-auth` npm package and dedicated route. Recommended to add post-launch if needed.

---

## 6. OpenRouter (AI routing)

**Required for:** All AI-powered agent tasks (code review, content generation, research).

1. Go to [OpenRouter](https://openrouter.ai) → Sign up → API Keys → Create key
2. Name: `Ooplix Production`

```env
OPENROUTER_API_KEY=sk-or-<paste-key>
```

---

## 7. Ollama (local AI — optional)

For local inference (zero API cost):

```bash
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3
ollama serve   # runs on http://localhost:11434
```

No env var needed — the tool layer auto-detects `http://localhost:11434`.

---

## Summary — env vars to set

| Variable | Required | Provider |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes (for Google login) | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Yes | Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | Yes | Set to your domain |
| `GITHUB_CLIENT_ID` | Yes (for GitHub) | GitHub Developer Settings |
| `GITHUB_CLIENT_SECRET` | Yes | GitHub Developer Settings |
| `GITHUB_TOKEN` | Yes (for agent) | GitHub PAT Settings |
| `SLACK_CLIENT_ID` | Optional | Slack API |
| `SLACK_CLIENT_SECRET` | Optional | Slack API |
| `SLACK_BOT_TOKEN` | Optional | Slack API |
| `NOTION_CLIENT_ID` | Optional | Notion Integrations |
| `NOTION_CLIENT_SECRET` | Optional | Notion Integrations |
| `OPENROUTER_API_KEY` | Yes (for AI) | OpenRouter |

---

## Verification

After setting env vars, test each provider:

```bash
# Start the server
node backend/server.js

# Get Google auth URL
curl -H "Cookie: jarvis_auth=<your-token>" \
  http://localhost:5050/oauth/google/url

# Check provider status
curl -H "Cookie: jarvis_auth=<your-token>" \
  http://localhost:5050/oauth/status
```

Expected response for a configured provider:
```json
{ "configured": true, "clientId": "set" }
```
