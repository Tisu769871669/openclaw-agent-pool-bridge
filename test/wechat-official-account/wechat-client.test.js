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

test("uploadArticleImage posts multipart image payload", async () => {
  const seen = [];
  const client = new WeChatMpClient({
    appId: "app",
    appSecret: "secret",
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      if (url.includes("/cgi-bin/token")) {
        return jsonResponse({ access_token: "token-1", expires_in: 7200 });
      }
      return jsonResponse({ url: "https://mmbiz.qpic.cn/uploaded.jpg" });
    },
  });

  const result = await client.uploadArticleImage(Buffer.from("image-bytes"), {
    filename: "look.png",
    contentType: "image/png",
  });

  assert.equal(result.url, "https://mmbiz.qpic.cn/uploaded.jpg");
  assert.match(seen[1].url, /media\/uploadimg/);
  assert.equal(seen[1].options.method, "POST");
  assert.ok(seen[1].options.body instanceof FormData);
});

test("uploadPermanentImage posts material image payload", async () => {
  const seen = [];
  const client = new WeChatMpClient({
    appId: "app",
    appSecret: "secret",
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      if (url.includes("/cgi-bin/token")) {
        return jsonResponse({ access_token: "token-1", expires_in: 7200 });
      }
      return jsonResponse({ media_id: "new-cover-media-id", url: "https://mmbiz.qpic.cn/cover.jpg" });
    },
  });

  const result = await client.uploadPermanentImage(Buffer.from("image-bytes"), {
    filename: "cover.jpg",
    contentType: "image/jpeg",
  });

  assert.equal(result.media_id, "new-cover-media-id");
  assert.match(seen[1].url, /material\/add_material/);
  assert.match(seen[1].url, /type=image/);
  assert.ok(seen[1].options.body instanceof FormData);
});

test("sendMassMpNews posts mpnews media_id to mass sendall", async () => {
  const seen = [];
  const client = new WeChatMpClient({
    appId: "app",
    appSecret: "secret",
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      if (url.includes("/cgi-bin/token")) {
        return jsonResponse({ access_token: "token-1", expires_in: 7200 });
      }
      return jsonResponse({ msg_id: 123, msg_data_id: 456 });
    },
  });

  const result = await client.sendMassMpNews("draft-media-id");

  assert.equal(result.msg_id, 123);
  assert.match(seen[1].url, /message\/mass\/sendall/);
  assert.deepEqual(JSON.parse(seen[1].options.body), {
    filter: { is_to_all: true },
    mpnews: { media_id: "draft-media-id" },
    msgtype: "mpnews",
    send_ignore_reprint: 0,
  });
});

test("getMassSendStatus posts msg_id to mass get", async () => {
  const seen = [];
  const client = new WeChatMpClient({
    appId: "app",
    appSecret: "secret",
    fetchImpl: async (url, options) => {
      seen.push({ url, options });
      if (url.includes("/cgi-bin/token")) {
        return jsonResponse({ access_token: "token-1", expires_in: 7200 });
      }
      return jsonResponse({ msg_id: 123, msg_status: "SEND_SUCCESS" });
    },
  });

  const result = await client.getMassSendStatus(123);

  assert.equal(result.msg_status, "SEND_SUCCESS");
  assert.match(seen[1].url, /message\/mass\/get/);
  assert.deepEqual(JSON.parse(seen[1].options.body), { msg_id: 123 });
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
