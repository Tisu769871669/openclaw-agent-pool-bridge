const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentPool, createQueueTimeoutError } = require("../src/agent-pool");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("AgentPool never leases more workers than configured", async () => {
  const pool = new AgentPool({
    defaultAgentId: "main",
    queueTimeoutMs: 200,
    stickyTtlMs: 1000,
    agents: {
      main: ["main-1", "main-2", "main-3", "main-4", "main-5"],
    },
  });

  const active = new Set();
  let maxActive = 0;

  await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      pool.withWorker("main", `conversation-${index}`, async (lease) => {
        active.add(lease.workerAgentId);
        maxActive = Math.max(maxActive, active.size);
        await delay(20);
        active.delete(lease.workerAgentId);
        return lease.workerAgentId;
      })
    )
  );

  assert.equal(maxActive, 5);
  assert.equal(pool.snapshot().busyWorkers, 0);
});

test("AgentPool releases a worker after task failure", async () => {
  const pool = new AgentPool({
    defaultAgentId: "main",
    queueTimeoutMs: 200,
    stickyTtlMs: 1000,
    agents: {
      main: ["main-1"],
    },
  });

  await assert.rejects(
    pool.withWorker("main", "conversation-1", async () => {
      throw new Error("runner failed");
    }),
    /runner failed/
  );

  assert.equal(pool.snapshot().busyWorkers, 0);

  const worker = await pool.withWorker("main", "conversation-2", async (lease) => lease.workerAgentId);
  assert.equal(worker, "main-1");
});

test("AgentPool rejects queued work after queue timeout", async () => {
  const pool = new AgentPool({
    defaultAgentId: "main",
    queueTimeoutMs: 30,
    stickyTtlMs: 1000,
    agents: {
      main: ["main-1"],
    },
  });

  const first = pool.withWorker("main", "conversation-1", async () => {
    await delay(120);
    return "first";
  });

  await delay(5);

  await assert.rejects(
    pool.withWorker("main", "conversation-2", async () => "second"),
    (error) => {
      assert.equal(error.code, "queue_timeout");
      assert.equal(error.statusCode, 429);
      return true;
    }
  );

  assert.equal(await first, "first");
  assert.equal(createQueueTimeoutError("main").statusCode, 429);
});

test("AgentPool prefers sticky worker while it is available", async () => {
  const pool = new AgentPool({
    defaultAgentId: "main",
    queueTimeoutMs: 200,
    stickyTtlMs: 10_000,
    agents: {
      main: ["main-1", "main-2"],
    },
  });

  const first = await pool.withWorker("main", "conversation-1", async (lease) => lease.workerAgentId);
  const second = await pool.withWorker("main", "conversation-1", async (lease) => lease.workerAgentId);

  assert.equal(first, "main-1");
  assert.equal(second, "main-1");
});

test("AgentPool can reassign a sticky conversation when its prior worker is busy", async () => {
  const pool = new AgentPool({
    defaultAgentId: "main",
    queueTimeoutMs: 200,
    stickyTtlMs: 10_000,
    agents: {
      main: ["main-1", "main-2"],
    },
  });

  assert.equal(
    await pool.withWorker("main", "conversation-1", async (lease) => lease.workerAgentId),
    "main-1"
  );

  const blocker = pool.withWorker("main", "conversation-1", async (lease) => {
    assert.equal(lease.workerAgentId, "main-1");
    await delay(80);
    return "blocked";
  });

  await delay(5);
  const reassigned = await pool.withWorker("main", "conversation-1", async (lease) => lease.workerAgentId);

  assert.equal(reassigned, "main-2");
  assert.equal(await blocker, "blocked");
});
