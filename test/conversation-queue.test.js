const test = require("node:test");
const assert = require("node:assert/strict");

const { ConversationQueueManager } = require("../src/conversation-queue");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("ConversationQueueManager runs the same conversation sequentially", async () => {
  const queues = new ConversationQueueManager();
  const events = [];

  const first = queues.run("main", "customer-1", async () => {
    events.push("first:start");
    await delay(30);
    events.push("first:end");
    return "first";
  });

  const second = queues.run("main", "customer-1", async () => {
    events.push("second:start");
    await delay(1);
    events.push("second:end");
    return "second";
  });

  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("ConversationQueueManager allows different conversations to run concurrently", async () => {
  const queues = new ConversationQueueManager();
  let active = 0;
  let maxActive = 0;

  await Promise.all([
    queues.run("main", "customer-1", async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(30);
      active -= 1;
    }),
    queues.run("main", "customer-2", async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(30);
      active -= 1;
    }),
  ]);

  assert.equal(maxActive, 2);
  assert.equal(queues.snapshot().conversationQueues, 0);
});

test("ConversationQueueManager snapshot exposes active and pending turns", async () => {
  const queues = new ConversationQueueManager();
  let releaseFirst;

  const first = queues.run(
    "main",
    "customer-1",
    () =>
      new Promise((resolve) => {
        releaseFirst = () => resolve("first");
      })
  );

  await delay(5);

  const second = queues.run("main", "customer-1", async () => "second");
  await delay(5);

  const snapshot = queues.snapshot();
  assert.equal(snapshot.conversationQueues, 1);
  assert.equal(snapshot.activeTurns, 1);
  assert.equal(snapshot.queuedTurns, 1);
  assert.equal(snapshot.conversations[0].logicalAgentId, "main");
  assert.equal(snapshot.conversations[0].conversationId, "customer-1");

  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.equal(queues.snapshot().conversationQueues, 0);
});

test("ConversationQueueManager keeps a later task queued while an earlier cleanup runs", async () => {
  const queues = new ConversationQueueManager();
  const events = [];

  const first = queues.run("main", "customer-1", async () => {
    events.push("first:start");
    await delay(10);
    events.push("first:end");
  });

  const second = queues.run("main", "customer-1", async () => {
    events.push("second:start");
    await delay(40);
    events.push("second:end");
  });

  await first;
  await delay(5);

  const third = queues.run("main", "customer-1", async () => {
    events.push("third:start");
    events.push("third:end");
  });

  await Promise.all([second, third]);

  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
    "third:start",
    "third:end",
  ]);
});
