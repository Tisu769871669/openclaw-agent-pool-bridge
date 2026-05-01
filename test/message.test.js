const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPrompt,
  normalizeChatBody,
  normalizeMessageList,
} = require("../src/message");

test("normalizeChatBody preserves emoji and summarizes rich media for the agent", () => {
  const normalized = normalizeChatBody({
    conversationId: "wxid-rich",
    userId: "wxid-user",
    content: {
      text: "这款还有吗 😊",
      attachments: [
        {
          type: "image",
          url: "https://example.test/look.png",
          filename: "look.png",
          mimeType: "image/png",
          alt: "客户发来的穿搭图",
        },
        {
          type: "file",
          url: "https://example.test/order.pdf",
          filename: "order.pdf",
          mimeType: "application/pdf",
          size: 1024,
        },
        {
          type: "audio",
          url: "https://example.test/voice.mp3",
          filename: "voice.mp3",
          transcript: "我想听语音回复",
          durationMs: 2300,
        },
      ],
      tts: {
        enabled: true,
        voice: "zh-CN-XiaoxiaoNeural",
        lang: "zh-CN",
      },
    },
  });

  assert.equal(normalized.messageText, "这款还有吗 😊");
  assert.equal(normalized.message, [
    "这款还有吗 😊",
    "",
    "Attachments:",
    "1. image: look.png; url=https://example.test/look.png; mime=image/png; alt=客户发来的穿搭图",
    "2. file: order.pdf; url=https://example.test/order.pdf; mime=application/pdf; size=1024",
    "3. audio: voice.mp3; url=https://example.test/voice.mp3; transcript=我想听语音回复; durationMs=2300",
    "",
    "Response options:",
    "- TTS requested: voice=zh-CN-XiaoxiaoNeural; lang=zh-CN",
  ].join("\n"));
  assert.equal(normalized.attachments.length, 3);
  assert.deepEqual(normalized.responseOptions.tts, {
    enabled: true,
    voice: "zh-CN-XiaoxiaoNeural",
    lang: "zh-CN",
  });
});

test("normalizeMessageList keeps user media-only messages as trusted history text", () => {
  const messages = normalizeMessageList([
    {
      role: "user",
      type: "image",
      imageUrl: "https://example.test/customer.jpg",
      caption: "尺码合适吗",
    },
  ]);

  assert.deepEqual(messages, [
    {
      role: "user",
      text: "尺码合适吗\n\nAttachments:\n1. image: url=https://example.test/customer.jpg",
      attachments: [
        {
          type: "image",
          url: "https://example.test/customer.jpg",
        },
      ],
    },
  ]);
});

test("normalizeMessageList does not treat ordinary message ids as file attachments", () => {
  const messages = normalizeMessageList([
    {
      id: "msg-1",
      role: "user",
      text: "普通文本",
    },
  ]);

  assert.deepEqual(messages, [
    {
      role: "user",
      text: "普通文本",
    },
  ]);
});

test("buildPrompt includes rich message summaries without changing plain text prompts", () => {
  assert.equal(buildPrompt({ message: "hello 😊" }), "hello 😊");

  const prompt = buildPrompt({
    message: "请看附件\n\nAttachments:\n1. file: spec.pdf; url=https://example.test/spec.pdf",
    history: [{ role: "user", text: "上一条 😊" }],
  });

  assert.match(prompt, /1\. user: 上一条 😊/);
  assert.match(prompt, /Current user message: 请看附件/);
  assert.match(prompt, /1\. file: spec\.pdf/);
});
