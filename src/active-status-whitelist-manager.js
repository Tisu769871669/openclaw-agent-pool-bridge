const fs = require("node:fs");
const path = require("node:path");

const { cleanAgentId, sha256 } = require("./source-md-file-manager");
const { createApiError } = require("./errors");

const ACTIVE_STATUS_WHITELIST_FILE_NAME = "ACTIVE_STATUS_WHITELIST.json";
const WHITELIST_TARGET_FIELDS = ["recvId", "userId", "wxid", "phone", "conversationId"];
const DISABLED_STATUS_VALUES = new Set([
  "0",
  "false",
  "off",
  "disable",
  "disabled",
  "inactive",
  "close",
  "closed",
  "stop",
  "stopped",
  "remove",
  "removed",
  "delete",
  "deleted",
  "block",
  "blocked",
  "关闭",
  "关",
  "停用",
  "禁用",
  "取消",
  "下线",
]);

class ActiveStatusWhitelistManager {
  constructor(options = {}) {
    this.defaultAgentId = cleanAgentId(options.defaultAgentId || "main");
    this.agentTemplates = options.agentTemplates || {};
  }

  snapshot() {
    return {
      enabled: true,
      fileName: ACTIVE_STATUS_WHITELIST_FILE_NAME,
      agents: Object.keys(this.agentTemplates),
    };
  }

  read(logicalAgentId) {
    const agent = this.resolveAgent(logicalAgentId);
    const filePath = this.getFilePath(agent.sourceWorkspace);
    if (!fs.existsSync(filePath)) {
      throw createApiError(
        404,
        "active_status_whitelist_not_found",
        `ACTIVE_STATUS_WHITELIST.json does not exist for logical agent ${agent.logicalAgentId}`
      );
    }

    const content = fs.readFileSync(filePath, "utf8");
    const data = parseWhitelistContent(content);
    return {
      logicalAgentId: agent.logicalAgentId,
      sourceWorkspace: agent.sourceWorkspace,
      fileName: ACTIVE_STATUS_WHITELIST_FILE_NAME,
      path: filePath,
      content,
      data,
      entries: data.entries,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content),
    };
  }

  write(logicalAgentId, payload, options = {}) {
    const agent = this.resolveAgent(logicalAgentId);
    const data = normalizeWhitelistPayload(payload);
    return this.persist(agent, data, options);
  }

  update(logicalAgentId, payload, options = {}) {
    const agent = this.resolveAgent(logicalAgentId);
    const current = this.readExistingData(agent.sourceWorkspace);
    const updates = normalizeWhitelistStatusUpdates(payload);
    let entries = current.entries || [];

    for (const update of updates) {
      entries = entries.filter((entry) => !whitelistEntriesMatch(entry, update));
      if (isWhitelistStatusEnabled(update.status)) {
        entries.push(update);
      }
    }

    const tenantId = cleanText(payload?.tenantId) || current.tenantId || "";
    const data = normalizeWhitelistPayload(
      {
        ...(tenantId ? { tenantId } : {}),
        entries,
      },
      { allowEmpty: true }
    );
    return this.persist(agent, data, options);
  }

  persist(agent, data, options = {}) {
    const content = `${JSON.stringify(data, null, 2)}\n`;
    const sourcePath = this.getFilePath(agent.sourceWorkspace);
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, content, "utf8");

    const syncWorkers = options.syncWorkers !== false;
    const template = syncWorkers ? this.syncTemplate(agent, content) : null;
    const workers = syncWorkers ? this.syncWorkers(agent, content) : [];

    return {
      logicalAgentId: agent.logicalAgentId,
      source: this.describeContent(sourcePath, content, data),
      template,
      workers,
      syncWorkers,
    };
  }

  readExistingData(workspace) {
    const filePath = this.getFilePath(workspace);
    if (!fs.existsSync(filePath)) {
      return { version: 1, entries: [] };
    }
    return parseWhitelistContent(fs.readFileSync(filePath, "utf8"));
  }

  syncTemplate(agent, content) {
    if (!agent.templateWorkspace) {
      return null;
    }
    const targetPath = this.getFilePath(agent.templateWorkspace);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, "utf8");
    return this.describeContent(targetPath, content, parseWhitelistContent(content));
  }

  syncWorkers(agent, content) {
    const workers = [];
    const data = parseWhitelistContent(content);
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
        ...this.describeContent(targetPath, content, data),
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
    return path.join(workspace, ACTIVE_STATUS_WHITELIST_FILE_NAME);
  }

  describeContent(filePath, content, data) {
    return {
      name: ACTIVE_STATUS_WHITELIST_FILE_NAME,
      path: filePath,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content),
      count: data.entries.length,
      entries: data.entries,
    };
  }
}

function createActiveStatusWhitelistManager(options = {}) {
  return new ActiveStatusWhitelistManager(options);
}

function getActiveStatusWhitelistPath(workspace) {
  return path.join(workspace, ACTIVE_STATUS_WHITELIST_FILE_NAME);
}

function parseWhitelistContent(content) {
  const text = String(content || "").trim();
  if (!text) {
    throw createApiError(400, "invalid_request", "ACTIVE_STATUS_WHITELIST.json content is required");
  }
  try {
    return normalizeWhitelistPayload(JSON.parse(text), { allowEmpty: true });
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw createApiError(400, "invalid_request", "ACTIVE_STATUS_WHITELIST.json must be valid JSON");
  }
}

function normalizeWhitelistPayload(payload = {}, options = {}) {
  const source = payload || {};
  const tenantId = cleanText(source.tenantId);
  const rawEntries = selectRawEntries(source);
  const entries = [];
  const seen = new Set();

  for (const rawEntry of rawEntries) {
    const entry = normalizeWhitelistEntry(rawEntry, tenantId);
    const key = [
      entry.tenantId || "",
      entry.sendId || "",
      entry.recvId || "",
      entry.userId || "",
      entry.wxid || "",
      entry.phone || "",
      entry.conversationId || "",
    ].join("\u001f");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push(entry);
  }

  if (!entries.length && !options.allowEmpty) {
    throw createApiError(400, "invalid_request", "ACTIVE_STATUS_WHITELIST.json must include at least one user");
  }

  return {
    version: 1,
    ...(tenantId ? { tenantId } : {}),
    entries,
  };
}

function selectRawEntries(source) {
  for (const key of ["entries", "users", "whitelist", "allowlist"]) {
    if (Array.isArray(source[key])) {
      return source[key];
    }
  }

  if (typeof source.content === "string") {
    const content = source.content.trim();
    if (!content) {
      return [];
    }
    const parsed = tryParseJson(content);
    if (parsed) {
      if (Array.isArray(parsed)) {
        return parsed;
      }
      return selectRawEntries({ ...parsed, tenantId: parsed.tenantId || source.tenantId });
    }
    return content.split(/[\s,，;；]+/).filter(Boolean);
  }

  return [];
}

function normalizeWhitelistStatusUpdates(payload = {}) {
  const source = payload || {};
  const tenantId = cleanText(source.tenantId);
  const defaults = pickWhitelistEntryFields(source, tenantId);
  let rawEntries = selectRawEntries(source);
  if (!rawEntries.length && hasWhitelistTarget(source)) {
    rawEntries = [source];
  }

  const updates = rawEntries.map((rawEntry) => normalizeWhitelistStatusEntry(rawEntry, defaults, tenantId));
  if (!updates.length) {
    throw createApiError(400, "invalid_request", "active status update requires recvId, userId, wxid, phone, or conversationId");
  }
  return updates;
}

function normalizeWhitelistStatusEntry(rawEntry, defaults, fallbackTenantId = "") {
  if (typeof rawEntry === "string" || typeof rawEntry === "number") {
    return normalizeWhitelistEntry({ ...defaults, recvId: cleanText(rawEntry) }, fallbackTenantId);
  }
  return normalizeWhitelistEntry({ ...defaults, ...(rawEntry || {}) }, fallbackTenantId);
}

function normalizeWhitelistEntry(rawEntry, fallbackTenantId = "") {
  if (typeof rawEntry === "string" || typeof rawEntry === "number") {
    const recvId = cleanText(rawEntry);
    if (!recvId) {
      throw createApiError(400, "invalid_request", "whitelist user id cannot be empty");
    }
    return {
      ...(fallbackTenantId ? { tenantId: fallbackTenantId } : {}),
      recvId,
    };
  }

  const raw = rawEntry || {};
  const entry = {};
  for (const key of ["tenantId", "sendId", "recvId", "userId", "wxid", "phone", "conversationId", "status", "note"]) {
    const value = cleanText(raw[key]);
    if (value) {
      entry[key] = value;
    }
  }
  if (!entry.tenantId && fallbackTenantId) {
    entry.tenantId = fallbackTenantId;
  }
  if (!entry.recvId && raw.id) {
    entry.recvId = cleanText(raw.id);
  }

  const hasTarget = WHITELIST_TARGET_FIELDS.some((key) => entry[key]);
  if (!hasTarget) {
    throw createApiError(400, "invalid_request", "whitelist entry requires recvId, userId, wxid, phone, or conversationId");
  }
  return entry;
}

function pickWhitelistEntryFields(raw, fallbackTenantId = "") {
  const source = raw || {};
  const entry = {};
  for (const key of ["tenantId", "sendId", "recvId", "userId", "wxid", "phone", "conversationId", "status", "note"]) {
    const value = cleanText(source[key]);
    if (value) {
      entry[key] = value;
    }
  }
  if (!entry.tenantId && fallbackTenantId) {
    entry.tenantId = fallbackTenantId;
  }
  if (!entry.recvId && source.id) {
    entry.recvId = cleanText(source.id);
  }
  return entry;
}

function hasWhitelistTarget(raw) {
  const source = raw || {};
  return WHITELIST_TARGET_FIELDS.some((key) => cleanText(source[key])) || Boolean(cleanText(source.id));
}

function isWhitelistStatusEnabled(status) {
  const value = cleanText(status).toLowerCase();
  return !value || !DISABLED_STATUS_VALUES.has(value);
}

function whitelistEntriesMatch(existing, update) {
  if (!sameOptionalField(existing, update, "tenantId") || !sameOptionalField(existing, update, "sendId")) {
    return false;
  }
  return WHITELIST_TARGET_FIELDS.some((key) => {
    const existingValue = cleanText(existing?.[key]);
    const updateValue = cleanText(update?.[key]);
    return existingValue && updateValue && existingValue === updateValue;
  });
}

function sameOptionalField(left, right, key) {
  const leftValue = cleanText(left?.[key]);
  const rightValue = cleanText(right?.[key]);
  return !leftValue || !rightValue || leftValue === rightValue;
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function cleanText(value) {
  return String(value ?? "").trim();
}

module.exports = {
  ACTIVE_STATUS_WHITELIST_FILE_NAME,
  ActiveStatusWhitelistManager,
  createActiveStatusWhitelistManager,
  getActiveStatusWhitelistPath,
  normalizeWhitelistPayload,
  normalizeWhitelistStatusUpdates,
};
