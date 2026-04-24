const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createApp } = require("../src/http-server");
const { AgentPool } = require("../src/agent-pool");
const { ConversationQueueManager } = require("../src/conversation-queue");
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
