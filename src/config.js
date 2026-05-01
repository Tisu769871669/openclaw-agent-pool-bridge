const fs = require("node:fs");
const path = require("node:path");

function loadDotEnv(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadConfig(env = process.env, baseDir = process.cwd()) {
  const agentPoolConfigPath = resolvePath(env.AGENT_POOL_CONFIG || "agent-pool.config.json", baseDir);
  const agentPoolConfig = fs.existsSync(agentPoolConfigPath)
    ? JSON.parse(fs.readFileSync(agentPoolConfigPath, "utf8"))
    : {};

  const defaultAgentId = String(env.DEFAULT_AGENT_ID || agentPoolConfig.defaultAgentId || "main").trim();
  const normalizedAgentConfig = normalizeAgentConfig(agentPoolConfig.agents || {
    [defaultAgentId]: expandPool(defaultAgentId, Number(env.AGENT_POOL_SIZE || 5)),
  }, baseDir);

  return {
    port: Number(env.PORT || 9070),
    token: String(env.AGENT_BRIDGE_TOKEN || "").trim(),
    defaultAgentId,
    openclawBin: String(env.OPENCLAW_BIN || "openclaw").trim(),
    agentTimeoutSeconds: Number(env.AGENT_TIMEOUT_SECONDS || 120),
    queueTimeoutMs: Number(env.QUEUE_TIMEOUT_SECONDS || 30) * 1000,
    stickyTtlMs: Number(env.STICKY_TTL_SECONDS || 1800) * 1000,
    debounceEnabled: parseBoolean(env.DEBOUNCE_ENABLED, false),
    debounceWindowMs: Number(env.DEBOUNCE_WINDOW_MS || 0),
    debounceMaxWaitMs: Number(env.DEBOUNCE_MAX_WAIT_MS || env.MAX_DEBOUNCE_WINDOW_MS || env.DEBOUNCE_WINDOW_MS || 0),
    debounceMaxMessages: Number(env.DEBOUNCE_MAX_MESSAGES || 20),
    incompleteMessageExtraWaitEnabled: parseBoolean(
      env.INCOMPLETE_MESSAGE_EXTRA_WAIT_ENABLED,
      cleanText(env.DEBOUNCE_EXTRA_WAIT_POLICY) === "incomplete-message"
    ),
    incompleteMessageExtraWaitMs: Number(env.INCOMPLETE_MESSAGE_EXTRA_WAIT_MS || 0),
    promptAdapter: cleanText(env.PROMPT_ADAPTER || "none").toLowerCase(),
    promptTemplateFile: cleanText(env.PROMPT_TEMPLATE_FILE)
      ? resolvePath(cleanText(env.PROMPT_TEMPLATE_FILE), baseDir)
      : "",
    retrievalEnabled: parseBoolean(env.RETRIEVAL_ENABLED, false),
    retrievalProvider: cleanText(env.RETRIEVAL_PROVIDER || "faq").toLowerCase(),
    faqFile: cleanText(env.FAQ_FILE) ? resolvePath(cleanText(env.FAQ_FILE), baseDir) : "",
    ragEndpoint: cleanText(env.RAG_ENDPOINT),
    retrievalTopK: Number(env.RETRIEVAL_TOP_K || 3),
    retrievalMinScore: Number(env.RETRIEVAL_MIN_SCORE || 0.65),
    soulAdminBodyLimitBytes: Number(env.SOUL_ADMIN_BODY_LIMIT_BYTES || 5 * 1024 * 1024),
    soulDistillerAgentId: cleanText(env.SOUL_DISTILLER_AGENT_ID),
    soulDistillerSkillDir: cleanText(env.SOUL_DISTILLER_SKILL_DIR)
      ? resolvePath(cleanText(env.SOUL_DISTILLER_SKILL_DIR), baseDir)
      : path.join(baseDir, "skills", "dot-skill"),
    soulDistillerSkillRepo: cleanText(env.SOUL_DISTILLER_SKILL_REPO),
    soulDistillerSkillSourceUrl: cleanText(env.SOUL_DISTILLER_SKILL_SOURCE_URL),
    soulDistillerTimeoutSeconds: Number(env.SOUL_DISTILLER_TIMEOUT_SECONDS || 120),
    sessionStoreDir: resolvePath(env.SESSION_STORE_DIR || ".sessions", baseDir),
    sessionHistoryLimit: Number(env.SESSION_HISTORY_LIMIT || 20),
    openclawConfigPath: cleanText(env.OPENCLAW_CONFIG_PATH || agentPoolConfig.openclawConfigPath)
      ? resolvePath(cleanText(env.OPENCLAW_CONFIG_PATH || agentPoolConfig.openclawConfigPath), baseDir)
      : "",
    agents: normalizedAgentConfig.agents,
    agentTemplates: normalizedAgentConfig.agentTemplates,
  };
}

function normalizeAgentConfig(rawAgents, baseDir) {
  const agents = {};
  const agentTemplates = {};
  const source = rawAgents && typeof rawAgents === "object" ? rawAgents : {};

  for (const [logicalAgentId, definition] of Object.entries(source)) {
    if (Array.isArray(definition)) {
      agents[logicalAgentId] = definition.map(cleanText).filter(Boolean);
      continue;
    }

    if (typeof definition === "string") {
      agents[logicalAgentId] = definition.split(",").map(cleanText).filter(Boolean);
      continue;
    }

    if (definition && typeof definition === "object") {
      const workers = Array.isArray(definition.workers)
        ? definition.workers.map(cleanText).filter(Boolean)
        : String(definition.workers || "").split(",").map(cleanText).filter(Boolean);
      agents[logicalAgentId] = workers;

      if (definition.templateWorkspace) {
        const sourceWorkspace = definition.sourceWorkspace
          ? resolvePath(String(definition.sourceWorkspace), baseDir)
          : "";
        const templateWorkspace = resolvePath(String(definition.templateWorkspace), baseDir);
        const workerWorkspaceRoot = definition.workerWorkspaceRoot
          ? resolvePath(String(definition.workerWorkspaceRoot), baseDir)
          : "";
        const workerWorkspaces = resolveWorkerWorkspaces(definition, workers, workerWorkspaceRoot, baseDir);

        const agentTemplate = {
          logicalAgentId,
          sourceWorkspace,
          templateWorkspace,
          workerWorkspaceRoot,
          workers,
          workerWorkspaces,
        };
        if (definition.openclawConfigPath) {
          agentTemplate.openclawConfigPath = resolvePath(String(definition.openclawConfigPath), baseDir);
        }
        agentTemplates[logicalAgentId] = agentTemplate;
      }
    }
  }

  return { agents, agentTemplates };
}

function resolveWorkerWorkspaces(definition, workers, workerWorkspaceRoot, baseDir) {
  const raw = definition.workerWorkspaces;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.fromEntries(
      Object.entries(raw).map(([worker, workspace]) => [worker, resolvePath(String(workspace), baseDir)])
    );
  }

  if (Array.isArray(raw)) {
    const out = {};
    for (const item of raw) {
      if (item && typeof item === "object" && item.worker && item.workspace) {
        out[String(item.worker)] = resolvePath(String(item.workspace), baseDir);
      }
    }
    return out;
  }

  if (!workerWorkspaceRoot) {
    return {};
  }

  return Object.fromEntries(workers.map((worker) => [worker, path.join(workerWorkspaceRoot, worker)]));
}

function expandPool(logicalAgentId, size) {
  const count = Number.isFinite(size) && size > 0 ? Math.floor(size) : 5;
  return Array.from({ length: count }, (_, index) => `${logicalAgentId}-${index + 1}`);
}

function resolvePath(value, baseDir) {
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(baseDir, value);
}

function cleanText(value) {
  return String(value || "").trim();
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
}

module.exports = {
  expandPool,
  loadConfig,
  loadDotEnv,
  normalizeAgentConfig,
};
