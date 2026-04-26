const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../src/http-server");
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
      windowMs: 20,
      maxWaitMs: 100,
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
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = send("第二句");
    await new Promise((resolve) => setTimeout(resolve, 5));
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
