const { AgentPool } = require("./agent-pool");
const { ConversationQueueManager } = require("./conversation-queue");
const { loadConfig, loadDotEnv } = require("./config");
const { DebounceQueue } = require("./debounce-queue");
const { createApp } = require("./http-server");
const { runOpenClawAgent } = require("./openclaw-runner");
const { createPromptAdapter } = require("./prompt-adapter");
const { createRetrievalAdapter } = require("./retrieval-adapter");
const { SessionStore } = require("./session-store");
const { createSoulDistiller } = require("./soul-distiller");
const { createSoulManager } = require("./soul-manager");

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
  const promptAdapter = createPromptAdapter({
    adapter: config.promptAdapter,
    templateFile: config.promptTemplateFile,
  });
  const retrievalAdapter = createRetrievalAdapter({
    enabled: config.retrievalEnabled,
    provider: config.retrievalProvider,
    faqFile: config.faqFile,
    ragEndpoint: config.ragEndpoint,
    topK: config.retrievalTopK,
    minScore: config.retrievalMinScore,
  });
  const soulManager = createSoulManager({
    defaultAgentId: config.defaultAgentId,
    agentTemplates: config.agentTemplates,
  });
  const soulDistiller = createSoulDistiller({
    openclawBin: config.openclawBin,
    agentId: config.soulDistillerAgentId,
    timeoutSeconds: config.soulDistillerTimeoutSeconds,
    skillDir: config.soulDistillerSkillDir,
    skillSourceUrl: config.soulDistillerSkillSourceUrl,
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
    promptAdapter,
    retrievalAdapter,
    sessionStore,
    soulManager,
    soulDistiller,
    bodyLimitBytes: config.soulAdminBodyLimitBytes,
    runner,
  });
}

module.exports = {
  AgentPool,
  ConversationQueueManager,
  DebounceQueue,
  SessionStore,
  createApp,
  createPromptAdapter,
  createRetrievalAdapter,
  createServerFromConfig,
  createSoulDistiller,
  createSoulManager,
  loadConfig,
  loadDotEnv,
  runOpenClawAgent,
};
