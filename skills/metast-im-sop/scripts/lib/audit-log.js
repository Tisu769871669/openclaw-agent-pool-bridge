const fs = require("node:fs");
const path = require("node:path");

const SECRET_KEYS = /secret|token|password|authorization|mcpkey|mcpsecret/i;

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = SECRET_KEYS.test(key) ? "[REDACTED]" : redactSecrets(nested);
    }
    return result;
  }
  return value;
}

function writeAuditRecord({ rootDir = process.cwd(), record }) {
  const clean = redactSecrets(record);
  const logsDir = path.join(rootDir, "logs", "metast-im-sop");
  const docsDir = path.join(rootDir, "docs", "metast-im-sop");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const jsonlPath = path.join(logsDir, "action-audit.jsonl");
  const markdownPath = path.join(docsDir, "action-log.md");
  fs.appendFileSync(jsonlPath, `${JSON.stringify(clean)}\n`, "utf8");

  const lines = [
    "",
    `## ${clean.timestamp || new Date().toISOString()} ${clean.action || ""}`,
    "",
    `- Profile: ${clean.profileId || ""}`,
    `- Platform: ${clean.platform || ""}`,
    `- Mode: ${clean.mode || ""}`,
    `- Status: ${clean.status || ""}`,
    `- Endpoint: ${clean.endpoint || ""}`,
  ];
  fs.appendFileSync(markdownPath, `${lines.join("\n")}\n`, "utf8");
  return { jsonlPath, markdownPath };
}

module.exports = {
  redactSecrets,
  writeAuditRecord,
};
