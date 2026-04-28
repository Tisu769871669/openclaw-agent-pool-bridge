const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { redactSecrets, writeAuditRecord } = require("../../skills/wechat-official-account/scripts/lib/audit-log");

test("redactSecrets removes sensitive values", () => {
  const redacted = redactSecrets({
    title: "标题",
    access_token: "secret-token",
    nested: { WECHAT_MP_APP_SECRET: "secret" },
  });

  assert.equal(redacted.title, "标题");
  assert.equal(redacted.access_token, "[REDACTED]");
  assert.equal(redacted.nested.WECHAT_MP_APP_SECRET, "[REDACTED]");
});

test("writeAuditRecord writes jsonl and markdown summary", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-audit-"));
  const result = writeAuditRecord({
    rootDir: dir,
    record: {
      timestamp: "2026-04-28T12:00:00+08:00",
      profileId: "sudan-health",
      mode: "publish",
      title: "标题",
      status: "submitted",
      access_token: "secret-token",
    },
  });

  assert.equal(fs.existsSync(result.jsonlPath), true);
  assert.equal(fs.existsSync(result.markdownPath), true);
  assert.match(fs.readFileSync(result.jsonlPath, "utf8"), /\[REDACTED\]/);
  assert.match(fs.readFileSync(result.markdownPath, "utf8"), /sudan-health/);
});
