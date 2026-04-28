const test = require("node:test");
const assert = require("node:assert/strict");

const { validateArticlePackage, renderArticleContent, renderWechatHtml } = require("../../skills/wechat-official-account/scripts/lib/article-package");

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
    /markdown or html is required/
  );
});

test("validateArticlePackage accepts WeChat-ready HTML body", () => {
  const article = validateArticlePackage({
    title: "韩系穿搭公式",
    digest: "低饱和色系照着穿。",
    html: "<section><p>今天这套太适合通勤了。</p></section>",
  });

  assert.equal(article.markdown, "");
  assert.equal(article.html, "<section><p>今天这套太适合通勤了。</p></section>");
});

test("validateArticlePackage rejects unsafe HTML body", () => {
  assert.throws(
    () => validateArticlePackage({
      title: "韩系穿搭公式",
      digest: "低饱和色系照着穿。",
      html: "<section><script>alert(1)</script></section>",
    }),
    /unsafe html/i
  );
});

test("validateArticlePackage rejects editorial generation instructions in body", () => {
  assert.throws(
    () => validateArticlePackage({
      title: "韩系穿搭公式",
      digest: "低饱和色系照着穿。",
      html: [
        "<section>",
        "<p>这篇直接按“小红书穿搭笔记”的方式来：短句、公式、避雷点，一屏一个重点。</p>",
        "<p>先说结论：韩系氛围感，抓这 3 个词就够了。</p>",
        "</section>",
      ].join(""),
    }),
    /editorial instruction/i
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

test("renderArticleContent renders WeChat-ready HTML with uploaded image placeholders", () => {
  const article = validateArticlePackage({
    title: "韩系穿搭公式",
    digest: "低饱和色系照着穿。",
    html: [
      '<section style="margin: 0 0 18px;">',
      '<p><strong>通勤这样穿，真的不费力。</strong></p>',
      "{{image:look1}}",
      "</section>",
    ].join(""),
    contentImages: [{ key: "look1", path: "look.png", alt: "低饱和韩系通勤穿搭" }],
  });

  const html = renderArticleContent(article, {
    imageUrls: {
      look1: {
        url: "https://mmbiz.qpic.cn/look.jpg",
        alt: "低饱和韩系通勤穿搭",
      },
    },
  });

  assert.match(html, /<section style="margin: 0 0 18px;">/);
  assert.match(html, /<strong>通勤这样穿，真的不费力。<\/strong>/);
  assert.match(html, /src="https:\/\/mmbiz\.qpic\.cn\/look\.jpg"/);
});
