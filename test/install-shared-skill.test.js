const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { loadConfig } = require("../src/config");
const {
  assertSafeSkillName,
  installSharedSkill,
  parseArgs,
} = require("../scripts/install-shared-skill");

function write(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function exists(filePath) {
  return fs.existsSync(filePath);
}

function setupConfig(dir) {
  write(
    path.join(dir, "agent-pool.config.json"),
    JSON.stringify({
      defaultAgentId: "main",
      agents: {
        main: {
          templateWorkspace: "templates/sudan-main",
          workerWorkspaceRoot: "workers",
          workers: ["sudan-main-1"],
        },
        snowchuang: {
          templateWorkspace: "templates/snowchuang",
          workerWorkspaceRoot: "workers",
          workers: ["snowchuang-1"],
        },
      },
    })
  );
  return loadConfig({ AGENT_POOL_CONFIG: "agent-pool.config.json" }, dir);
}

test("parseArgs accepts shared skill install options", () => {
  assert.deepEqual(parseArgs([
    "article-image-generator",
    "--agent", "main,snowchuang",
    "--config", "agent-pool.config.json",
    "--sync-workers",
    "--dry-run",
  ]), {
    _: ["article-image-generator"],
    agents: ["main", "snowchuang"],
    config: "agent-pool.config.json",
    "sync-workers": true,
    "dry-run": true,
  });
});

test("installSharedSkill copies one root skill into every configured template", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-skill-"));
  write(path.join(dir, "skills", "article-image-generator", "SKILL.md"), "shared image skill");
  write(path.join(dir, "skills", "article-image-generator", "scripts", "run.js"), "run");
  write(path.join(dir, "skills", "article-image-generator", "node_modules", "ignored.js"), "ignored");
  write(path.join(dir, "templates", "sudan-main", "skills", "article-image-generator", "stale.txt"), "stale");
  write(path.join(dir, "templates", "sudan-main", "skills", "metast-mcp", "SKILL.md"), "keep");
  write(path.join(dir, "templates", "snowchuang", "SOUL.md"), "snow");

  const config = setupConfig(dir);
  const result = installSharedSkill(config, "article-image-generator", { rootDir: dir });

  assert.deepEqual(result.agents.map((agent) => agent.logicalAgentId), ["main", "snowchuang"]);
  for (const templateName of ["sudan-main", "snowchuang"]) {
    assert.equal(
      read(path.join(dir, "templates", templateName, "skills", "article-image-generator", "SKILL.md")),
      "shared image skill"
    );
    assert.equal(
      read(path.join(dir, "templates", templateName, "skills", "article-image-generator", "scripts", "run.js")),
      "run"
    );
    assert.equal(
      exists(path.join(dir, "templates", templateName, "skills", "article-image-generator", "node_modules", "ignored.js")),
      false
    );
  }
  assert.equal(exists(path.join(dir, "templates", "sudan-main", "skills", "article-image-generator", "stale.txt")), false);
  assert.equal(read(path.join(dir, "templates", "sudan-main", "skills", "metast-mcp", "SKILL.md")), "keep");
});

test("installSharedSkill dry-run reports operations without touching templates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-skill-dry-"));
  write(path.join(dir, "skills", "article-image-generator", "SKILL.md"), "shared image skill");
  write(path.join(dir, "templates", "sudan-main", "skills", "article-image-generator", "SKILL.md"), "old");

  const config = setupConfig(dir);
  const result = installSharedSkill(config, "article-image-generator", {
    rootDir: dir,
    agents: ["main"],
    dryRun: true,
  });

  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].operations.some((operation) => operation.type === "copy"), true);
  assert.equal(read(path.join(dir, "templates", "sudan-main", "skills", "article-image-generator", "SKILL.md")), "old");
});

test("installSharedSkill can sync updated templates into worker workspaces", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-skill-sync-"));
  write(path.join(dir, "skills", "article-image-generator", "SKILL.md"), "shared image skill");
  write(path.join(dir, "templates", "sudan-main", "SOUL.md"), "sudan");
  write(path.join(dir, "workers", "sudan-main-1", "SOUL.md"), "old");

  const config = setupConfig(dir);
  const result = installSharedSkill(config, "article-image-generator", {
    rootDir: dir,
    agents: ["main"],
    syncWorkers: true,
  });

  assert.equal(result.agents[0].sync.workers[0], "sudan-main-1");
  assert.equal(
    read(path.join(dir, "workers", "sudan-main-1", "skills", "article-image-generator", "SKILL.md")),
    "shared image skill"
  );
});

test("assertSafeSkillName rejects path traversal", () => {
  assert.throws(() => assertSafeSkillName("../article-image-generator"), /unsafe skill name/);
});
