const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { SessionStore } = require("../src/session-store");

test("SessionStore isolates history by logical agent and conversation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const store = new SessionStore({ dir, historyLimit: 4 });

  store.appendTurn("main", "customer-1", "hello", "hi");
  store.appendTurn("main", "customer-2", "price", "100");
  store.appendTurn("snowchuang", "customer-1", "hello", "snow");

  assert.deepEqual(store.load("main", "customer-1"), [
    { role: "user", text: "hello" },
    { role: "assistant", text: "hi" },
  ]);
  assert.deepEqual(store.load("main", "customer-2"), [
    { role: "user", text: "price" },
    { role: "assistant", text: "100" },
  ]);
  assert.deepEqual(store.load("snowchuang", "customer-1"), [
    { role: "user", text: "hello" },
    { role: "assistant", text: "snow" },
  ]);
});

test("SessionStore trims old messages to the configured history limit", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const store = new SessionStore({ dir, historyLimit: 4 });

  store.appendTurn("main", "customer-1", "one", "one-reply");
  store.appendTurn("main", "customer-1", "two", "two-reply");
  store.appendTurn("main", "customer-1", "three", "three-reply");

  assert.deepEqual(store.load("main", "customer-1"), [
    { role: "user", text: "two" },
    { role: "assistant", text: "two-reply" },
    { role: "user", text: "three" },
    { role: "assistant", text: "three-reply" },
  ]);
});
