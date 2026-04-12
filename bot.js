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
const PREVIEW_BLOCKS_COUNT = 30;

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
  const { markdownToBlocks } = await import("@tryfabric/mack");
  return markdownToBlocks(content);
}

async function findThreadTs(client, channelId, fileId) {
  const history = await client.conversations.history({
    channel: channelId,
    limit: 10,
  });

  for (const msg of history.messages || []) {
    const msgFiles = msg.files || [];
    if (msgFiles.some((f) => f.id === fileId)) {
      return msg.ts;
    }

    if (msg.reply_count > 0) {
      try {
        const replies = await client.conversations.replies({
          channel: channelId,
          ts: msg.ts,
          limit: 20,
        });
        for (const reply of replies.messages || []) {
          const replyFiles = reply.files || [];
          if (replyFiles.some((f) => f.id === fileId)) {
            return msg.ts;
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }

  return null;
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

    const allBlocks = await markdownToSlackBlocks(content);
    const threadTs = await findThreadTs(client, event.channel_id, event.file_id);

    const headerBlock = {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `*Rendered preview of \`${file.name}\`*` },
      ],
    };

    if (allBlocks.length <= PREVIEW_BLOCKS_COUNT) {
      // Small file — send everything in one message
      await client.chat.postMessage({
        channel: event.channel_id,
        thread_ts: threadTs,
        blocks: [headerBlock, ...allBlocks],
        text: `Rendered preview of ${file.name}`,
      });
      console.log(`Posted preview for ${file.name} — ${allBlocks.length} blocks`);
    } else {
      // Large file — show preview + "Show full preview" button
      const previewBlocks = allBlocks.slice(0, PREVIEW_BLOCKS_COUNT);

      const footerBlock = {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `_Showing ${PREVIEW_BLOCKS_COUNT} of ${allBlocks.length} blocks — click below for full preview_`,
          },
        ],
      };

      const buttonBlock = {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Show full preview" },
            style: "primary",
            action_id: "show_full_preview",
            value: JSON.stringify({
              file_id: event.file_id,
              channel_id: event.channel_id,
            }),
          },
        ],
      };

      await client.chat.postMessage({
        channel: event.channel_id,
        thread_ts: threadTs,
        blocks: [headerBlock, ...previewBlocks, footerBlock, buttonBlock],
        text: `Rendered preview of ${file.name}`,
      });

      console.log(
        `Posted preview for ${file.name} — ${PREVIEW_BLOCKS_COUNT}/${allBlocks.length} blocks (truncated)`
      );
    }
  } catch (err) {
    console.error("Error handling file_shared:", err.message);
  }
});

// --- "Show full preview" button handler ---

app.action("show_full_preview", async ({ action, body, client, ack }) => {
  await ack();

  try {
    const { file_id, channel_id } = JSON.parse(action.value);

    // Update the button to show loading state
    const originalMessage = body.message;
    const updatedBlocks = originalMessage.blocks.map((block) => {
      if (block.type === "actions") {
        return {
          type: "context",
          elements: [
            { type: "mrkdwn", text: "_Loading full preview..._" },
          ],
        };
      }
      return block;
    });

    await client.chat.update({
      channel: channel_id,
      ts: originalMessage.ts,
      blocks: updatedBlocks,
      text: originalMessage.text,
    });

    // Re-download and re-process the file
    const fileInfo = await client.files.info({ file: file_id });
    const file = fileInfo.file;

    const content = await downloadFile(
      file.url_private_download,
      process.env.SLACK_BOT_TOKEN
    );

    const allBlocks = await markdownToSlackBlocks(content);

    // Send full content as follow-up messages in the same thread
    const threadTs = originalMessage.thread_ts || originalMessage.ts;

    for (let i = 0; i < allBlocks.length; i += MAX_BLOCKS_PER_MESSAGE) {
      const chunk = allBlocks.slice(i, i + MAX_BLOCKS_PER_MESSAGE);
      await client.chat.postMessage({
        channel: channel_id,
        thread_ts: threadTs,
        blocks: chunk,
        text: `Full preview of ${file.name}`,
      });
    }

    // Update original message: remove loading, show "full preview posted"
    const finalBlocks = originalMessage.blocks.map((block) => {
      if (block.type === "actions") {
        return {
          type: "context",
          elements: [
            { type: "mrkdwn", text: "_Full preview posted below_" },
          ],
        };
      }
      // Also remove the "showing X of Y" footer
      if (
        block.type === "context" &&
        block.elements?.[0]?.text?.includes("click below")
      ) {
        return {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `_Full preview: ${allBlocks.length} blocks_` },
          ],
        };
      }
      return block;
    });

    await client.chat.update({
      channel: channel_id,
      ts: originalMessage.ts,
      blocks: finalBlocks,
      text: originalMessage.text,
    });

    console.log(`Posted full preview for ${file.name} — ${allBlocks.length} blocks`);
  } catch (err) {
    console.error("Error showing full preview:", err.message);
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
