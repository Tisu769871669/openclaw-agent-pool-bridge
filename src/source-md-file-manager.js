const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { createApiError } = require("./errors");

class SourceMdFileManager {
  constructor(options = {}) {
    this.defaultAgentId = cleanAgentId(options.defaultAgentId || "main");
    this.agentTemplates = options.agentTemplates || {};
    this.fileName = String(options.fileName || "").trim();
    this.fileLabel = String(options.fileLabel || this.fileName).trim();
    this.missingCode = String(options.missingCode || "markdown_file_not_found").trim();
    if (!this.fileName || path.basename(this.fileName) !== this.fileName || !this.fileName.endsWith(".md")) {
      throw new Error("SourceMdFileManager requires a safe .md fileName");
    }
  }

  snapshot() {
    return {
      enabled: true,
      fileName: this.fileName,
      agents: Object.keys(this.agentTemplates),
    };
  }

  read(logicalAgentId) {
    const agent = this.resolveAgent(logicalAgentId);
    const filePath = this.getFilePath(agent.sourceWorkspace);
    if (!fs.existsSync(filePath)) {
      throw createApiError(
        404,
        this.missingCode,
        `${this.fileLabel} does not exist for logical agent ${agent.logicalAgentId}`
      );
    }

    const content = fs.readFileSync(filePath, "utf8");
    return {
      logicalAgentId: agent.logicalAgentId,
      sourceWorkspace: agent.sourceWorkspace,
      fileName: this.fileName,
      path: filePath,
      content,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content),
    };
  }

  readOptional(logicalAgentId) {
    try {
      return this.read(logicalAgentId);
    } catch (error) {
      if (error.code === this.missingCode) {
        const agent = this.resolveAgent(logicalAgentId);
        return {
          logicalAgentId: agent.logicalAgentId,
          sourceWorkspace: agent.sourceWorkspace,
          fileName: this.fileName,
          path: this.getFilePath(agent.sourceWorkspace),
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
    const text = normalizeMarkdownContent(content, this.fileLabel);
    const sourcePath = this.getFilePath(agent.sourceWorkspace);
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, text, "utf8");

    const syncWorkers = options.syncWorkers !== false;
    const template = syncWorkers ? this.syncTemplate(agent, text) : null;
    const workers = syncWorkers ? this.syncWorkers(agent, text) : [];
    const fileInfo = this.describeContent(sourcePath, text);

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
    const targetPath = this.getFilePath(agent.templateWorkspace);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");
    return this.describeContent(targetPath, content);
  }

  syncWorkers(agent, content) {
    const workers = [];
    for (const worker of agent.workers || []) {
      const workspace = agent.workerWorkspaces?.[worker];
      if (!workspace) {
        continue;
      }
      const targetPath = this.getFilePath(workspace);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content, "utf8");
      workers.push({
        worker,
        ...this.describeContent(targetPath, content),
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

  getFilePath(workspace) {
    return path.join(workspace, this.fileName);
  }

  describeContent(filePath, content) {
    return {
      name: this.fileName,
      path: filePath,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content),
    };
  }
}

function normalizeMarkdownContent(value, fileLabel = "Markdown file") {
  const content = String(value || "").trim();
  if (!content) {
    throw createApiError(400, "invalid_request", `${fileLabel} content is required`);
  }
  return content;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function cleanAgentId(value) {
  return String(value || "").trim();
}

module.exports = {
  SourceMdFileManager,
  cleanAgentId,
  normalizeMarkdownContent,
  sha256,
};
