# MD Slack Preview — Setup Guide

Step-by-step setup for a new workspace. For details on features, architecture, and limits see [README.md](README.md).

---

## Prerequisites

- **Node.js** v18 or higher
- **cloudflared** — [Install Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
- A **Slack workspace** where you can install apps (or a [free developer sandbox](https://api.slack.com/developer-program))

---

## Step 1: Create the Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **"Create New App"** → **"From scratch"**
3. Name: `MD Preview`
4. Pick your workspace
5. Click **"Create App"**

---

## Step 2: Configure Bot Scopes

Go to **OAuth & Permissions** → **"Bot Token Scopes"** → add all of these:

| Scope | Purpose |
|-------|---------|
| `files:read` | Read uploaded file content |
| `chat:write` | Post rendered preview messages |
| `channels:history` | See messages in public channels |
| `channels:read` | List public channels (for auto-join) |
| `channels:join` | Auto-join public channels |
| `groups:history` | See messages in private channels |
| `im:history` | See messages in DMs |
| `mpim:history` | See messages in group DMs |

---

## Step 3: Enable Event Subscriptions

Go to **Event Subscriptions** in the left sidebar.

1. Toggle **ON**
2. Leave the Request URL empty for now (we'll fill it in Step 8)
3. Under **"Subscribe to bot events"**, add:
   - `file_shared`
   - `channel_created`
4. Click **Save Changes**

---

## Step 4: Enable Interactivity

Go to **Interactivity & Shortcuts** in the left sidebar.

1. Toggle **ON**
2. Leave the Request URL empty for now (same URL as events, we'll fill it in Step 8)
3. Click **Save Changes**

---

## Step 5: Install the App to Workspace

Go to **Install App** in the left sidebar.

1. Click **"Install to Workspace"**
2. Authorize the permissions
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

Then go to **Basic Information** → **App Credentials** → copy the **Signing Secret**.

---

## Step 6: Install Dependencies

```bash
npm install
```

---

## Step 7: Create the .env File

Create a file called `.env` in the project root:

```
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here
PORT=3000
AUTO_JOIN_CHANNELS=false
```

> **WARNING: The `.env` file MUST be saved as UTF-8 encoding, NOT UTF-16.**
>
> Windows Notepad defaults to UTF-16 which adds invisible characters between every letter. The bot will fail to read the tokens and crash with `signingSecret is required`.
>
> **How to save as UTF-8:**
> - **Notepad:** File → Save As → Encoding dropdown → select **"UTF-8"** (not "Unicode" or "UTF-16")
> - **VS Code:** Already UTF-8 by default — no action needed
> - **PowerShell:** `Set-Content` defaults to UTF-16 — use `-Encoding utf8` flag

---

## Step 8: Start the Bot and Tunnel

### Terminal 1 — Start the bot

```bash
npm start
```

Expected output:

```
MD Preview Bot is running on port 3000
   Waiting for .md files to be shared...
```

### Terminal 2 — Start the Cloudflare tunnel

```bash
npm run tunnel
```

Copy the URL that Cloudflare prints (e.g. `https://something-random.trycloudflare.com`).

---

## Step 9: Connect the Tunnel URL to Slack

Go back to your Slack app settings. You need to set the same URL in **two places**:

### Event Subscriptions

1. Go to **Event Subscriptions**
2. Paste:
   ```
   https://your-tunnel-url.trycloudflare.com/slack/events
   ```
3. Wait for the green **"Verified"** checkmark
4. Click **Save Changes**

### Interactivity & Shortcuts

1. Go to **Interactivity & Shortcuts**
2. Paste the same URL:
   ```
   https://your-tunnel-url.trycloudflare.com/slack/events
   ```
3. Click **Save Changes**

If Slack shows a yellow banner saying **"Reinstall your app"** — click it and reinstall.

---

## Step 10: Test It

1. Invite the bot to a channel: `/invite @MD Preview`
2. Upload a `.md` file (drag and drop)
3. The bot should reply in the thread with a rendered preview

Use the included `test-sample.md` for a quick test — it has headings, tables, code blocks, and lists.

---

## Step 11: Go Org-Wide

### Auto-join all public channels

Set `AUTO_JOIN_CHANNELS=true` in `.env` and restart the bot.

### Private channels

Someone in the channel types `/invite @MD Preview` once per channel.

### Group DMs

Add the bot as a participant in the group DM.

---

## Troubleshooting

### Bot doesn't respond to file uploads

- Is the bot a member of that channel? → `/invite @MD Preview`
- Is the tunnel running? Check Terminal 2
- Is the Event Subscriptions URL verified? (green checkmark)

### "Your URL didn't respond with the value of the challenge parameter"

- URL must end with `/slack/events`
- Bot must be running before you verify the URL

### "This app is not configured to handle interactive responses"

- Enable **Interactivity & Shortcuts** in app settings
- Set the Request URL to `https://your-tunnel-url/slack/events`

### Bot crashes with "signingSecret is required"

- `.env` file is likely saved as **UTF-16** — re-save as **UTF-8** (see Step 7 warning)
- No spaces around `=`: `SLACK_BOT_TOKEN=xoxb-xxx`
- No quotes around values: `xoxb-xxx` not `"xoxb-xxx"`
