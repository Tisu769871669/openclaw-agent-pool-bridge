const fs = require("node:fs");
const path = require("node:path");

const SECRET_KEYS = /secret|token|password|authorization/i;

function redactSecrets(value) {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
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
  const logsDir = path.join(rootDir, "logs", "wechat-official-account");
  const docsDir = path.join(rootDir, "docs", "wechat-official-account");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const jsonlPath = path.join(logsDir, "publish-audit.jsonl");
  const markdownPath = path.join(docsDir, "publish-log.md");

  fs.appendFileSync(jsonlPath, `${JSON.stringify(clean)}\n`, "utf8");
  const lines = [
    "",
    `## ${clean.timestamp || new Date().toISOString()} ${clean.title || ""}`,
    "",
    `- Profile: ${clean.profileId || ""}`,
    `- Mode: ${clean.mode || ""}`,
    `- Status: ${clean.status || ""}`,
    `- Draft media_id: ${clean.draftMediaId || ""}`,
    `- Publish id: ${clean.publishId || ""}`,
  ];
  fs.appendFileSync(markdownPath, `${lines.join("\n")}\n`, "utf8");

  return { jsonlPath, markdownPath };
}

module.exports = {
  redactSecrets,
  writeAuditRecord,
};
