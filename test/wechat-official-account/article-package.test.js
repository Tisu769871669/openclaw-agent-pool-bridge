const test = require("node:test");
const assert = require("node:assert/strict");

const { validateArticlePackage, renderWechatHtml } = require("../../skills/wechat-official-account/scripts/lib/article-package");

test("validateArticlePackage accepts complete article", () => {
  const article = validateArticlePackage({
    title: "春天吃得清爽一点",
    digest: "一份适合日常阅读的大健康饮食参考。",
    author: "苏丹",
    markdown: "## 饮食参考\n\n多吃新鲜食材，少一点负担。",
    coverPath: "cover.jpg",
    contentImages: [{ key: "hero", path: "hero.png", alt: "封面氛围图" }],
  });

  assert.equal(article.title, "春天吃得清爽一点");
  assert.deepEqual(article.contentImages, [{ key: "hero", path: "hero.png", alt: "封面氛围图" }]);
});

test("validateArticlePackage rejects empty body", () => {
  assert.throws(
    () => validateArticlePackage({ title: "标题", digest: "摘要", markdown: "" }),
    /markdown is required/
  );
});

test("renderWechatHtml renders safe basic markdown", () => {
  const html = renderWechatHtml("## 小标题\n\n第一段\n\n- 要点一\n- 要点二");

  assert.match(html, /<h2>小标题<\/h2>/);
  assert.match(html, /<p>第一段<\/p>/);
  assert.match(html, /<li>要点一<\/li>/);
});

test("renderWechatHtml renders uploaded image placeholders", () => {
  const html = renderWechatHtml("## 小标题\n\n{{image:look1}}\n\n搭配说明", {
    imageUrls: {
      look1: {
        url: "https://mmbiz.qpic.cn/example.jpg",
        alt: "低饱和韩系通勤穿搭",
      },
    },
  });

  assert.match(html, /<img/);
  assert.match(html, /src="https:\/\/mmbiz\.qpic\.cn\/example\.jpg"/);
  assert.match(html, /alt="低饱和韩系通勤穿搭"/);
  assert.match(html, /<p>搭配说明<\/p>/);
});
