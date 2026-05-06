const test = require("node:test");
const assert = require("node:assert/strict");

const { MetastImApiError, MetastImClient } = require("../../skills/metast-im-sop/scripts/lib/metast-client");

test("listFriends sends platform-specific GET request with mcp headers", async () => {
  const seen = [];
  const client = new MetastImClient({
    baseUrl: "https://lx.metast.cn",
    mcpKey: "key-1",
    mcpSecret: "secret-1",
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return jsonResponse({ code: 200, data: [{ friendId: "wxid_friend" }], msg: "ok" });
    },
  });

  const result = await client.listFriends("wx", { pageNo: 1, pageSize: 20, sendId: "wxid_sender" });

  assert.equal(result.data[0].friendId, "wxid_friend");
  assert.match(seen[0].url, /^https:\/\/lx\.metast\.cn\/prod-api\/system\/api\/im\/getWxFrendList\?/);
  assert.match(seen[0].url, /pageNo=1/);
  assert.match(seen[0].url, /pageSize=20/);
  assert.match(seen[0].url, /sendId=wxid_sender/);
  assert.equal(seen[0].options.method, "GET");
  assert.equal(seen[0].options.headers.mcpKey, "key-1");
  assert.equal(seen[0].options.headers.mcpSecret, "secret-1");
});

test("submitSopTask posts JSON body to WeCom SOP endpoint", async () => {
  const seen = [];
  const client = new MetastImClient({
    baseUrl: "https://lx.metast.cn/",
    mcpKey: "key-1",
    mcpSecret: "secret-1",
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return jsonResponse({ code: 200, data: { taskId: "task-1" }, msg: "ok" });
    },
  });

  const result = await client.submitSopTask("im", { taskName: "任务", concatList: [] });

  assert.equal(result.data.taskId, "task-1");
  assert.equal(seen[0].url, "https://lx.metast.cn/prod-api/system/api/im/sendImSopChatMesage");
  assert.equal(seen[0].options.method, "POST");
  assert.equal(seen[0].options.headers["content-type"], "application/json");
  assert.equal(JSON.parse(seen[0].options.body).taskName, "任务");
});

test("submitMoment posts JSON body to dedicated personal WeChat Moment endpoint", async () => {
  const seen = [];
  const client = new MetastImClient({
    baseUrl: "https://lx.metast.cn",
    mcpKey: "key-1",
    mcpSecret: "secret-1",
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      return jsonResponse({ code: 200, data: { momentId: "moment-1" }, msg: "ok" });
    },
  });

  const result = await client.submitMoment("wx", { content: "朋友圈", mediaList: [] });

  assert.equal(result.data.momentId, "moment-1");
  assert.equal(seen[0].url, "https://lx.metast.cn/prod-api/system/api/im/sendWxMomentChatMesage");
  assert.equal(JSON.parse(seen[0].options.body).content, "朋友圈");
});

test("API failures throw useful MetastImApiError", async () => {
  const client = new MetastImClient({
    baseUrl: "https://lx.metast.cn",
    mcpKey: "key-1",
    mcpSecret: "secret-1",
    fetchImpl: async () => jsonResponse({ code: 401, data: null, msg: "账号未登录" }),
  });

  await assert.rejects(() => client.listFriends("im", { pageNo: 1, pageSize: 20 }), MetastImApiError);
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
}
