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
const MAX_BLOCKS_PER_MESSAGE = 50;

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

async function markdownToSlackBlocks(content) {
  // Dynamic import for ESM module
  const { markdownToBlocks } = await import("@tryfabric/mack");
  return markdownToBlocks(content);
}

function chunkBlocks(blocks, maxPerMessage) {
  // Split blocks array into groups that fit within Slack's limit.
  // Reserve 1 slot for the context header in the first message.
  const chunks = [];
  for (let i = 0; i < blocks.length; i += maxPerMessage) {
    chunks.push(blocks.slice(i, i + maxPerMessage));
  }
  return chunks;
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
  if (process.env.AUTO_JOIN_CHANNELS !== "true") return;
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

    // Convert markdown to Slack Block Kit blocks using mack
    const allBlocks = await markdownToSlackBlocks(content);

    // Find the message with this file to get correct thread_ts
    const history = await client.conversations.history({
      channel: event.channel_id,
      limit: 10,
    });

    let threadTs = null;

    for (const msg of history.messages || []) {
      const msgFiles = msg.files || [];
      if (msgFiles.some((f) => f.id === event.file_id)) {
        threadTs = msg.ts;
        break;
      }

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
              threadTs = msg.ts;
              break;
            }
          }
        } catch (e) {
          // ignore
        }
        if (threadTs) break;
      }
    }

    // First message: context header + first batch of blocks
    const headerBlock = {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `*Rendered preview of \`${file.name}\`*` },
      ],
    };

    // Chunk blocks into groups of max 49 (50 minus header for first message)
    const firstBatch = allBlocks.slice(0, MAX_BLOCKS_PER_MESSAGE - 1);
    const remainingBlocks = allBlocks.slice(MAX_BLOCKS_PER_MESSAGE - 1);

    await client.chat.postMessage({
      channel: event.channel_id,
      thread_ts: threadTs,
      blocks: [headerBlock, ...firstBatch],
      text: `Rendered preview of ${file.name}`,
    });

    // Send remaining chunks as follow-up messages in the same thread
    if (remainingBlocks.length > 0) {
      const chunks = chunkBlocks(remainingBlocks, MAX_BLOCKS_PER_MESSAGE);
      for (const chunk of chunks) {
        await client.chat.postMessage({
          channel: event.channel_id,
          thread_ts: threadTs,
          blocks: chunk,
          text: `Rendered preview of ${file.name} (continued)`,
        });
      }
    }

    const totalMessages = 1 + Math.ceil(remainingBlocks.length / MAX_BLOCKS_PER_MESSAGE);
    console.log(
      `Posted preview for ${file.name} — ${allBlocks.length} blocks in ${totalMessages} message(s)`
    );
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

  if (process.env.AUTO_JOIN_CHANNELS === "true") {
    try {
      await joinAllPublicChannels(app.client);
    } catch (e) {
      console.log("   Could not auto-join channels:", e.message);
      console.log("   Add 'channels:join' scope and reinstall the app");
    }
  } else {
    console.log("   Auto-join disabled. Set AUTO_JOIN_CHANNELS=true to enable");
  }
})();
