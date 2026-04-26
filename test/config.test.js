const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadConfig } = require("../src/config");

test("loadConfig supports template workspace agent definitions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  fs.mkdirSync(path.join(dir, "templates"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "agent-pool.config.json"),
    JSON.stringify({
      defaultAgentId: "main",
      agents: {
        main: {
          templateWorkspace: "templates/main",
          workerWorkspaceRoot: "workers/workspace",
          workers: ["main-1", "main-2"],
        },
        legacy: ["legacy-1"],
      },
    }),
    "utf8"
  );

  const config = loadConfig(
    {
      AGENT_POOL_CONFIG: "agent-pool.config.json",
    },
    dir
  );

  assert.deepEqual(config.agents, {
    main: ["main-1", "main-2"],
    legacy: ["legacy-1"],
  });
  assert.deepEqual(config.agentTemplates.main, {
    logicalAgentId: "main",
    templateWorkspace: path.join(dir, "templates", "main"),
    workerWorkspaceRoot: path.join(dir, "workers", "workspace"),
    workers: ["main-1", "main-2"],
    workerWorkspaces: {
      "main-1": path.join(dir, "workers", "workspace", "main-1"),
      "main-2": path.join(dir, "workers", "workspace", "main-2"),
    },
  });
  assert.equal(config.agentTemplates.legacy, undefined);
});

test("loadConfig supports debounce environment options", () => {
  const config = loadConfig({
    DEBOUNCE_ENABLED: "true",
    DEBOUNCE_WINDOW_MS: "1500",
    DEBOUNCE_MAX_WAIT_MS: "5000",
    DEBOUNCE_MAX_MESSAGES: "12",
  });

  assert.equal(config.debounceEnabled, true);
  assert.equal(config.debounceWindowMs, 1500);
  assert.equal(config.debounceMaxWaitMs, 5000);
  assert.equal(config.debounceMaxMessages, 12);
});
