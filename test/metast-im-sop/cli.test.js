const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { main, parseArgs } = require("../../skills/metast-im-sop/scripts/metast-im-sop");

const profilesDir = path.join(__dirname, "..", "..", "skills", "metast-im-sop", "profiles");

test("parseArgs accepts core SOP CLI options", () => {
  assert.deepEqual(parseArgs([
    "--mode", "dry-run",
    "--action", "sop-task",
    "--platform", "wx",
    "--profile", "example",
    "--input-json", "task.json",
    "--root-dir", "tmp",
  ]), {
    action: "sop-task",
    confirmSend: false,
    inputJson: "task.json",
    mode: "dry-run",
    pageNo: "1",
    pageSize: "20",
    platform: "wx",
    profile: "example",
    rootDir: "tmp",
    sendId: "",
  });
});

test("dry-run builds SOP task and writes audit without calling network", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metast-sop-dry-"));
  const inputPath = path.join(dir, "task.json");
  fs.writeFileSync(inputPath, JSON.stringify({
    sopNo: "S0",
    taskName: "任务_2026-04-30_14:59:23",
    contacts: [{ accountId: "wxid_sender", friendId: "wxid_friend", friendName: "小威" }],
    events: [{ content: "你好[惊讶]" }],
  }));

  const result = await main([
    "--mode", "dry-run",
    "--action", "sop-task",
    "--platform", "wx",
    "--profile", "example",
    "--input-json", inputPath,
    "--root-dir", dir,
    "--profiles-dir", profilesDir,
  ], {}, {
    fetchImpl: async () => {
      throw new Error("dry-run should not call fetch");
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.status, "planned");
  assert.equal(result.record.endpoint, "/prod-api/system/api/im/sendWxSopChatMesage");
  assert.equal(result.payload.sopInfo.sopNo, "S0");
  assert.equal(fs.existsSync(result.audit.jsonlPath), true);
  assert.match(fs.readFileSync(result.audit.markdownPath, "utf8"), /sop-task/);
});

test("submit mode requires explicit confirmation", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metast-sop-confirm-"));
  const inputPath = path.join(dir, "task.json");
  const profiles = path.join(dir, "profiles");
  fs.mkdirSync(profiles);
  fs.writeFileSync(path.join(profiles, "live.json"), JSON.stringify({
    id: "live",
    baseUrl: "https://lx.metast.cn",
    credentialEnv: { mcpKey: "METAST_MCP_KEY", mcpSecret: "METAST_MCP_SECRET" },
    safety: { allowSubmit: true },
  }));
  fs.writeFileSync(inputPath, JSON.stringify({
    sopNo: "S2",
    taskName: "事件任务",
    contacts: [{ accountId: "sender", friendId: "friend" }],
    events: [{ content: "第一条" }],
  }));

  await assert.rejects(() => main([
    "--mode", "submit",
    "--action", "sop-task",
    "--platform", "im",
    "--profile", "live",
    "--input-json", inputPath,
    "--root-dir", dir,
    "--profiles-dir", profiles,
  ], {
    METAST_MCP_KEY: "key",
    METAST_MCP_SECRET: "secret",
  }), /--confirm-send is required/);
});

test("submit mode posts built payload when profile allows live send", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metast-sop-submit-"));
  const inputPath = path.join(dir, "task.json");
  const profiles = path.join(dir, "profiles");
  const seen = [];
  fs.mkdirSync(profiles);
  fs.writeFileSync(path.join(profiles, "live.json"), JSON.stringify({
    id: "live",
    baseUrl: "https://lx.metast.cn",
    credentialEnv: { mcpKey: "METAST_MCP_KEY", mcpSecret: "METAST_MCP_SECRET" },
    safety: { allowSubmit: true },
  }));
  fs.writeFileSync(inputPath, JSON.stringify({
    sopNo: "S0",
    taskName: "单事件",
    contacts: [{ accountId: "sender", friendId: "friend" }],
    events: [{ content: "第一条" }],
  }));

  const result = await main([
    "--mode", "submit",
    "--action", "sop-task",
    "--platform", "im",
    "--profile", "live",
    "--input-json", inputPath,
    "--root-dir", dir,
    "--profiles-dir", profiles,
    "--confirm-send",
  ], {
    METAST_MCP_KEY: "key",
    METAST_MCP_SECRET: "secret",
  }, {
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ code: 200, data: { taskId: "task-1" }, msg: "ok" });
        },
      };
    },
  });

  assert.equal(result.record.status, "submitted");
  assert.equal(result.response.data.taskId, "task-1");
  assert.equal(seen[0].url, "https://lx.metast.cn/prod-api/system/api/im/sendImSopChatMesage");
  assert.equal(JSON.parse(seen[0].options.body).taskName, "单事件");
});

test("submit mode can load credentials from root .env", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "metast-sop-env-"));
  const inputPath = path.join(dir, "task.json");
  const profiles = path.join(dir, "profiles");
  const seen = [];
  fs.mkdirSync(profiles);
  fs.writeFileSync(path.join(dir, ".env"), [
    "METAST_MCP_KEY=key-from-env-file",
    "METAST_MCP_SECRET=\"secret#from-env-file\"",
    "",
  ].join("\n"));
  fs.writeFileSync(path.join(profiles, "live.json"), JSON.stringify({
    id: "live",
    baseUrl: "https://lx.metast.cn",
    credentialEnv: { mcpKey: "METAST_MCP_KEY", mcpSecret: "METAST_MCP_SECRET" },
    safety: { allowSubmit: true },
  }));
  fs.writeFileSync(inputPath, JSON.stringify({
    sopNo: "S0",
    taskName: "单事件-env",
    contacts: [{ accountId: "sender", friendId: "friend" }],
    events: [{ content: "第一条" }],
  }));

  const result = await main([
    "--mode", "submit",
    "--action", "sop-task",
    "--platform", "wx",
    "--profile", "live",
    "--input-json", inputPath,
    "--root-dir", dir,
    "--profiles-dir", profiles,
    "--confirm-send",
  ], {}, {
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ code: 200, msg: "ok" });
        },
      };
    },
  });

  assert.equal(result.record.status, "submitted");
  assert.equal(seen[0].options.headers.mcpKey, "key-from-env-file");
  assert.equal(seen[0].options.headers.mcpSecret, "secret#from-env-file");
});
