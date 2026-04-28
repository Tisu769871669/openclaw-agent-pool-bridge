const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { main } = require("../../skills/wechat-official-account/scripts/wechat-official-account");

test("draft-only uploads cover and content images before adding draft", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-rich-media-"));
  const articlePath = path.join(dir, "article.json");
  const coverPath = path.join(dir, "cover.jpg");
  const lookPath = path.join(dir, "look.png");
  fs.writeFileSync(coverPath, "cover-bytes");
  fs.writeFileSync(lookPath, "look-bytes");
  fs.writeFileSync(articlePath, JSON.stringify({
    title: "韩式穿搭公式",
    author: "衣荒救星站",
    digest: "一篇带新图片的韩系穿搭测试稿。",
    coverPath,
    markdown: "## 搭配公式\n\n{{image:look1}}\n\n低饱和色系更耐看。",
    contentImages: [{ key: "look1", path: lookPath, alt: "韩系穿搭示意图" }],
  }));

  const calls = [];
  await main([
    "--mode", "draft-only",
    "--profile", "snowchuang-yihuang",
    "--article-json", articlePath,
    "--profiles-dir", path.join(__dirname, "..", "..", "skills", "wechat-official-account", "profiles"),
    "--root-dir", dir,
  ], {
    WECHAT_MP_APP_ID: "app",
    WECHAT_MP_APP_SECRET: "secret",
    WECHAT_MP_FETCH_IMPL: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes("/cgi-bin/token")) {
        return jsonResponse({ access_token: "token-1", expires_in: 7200 });
      }
      if (url.includes("/cgi-bin/material/add_material")) {
        return jsonResponse({ media_id: "cover-media-id", url: "https://mmbiz.qpic.cn/cover.jpg" });
      }
      if (url.includes("/cgi-bin/media/uploadimg")) {
        return jsonResponse({ url: "https://mmbiz.qpic.cn/look.jpg" });
      }
      if (url.includes("/cgi-bin/draft/add")) {
        const payload = JSON.parse(options.body);
        assert.equal(payload.articles[0].thumb_media_id, "cover-media-id");
        assert.match(payload.articles[0].content, /https:\/\/mmbiz\.qpic\.cn\/look\.jpg/);
        return jsonResponse({ media_id: "draft-media-id" });
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });

  assert.equal(calls.some((call) => call.url.includes("/cgi-bin/material/add_material")), true);
  assert.equal(calls.some((call) => call.url.includes("/cgi-bin/media/uploadimg")), true);
  assert.equal(calls.some((call) => call.url.includes("/cgi-bin/draft/add")), true);
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
