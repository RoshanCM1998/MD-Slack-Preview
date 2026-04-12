<p align="center">
  <h1 align="center">MD Slack Preview</h1>
  <p align="center">
    Automatically render beautiful markdown previews when <code>.md</code> files are shared in Slack.
    <br />
    <strong>One install. Entire workspace. Zero per-user setup.</strong>
    <br />
    <br />
    <a href="SETUP.md"><strong>Setup Guide &raquo;</strong></a>
    &nbsp;&middot;&nbsp;
    <a href="https://github.com/slackapi/bolt-js">Bolt.js</a>
    &nbsp;&middot;&nbsp;
    <a href="https://github.com/tryfabric/mack">@tryfabric/mack</a>
  </p>
</p>

<br />

## Features

- **Automatic previews** — drop a `.md` file in any channel, get a rendered preview in the thread
- **Smart large file handling** — files with 30+ blocks show a compact preview with a "Show full preview" button
- **Thread-aware** — files shared inside a thread get previews in the same thread
- **Auto-join channels** — optionally joins all public channels on startup and new ones as they're created
- **Full markdown support** — headings, tables, code blocks with syntax highlighting, lists, task lists, blockquotes, links, images, and more
- **Free** — $0/month on Slack's free plan with free-tier hosting

## How It Works

```
User drops README.md into #engineering
         |
         v
  +------+-------+
  | Slack fires   |
  | file_shared   |
  | event         |
  +------+-------+
         |
         v
  +------+-------+
  | Bot downloads |
  | file content  |
  +------+-------+
         |
         v
  +------+--------+
  | @tryfabric/mack|
  | converts to    |
  | Block Kit      |
  +------+---------+
         |
         v
  +------+-------+
  | Bot posts     |
  | threaded      |
  | reply         |
  +--------------+
```

### Small files (30 blocks or fewer)

Full rendered preview in a single threaded reply.

### Large files (30+ blocks)

1. Preview of the first 30 blocks + **"Show full preview"** button
2. Click the button:
   - Button changes to *"Loading full preview..."*
   - Full content posted as follow-up messages in the same thread
   - Button replaced with *"Full preview posted below"*

## Quick Start

```bash
git clone https://github.com/your-org/md-slack-preview.git
cd md-slack-preview
npm install
```

Create a `.env` file:

```env
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_SIGNING_SECRET=your-secret
PORT=3000
AUTO_JOIN_CHANNELS=false
```

Start the bot and tunnel:

```bash
# Terminal 1
npm start

# Terminal 2
npm run tunnel
```

> **New to this?** Follow the complete **[Setup Guide](SETUP.md)** — it walks you through creating the Slack app, configuring scopes, and connecting everything.

## Configuration

| Variable | Required | Default | Description |
|----------|:--------:|:-------:|-------------|
| `SLACK_BOT_TOKEN` | Yes | — | Bot token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Yes | — | Signing secret from app credentials |
| `PORT` | No | `3000` | Server port |
| `AUTO_JOIN_CHANNELS` | No | `false` | Auto-join all public channels on startup |

## Supported File Types

| Extension | Detected |
|-----------|:--------:|
| `.md` | Yes |
| `.mdx` | Yes |
| `.markdown` | Yes |
| `.mdown` | Yes |
| `.mkd` | Yes |

## Channel Coverage

| Scenario | Automatic | Action Required |
|----------|:---------:|-----------------|
| Public channels (existing + new) | Yes | Set `AUTO_JOIN_CHANNELS=true` |
| Private channels | No | `/invite @MD Preview` once |
| Group DMs | No | Add bot as participant |
| 1-on-1 DMs | No | Not practical |
| Self-DMs | — | Not supported by Slack |

## Slack API Scopes

| Scope | Why |
|-------|-----|
| `files:read` | Read uploaded files |
| `chat:write` | Post preview messages |
| `channels:history` | Read public channel messages |
| `channels:read` | List channels for auto-join |
| `channels:join` | Join public channels |
| `groups:history` | Read private channel messages |
| `im:history` | Read DM messages |
| `mpim:history` | Read group DM messages |

## Platform Limits

These are Slack's limits, not ours:

| Constraint | Limit |
|------------|-------|
| Blocks per message | 50 |
| Characters per message | 40,000 |
| Auto-join private channels | Not possible |
| Custom CSS / styling | Not possible |
| Bot in self-DMs | Not possible |

## Production Deployment

Replace the Cloudflare dev tunnel with a permanent host:

| Platform | Cost | Setup |
|----------|------|-------|
| [Railway](https://railway.app) | Free / $5 mo | `git push` to deploy |
| [Render](https://render.com) | Free tier | Auto-deploy from GitHub |
| [Fly.io](https://fly.io) | Free tier | Docker-based |
| [AWS Lambda](https://aws.amazon.com/lambda/) | ~$0/mo | Needs API Gateway |

Then update the **Event Subscriptions** and **Interactivity** URLs in your Slack app settings to point to your production URL.

## Tech Stack

| Component | Library |
|-----------|---------|
| Slack framework | [@slack/bolt](https://github.com/slackapi/bolt-js) |
| Markdown to blocks | [@tryfabric/mack](https://github.com/tryfabric/mack) |
| Dev tunnel | [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) |

## Project Structure

```
md-slack-preview/
  bot.js              # Bot source code
  package.json        # Dependencies and scripts
  .env                # Tokens (not committed)
  env.example         # Template for .env
  test-sample.md      # Sample markdown for testing
  SETUP.md            # Step-by-step setup guide
  README.md           # This file
  LICENSE             # MIT
```

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Test with a Slack sandbox workspace
5. Open a PR

## License

[MIT](LICENSE)
