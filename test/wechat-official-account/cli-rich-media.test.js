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

test("draft-only can add draft from WeChat-ready HTML content", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-html-content-"));
  const articlePath = path.join(dir, "article.json");
  const coverPath = path.join(dir, "cover.jpg");
  const lookPath = path.join(dir, "look.png");
  fs.writeFileSync(coverPath, "cover-bytes");
  fs.writeFileSync(lookPath, "look-bytes");
  fs.writeFileSync(articlePath, JSON.stringify({
    title: "韩式穿搭公式",
    author: "衣荒救星站",
    digest: "一篇带公众号 HTML 排版的测试稿。",
    coverPath,
    html: [
      '<section style="padding: 16px; background: #fff8f0;">',
      '<p><strong>低饱和韩系穿搭，照着穿就很稳。</strong></p>',
      "{{image:look1}}",
      "</section>",
    ].join(""),
    contentImages: [{ key: "look1", path: lookPath, alt: "韩系穿搭示意图" }],
  }));

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
        assert.match(payload.articles[0].content, /<section style="padding: 16px; background: #fff8f0;">/);
        assert.match(payload.articles[0].content, /https:\/\/mmbiz\.qpic\.cn\/look\.jpg/);
        assert.doesNotMatch(payload.articles[0].content, /\{\{image:look1\}\}/);
        return jsonResponse({ media_id: "draft-media-id" });
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });
});

test("draft-only appends configured footer QR images", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-footer-"));
  const profilesDir = path.join(dir, "profiles");
  fs.mkdirSync(profilesDir);
  const articlePath = path.join(dir, "article.json");
  const coverPath = path.join(dir, "cover.jpg");
  const lookPath = path.join(dir, "look.png");
  const wecomQrPath = path.join(dir, "wecom.jpg");
  const personalQrPath = path.join(dir, "personal.jpg");
  fs.writeFileSync(coverPath, "cover-bytes");
  fs.writeFileSync(lookPath, "look-bytes");
  fs.writeFileSync(wecomQrPath, "wecom-qr-bytes");
  fs.writeFileSync(personalQrPath, "personal-qr-bytes");
  fs.writeFileSync(path.join(profilesDir, "footer-test.json"), JSON.stringify({
    id: "footer-test",
    subject: "雪创",
    officialAccount: "衣荒救星站",
    publishPolicy: {
      defaultMode: "publish",
      requireComplianceCheck: true,
    },
    articleFooter: {
      enabled: true,
      title: "想要更多穿搭建议",
      description: "扫码添加雪创，获取一对一搭配建议。",
      qrImages: [
        { key: "wecomQr", path: wecomQrPath, alt: "企业微信二维码", caption: "添加企业微信" },
        { key: "personalQr", path: personalQrPath, alt: "个人微信二维码", caption: "添加个人微信" },
      ],
    },
  }));
  fs.writeFileSync(articlePath, JSON.stringify({
    title: "韩式穿搭公式",
    author: "衣荒救星站",
    digest: "一篇带文末二维码的测试稿。",
    coverPath,
    markdown: "## 搭配公式\n\n{{image:look1}}\n\n低饱和色系更耐看。",
    contentImages: [{ key: "look1", path: lookPath, alt: "韩系穿搭示意图" }],
  }));

  const uploadedMedia = [];
  await main([
    "--mode", "draft-only",
    "--profile", "footer-test",
    "--article-json", articlePath,
    "--profiles-dir", profilesDir,
    "--root-dir", dir,
  ], {
    WECHAT_MP_APP_ID: "app",
    WECHAT_MP_APP_SECRET: "secret",
    WECHAT_MP_FETCH_IMPL: async (url, options = {}) => {
      if (url.includes("/cgi-bin/token")) {
        return jsonResponse({ access_token: "token-1", expires_in: 7200 });
      }
      if (url.includes("/cgi-bin/material/add_material")) {
        return jsonResponse({ media_id: "cover-media-id", url: "https://mmbiz.qpic.cn/cover.jpg" });
      }
      if (url.includes("/cgi-bin/media/uploadimg")) {
        const filename = getMultipartFilename(options.body);
        uploadedMedia.push(filename);
        return jsonResponse({ url: `https://mmbiz.qpic.cn/${filename}` });
      }
      if (url.includes("/cgi-bin/draft/add")) {
        const payload = JSON.parse(options.body);
        assert.match(payload.articles[0].content, /想要更多穿搭建议/);
        assert.match(payload.articles[0].content, /添加企业微信/);
        assert.match(payload.articles[0].content, /https:\/\/mmbiz\.qpic\.cn\/wecom\.jpg/);
        assert.match(payload.articles[0].content, /https:\/\/mmbiz\.qpic\.cn\/personal\.jpg/);
        return jsonResponse({ media_id: "draft-media-id" });
      }
      throw new Error(`unexpected URL: ${url}`);
    },
  });

  assert.deepEqual(uploadedMedia.sort(), ["look.png", "personal.jpg", "wecom.jpg"]);
});

function getMultipartFilename(form) {
  const entry = Array.from(form.entries()).find(([name]) => name === "media");
  assert.ok(entry, "media multipart field should exist");
  return entry[1].name;
}

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
}
