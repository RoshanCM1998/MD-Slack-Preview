const fs = require("fs");
const path = require("path");

// Load .env manually to avoid dotenvx issues
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

if (!process.env.SLACK_BOT_TOKEN || !process.env.SLACK_SIGNING_SECRET) {
  console.error("Missing SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET in .env");
  process.exit(1);
}

const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  customRoutes: [
    {
      path: "/",
      method: "GET",
      handler: (req, res) => {
        res.writeHead(200);
        res.end("MD Preview Bot is running");
      },
    },
  ],
});

const MD_EXTENSIONS = [".md", ".mdx", ".markdown", ".mdown", ".mkd"];
const MAX_MARKDOWN_BLOCK_CHARS = 12000;

// --- Helpers ---

function isMarkdownFile(fileInfo) {
  const name = (fileInfo.name || "").toLowerCase();
  return (
    fileInfo.filetype === "markdown" ||
    MD_EXTENSIONS.some((ext) => name.endsWith(ext))
  );
}

async function downloadFile(url, token) {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`Failed to download file: ${resp.status}`);
  return resp.text();
}

function buildPreviewBlocks(content, fileName) {
  const blocks = [];

  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `*Rendered preview of \`${fileName}\`*` },
    ],
  });

  if (content.length <= MAX_MARKDOWN_BLOCK_CHARS) {
    blocks.push({ type: "markdown", text: content });
  } else {
    const lines = content.split("\n");
    let chunk = "";
    for (const line of lines) {
      if (chunk.length + line.length + 1 > MAX_MARKDOWN_BLOCK_CHARS) {
        blocks.push({ type: "markdown", text: chunk });
        chunk = "";
      }
      chunk += (chunk ? "\n" : "") + line;
    }
    if (chunk) {
      blocks.push({ type: "markdown", text: chunk });
    }
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `_File was ${content.length.toLocaleString()} chars — split into ${blocks.length - 1} sections_`,
        },
      ],
    });
  }

  return blocks;
}

// --- Auto-join all public channels on startup ---

async function joinAllPublicChannels(client) {
  let cursor;
  let joined = 0;
  let already = 0;

  do {
    const result = await client.conversations.list({
      types: "public_channel",
      exclude_archived: true,
      limit: 200,
      cursor,
    });

    for (const channel of result.channels || []) {
      if (!channel.is_member) {
        try {
          await client.conversations.join({ channel: channel.id });
          joined++;
        } catch (e) {
          // some channels may restrict joining
        }
      } else {
        already++;
      }
    }

    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  console.log(
    `   Channels: joined ${joined} new, already in ${already}`
  );
}

// --- Auto-join newly created public channels ---

app.event("channel_created", async ({ event, client }) => {
  try {
    await client.conversations.join({ channel: event.channel.id });
    console.log(`Joined new channel: #${event.channel.name}`);
  } catch (e) {
    // ignore
  }
});

// --- File shared handler ---

app.event("file_shared", async ({ event, client }) => {
  try {
    const fileInfo = await client.files.info({ file: event.file_id });
    const file = fileInfo.file;

    if (!isMarkdownFile(file)) return;

    const content = await downloadFile(
      file.url_private_download,
      process.env.SLACK_BOT_TOKEN
    );

    if (!content.trim()) return;

    const blocks = buildPreviewBlocks(content, file.name);

    // Find the message with this file to get correct thread_ts.
    // First check top-level messages.
    const history = await client.conversations.history({
      channel: event.channel_id,
      limit: 10,
    });

    let threadTs = null;

    for (const msg of history.messages || []) {
      const msgFiles = msg.files || [];
      if (msgFiles.some((f) => f.id === event.file_id)) {
        // File was shared at channel level — reply in thread on this message
        threadTs = msg.ts;
        break;
      }

      // If this message has a thread, check replies too
      if (msg.reply_count > 0) {
        try {
          const replies = await client.conversations.replies({
            channel: event.channel_id,
            ts: msg.ts,
            limit: 20,
          });
          for (const reply of replies.messages || []) {
            const replyFiles = reply.files || [];
            if (replyFiles.some((f) => f.id === event.file_id)) {
              // File was shared inside a thread — reply in the SAME thread
              threadTs = msg.ts; // use parent ts, not reply ts
              break;
            }
          }
        } catch (e) {
          // ignore
        }
        if (threadTs) break;
      }
    }

    await client.chat.postMessage({
      channel: event.channel_id,
      thread_ts: threadTs,
      blocks,
      text: `Rendered preview of ${file.name}`,
    });

    console.log(`Posted preview for ${file.name} in ${event.channel_id}`);
  } catch (err) {
    console.error("Error handling file_shared:", err.message);
  }
});

// --- Start ---

(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`MD Preview Bot is running on port ${port}`);
  console.log(`   Waiting for .md files to be shared...`);

  // Auto-join all public channels
  try {
    await joinAllPublicChannels(app.client);
  } catch (e) {
    console.log("   Could not auto-join channels:", e.message);
    console.log("   Add 'channels:join' scope and reinstall the app");
  }
})();
