const { AgentPool } = require("./agent-pool");
const { ConversationQueueManager } = require("./conversation-queue");
const { loadConfig, loadDotEnv } = require("./config");
const { DebounceQueue } = require("./debounce-queue");
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
  const debounce = new DebounceQueue({
    enabled: config.debounceEnabled,
    windowMs: config.debounceWindowMs,
    maxWaitMs: config.debounceMaxWaitMs,
    maxMessages: config.debounceMaxMessages,
    incompleteMessageExtraWaitEnabled: config.incompleteMessageExtraWaitEnabled,
    incompleteMessageExtraWaitMs: config.incompleteMessageExtraWaitMs,
  });
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
    debounce,
    sessionStore,
    runner,
  });
}

module.exports = {
  AgentPool,
  ConversationQueueManager,
  DebounceQueue,
  SessionStore,
  createApp,
  createServerFromConfig,
  loadConfig,
  loadDotEnv,
  runOpenClawAgent,
};
