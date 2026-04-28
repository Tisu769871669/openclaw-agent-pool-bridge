const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { mergeArticleImages } = require("../../skills/article-image-generator/scripts/lib/article-merge");
const { buildAssetRecord, safeImageFilename, writeManifest } = require("../../skills/article-image-generator/scripts/lib/manifest");

test("mergeArticleImages preserves article fields and adds coverPath plus contentImages", () => {
  const article = {
    title: "韩式穿搭公式",
    digest: "低饱和色系照着穿。",
    html: "<section>{{image:coverMood}}</section><section>{{image:lookGrid}}</section>",
    sourceLinks: ["https://example.test/source"],
  };
  const assets = [
    { key: "coverMood", role: "cover", path: "/tmp/assets/coverMood.png", alt: "封面图" },
    { key: "lookGrid", role: "body", path: "/tmp/assets/lookGrid.png", alt: "穿搭图" },
  ];

  const result = mergeArticleImages(article, assets);

  assert.equal(result.title, article.title);
  assert.equal(result.digest, article.digest);
  assert.deepEqual(result.sourceLinks, article.sourceLinks);
  assert.equal(result.coverPath, "/tmp/assets/coverMood.png");
  assert.deepEqual(result.contentImages, [
    { key: "coverMood", path: "/tmp/assets/coverMood.png", alt: "封面图" },
    { key: "lookGrid", path: "/tmp/assets/lookGrid.png", alt: "穿搭图" },
  ]);
});

test("mergeArticleImages keeps existing content images not replaced by generated assets", () => {
  const result = mergeArticleImages({
    title: "标题",
    digest: "摘要",
    markdown: "{{image:old}} {{image:newOne}}",
    contentImages: [{ key: "old", path: "/tmp/old.png", alt: "旧图" }],
  }, [
    { key: "newOne", role: "body", path: "/tmp/new.png", alt: "新图" },
  ]);

  assert.deepEqual(result.contentImages, [
    { key: "old", path: "/tmp/old.png", alt: "旧图" },
    { key: "newOne", path: "/tmp/new.png", alt: "新图" },
  ]);
});

test("safeImageFilename removes unsafe path characters", () => {
  assert.equal(safeImageFilename("../cover Mood?.png", "fallback"), "cover_Mood_.png");
  assert.equal(safeImageFilename("", "coverMood"), "coverMood.png");
});

test("buildAssetRecord computes sha256 and image path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-record-"));
  const imagePath = path.join(dir, "cover.png");
  fs.writeFileSync(imagePath, Buffer.from("image-bytes"));

  const record = buildAssetRecord({
    image: { key: "coverMood", role: "cover", alt: "封面图", size: "1024x1024", model: "gpt-image-2" },
    filePath: imagePath,
  });

  assert.equal(record.key, "coverMood");
  assert.equal(record.role, "cover");
  assert.equal(record.path, imagePath);
  assert.equal(record.sha256.length, 64);
});

test("writeManifest writes a JSON manifest", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-"));
  const manifestPath = path.join(dir, "assets-manifest.json");
  const result = writeManifest(manifestPath, {
    createdAt: "2026-04-28T10:00:00.000Z",
    profile: "snowchuang-yihuang",
    model: "gpt-image-2",
    images: [],
  });

  assert.equal(result, manifestPath);
  assert.equal(JSON.parse(fs.readFileSync(manifestPath, "utf8")).profile, "snowchuang-yihuang");
});
