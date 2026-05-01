const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createPromptAdapter, renderPromptTemplate } = require("../src/prompt-adapter");

test("none prompt adapter preserves the default bridge prompt", () => {
  const adapter = createPromptAdapter({ adapter: "none" });

  const prompt = adapter.buildPrompt({
    message: "现在还有货吗",
    history: [
      { role: "user", text: "你好" },
      { role: "assistant", text: "您好，想了解哪款？" },
    ],
  });

  assert.match(prompt, /Recent conversation:/);
  assert.match(prompt, /1\. user: 你好/);
  assert.match(prompt, /2\. assistant: 您好，想了解哪款？/);
  assert.match(prompt, /Current user message: 现在还有货吗/);
  assert.deepEqual(adapter.snapshot(), { adapter: "none" });
});

test("template prompt adapter renders bridge variables", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-prompt-adapter-"));
  const templateFile = path.join(dir, "prompt.md");
  fs.writeFileSync(
    templateFile,
    [
      "Agent={{logical_agent}}",
      "Conversation={{conversation_id}}",
      "User={{user_id}}",
      "History:",
      "{{history}}",
      "Retrieval:",
      "{{retrieval_context}}",
      "MessageText:",
      "{{message_text}}",
      "Attachments:",
      "{{attachments}}",
      "ResponseOptions:",
      "{{response_options}}",
      "Message:",
      "{{message}}",
    ].join("\n"),
    "utf8"
  );

  const adapter = createPromptAdapter({ adapter: "template", templateFile });
  const prompt = adapter.buildPrompt({
    logicalAgentId: "main",
    conversationId: "customer-1",
    userId: "wx-user-1",
    message: "多少钱\n\nAttachments:\n1. image: look.png; url=https://example.test/look.png",
    messageText: "多少钱",
    attachments: [{ type: "image", name: "look.png", url: "https://example.test/look.png" }],
    responseOptions: { tts: { enabled: true, voice: "zh-CN-XiaoxiaoNeural" } },
    history: [
      { role: "user", text: "你好" },
      { role: "assistant", text: "您好" },
    ],
    retrievalContext: "FAQ: 会员价 138 元",
  });

  assert.equal(
    prompt,
    [
      "Agent=main",
      "Conversation=customer-1",
      "User=wx-user-1",
      "History:",
      "1. user: 你好",
      "2. assistant: 您好",
      "Retrieval:",
      "FAQ: 会员价 138 元",
      "MessageText:",
      "多少钱",
      "Attachments:",
      "Attachments:",
      "1. image: look.png; url=https://example.test/look.png",
      "ResponseOptions:",
      "Response options:",
      "- TTS requested: voice=zh-CN-XiaoxiaoNeural",
      "Message:",
      "多少钱",
      "",
      "Attachments:",
      "1. image: look.png; url=https://example.test/look.png",
    ].join("\n")
  );
  assert.deepEqual(adapter.snapshot(), {
    adapter: "template",
    templateFile,
  });
});

test("renderPromptTemplate leaves unknown variables empty", () => {
  const prompt = renderPromptTemplate("A={{known}} B={{missing}}", { known: "ok" });

  assert.equal(prompt, "A=ok B=");
});

test("template prompt adapter requires a template file", () => {
  assert.throws(
    () => createPromptAdapter({ adapter: "template" }),
    /PROMPT_TEMPLATE_FILE is required/
  );
});
