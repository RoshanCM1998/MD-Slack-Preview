# Markdown Preview in Slack — Research & Options

## The Problem

When someone shares a `.md` file in Slack, it shows up as a raw text file with no formatting — no rendered headings, no tables, no code highlighting. We want a proper rendered preview.

---

## How Slack's Preview System Actually Works

Understanding this is key to picking the right approach:

### The Inline Preview (small, in-channel)
When you share a file in Slack, it shows:
- **Images**: a thumbnail (auto-generated at 64/80/360/480/720/960/1024px sizes)
- **PDFs/Docs**: first page rendered as image
- **Code files**: `preview_highlight` field — Slack uses **CodeMirror** to syntax-highlight a snippet
- **Text/.md files**: raw plain text snippet, no rendering. **This is the gap.**

### The Expanded Preview (click to open)
When you click on a file, Slack opens a modal/panel that shows the full content. For `.md` files, this is still **raw plain text**. Slack has zero built-in markdown rendering for uploaded files.

### What We CAN'T Do
- **We cannot replace Slack's native file preview** — there's no API to customize how Slack renders uploaded files in the preview panel
- **We cannot inject custom HTML/CSS/JS into the file preview modal** — Slack doesn't allow this
- **We cannot add a custom renderer to the "click to expand" view** — that's Slack's internal UI

### What We CAN Do
- Post a **rendered version as a separate message** (threaded reply with Block Kit)
- Register a **remote file** with a custom `preview_image` (rendered PNG of the markdown)
- Use the new **Markdown Block** in Block Kit to post rendered content

---

## Detailed Answers to Your Questions

### Q2: Slack Bot — How does it work org-wide? Custom CSS? Per-machine or org-level?

**It's org-level, one setup for everyone.**

Here's how a Slack App works:
1. A **workspace admin** installs the app once → it works for **everyone** in the workspace
2. No per-machine installation, no per-user setup
3. Works on desktop app (Windows/Mac), mobile, and browser — everywhere Slack runs
4. The bot runs on a **server you control** (or serverless like AWS Lambda)

**You cannot inject custom CSS** into Slack. Slack is an Electron app (Chromium wrapper), and while hackers have found ways to inject CSS by unpacking `app.asar`, this:
- Breaks on every Slack update
- Has to be done per-machine manually
- Is unsupported and fragile
- Doesn't help with file preview rendering anyway

**The bot approach doesn't need CSS** — it uses Slack's own Block Kit to render formatted content natively within Slack's UI.

### Q3: Link Unfurling — Dismissed (agreed)

You're right — requiring people to upload to GitHub first defeats the purpose. People drag-and-drop `.md` files directly into Slack. The bot approach handles this directly.

### Q4: Workflow — Per-machine or org-wide?

**Org-wide.** Both the Bot approach and Workflow approach are installed once at the workspace level. Every channel, every user benefits automatically.

---

## The Recommended Approach: Slack Bot with Markdown Block

### What the user sees (the UX):

```
┌─────────────────────────────────────────────┐
│ 👤 Alice                           10:30 AM │
│ [📎 architecture.md]  ← normal file upload  │
│  architecture.md — Click to view raw file    │
│                                              │
│  ┌─ 🤖 MD Preview Bot         10:30 AM ──┐  │
│  │                                        │  │
│  │  # Architecture Overview               │  │
│  │                                        │  │
│  │  Our system uses a **microservices**   │  │
│  │  architecture with 3 layers:           │  │
│  │                                        │  │
│  │  | Layer   | Tech      | Port |        │  │
│  │  |---------|-----------|------|        │  │
│  │  | API     | Express   | 3000 |        │  │
│  │  | Worker  | Bull      | -    |        │  │
│  │  | DB      | Postgres  | 5432 |        │  │
│  │                                        │  │
│  │  ## Getting Started                    │  │
│  │  ```bash                               │  │
│  │  npm install && npm run dev            │  │
│  │  ```                                   │  │
│  └────────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

**The bot auto-replies in a thread** with the rendered markdown. The original file is still there for download. The rendered version appears instantly as a threaded reply.

### How It Works (Technical Flow):

```
User drops README.md into #engineering channel
          │
          ▼
Slack fires `file_shared` event to our bot
          │
          ▼
Bot receives: { file_id: "F123", channel_id: "C456", user_id: "U789" }
          │
          ▼
Bot calls `files.info` API → gets file metadata
  → filetype: "markdown", name: "README.md", url_private_download: "https://..."
          │
          ▼
Bot checks: is filetype "markdown" or name ends in ".md"?
  → YES: continue
  → NO: ignore (not a markdown file)
          │
          ▼
Bot downloads file content using url_private_download + Bot Token
          │
          ▼
Bot posts threaded reply using chat.postMessage:
  {
    channel: "C456",
    thread_ts: original_message_ts,    ← replies in thread
    blocks: [{
      type: "markdown",                ← Slack's new markdown block!
      text: <raw file content>         ← just pass the .md content directly
    }]
  }
          │
          ▼
Slack renders the markdown natively in the thread
```

### For files > 12,000 characters:
- Split into multiple markdown blocks (each up to 12k)
- Or use `@tryfabric/mack` to convert to rich_text Block Kit blocks
- Or post first 12k with a "File truncated — click above to view full file" note

### Required Slack App Setup (one-time, org-level):

**Scopes needed:**
| Scope | Why |
|-------|-----|
| `files:read` | Read uploaded file content |
| `chat:write` | Post the rendered preview reply |
| `channels:history` | See messages in public channels |
| `groups:history` | See messages in private channels |

**Event subscriptions:**
| Event | Why |
|-------|-----|
| `file_shared` | Detect when any .md file is uploaded |

### Alternative UX: Preview Image Approach

Instead of a threaded text reply, we could render the markdown to a **PNG image** and use `files.remote.add` with `preview_image`. This would show an actual rendered thumbnail inline — closer to how image previews work. But:
- Images aren't searchable/copyable
- Requires a headless browser (Puppeteer) to render MD → PNG
- More complex infrastructure
- The threaded reply approach is simpler and more useful

---

## Tech Stack Decision

### Simplest: Node.js + Bolt.js + Markdown Block

```
@slack/bolt          → Slack app framework (handles events, auth, etc.)
markdown block       → Pass raw .md content, Slack renders it
```

That's it. No markdown conversion library needed for files under 12k chars. Slack's new markdown block accepts standard markdown directly.

### For larger files or richer rendering:

```
@slack/bolt          → Slack app framework
@tryfabric/mack      → Markdown → Block Kit blocks (handles >12k, tables, etc.)
```

### Hosting options (all org-wide, one deploy):

| Option | Cost | Complexity |
|--------|------|------------|
| **Railway** | Free tier → $5/mo | Lowest — git push to deploy |
| **Vercel** (serverless) | Free tier | Low — but needs event handling setup |
| **AWS Lambda** | Pennies/month | Medium — needs API Gateway |
| **Cloudflare Worker** | Free tier | Low — but 10ms CPU limit on free |
| **Self-hosted** (any VPS) | $5/mo | Medium — you manage uptime |
| **Local (ngrok)** | Free | Dev only — not production |

---

## Open Source Libraries Summary

| Library | Language | What it does | Link |
|---------|----------|-------------|------|
| **@slack/bolt** | JS/TS | Slack app framework | [GitHub](https://github.com/slackapi/bolt-js) |
| **@tryfabric/mack** | TS | MD/GFM → Slack Block Kit blocks | [GitHub](https://github.com/tryfabric/mack) |
| **slackify-markdown** | JS | MD → Slack mrkdwn text | [GitHub](https://github.com/jsarafajr/slackify-markdown) |
| **md-to-slack** | JS | MD → Slack mrkdwn text | [GitHub](https://github.com/nicoespeon/md-to-slack) |
| **markdown-to-mrkdwn** | Python | MD → Slack mrkdwn text | [PyPI](https://pypi.org/project/markdown-to-mrkdwn/) |

---

## Key Insight: Slack's New Markdown Block (Feb 2025)

As of February 2025, Slack introduced a native `markdown` block type in Block Kit:

```json
{
  "blocks": [{
    "type": "markdown",
    "text": "# Your raw markdown here\n\n**Bold**, *italic*, tables, code blocks — all work!"
  }]
}
```

**Supports:** Bold, italic, strikethrough, all header levels, ordered/unordered lists, block quotes, code blocks with syntax highlighting, links, tables, task lists, horizontal dividers.

**Limits:** 12,000 chars cumulative. Images render as links not inline images.

**March 2026 update** added even more rich text markdown support.

This means for most `.md` files, **you just pass the raw content through** — no conversion needed.

---

## Next Steps

1. Set up a Slack App in the workspace admin panel
2. Build the bot with Bolt.js + the markdown block
3. Deploy to Railway or similar
4. Done — works for entire org, all platforms, zero per-user setup
