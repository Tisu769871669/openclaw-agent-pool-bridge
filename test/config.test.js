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
          sourceWorkspace: ".openclaw/workspace",
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
    sourceWorkspace: path.join(dir, ".openclaw", "workspace"),
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
    INCOMPLETE_MESSAGE_EXTRA_WAIT_ENABLED: "true",
    INCOMPLETE_MESSAGE_EXTRA_WAIT_MS: "2500",
  });

  assert.equal(config.debounceEnabled, true);
  assert.equal(config.debounceWindowMs, 1500);
  assert.equal(config.debounceMaxWaitMs, 5000);
  assert.equal(config.debounceMaxMessages, 12);
  assert.equal(config.incompleteMessageExtraWaitEnabled, true);
  assert.equal(config.incompleteMessageExtraWaitMs, 2500);
});

test("loadConfig supports legacy max debounce env alias and extra wait policy alias", () => {
  const config = loadConfig({
    DEBOUNCE_ENABLED: "true",
    DEBOUNCE_WINDOW_MS: "1500",
    MAX_DEBOUNCE_WINDOW_MS: "6000",
    DEBOUNCE_EXTRA_WAIT_POLICY: "incomplete-message",
    INCOMPLETE_MESSAGE_EXTRA_WAIT_MS: "2500",
  });

  assert.equal(config.debounceMaxWaitMs, 6000);
  assert.equal(config.incompleteMessageExtraWaitEnabled, true);
  assert.equal(config.incompleteMessageExtraWaitMs, 2500);
});

test("loadConfig supports prompt adapter environment options", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const config = loadConfig(
    {
      PROMPT_ADAPTER: "template",
      PROMPT_TEMPLATE_FILE: "prompts/main.md",
    },
    dir
  );

  assert.equal(config.promptAdapter, "template");
  assert.equal(config.promptTemplateFile, path.join(dir, "prompts", "main.md"));
});

test("loadConfig supports retrieval adapter environment options", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const config = loadConfig(
    {
      RETRIEVAL_ENABLED: "true",
      RETRIEVAL_PROVIDER: "faq",
      FAQ_FILE: "knowledge/faq.json",
      RAG_ENDPOINT: "https://rag.example.test/search",
      RETRIEVAL_TOP_K: "4",
      RETRIEVAL_MIN_SCORE: "0.7",
    },
    dir
  );

  assert.equal(config.retrievalEnabled, true);
  assert.equal(config.retrievalProvider, "faq");
  assert.equal(config.faqFile, path.join(dir, "knowledge", "faq.json"));
  assert.equal(config.ragEndpoint, "https://rag.example.test/search");
  assert.equal(config.retrievalTopK, 4);
  assert.equal(config.retrievalMinScore, 0.7);
});

test("loadConfig supports SOUL distillation environment options", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-pool-bridge-"));
  const config = loadConfig(
    {
      SOUL_ADMIN_BODY_LIMIT_BYTES: "1024",
      SOUL_DISTILLER_AGENT_ID: "soul-distiller",
      SOUL_DISTILLER_SKILL_DIR: "skills/shared-soul",
      SOUL_DISTILLER_SKILL_SOURCE_URL: "https://raw.githubusercontent.test/team/soul/SKILL.md",
      SOUL_DISTILLER_TIMEOUT_SECONDS: "90",
    },
    dir
  );

  assert.equal(config.soulAdminBodyLimitBytes, 1024);
  assert.equal(config.soulDistillerAgentId, "soul-distiller");
  assert.equal(config.soulDistillerSkillDir, path.join(dir, "skills", "shared-soul"));
  assert.equal(config.soulDistillerSkillSourceUrl, "https://raw.githubusercontent.test/team/soul/SKILL.md");
  assert.equal(config.soulDistillerTimeoutSeconds, 90);
});
