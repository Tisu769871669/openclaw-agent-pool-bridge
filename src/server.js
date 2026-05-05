#!/usr/bin/env node
const path = require("node:path");

const { createServerFromConfig, loadConfig, loadDotEnv } = require("./index");

const rootDir = path.resolve(__dirname, "..");
loadDotEnv(path.join(rootDir, ".env"));

const config = loadConfig(process.env, rootDir);
const server = createServerFromConfig(config);

server.listen(config.port, () => {
  console.log(
    JSON.stringify({
      service: "openclaw-agent-pool-bridge",
      port: config.port,
      defaultAgentId: config.defaultAgentId,
      workers: config.agents,
      debounce: {
        enabled: config.debounceEnabled,
        windowMs: config.debounceWindowMs,
        maxWaitMs: config.debounceMaxWaitMs,
        incompleteMessageExtraWaitEnabled: config.incompleteMessageExtraWaitEnabled,
        incompleteMessageExtraWaitMs: config.incompleteMessageExtraWaitMs,
      },
      prompt: {
        adapter: config.promptAdapter,
        templateFile: config.promptTemplateFile,
      },
      retrieval: {
        enabled: config.retrievalEnabled,
        provider: config.retrievalProvider,
        faqFile: config.faqFile,
        ragEndpoint: config.ragEndpoint,
        ragRequestFormat: config.ragRequestFormat,
        ragApiKeyConfigured: Boolean(config.ragApiKey),
        topK: config.retrievalTopK,
        minScore: config.retrievalMinScore,
      },
      soul: {
        bodyLimitBytes: config.soulAdminBodyLimitBytes,
        distillerAgentId: config.soulDistillerAgentId,
        distillerSkillDir: config.soulDistillerSkillDir,
        distillerSkillRepo: config.soulDistillerSkillRepo,
      },
    })
  );
});
