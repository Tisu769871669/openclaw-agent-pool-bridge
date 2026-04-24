const { AgentPool } = require("./agent-pool");
const { ConversationQueueManager } = require("./conversation-queue");
const { loadConfig, loadDotEnv } = require("./config");
const { createApp } = require("./http-server");
const { runOpenClawAgent } = require("./openclaw-runner");
const { SessionStore } = require("./session-store");

function createServerFromConfig(config) {
  const pool = new AgentPool({
    defaultAgentId: config.defaultAgentId,
    queueTimeoutMs: config.queueTimeoutMs,
    stickyTtlMs: config.stickyTtlMs,
    agents: config.agents,
  });
  const queues = new ConversationQueueManager();
  const sessionStore = new SessionStore({
    dir: config.sessionStoreDir,
    historyLimit: config.sessionHistoryLimit,
  });
  const runner = (input) =>
    runOpenClawAgent({
      openclawBin: config.openclawBin,
      timeoutSeconds: config.agentTimeoutSeconds,
      workerAgentId: input.workerAgentId,
      runSessionId: input.runSessionId,
      prompt: input.prompt,
    });

  return createApp({
    token: config.token,
    defaultAgentId: config.defaultAgentId,
    pool,
    queues,
    sessionStore,
    runner,
  });
}

module.exports = {
  AgentPool,
  ConversationQueueManager,
  SessionStore,
  createApp,
  createServerFromConfig,
  loadConfig,
  loadDotEnv,
  runOpenClawAgent,
};
