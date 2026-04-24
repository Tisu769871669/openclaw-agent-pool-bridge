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
    })
  );
});
