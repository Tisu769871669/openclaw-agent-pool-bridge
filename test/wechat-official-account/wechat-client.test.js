const test = require("node:test");
const assert = require("node:assert/strict");

const { WeChatMpClient, WeChatApiError } = require("../../skills/wechat-official-account/scripts/lib/wechat-client");

test("getAccessToken caches token", async () => {
  let calls = 0;
  const client = new WeChatMpClient({
    appId: "app",
    appSecret: "secret",
    fetchImpl: async (url) => {
      calls += 1;
      assert.match(url, /cgi-bin\/token/);
      return jsonResponse({ access_token: "token-1", expires_in: 7200 });
    },
    now: () => 1000,
  });

  assert.equal(await client.getAccessToken(), "token-1");
  assert.equal(await client.getAccessToken(), "token-1");
  assert.equal(calls, 1);
});

test("addDraft posts article payload", async () => {
  const seen = [];
  const client = new WeChatMpClient({
    appId: "app",
    appSecret: "secret",
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      if (url.includes("/cgi-bin/token")) {
        return jsonResponse({ access_token: "token-1", expires_in: 7200 });
      }
      return jsonResponse({ media_id: "draft-media-id" });
    },
  });

  const result = await client.addDraft([{ title: "标题", content: "<p>正文</p>", thumb_media_id: "thumb-id" }]);

  assert.equal(result.media_id, "draft-media-id");
  assert.match(seen[1].url, /draft\/add/);
  assert.equal(JSON.parse(seen[1].options.body).articles[0].title, "标题");
});

test("wechat API error throws useful error", async () => {
  const client = new WeChatMpClient({
    appId: "app",
    appSecret: "secret",
    fetchImpl: async () => jsonResponse({ errcode: 40001, errmsg: "invalid credential" }),
  });

  await assert.rejects(() => client.getAccessToken(), WeChatApiError);
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}
