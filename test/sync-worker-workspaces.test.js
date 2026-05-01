const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadConfig } = require("../src/config");
const { syncWorkerWorkspaces } = require("../scripts/sync-worker-workspaces");

function write(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

test("syncWorkerWorkspaces mirrors template files to every worker and preserves runtime exclusions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));

  write(path.join(dir, "templates", "main", "SOUL.md"), "new soul");
  write(path.join(dir, "templates", "main", "skills", "metast", "SKILL.md"), "skill");
  write(path.join(dir, "templates", "main", "knowledge", "faq.md"), "faq");
  write(path.join(dir, "templates", "main", ".env"), "SHOULD_NOT_COPY=1");
  write(path.join(dir, "templates", "main", ".git", "config"), "git");
  write(path.join(dir, "templates", "main", "tmp", "scratch.txt"), "scratch");

  write(path.join(dir, "workers", "main-1", "SOUL.md"), "old soul");
  write(path.join(dir, "workers", "main-1", "obsolete.md"), "remove me");
  write(path.join(dir, "workers", "main-1", ".sessions", "keep.json"), "{}");
  write(path.join(dir, "workers", "main-1", "agent.log"), "keep log");
  fs.mkdirSync(path.join(dir, "workers", "main-2"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "agent-pool.config.json"),
    JSON.stringify({
      defaultAgentId: "main",
      agents: {
        main: {
          templateWorkspace: "templates/main",
          workerWorkspaceRoot: "workers",
          workers: ["main-1", "main-2"],
        },
      },
    }),
    "utf8"
  );

  const config = loadConfig({ AGENT_POOL_CONFIG: "agent-pool.config.json" }, dir);
  const result = syncWorkerWorkspaces(config, "main");

  assert.equal(result.workers.length, 2);
  for (const worker of ["main-1", "main-2"]) {
    assert.equal(read(path.join(dir, "workers", worker, "SOUL.md")), "new soul");
    assert.equal(read(path.join(dir, "workers", worker, "skills", "metast", "SKILL.md")), "skill");
    assert.equal(read(path.join(dir, "workers", worker, "knowledge", "faq.md")), "faq");
    assert.equal(exists(path.join(dir, "workers", worker, ".env")), false);
    assert.equal(exists(path.join(dir, "workers", worker, ".git", "config")), false);
    assert.equal(exists(path.join(dir, "workers", worker, "tmp", "scratch.txt")), false);
  }

  assert.equal(exists(path.join(dir, "workers", "main-1", "obsolete.md")), false);
  assert.equal(exists(path.join(dir, "workers", "main-1", ".sessions", "keep.json")), true);
  assert.equal(exists(path.join(dir, "workers", "main-1", "agent.log")), true);
});

test("syncWorkerWorkspaces dry-run reports changes without touching worker files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  write(path.join(dir, "templates", "main", "SOUL.md"), "new soul");
  write(path.join(dir, "workers", "main-1", "SOUL.md"), "old soul");

  fs.writeFileSync(
    path.join(dir, "agent-pool.config.json"),
    JSON.stringify({
      agents: {
        main: {
          templateWorkspace: "templates/main",
          workerWorkspaceRoot: "workers",
          workers: ["main-1"],
        },
      },
    }),
    "utf8"
  );

  const config = loadConfig({ AGENT_POOL_CONFIG: "agent-pool.config.json" }, dir);
  const result = syncWorkerWorkspaces(config, "main", { dryRun: true });

  assert.equal(read(path.join(dir, "workers", "main-1", "SOUL.md")), "old soul");
  assert.ok(result.operations.some((operation) => operation.type === "copy"));
});

test("syncWorkerWorkspaces syncs worker agent models from the logical agent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const openclawDir = path.join(dir, ".openclaw");
  write(path.join(openclawDir, "workspace-main", "SOUL.md"), "source soul");
  write(path.join(dir, "templates", "main", "SOUL.md"), "template soul");
  fs.mkdirSync(path.join(dir, "workers", "main-1"), { recursive: true });
  fs.mkdirSync(path.join(dir, "workers", "main-2"), { recursive: true });
  write(
    path.join(openclawDir, "openclaw.json"),
    JSON.stringify({
      agents: {
        list: [
          { id: "main", model: "volcengine-plan/doubao-seed-2.0-lite" },
          { id: "main-1", model: "minimax/MiniMax-M2.5" },
          { id: "main-2", model: "minimax/MiniMax-M2.5" },
        ],
      },
    })
  );
  write(
    path.join(dir, "agent-pool.config.json"),
    JSON.stringify({
      agents: {
        main: {
          sourceWorkspace: ".openclaw/workspace-main",
          templateWorkspace: "templates/main",
          workerWorkspaceRoot: "workers",
          workers: ["main-1", "main-2"],
        },
      },
    })
  );

  const config = loadConfig({ AGENT_POOL_CONFIG: "agent-pool.config.json" }, dir);
  const result = syncWorkerWorkspaces(config, "main");
  const openclawConfig = JSON.parse(read(path.join(openclawDir, "openclaw.json")));

  assert.equal(openclawConfig.agents.list.find((agent) => agent.id === "main-1").model, "volcengine-plan/doubao-seed-2.0-lite");
  assert.equal(openclawConfig.agents.list.find((agent) => agent.id === "main-2").model, "volcengine-plan/doubao-seed-2.0-lite");
  assert.ok(result.operations.some((operation) => operation.type === "sync-model" && operation.worker === "main-1"));
});
