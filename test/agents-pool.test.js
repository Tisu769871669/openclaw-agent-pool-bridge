const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const packageJson = require("../package.json");

const {
  buildAgentDefinition,
  buildSetupPlan,
  discoverLocalWorkspaces,
  executeSetupPlan,
  mergeAgentConfig,
  parseSelection,
  runCli,
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

test("buildSetupPlan reuses existing worker names and template paths by default", () => {
  const plan = buildSetupPlan({
    selectedWorkspaces: [{ logicalAgentId: "main", workspace: "/root/.openclaw/workspace" }],
    workerCount: 5,
    templateRoot: "/root/openclaw-agent-templates",
    workerWorkspaceRoot: "/root/.openclaw/workers/workspace",
    workerAgentDirRoot: "/root/.openclaw/workers/agents",
    existingConfig: {
      agents: {
        main: {
          sourceWorkspace: "/root/.openclaw/workspace",
          templateWorkspace: "/root/openclaw-agent-templates/sudan-main",
          workerWorkspaceRoot: "/root/.openclaw/workers/workspace",
          workers: ["sudan-main-1", "sudan-main-2"],
        },
      },
    },
  });

  assert.equal(plan.agents[0].templateWorkspace, "/root/openclaw-agent-templates/sudan-main");
  assert.deepEqual(plan.agents[0].workers, ["sudan-main-1", "sudan-main-2"]);
  assert.equal(plan.agents[0].workerWorkspaces["sudan-main-1"], "/root/.openclaw/workers/workspace/sudan-main-1");
});

test("buildSetupPlan expands existing worker prefix when count is explicit", () => {
  const plan = buildSetupPlan({
    selectedWorkspaces: [{ logicalAgentId: "main", workspace: "/root/.openclaw/workspace" }],
    workerCount: 3,
    workerCountExplicit: true,
    templateRoot: "/root/openclaw-agent-templates",
    workerWorkspaceRoot: "/root/.openclaw/workers/workspace",
    workerAgentDirRoot: "/root/.openclaw/workers/agents",
    existingConfig: {
      agents: {
        main: {
          sourceWorkspace: "/root/.openclaw/workspace",
          templateWorkspace: "/root/openclaw-agent-templates/sudan-main",
          workerWorkspaceRoot: "/root/.openclaw/workers/workspace",
          workers: ["sudan-main-1", "sudan-main-2"],
        },
      },
    },
  });

  assert.deepEqual(plan.agents[0].workers, ["sudan-main-1", "sudan-main-2", "sudan-main-3"]);
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
        sourceWorkspace: "/root/.openclaw/workspace",
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

test("sync command refreshes template from configured sourceWorkspace", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-pool-"));
  const sourceWorkspace = path.join(dir, "source", "main");
  const templateWorkspace = path.join(dir, "templates", "main");
  const workerWorkspace = path.join(dir, "workers", "workspace", "main-1");
  fs.mkdirSync(sourceWorkspace, { recursive: true });
  fs.mkdirSync(templateWorkspace, { recursive: true });
  fs.mkdirSync(workerWorkspace, { recursive: true });
  fs.writeFileSync(path.join(sourceWorkspace, "SOUL.md"), "source soul", "utf8");
  fs.writeFileSync(path.join(templateWorkspace, "SOUL.md"), "old template soul", "utf8");
  fs.writeFileSync(path.join(workerWorkspace, "SOUL.md"), "old worker soul", "utf8");
  fs.writeFileSync(
    path.join(dir, "agent-pool.config.json"),
    JSON.stringify({
      defaultAgentId: "main",
      agents: {
        main: {
          sourceWorkspace,
          templateWorkspace,
          workerWorkspaceRoot: path.join(dir, "workers", "workspace"),
          workers: ["main-1"],
        },
      },
    }),
    "utf8"
  );

  const output = [];
  const code = await runCli(["sync", "main", "--config", path.join(dir, "agent-pool.config.json")], {
    stdout: { write: (value) => output.push(value) },
    stderr: { write: () => {} },
  });

  assert.equal(code, 0);
  assert.equal(fs.readFileSync(path.join(templateWorkspace, "SOUL.md"), "utf8"), "source soul");
  assert.equal(fs.readFileSync(path.join(workerWorkspace, "SOUL.md"), "utf8"), "source soul");
  assert.match(output.join(""), /refreshed template/);
});

test("pool command fetches live admin pool status with bearer token", async () => {
  const output = [];
  const requests = [];
  const code = await runCli(["pool", "--url", "http://127.0.0.1:9070", "--token", "secret-token"], {
    stdout: { write: (value) => output.push(value) },
    stderr: { write: () => {} },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          generatedAt: "2026-04-26T12:00:00.000Z",
          defaultAgentId: "main",
          pool: {
            workerCount: 2,
            busyWorkers: 1,
            queueDepth: 1,
            workers: [
              {
                logicalAgentId: "main",
                workerAgentId: "main-1",
                busy: true,
                currentSession: "bridge_main_customer-1",
                currentConversationId: "customer-1",
                boundSessions: [],
                busyForMs: 1234,
                idleForMs: 0,
              },
              {
                logicalAgentId: "main",
                workerAgentId: "main-2",
                busy: false,
                currentSession: null,
                currentConversationId: null,
                boundSessions: [{ sessionId: "bridge_main_customer-2" }],
                busyForMs: 0,
                idleForMs: 5000,
              },
            ],
            waiters: [{ sessionId: "bridge_main_customer-3", queuedForMs: 2500 }],
          },
          queues: {
            conversationQueues: 1,
            activeTasks: 1,
            pendingTasks: 0,
            queues: [],
          },
          debounce: {
            enabled: true,
            incompleteMessageExtraWaitEnabled: true,
            pendingBatches: 1,
            pendingMessages: 2,
          },
          prompt: {
            adapter: "template",
            templateFile: "/root/prompts/main.md",
          },
          retrieval: {
            enabled: true,
            provider: "faq",
            lastHitCount: 2,
          },
        }),
      };
    },
  });

  assert.equal(code, 0);
  assert.equal(requests[0].url, "http://127.0.0.1:9070/admin/pool");
  assert.equal(requests[0].options.headers.Authorization, "Bearer secret-token");
  const text = output.join("");
  assert.match(text, /Live pool/);
  assert.match(text, /main-1/);
  assert.match(text, /BUSY/);
  assert.match(text, /bridge_main_customer-1/);
  assert.match(text, /queued=1/);
  assert.match(text, /debounce=on/);
  assert.match(text, /incompleteExtraWait=on/);
  assert.match(text, /pendingMessages=2/);
  assert.match(text, /promptAdapter=template/);
  assert.match(text, /retrieval=on provider=faq lastHitCount=2/);
});

test("help command lists every command with an operator description", async () => {
  const output = [];
  const code = await runCli(["help"], {
    stdout: { write: (value) => output.push(value) },
  });

  assert.equal(code, 0);
  const text = output.join("");
  assert.match(text, /Commands:/);
  assert.match(text, /scan\s+Discover local OpenClaw workspaces/);
  assert.match(text, /setup\s+Configure logical agents/);
  assert.match(text, /status\s+Print the static agent-pool.config.json/);
  assert.match(text, /pool\s+Show live worker busy/);
  assert.match(text, /sync <logicalAgent>\s+Refresh template and worker workspaces/);
  assert.match(text, /doctor\s+Check OpenClaw CLI/);
  assert.match(text, /help\s+Show this help/);
});

test("package exposes gents-pool as a forgiving CLI alias", () => {
  assert.equal(packageJson.bin["gents-pool"], "scripts/agents-pool.js");
});
