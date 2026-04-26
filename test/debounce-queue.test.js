const test = require("node:test");
const assert = require("node:assert/strict");

const { DebounceQueue, formatDebouncedMessage, looksIncompleteMessage } = require("../src/debounce-queue");

test("DebounceQueue merges same-conversation messages into one task", async () => {
  const debounce = new DebounceQueue({
    enabled: true,
    windowMs: 20,
    maxWaitMs: 100,
  });
  const taskInputs = [];

  const first = debounce.run("main", "customer-1", { conversationId: "customer-1", message: "第一句" }, async (normalized) => {
    taskInputs.push(normalized);
    return { reply: `merged=${normalized.message}` };
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = debounce.run("main", "customer-1", { conversationId: "customer-1", message: "第二句" }, async (normalized) => {
    taskInputs.push(normalized);
    return { reply: `merged=${normalized.message}` };
  });

  const results = await Promise.all([first, second]);

  assert.equal(taskInputs.length, 1);
  assert.match(taskInputs[0].message, /第一句/);
  assert.match(taskInputs[0].message, /第二句/);
  assert.deepEqual(results, [results[0], results[0]]);
  assert.equal(debounce.snapshot().pendingMessages, 0);
});

test("DebounceQueue does not merge different conversations", async () => {
  const debounce = new DebounceQueue({
    enabled: true,
    windowMs: 10,
    maxWaitMs: 100,
  });
  const taskInputs = [];

  await Promise.all([
    debounce.run("main", "customer-1", { conversationId: "customer-1", message: "A" }, async (normalized) => {
      taskInputs.push(normalized);
      return "A";
    }),
    debounce.run("main", "customer-2", { conversationId: "customer-2", message: "B" }, async (normalized) => {
      taskInputs.push(normalized);
      return "B";
    }),
  ]);

  assert.equal(taskInputs.length, 2);
});

test("DebounceQueue bypasses immediately when disabled", async () => {
  const debounce = new DebounceQueue({
    enabled: false,
    windowMs: 20,
    maxWaitMs: 100,
  });
  let calls = 0;

  const result = await debounce.run("main", "customer-1", { message: "hello" }, async (normalized) => {
    calls += 1;
    return normalized.message;
  });

  assert.equal(calls, 1);
  assert.equal(result, "hello");
});

test("DebounceQueue adds extra wait for incomplete trailing messages", async () => {
  const debounce = new DebounceQueue({
    enabled: true,
    windowMs: 10,
    maxWaitMs: 80,
    incompleteMessageExtraWaitEnabled: true,
    incompleteMessageExtraWaitMs: 35,
  });
  const taskInputs = [];

  const result = debounce.run("main", "customer-1", { message: "我想问一下" }, async (normalized) => {
    taskInputs.push(normalized);
    return normalized.message;
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(taskInputs.length, 0);
  assert.equal(await result, "我想问一下");
  assert.equal(taskInputs.length, 1);
});

test("DebounceQueue caps incomplete extra wait at maxWaitMs", async () => {
  const debounce = new DebounceQueue({
    enabled: true,
    windowMs: 20,
    maxWaitMs: 35,
    incompleteMessageExtraWaitEnabled: true,
    incompleteMessageExtraWaitMs: 100,
  });

  const startedAt = Date.now();
  await debounce.run("main", "customer-1", { message: "还有" }, async (normalized) => normalized.message);
  const elapsed = Date.now() - startedAt;

  assert.ok(elapsed < 80);
});

test("formatDebouncedMessage keeps one message unchanged and numbers multiple messages", () => {
  assert.equal(formatDebouncedMessage(["hello"]), "hello");
  assert.match(formatDebouncedMessage(["hello", "world"]), /1\. hello/);
  assert.match(formatDebouncedMessage(["hello", "world"]), /2\. world/);
});

test("looksIncompleteMessage distinguishes incomplete tails from complete questions", () => {
  assert.equal(looksIncompleteMessage("我想问一下"), true);
  assert.equal(looksIncompleteMessage("还有"), true);
  assert.equal(looksIncompleteMessage("这个多少钱？"), false);
  assert.equal(looksIncompleteMessage("帮我查一下订单号12345678"), false);
  assert.equal(looksIncompleteMessage("你好"), false);
});
