const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../src/http-server");
const { createServerFromConfig } = require("../src/index");
const { AgentPool } = require("../src/agent-pool");
const { ConversationQueueManager } = require("../src/conversation-queue");
const { DebounceQueue } = require("../src/debounce-queue");
const { SessionStore } = require("../src/session-store");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("HTTP server preserves the existing chat response schema", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const runnerCalls = [];
  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: sessionDir, historyLimit: 20 }),
    runner: async (input) => {
      runnerCalls.push(input);
      return { reply: `worker=${input.workerAgentId}; message=${input.message}` };
    },
  });

  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "customer-1",
        userId: "user-1",
        content: "hello",
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.agent_id, "main");
    assert.equal(payload.conversation_id, "customer-1");
    assert.equal(payload.user_id, "user-1");
    assert.equal(payload.reply, "worker=main-1; message=hello");
    assert.equal(payload.session_id, "bridge_main_customer-1");
    assert.equal(typeof payload.trace_id, "string");
    assert.equal(Object.hasOwn(payload, "worker_agent_id"), false);
    assert.equal(runnerCalls[0].workerAgentId, "main-1");
  } finally {
    await close(server);
  }
});

test("HTTP server returns 429 when the pool queue times out", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const pool = new AgentPool({
    defaultAgentId: "main",
    queueTimeoutMs: 20,
    stickyTtlMs: 1000,
    agents: { main: ["main-1"] },
  });
  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    pool,
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: sessionDir, historyLimit: 20 }),
    runner: async () =>
      new Promise((resolve) => {
        setTimeout(() => resolve({ reply: "slow" }), 100);
      }),
  });

  const port = await listen(server);
  try {
    const first = fetch(`http://127.0.0.1:${port}/api/agents/main/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversationId: "customer-1", content: "first" }),
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const second = await fetch(`http://127.0.0.1:${port}/api/agents/main/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversationId: "customer-2", content: "second" }),
    });

    assert.equal(second.status, 429);
    const payload = await second.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "queue_timeout");
    assert.equal(await (await first).json().then((body) => body.reply), "slow");
  } finally {
    await close(server);
  }
});

test("HTTP server exposes authenticated pool admin status", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  let releaseRunner;
  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: sessionDir, historyLimit: 20 }),
    runner: async () =>
      new Promise((resolve) => {
        releaseRunner = () => resolve({ reply: "done" });
      }),
  });

  const port = await listen(server);
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${port}/admin/pool`);
    assert.equal(unauthorized.status, 401);

    const first = fetch(`http://127.0.0.1:${port}/api/agents/main/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversationId: "customer-admin", content: "first" }),
    });

    await new Promise((resolve) => setTimeout(resolve, 5));

    const response = await fetch(`http://127.0.0.1:${port}/admin/pool`, {
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(response.status, 200);

    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.pool.busyWorkers, 1);
    assert.equal(payload.pool.workers[0].busy, true);
    assert.equal(payload.pool.workers[0].currentSession, "bridge_main_customer-admin");
    assert.equal(payload.queues.activeTurns, 1);

    releaseRunner();
    assert.equal(await (await first).json().then((body) => body.reply), "done");
  } finally {
    await close(server);
  }
});

test("HTTP server prefers bridge-owned history over caller-provided messageList roles", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const runnerCalls = [];
  const replies = ["客服旧回复", "第二次回复"];
  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: sessionDir, historyLimit: 20 }),
    runner: async (input) => {
      runnerCalls.push(input);
      return { reply: replies.shift() };
    },
  });

  const port = await listen(server);
  try {
    await fetch(`http://127.0.0.1:${port}/api/agents/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "customer-roles",
        content: "第一条用户消息",
      }),
    });

    await fetch(`http://127.0.0.1:${port}/api/agents/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "customer-roles",
        content: {
          messageList: [
            { text: "客服旧回复" },
            { text: "老师您很忙吗" },
          ],
        },
      }),
    });

    assert.deepEqual(runnerCalls[1].history, [
      { role: "user", text: "第一条用户消息" },
      { role: "assistant", text: "客服旧回复" },
    ]);
    assert.match(runnerCalls[1].prompt, /2\. assistant: 客服旧回复/);
    assert.doesNotMatch(runnerCalls[1].prompt, /2\. user: 客服旧回复/);
  } finally {
    await close(server);
  }
});

test("HTTP server ignores roleless caller-provided history on cold start", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const runnerCalls = [];
  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: sessionDir, historyLimit: 20 }),
    runner: async (input) => {
      runnerCalls.push(input);
      return { reply: "客服回复" };
    },
  });

  const port = await listen(server);
  try {
    await fetch(`http://127.0.0.1:${port}/api/agents/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "customer-cold-start",
        content: {
          messageList: [
            { text: "客服旧回复" },
            { text: "老师您很忙吗" },
          ],
        },
      }),
    });

    assert.equal(runnerCalls[0].message, "老师您很忙吗");
    assert.deepEqual(runnerCalls[0].history, []);
    assert.doesNotMatch(runnerCalls[0].prompt, /user: 客服旧回复/);
  } finally {
    await close(server);
  }
});

test("HTTP server sends prompt adapter output to the runner", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const runnerCalls = [];
  const promptAdapterCalls = [];
  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: sessionDir, historyLimit: 20 }),
    promptAdapter: {
      snapshot: () => ({ adapter: "test" }),
      buildPrompt: (input) => {
        promptAdapterCalls.push(input);
        return `adapter prompt for ${input.logicalAgentId}/${input.conversationId}: ${input.message}`;
      },
    },
    runner: async (input) => {
      runnerCalls.push(input);
      return { reply: "客服回复" };
    },
  });

  const port = await listen(server);
  try {
    await fetch(`http://127.0.0.1:${port}/api/agents/main/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "customer-template",
        userId: "user-template",
        content: "请介绍一下",
      }),
    });

    assert.equal(promptAdapterCalls.length, 1);
    assert.equal(promptAdapterCalls[0].logicalAgentId, "main");
    assert.equal(promptAdapterCalls[0].conversationId, "customer-template");
    assert.equal(promptAdapterCalls[0].userId, "user-template");
    assert.equal(promptAdapterCalls[0].message, "请介绍一下");
    assert.equal(runnerCalls[0].prompt, "adapter prompt for main/customer-template: 请介绍一下");

    const admin = await fetch(`http://127.0.0.1:${port}/admin/pool`, {
      headers: { Authorization: "Bearer secret" },
    });
    assert.deepEqual((await admin.json()).prompt, { adapter: "test" });
  } finally {
    await close(server);
  }
});

test("HTTP server passes rich chat context to the runner and returns TTS metadata", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const runnerCalls = [];
  const promptAdapterCalls = [];
  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: sessionDir, historyLimit: 20 }),
    promptAdapter: {
      snapshot: () => ({ adapter: "test" }),
      buildPrompt: (input) => {
        promptAdapterCalls.push(input);
        return `message=${input.message}\nattachments=${input.attachments.length}\ntts=${input.responseOptions.tts.enabled}`;
      },
    },
    runner: async (input) => {
      runnerCalls.push(input);
      return {
        reply: "可以，我给您发语音版。",
        outputs: [
          {
            type: "audio",
            url: "https://example.test/reply.mp3",
            mimeType: "audio/mpeg",
            title: "TTS 语音回复",
          },
        ],
      };
    },
  });

  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/main/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "customer-rich",
        userId: "user-rich",
        content: {
          text: "看看这个图，可以语音回复吗 😊",
          attachments: [
            {
              type: "image",
              url: "https://example.test/look.png",
              filename: "look.png",
              mimeType: "image/png",
            },
            {
              type: "file",
              url: "https://example.test/order.pdf",
              filename: "order.pdf",
            },
          ],
          tts: true,
        },
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();

    assert.equal(promptAdapterCalls.length, 1);
    assert.match(promptAdapterCalls[0].message, /看看这个图，可以语音回复吗 😊/);
    assert.match(promptAdapterCalls[0].message, /1\. image: look\.png/);
    assert.equal(promptAdapterCalls[0].attachments.length, 2);
    assert.equal(promptAdapterCalls[0].responseOptions.tts.enabled, true);
    assert.equal(runnerCalls[0].attachments.length, 2);
    assert.equal(runnerCalls[0].responseOptions.tts.enabled, true);
    assert.equal(payload.reply, "可以，我给您发语音版。");
    assert.deepEqual(payload.tts, { requested: true });
    assert.deepEqual(payload.outputs, [
      {
        type: "audio",
        url: "https://example.test/reply.mp3",
        mime_type: "audio/mpeg",
        title: "TTS 语音回复",
      },
    ]);
  } finally {
    await close(server);
  }
});

test("HTTP server passes retrieval context into the prompt adapter", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const promptAdapterCalls = [];
  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: sessionDir, historyLimit: 20 }),
    retrievalAdapter: {
      snapshot: () => ({ enabled: true, provider: "test", lastHitCount: 1 }),
      retrieve: async () => ({ context: "FAQ: 会员费是 138 元。", hits: [{ title: "会员 FAQ" }] }),
    },
    promptAdapter: {
      snapshot: () => ({ adapter: "test" }),
      buildPrompt: (input) => {
        promptAdapterCalls.push(input);
        return `context=${input.retrievalContext}; message=${input.message}`;
      },
    },
    runner: async (input) => ({ reply: input.prompt }),
  });

  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/main/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "customer-retrieval",
        userId: "user-retrieval",
        content: "会员多少钱",
      }),
    });
    const payload = await response.json();

    assert.equal(payload.reply, "context=FAQ: 会员费是 138 元。; message=会员多少钱");
    assert.equal(promptAdapterCalls[0].retrievalContext, "FAQ: 会员费是 138 元。");

    const admin = await fetch(`http://127.0.0.1:${port}/admin/pool`, {
      headers: { Authorization: "Bearer secret" },
    });
    assert.deepEqual((await admin.json()).retrieval, {
      enabled: true,
      provider: "test",
      lastHitCount: 1,
    });
  } finally {
    await close(server);
  }
});

test("HTTP server keeps serving when retrieval fails", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  let recordedError = null;
  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: sessionDir, historyLimit: 20 }),
    retrievalAdapter: {
      snapshot: () => ({ enabled: true, provider: "test" }),
      retrieve: async () => {
        throw new Error("retrieval down");
      },
      recordError: (error) => {
        recordedError = error;
      },
    },
    promptAdapter: {
      snapshot: () => ({ adapter: "test" }),
      buildPrompt: (input) => `context=${input.retrievalContext}; message=${input.message}`,
    },
    runner: async (input) => ({ reply: input.prompt }),
  });

  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/main/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "customer-retrieval-fail",
        content: "会员多少钱",
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.reply, "context=; message=会员多少钱");
    assert.equal(recordedError.message, "retrieval down");
  } finally {
    await close(server);
  }
});

test("HTTP server debounces same-conversation bursts into one runner call", async () => {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const runnerCalls = [];
  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    debounce: new DebounceQueue({
      enabled: true,
      windowMs: 80,
      maxWaitMs: 200,
    }),
    sessionStore: new SessionStore({ dir: sessionDir, historyLimit: 20 }),
    runner: async (input) => {
      runnerCalls.push(input);
      return { reply: `reply for ${input.message}` };
    },
  });

  const port = await listen(server);
  try {
    const send = (content) => fetch(`http://127.0.0.1:${port}/api/agents/chat`, {
      method: "POST",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId: "customer-debounce",
        userId: "user-1",
        content,
      }),
    }).then((response) => response.json());

    const first = send("第一句");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = send("第二句");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const third = send("第三句");

    const payloads = await Promise.all([first, second, third]);

    assert.equal(runnerCalls.length, 1);
    assert.match(runnerCalls[0].message, /第一句/);
    assert.match(runnerCalls[0].message, /第二句/);
    assert.match(runnerCalls[0].message, /第三句/);
    assert.equal(payloads[0].reply, payloads[1].reply);
    assert.equal(payloads[1].reply, payloads[2].reply);
  } finally {
    await close(server);
  }
});

test("HTTP server exposes source SOUL.md for a logical agent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const sourceWorkspace = path.join(dir, "source", "main");
  const templateWorkspace = path.join(dir, "templates", "main");
  fs.mkdirSync(sourceWorkspace, { recursive: true });
  fs.mkdirSync(templateWorkspace, { recursive: true });
  fs.writeFileSync(path.join(sourceWorkspace, "SOUL.md"), "# SOUL\n\n已有客服人格", "utf8");
  fs.writeFileSync(path.join(templateWorkspace, "SOUL.md"), "# SOUL\n\n旧模板人格", "utf8");

  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    agentTemplates: {
      main: {
        logicalAgentId: "main",
        sourceWorkspace,
        templateWorkspace,
        workers: [],
        workerWorkspaces: {},
      },
    },
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: path.join(dir, "sessions"), historyLimit: 20 }),
    runner: async () => ({ reply: "ok" }),
  });

  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/main/soul`, {
      headers: { Authorization: "Bearer secret" },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.agent_id, "main");
    assert.equal(payload.soul.content, "# SOUL\n\n已有客服人格");
    assert.equal(payload.soul.path, path.join(sourceWorkspace, "SOUL.md"));
    assert.equal(payload.soul.source_workspace, sourceWorkspace);
  } finally {
    await close(server);
  }
});

test("HTTP server overwrites SOUL.md and syncs it to worker workspaces", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const sourceWorkspace = path.join(dir, "source", "main");
  const templateWorkspace = path.join(dir, "templates", "main");
  const workerWorkspace = path.join(dir, "workers", "main-1");
  fs.mkdirSync(sourceWorkspace, { recursive: true });
  fs.mkdirSync(templateWorkspace, { recursive: true });
  fs.mkdirSync(workerWorkspace, { recursive: true });
  fs.writeFileSync(path.join(sourceWorkspace, "SOUL.md"), "old source soul", "utf8");
  fs.writeFileSync(path.join(templateWorkspace, "SOUL.md"), "old template soul", "utf8");
  fs.writeFileSync(path.join(workerWorkspace, "SOUL.md"), "old worker soul", "utf8");

  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    agentTemplates: {
      main: {
        logicalAgentId: "main",
        sourceWorkspace,
        templateWorkspace,
        workers: ["main-1"],
        workerWorkspaces: { "main-1": workerWorkspace },
      },
    },
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: path.join(dir, "sessions"), historyLimit: 20 }),
    runner: async () => ({ reply: "ok" }),
  });

  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/main/soul`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: "# SOUL\n\n新的客服人格" }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.soul.path, path.join(sourceWorkspace, "SOUL.md"));
    assert.equal(payload.sync.template.path, path.join(templateWorkspace, "SOUL.md"));
    assert.equal(payload.sync.workers.length, 1);
    assert.equal(fs.readFileSync(path.join(sourceWorkspace, "SOUL.md"), "utf8"), "# SOUL\n\n新的客服人格");
    assert.equal(fs.readFileSync(path.join(templateWorkspace, "SOUL.md"), "utf8"), "# SOUL\n\n新的客服人格");
    assert.equal(fs.readFileSync(path.join(workerWorkspace, "SOUL.md"), "utf8"), "# SOUL\n\n新的客服人格");
  } finally {
    await close(server);
  }
});

test("HTTP server exposes source WECHAT_ARTICLE_PERSONA.md for a logical agent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const sourceWorkspace = path.join(dir, "source", "snowchuang");
  const templateWorkspace = path.join(dir, "templates", "snowchuang");
  fs.mkdirSync(sourceWorkspace, { recursive: true });
  fs.mkdirSync(templateWorkspace, { recursive: true });
  fs.writeFileSync(
    path.join(sourceWorkspace, "WECHAT_ARTICLE_PERSONA.md"),
    "# 公众号文章人设\n\n写作要亲切、实用，图片要有穿搭场景。",
    "utf8"
  );

  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    agentTemplates: {
      snowchuang: {
        logicalAgentId: "snowchuang",
        sourceWorkspace,
        templateWorkspace,
        workers: [],
        workerWorkspaces: {},
      },
    },
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: path.join(dir, "sessions"), historyLimit: 20 }),
    runner: async () => ({ reply: "ok" }),
  });

  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/snowchuang/wechat-article-persona`, {
      headers: { Authorization: "Bearer secret" },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.agent_id, "snowchuang");
    assert.equal(payload.persona.name, "WECHAT_ARTICLE_PERSONA.md");
    assert.match(payload.persona.content, /图片要有穿搭场景/);
    assert.equal(payload.persona.path, path.join(sourceWorkspace, "WECHAT_ARTICLE_PERSONA.md"));
    assert.equal(payload.persona.source_workspace, sourceWorkspace);
  } finally {
    await close(server);
  }
});

test("configured server wires WECHAT_ARTICLE_PERSONA.md manager from agent templates", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const sourceWorkspace = path.join(dir, "source", "main");
  const templateWorkspace = path.join(dir, "templates", "main");
  fs.mkdirSync(sourceWorkspace, { recursive: true });
  fs.mkdirSync(templateWorkspace, { recursive: true });
  fs.writeFileSync(
    path.join(sourceWorkspace, "WECHAT_ARTICLE_PERSONA.md"),
    "# 公众号文章人设\n\n用于生产入口回归测试。",
    "utf8"
  );

  const server = createServerFromConfig({
    token: "secret",
    defaultAgentId: "main",
    agents: { main: ["main-1"] },
    agentTemplates: {
      main: {
        logicalAgentId: "main",
        sourceWorkspace,
        templateWorkspace,
        workers: ["main-1"],
        workerWorkspaces: {},
      },
    },
    sessionStoreDir: path.join(dir, "sessions"),
    sessionHistoryLimit: 20,
    promptAdapter: "none",
    retrievalEnabled: false,
    queueTimeoutMs: 200,
    stickyTtlMs: 1000,
    soulAdminBodyLimitBytes: 5 * 1024 * 1024,
    soulDistillerTimeoutSeconds: 10,
    agentTimeoutSeconds: 10,
    openclawBin: "openclaw",
  });

  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/main/wechat-article-persona`, {
      headers: { Authorization: "Bearer secret" },
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.persona.source_workspace, sourceWorkspace);
    assert.match(payload.persona.content, /生产入口回归测试/);
  } finally {
    await close(server);
  }
});

test("HTTP server overwrites WECHAT_ARTICLE_PERSONA.md and syncs it to template and workers", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const sourceWorkspace = path.join(dir, "source", "snowchuang");
  const templateWorkspace = path.join(dir, "templates", "snowchuang");
  const workerWorkspace = path.join(dir, "workers", "snowchuang-1");
  fs.mkdirSync(sourceWorkspace, { recursive: true });
  fs.mkdirSync(templateWorkspace, { recursive: true });
  fs.mkdirSync(workerWorkspace, { recursive: true });
  fs.writeFileSync(path.join(sourceWorkspace, "WECHAT_ARTICLE_PERSONA.md"), "old source persona", "utf8");
  fs.writeFileSync(path.join(templateWorkspace, "WECHAT_ARTICLE_PERSONA.md"), "old template persona", "utf8");
  fs.writeFileSync(path.join(workerWorkspace, "WECHAT_ARTICLE_PERSONA.md"), "old worker persona", "utf8");

  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    agentTemplates: {
      snowchuang: {
        logicalAgentId: "snowchuang",
        sourceWorkspace,
        templateWorkspace,
        workers: ["snowchuang-1"],
        workerWorkspaces: { "snowchuang-1": workerWorkspace },
      },
    },
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: path.join(dir, "sessions"), historyLimit: 20 }),
    runner: async () => ({ reply: "ok" }),
  });

  const content = "# 公众号文章人设\n\n写公众号时保持生活化、可执行，配图提示要延续文章语气。";
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/snowchuang/wechat-article-persona`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.persona.name, "WECHAT_ARTICLE_PERSONA.md");
    assert.equal(payload.persona.path, path.join(sourceWorkspace, "WECHAT_ARTICLE_PERSONA.md"));
    assert.equal(payload.sync.template.path, path.join(templateWorkspace, "WECHAT_ARTICLE_PERSONA.md"));
    assert.equal(payload.sync.workers.length, 1);
    assert.equal(fs.readFileSync(path.join(sourceWorkspace, "WECHAT_ARTICLE_PERSONA.md"), "utf8"), content);
    assert.equal(fs.readFileSync(path.join(templateWorkspace, "WECHAT_ARTICLE_PERSONA.md"), "utf8"), content);
    assert.equal(fs.readFileSync(path.join(workerWorkspace, "WECHAT_ARTICLE_PERSONA.md"), "utf8"), content);
  } finally {
    await close(server);
  }
});

test("HTTP server accepts multipart WECHAT_ARTICLE_PERSONA.md uploads", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const sourceWorkspace = path.join(dir, "source", "snowchuang");
  const templateWorkspace = path.join(dir, "templates", "snowchuang");
  fs.mkdirSync(sourceWorkspace, { recursive: true });
  fs.mkdirSync(templateWorkspace, { recursive: true });

  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    agentTemplates: {
      snowchuang: {
        logicalAgentId: "snowchuang",
        sourceWorkspace,
        templateWorkspace,
        workers: [],
        workerWorkspaces: {},
      },
    },
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: path.join(dir, "sessions"), historyLimit: 20 }),
    runner: async () => ({ reply: "ok" }),
  });

  const port = await listen(server);
  const form = new FormData();
  form.set(
    "personaFile",
    new Blob(["# 公众号文章人设\n\n图片提示词要围绕文章主题，不单独跑偏。"], { type: "text/markdown" }),
    "WECHAT_ARTICLE_PERSONA.md"
  );

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/snowchuang/wechat-article-persona`, {
      method: "PUT",
      headers: { Authorization: "Bearer secret" },
      body: form,
    });

    assert.equal(response.status, 200);
    assert.match(
      fs.readFileSync(path.join(sourceWorkspace, "WECHAT_ARTICLE_PERSONA.md"), "utf8"),
      /图片提示词要围绕文章主题/
    );
  } finally {
    await close(server);
  }
});

test("HTTP server accepts multipart SOUL.md uploads with mixed-case boundary", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const sourceWorkspace = path.join(dir, "source", "main");
  const templateWorkspace = path.join(dir, "templates", "main");
  fs.mkdirSync(sourceWorkspace, { recursive: true });
  fs.mkdirSync(templateWorkspace, { recursive: true });
  fs.writeFileSync(path.join(sourceWorkspace, "SOUL.md"), "old source soul", "utf8");

  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    agentTemplates: {
      main: {
        logicalAgentId: "main",
        sourceWorkspace,
        templateWorkspace,
        workers: [],
        workerWorkspaces: {},
      },
    },
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: path.join(dir, "sessions"), historyLimit: 20 }),
    runner: async () => ({ reply: "ok" }),
  });

  const port = await listen(server);
  const boundary = "AaB03xYz";
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="soulFile"; filename="SOUL.md"',
    "Content-Type: text/markdown",
    "",
    "# SOUL\n\nmultipart 客服人格",
    `--${boundary}--`,
    "",
  ].join("\r\n");

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/main/soul`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer secret",
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(fs.readFileSync(path.join(sourceWorkspace, "SOUL.md"), "utf8"), "# SOUL\n\nmultipart 客服人格");
  } finally {
    await close(server);
  }
});

test("HTTP server distills uploaded chat history into SOUL.md", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const sourceWorkspace = path.join(dir, "source", "main");
  const templateWorkspace = path.join(dir, "templates", "main");
  const workerWorkspace = path.join(dir, "workers", "main-1");
  fs.mkdirSync(sourceWorkspace, { recursive: true });
  fs.mkdirSync(templateWorkspace, { recursive: true });
  fs.mkdirSync(workerWorkspace, { recursive: true });
  fs.writeFileSync(path.join(sourceWorkspace, "SOUL.md"), "# SOUL\n\n原有人格", "utf8");
  fs.writeFileSync(path.join(templateWorkspace, "SOUL.md"), "# SOUL\n\n旧模板人格", "utf8");

  const distillerCalls = [];
  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    agentTemplates: {
      main: {
        logicalAgentId: "main",
        sourceWorkspace,
        templateWorkspace,
        workers: ["main-1"],
        workerWorkspaces: { "main-1": workerWorkspace },
      },
    },
    soulDistiller: {
      distill: async (input) => {
        distillerCalls.push(input);
        return {
          content: "# SOUL\n\n蒸馏后的客服人格",
          skill: { name: "dot-skill", path: path.join(dir, "skills", "dot-skill") },
        };
      },
    },
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: path.join(dir, "sessions"), historyLimit: 20 }),
    runner: async () => ({ reply: "ok" }),
  });

  const port = await listen(server);
  try {
    const form = new FormData();
    form.set("chatFile", new Blob(["用户：价格多少？\n客服：您好，会员价 138。"], { type: "text/plain" }), "chat.txt");

    const response = await fetch(`http://127.0.0.1:${port}/api/agents/main/soul/distill`, {
      method: "POST",
      headers: { Authorization: "Bearer secret" },
      body: form,
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.distillation.skill.name, "dot-skill");
    assert.equal(distillerCalls.length, 1);
    assert.equal(distillerCalls[0].logicalAgentId, "main");
    assert.equal(distillerCalls[0].currentSoul, "# SOUL\n\n原有人格");
    assert.match(distillerCalls[0].chatLog, /会员价 138/);
    assert.equal(distillerCalls[0].filename, "chat.txt");
    assert.equal(fs.readFileSync(path.join(sourceWorkspace, "SOUL.md"), "utf8"), "# SOUL\n\n蒸馏后的客服人格");
    assert.equal(fs.readFileSync(path.join(templateWorkspace, "SOUL.md"), "utf8"), "# SOUL\n\n蒸馏后的客服人格");
    assert.equal(fs.readFileSync(path.join(workerWorkspace, "SOUL.md"), "utf8"), "# SOUL\n\n蒸馏后的客服人格");
  } finally {
    await close(server);
  }
});

test("HTTP server rejects SOUL updates when sourceWorkspace is missing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const templateWorkspace = path.join(dir, "templates", "main");
  fs.mkdirSync(templateWorkspace, { recursive: true });

  const server = createApp({
    token: "secret",
    defaultAgentId: "main",
    agentTemplates: {
      main: {
        logicalAgentId: "main",
        templateWorkspace,
        workers: [],
        workerWorkspaces: {},
      },
    },
    pool: new AgentPool({
      defaultAgentId: "main",
      queueTimeoutMs: 200,
      stickyTtlMs: 1000,
      agents: { main: ["main-1"] },
    }),
    queues: new ConversationQueueManager(),
    sessionStore: new SessionStore({ dir: path.join(dir, "sessions"), historyLimit: 20 }),
    runner: async () => ({ reply: "ok" }),
  });

  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/agents/main/soul`, {
      headers: { Authorization: "Bearer secret" },
    });

    assert.equal(response.status, 404);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.error, "agent_source_not_found");
  } finally {
    await close(server);
  }
});
