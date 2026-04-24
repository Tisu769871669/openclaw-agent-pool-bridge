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
  const agents = agentPoolConfig.agents || {
    [defaultAgentId]: expandPool(defaultAgentId, Number(env.AGENT_POOL_SIZE || 5)),
  };

  return {
    port: Number(env.PORT || 9070),
    token: String(env.AGENT_BRIDGE_TOKEN || "").trim(),
    defaultAgentId,
    openclawBin: String(env.OPENCLAW_BIN || "openclaw").trim(),
    agentTimeoutSeconds: Number(env.AGENT_TIMEOUT_SECONDS || 120),
    queueTimeoutMs: Number(env.QUEUE_TIMEOUT_SECONDS || 30) * 1000,
    stickyTtlMs: Number(env.STICKY_TTL_SECONDS || 1800) * 1000,
    sessionStoreDir: resolvePath(env.SESSION_STORE_DIR || ".sessions", baseDir),
    sessionHistoryLimit: Number(env.SESSION_HISTORY_LIMIT || 20),
    agents,
  };
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

module.exports = {
  expandPool,
  loadConfig,
  loadDotEnv,
};
