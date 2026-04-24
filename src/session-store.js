const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

class SessionStore {
  constructor(options = {}) {
    this.dir = path.resolve(options.dir || ".sessions");
    this.historyLimit = Number.isFinite(options.historyLimit) ? Math.max(2, options.historyLimit) : 20;
  }

  load(logicalAgentId, conversationId) {
    const payload = safeJsonRead(this.filePath(logicalAgentId, conversationId), { messages: [] });
    return normalizeMessages(payload.messages || []);
  }

  save(logicalAgentId, conversationId, messages) {
    const cleanMessages = normalizeMessages(messages).slice(-this.historyLimit);
    safeJsonWrite(this.filePath(logicalAgentId, conversationId), {
      logicalAgentId,
      conversationId,
      updatedAt: new Date().toISOString(),
      messages: cleanMessages,
    });
    return cleanMessages;
  }

  appendTurn(logicalAgentId, conversationId, userMessage, assistantReply) {
    const messages = this.load(logicalAgentId, conversationId);
    messages.push({ role: "user", text: String(userMessage || "").trim() });
    messages.push({ role: "assistant", text: String(assistantReply || "").trim() });
    return this.save(logicalAgentId, conversationId, messages);
  }

  filePath(logicalAgentId, conversationId) {
    const hash = crypto
      .createHash("sha1")
      .update(`${logicalAgentId}:${conversationId}`, "utf8")
      .digest("hex")
      .slice(0, 16);
    return path.join(
      this.dir,
      `${safeName(logicalAgentId, 48)}_${safeName(conversationId, 96)}_${hash}.json`
    );
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message) => ({
      role: normalizeRole(message?.role),
      text: String(message?.text || message?.content || message?.message || "").trim(),
    }))
    .filter((message) => message.text);
}

function normalizeRole(role) {
  const text = String(role || "").trim().toLowerCase();
  return text === "assistant" ? "assistant" : "user";
}

function safeName(value, maxLength) {
  const text = String(value || "unknown").trim().replace(/[^a-zA-Z0-9_-]/g, "_");
  return (text || "unknown").slice(0, maxLength);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeJsonRead(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function safeJsonWrite(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

module.exports = {
  SessionStore,
  normalizeMessages,
};
