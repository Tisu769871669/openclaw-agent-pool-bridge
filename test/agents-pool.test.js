const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildAgentDefinition,
  buildSetupPlan,
  discoverLocalWorkspaces,
  executeSetupPlan,
  mergeAgentConfig,
  parseSelection,
} = require("../scripts/agents-pool");

test("discoverLocalWorkspaces finds main and named OpenClaw workspaces", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-pool-"));
  const openclawDir = path.join(dir, ".openclaw");
  fs.mkdirSync(path.join(openclawDir, "workspace"), { recursive: true });
  fs.mkdirSync(path.join(openclawDir, "workspace-agent1"), { recursive: true });
  fs.mkdirSync(path.join(openclawDir, "workers", "workspace", "agent1-1"), { recursive: true });

  const workspaces = discoverLocalWorkspaces({ homeDir: dir });

  assert.deepEqual(
    workspaces.map((item) => ({ logicalAgentId: item.logicalAgentId, workspace: item.workspace })),
    [
      { logicalAgentId: "main", workspace: path.join(openclawDir, "workspace") },
      { logicalAgentId: "agent1", workspace: path.join(openclawDir, "workspace-agent1") },
    ]
  );
});

test("parseSelection supports comma-separated numbers and all", () => {
  assert.deepEqual(parseSelection("1, 3", 4), [0, 2]);
  assert.deepEqual(parseSelection("all", 3), [0, 1, 2]);
  assert.throws(() => parseSelection("0", 3), /Invalid selection/);
  assert.throws(() => parseSelection("4", 3), /Invalid selection/);
});

test("buildAgentDefinition creates deterministic worker and template paths", () => {
  const definition = buildAgentDefinition({
    logicalAgentId: "agent1",
    workerCount: 3,
    templateRoot: "/root/openclaw-agent-templates",
    workerWorkspaceRoot: "/root/.openclaw/workers/workspace",
  });

  assert.deepEqual(definition, {
    templateWorkspace: "/root/openclaw-agent-templates/agent1",
    workerWorkspaceRoot: "/root/.openclaw/workers/workspace",
    workers: ["agent1-1", "agent1-2", "agent1-3"],
  });
});

test("buildSetupPlan maps selected workspaces into pool operations", () => {
  const plan = buildSetupPlan({
    selectedWorkspaces: [
      { logicalAgentId: "main", workspace: "/root/.openclaw/workspace" },
      { logicalAgentId: "agent1", workspace: "/root/.openclaw/workspace-agent1" },
    ],
    workerCount: 2,
    templateRoot: "/root/openclaw-agent-templates",
    workerWorkspaceRoot: "/root/.openclaw/workers/workspace",
    workerAgentDirRoot: "/root/.openclaw/workers/agents",
  });

  assert.equal(plan.agents.length, 2);
  assert.equal(plan.agents[0].logicalAgentId, "main");
  assert.equal(plan.agents[0].sourceWorkspace, "/root/.openclaw/workspace");
  assert.equal(plan.agents[0].templateWorkspace, "/root/openclaw-agent-templates/main");
  assert.deepEqual(plan.agents[0].workers, ["main-1", "main-2"]);
  assert.equal(plan.agents[0].workerAgentDirs["main-1"], "/root/.openclaw/workers/agents/main-1");
  assert.equal(plan.agents[1].logicalAgentId, "agent1");
});

test("mergeAgentConfig preserves existing agents and updates selected definitions", () => {
  const existing = {
    defaultAgentId: "main",
    agents: {
      main: ["old-main-1"],
      untouched: ["untouched-1"],
    },
  };
  const plan = buildSetupPlan({
    selectedWorkspaces: [{ logicalAgentId: "main", workspace: "/root/.openclaw/workspace" }],
    workerCount: 2,
    templateRoot: "/root/openclaw-agent-templates",
    workerWorkspaceRoot: "/root/.openclaw/workers/workspace",
    workerAgentDirRoot: "/root/.openclaw/workers/agents",
  });

  const merged = mergeAgentConfig(existing, plan);

  assert.deepEqual(merged, {
    defaultAgentId: "main",
    agents: {
      main: {
        templateWorkspace: "/root/openclaw-agent-templates/main",
        workerWorkspaceRoot: "/root/.openclaw/workers/workspace",
        workers: ["main-1", "main-2"],
      },
      untouched: ["untouched-1"],
    },
  });
});

test("executeSetupPlan dry-run tolerates templates that would be created", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-pool-"));
  const sourceWorkspace = path.join(dir, ".openclaw", "workspace");
  fs.mkdirSync(sourceWorkspace, { recursive: true });
  fs.writeFileSync(path.join(sourceWorkspace, "SOUL.md"), "test soul", "utf8");

  const plan = buildSetupPlan({
    selectedWorkspaces: [{ logicalAgentId: "main", workspace: sourceWorkspace }],
    workerCount: 1,
    templateRoot: path.join(dir, "templates"),
    workerWorkspaceRoot: path.join(dir, "workers", "workspace"),
    workerAgentDirRoot: path.join(dir, "workers", "agents"),
  });
  const nextConfig = mergeAgentConfig({}, plan);
  const output = [];

  executeSetupPlan(plan, {
    rootDir: dir,
    configPath: path.join(dir, "agent-pool.config.json"),
    nextConfig,
    dryRun: true,
    createWorkers: false,
    refreshTemplates: true,
    syncWorkers: true,
    restartService: false,
    stdout: { write: (value) => output.push(value) },
  });

  assert.equal(fs.existsSync(path.join(dir, "templates", "main")), false);
  assert.equal(fs.existsSync(path.join(dir, "agent-pool.config.json")), false);
  assert.equal(output.some((line) => line.includes("would sync main")), true);
});
