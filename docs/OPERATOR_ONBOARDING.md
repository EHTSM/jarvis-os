# OPERATOR_ONBOARDING.md

**For:** First-time operator setting up JARVIS OS  
**Time to complete:** ~30 minutes

---

## What JARVIS Does

JARVIS is an automated business assistant. It:
- Responds to questions and commands via the Chat interface
- Follows up with sales leads automatically via WhatsApp
- Creates Razorpay payment links and tracks payments
- Runs scheduled tasks in the background (cron-style)
- Provides a Runtime console for direct task dispatch and system monitoring

---

## Step 1: Deploy the Server

If you haven't deployed yet, follow [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) to:
1. Set up a VPS (DigitalOcean, Linode, or any Ubuntu 22.04 server)
2. Configure `.env` with your API keys
3. Run `bash deploy.sh`

Once running, visit `https://yourdomain.com` — you should see the JARVIS landing page.

---

## Step 2: Initial Configuration

### Set your business profile

1. Open JARVIS in a browser
2. Click **Get Started**
3. Enter your business name, type, and follow-up message template
4. Click **Complete Setup**

This stores your business profile locally in the browser.

### Test the AI connection

Type any message in the Chat tab. You should receive a response within 1-3 seconds.

If the chat shows "Backend offline", check:
```bash
pm2 status
curl http://localhost:5050/health
```

---

## Step 3: Connect Integrations

### WhatsApp (for automated follow-ups)

1. Go to the **Clients** tab
2. Click **Set Up WhatsApp**
3. Enter your Meta Business API credentials
4. Click **Test Connection** — you should receive a test message on WhatsApp

Required in `.env`:
- `WA_TOKEN` (Meta permanent token)
- `PHONE_NUMBER_ID` (from Meta dashboard)
- `WA_VERIFY_TOKEN` (your own secret string)

### Telegram

Add `TELEGRAM_TOKEN` to `.env` and redeploy (`bash deploy.sh --no-build`).

The bot will automatically respond to messages after restart.

### Razorpay Payments

Add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` to `.env`.

Register your webhook URL in the Razorpay dashboard:
```
https://yourdomain.com/webhook/razorpay
```

---

## Step 4: Add Your First Leads

1. Go to the **Clients** tab
2. Click **Add Client**
3. Enter name, phone (with country code, e.g. `+919876543210`), and service interest
4. Click **Save**

JARVIS will automatically follow up at scheduled intervals.

---

## Step 5: Runtime Console Access

The **Runtime** tab is the operator control panel. It requires authentication.

1. Click **Runtime** tab
2. Enter your operator password (the one you used in `generate-password-hash.cjs`)
3. You now have access to:
   - **TaskQueue**: view pending and running background tasks
   - **ExecLog**: real-time execution history
   - **AIConsole**: direct AI prompt interface
   - **WorkflowPanel**: dispatch custom tasks
   - **Governor**: emergency stop / resume
   - **Adapters**: agent status and circuit breakers

### Dispatching a task from Runtime

1. Open WorkflowPanel
2. Enter a command (e.g. `run git status` or `summarize today's leads`)
3. Click **⚡ Dispatch** for synchronous execution (waits for result)
4. Click **📋 Queue** to add to background queue (returns immediately)

---

## Day-to-Day Operations

### Check system health
```
https://yourdomain.com/health
```

### View logs
```bash
pm2 logs jarvis-os --lines 100
```

### Restart server (with frontend rebuild)
```bash
bash deploy.sh
```

### Restart backend only (no frontend rebuild)
```bash
bash deploy.sh --no-build
```

### Emergency stop (stops all background task execution)

In the Runtime tab → Governor panel → **■ E-Stop** → Confirm

This does not stop the server — only pauses background task processing. Click **▶ Resume** to resume.

---

## Common Operations via Chat

Send these commands in the Chat tab:

| Command | What it does |
|---------|-------------|
| `show me today's leads` | Summary of recent CRM activity |
| `how many leads do we have` | Lead count |
| `open youtube` | Opens YouTube in default browser |
| `search for <topic>` | Web search |
| `run <terminal command>` | Execute a shell command |
| `schedule send whatsapp to <phone> at 3pm` | Queue a scheduled WhatsApp message |

---

## Backup Your Data

```bash
tar -czf backups/data-$(date +%Y%m%d).tar.gz data/
```

The most important files are:
- `data/leads.json` — your CRM
- `data/task-queue.json` — scheduled tasks
