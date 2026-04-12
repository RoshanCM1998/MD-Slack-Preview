# MD Slack Preview

A Slack bot that automatically renders markdown (.md) file previews when someone shares a markdown file in any channel. One install covers the entire workspace.

## What It Does

- Someone drops a `.md` file in a Slack channel
- Bot replies in the thread with a rendered preview (headings, tables, code blocks, lists, etc.)
- Small files: full preview in one message
- Large files: preview with a **"Show full preview"** button — click to expand
- Works in public channels, private channels, and group DMs
- Auto-joins all public channels (configurable)

## What It Does NOT Do

- Does not work in self-DMs (Slack platform limitation)
- Does not work in 1-on-1 DMs unless the bot is added to the conversation
- Cannot customize visual styling (fonts, colors) — Slack controls rendering
- Cannot replace Slack's native file preview panel

## Quick Start

See **[SETUP.md](SETUP.md)** for the full step-by-step setup guide.

```bash
npm install
# Create .env with your tokens (see SETUP.md Step 6)
npm start
# In another terminal:
npm run tunnel
```

## How It Works

### Small files (30 blocks or fewer)

The entire rendered preview is posted in one message as a threaded reply.

### Large files (more than 30 blocks)

1. A preview (first 30 blocks) is posted with a **"Show full preview"** button
2. When someone clicks the button:
   - The button changes to "Loading full preview..."
   - The full content is posted as follow-up messages in the same thread
   - The button is replaced with "Full preview posted below"

### Thread awareness

If a file is shared inside a thread reply, the bot's preview appears in the **same thread** — not at the channel level.

### Supported file extensions

`.md`, `.mdx`, `.markdown`, `.mdown`, `.mkd`

## Architecture

```
User uploads .md file in Slack
         |
         v
Slack fires "file_shared" event
         |
         v
Cloudflare Tunnel --> localhost:3000
         |
         v
Bot (Bolt.js) receives event
         |
         v
Bot calls files.info --> checks if markdown
         |
         v
Bot downloads file content
         |
         v
@tryfabric/mack converts Markdown --> Slack Block Kit blocks
         |
         v
Bot posts threaded reply with rendered blocks
(preview + "Show full" button if large)
```

## Where It Works

| Scenario | Automatic? | Action needed |
|----------|-----------|---------------|
| All public channels (existing + new) | Yes | Set `AUTO_JOIN_CHANNELS=true` |
| Private channels | No | `/invite @MD Preview` once per channel |
| Group DMs | No | Add bot as participant |
| 1-on-1 DMs | No | Not practical (becomes 3-person chat) |
| Self-DMs | Never | Slack platform limitation |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot token starting with `xoxb-` |
| `SLACK_SIGNING_SECRET` | Yes | From Basic Information -> App Credentials |
| `PORT` | No | Server port (default: 3000) |
| `AUTO_JOIN_CHANNELS` | No | `true` to auto-join all public channels on startup (default: `false`) |

## Slack Platform Limits

| Limit | Value |
|-------|-------|
| Max blocks per message | 50 |
| Max characters per message | 40,000 |
| Bot auto-join public channels | Yes (with `channels:join` scope) |
| Bot auto-join private channels | No (must be invited) |
| Bot in self-DMs | Not possible |
| Custom CSS/styling | Not possible |

## Production Hosting

For production, replace the Cloudflare tunnel with a permanent deployment:

| Option | Cost | Notes |
|--------|------|-------|
| **Railway** | Free tier / $5 mo | Git push to deploy |
| **Render** | Free tier | Auto-deploys from GitHub |
| **AWS Lambda** | ~$0/mo at low volume | Needs API Gateway config |
| **Fly.io** | Free tier | Docker-based |
| **VPS** (any) | $5/mo | You manage uptime |

Update the Event Subscriptions and Interactivity URLs to your production URL.

## Tech Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Slack framework | [@slack/bolt](https://github.com/slackapi/bolt-js) | Event handling, API calls |
| Markdown converter | [@tryfabric/mack](https://github.com/tryfabric/mack) | Markdown/GFM -> Slack Block Kit blocks |
| Tunnel (dev) | [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) | Expose localhost to Slack |

## Cost

| Component | Cost |
|-----------|------|
| Slack API / Bot | Free (all plans) |
| Slack workspace | Free plan works (unlimited users, 90-day history) |
| Hosting | Free tier available on Railway, Render, Fly.io, etc. |
| **Total** | **$0/month** for most setups |

## Troubleshooting

See **[SETUP.md](SETUP.md)** — the troubleshooting section at the bottom covers all known issues.

## License

MIT
