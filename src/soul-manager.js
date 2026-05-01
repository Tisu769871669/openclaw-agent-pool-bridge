const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { createApiError } = require("./errors");

const SOUL_FILE_NAME = "SOUL.md";

class SoulManager {
  constructor(options = {}) {
    this.defaultAgentId = cleanAgentId(options.defaultAgentId || "main");
    this.agentTemplates = options.agentTemplates || {};
  }

  snapshot() {
    return {
      enabled: true,
      agents: Object.keys(this.agentTemplates),
    };
  }

  read(logicalAgentId) {
    const agent = this.resolveAgent(logicalAgentId);
    const soulPath = getSoulPath(agent.sourceWorkspace);
    if (!fs.existsSync(soulPath)) {
      throw createApiError(404, "soul_not_found", `SOUL.md does not exist for logical agent ${agent.logicalAgentId}`);
    }

    const content = fs.readFileSync(soulPath, "utf8");
    return {
      logicalAgentId: agent.logicalAgentId,
      sourceWorkspace: agent.sourceWorkspace,
      path: soulPath,
      content,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content),
    };
  }

  readOptional(logicalAgentId) {
    try {
      return this.read(logicalAgentId);
    } catch (error) {
      if (error.code === "soul_not_found") {
        const agent = this.resolveAgent(logicalAgentId);
        return {
          logicalAgentId: agent.logicalAgentId,
          sourceWorkspace: agent.sourceWorkspace,
          path: getSoulPath(agent.sourceWorkspace),
          content: "",
          bytes: 0,
          sha256: sha256(""),
        };
      }
      throw error;
    }
  }

  write(logicalAgentId, content, options = {}) {
    const agent = this.resolveAgent(logicalAgentId);
    const text = normalizeSoulContent(content);
    const sourcePath = getSoulPath(agent.sourceWorkspace);
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, text, "utf8");

    const syncWorkers = options.syncWorkers !== false;
    const template = syncWorkers ? this.syncTemplate(agent, text) : null;
    const workers = syncWorkers ? this.syncWorkers(agent, text) : [];
    const fileInfo = describeContent(sourcePath, text);

    return {
      logicalAgentId: agent.logicalAgentId,
      source: fileInfo,
      template,
      workers,
      syncWorkers,
    };
  }

  syncTemplate(agent, content) {
    if (!agent.templateWorkspace) {
      return null;
    }
    const targetPath = getSoulPath(agent.templateWorkspace);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");
    return describeContent(targetPath, content);
  }

  syncWorkers(agent, content) {
    const workers = [];
    for (const worker of agent.workers || []) {
      const workspace = agent.workerWorkspaces?.[worker];
      if (!workspace) {
        continue;
      }
      const targetPath = getSoulPath(workspace);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, "utf8");
      workers.push({
        worker,
        ...describeContent(targetPath, content),
      });
    }
    return workers;
  }

  resolveAgent(logicalAgentId) {
    const agentId = cleanAgentId(logicalAgentId || this.defaultAgentId);
    const template = this.agentTemplates[agentId];
    if (!template?.sourceWorkspace) {
      throw createApiError(
        404,
        "agent_source_not_found",
        `No sourceWorkspace configured for logical agent ${agentId}`
      );
    }

    return {
      logicalAgentId: agentId,
      sourceWorkspace: template.sourceWorkspace,
      templateWorkspace: template.templateWorkspace,
      workers: template.workers || [],
      workerWorkspaces: template.workerWorkspaces || {},
    };
  }
}

function createSoulManager(options = {}) {
  return new SoulManager(options);
}

function getSoulPath(workspace) {
  return path.join(workspace, SOUL_FILE_NAME);
}

function normalizeSoulContent(value) {
  const content = String(value || "").trim();
  if (!content) {
    throw createApiError(400, "invalid_request", "SOUL.md content is required");
  }
  return content;
}

function describeContent(filePath, content) {
  return {
    path: filePath,
    bytes: Buffer.byteLength(content),
    sha256: sha256(content),
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function cleanAgentId(value) {
  return String(value || "").trim();
}

module.exports = {
  SOUL_FILE_NAME,
  SoulManager,
  createSoulManager,
  getSoulPath,
  normalizeSoulContent,
  sha256,
};
