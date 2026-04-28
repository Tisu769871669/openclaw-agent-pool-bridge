const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { main, parseArgs } = require("../../skills/article-image-generator/scripts/article-image-generator");

const profilesDir = path.join(__dirname, "..", "..", "skills", "article-image-generator", "profiles");

test("parseArgs accepts core CLI options", () => {
  assert.deepEqual(parseArgs([
    "--mode", "dry-run",
    "--image-plan", "image-plan.json",
    "--article-json", "article.json",
    "--output-dir", "tmp/assets",
    "--out-article", "article.with-images.json",
  ]), {
    mode: "dry-run",
    imagePlan: "image-plan.json",
    articleJson: "article.json",
    outputDir: "tmp/assets",
    outArticle: "article.with-images.json",
    profilesDir: "",
    strictPlaceholders: false,
  });
});

test("dry-run validates and writes planned manifest without API key", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-cli-dry-"));
  const articlePath = path.join(dir, "article.json");
  const planPath = path.join(dir, "image-plan.json");
  const outputDir = path.join(dir, "assets");
  const outArticle = path.join(dir, "article.with-images.json");

  fs.writeFileSync(articlePath, JSON.stringify({
    title: "韩式穿搭公式",
    digest: "低饱和色系照着穿。",
    html: "<section>{{image:lookGrid}}</section>",
  }));
  fs.writeFileSync(planPath, JSON.stringify({
    profile: "example",
    images: [{ key: "lookGrid", role: "body", prompt: "Clean outfit grid", alt: "穿搭图" }],
  }));

  const result = await main([
    "--mode", "dry-run",
    "--image-plan", planPath,
    "--article-json", articlePath,
    "--output-dir", outputDir,
    "--out-article", outArticle,
    "--profiles-dir", profilesDir,
  ], {});

  assert.equal(result.ok, true);
  assert.equal(result.record.status, "planned");
  assert.equal(fs.existsSync(path.join(outputDir, "assets-manifest.json")), true);
  assert.equal(fs.existsSync(outArticle), false);
});

test("generate writes image files, manifest, and updated article", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-cli-generate-"));
  const articlePath = path.join(dir, "article.json");
  const planPath = path.join(dir, "image-plan.json");
  const outputDir = path.join(dir, "assets");
  const outArticle = path.join(dir, "article.with-images.json");

  fs.writeFileSync(articlePath, JSON.stringify({
    title: "韩式穿搭公式",
    digest: "低饱和色系照着穿。",
    html: "<section>{{image:coverMood}}</section><section>{{image:lookGrid}}</section>",
  }));
  fs.writeFileSync(planPath, JSON.stringify({
    profile: "example",
    images: [
      { key: "coverMood", role: "cover", prompt: "Cover image", alt: "封面图" },
      { key: "lookGrid", role: "body", prompt: "Outfit grid", alt: "穿搭图" },
    ],
  }));

  const result = await main([
    "--mode", "generate",
    "--image-plan", planPath,
    "--article-json", articlePath,
    "--output-dir", outputDir,
    "--out-article", outArticle,
    "--profiles-dir", profilesDir,
  ], {
    IMAGE2_API_KEY: "secret",
    IMAGE2_API_BASE_URL: "https://api.example.test/v1",
    IMAGE2_MODEL: "gpt-image-2",
  }, {
    fetchImpl: async () => jsonResponse({ data: [{ b64_json: Buffer.from("png-bytes").toString("base64") }] }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.record.status, "generated");
  const article = JSON.parse(fs.readFileSync(outArticle, "utf8"));
  assert.match(article.coverPath, /coverMood\.png$/);
  assert.deepEqual(article.contentImages.map(item => item.key), ["coverMood", "lookGrid"]);
  assert.equal(fs.existsSync(article.contentImages[0].path), true);
});

test("generate does not write article when image generation fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-cli-fail-"));
  const articlePath = path.join(dir, "article.json");
  const planPath = path.join(dir, "image-plan.json");
  const outputDir = path.join(dir, "assets");
  const outArticle = path.join(dir, "article.with-images.json");

  fs.writeFileSync(articlePath, JSON.stringify({
    title: "标题",
    digest: "摘要",
    markdown: "{{image:look}}",
  }));
  fs.writeFileSync(planPath, JSON.stringify({
    profile: "example",
    images: [{ key: "look", role: "body", prompt: "Look image", alt: "图" }],
  }));

  await assert.rejects(
    () => main([
      "--mode", "generate",
      "--image-plan", planPath,
      "--article-json", articlePath,
      "--output-dir", outputDir,
      "--out-article", outArticle,
      "--profiles-dir", profilesDir,
    ], { IMAGE2_API_KEY: "secret" }, {
      fetchImpl: async () => ({ ok: false, status: 500, async text() { return "failed"; } }),
    }),
    /Image2 API error 500/
  );
  assert.equal(fs.existsSync(outArticle), false);
});

test("generate wires timeout and retry environment values into the image client", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "image-cli-env-"));
  const articlePath = path.join(dir, "article.json");
  const planPath = path.join(dir, "image-plan.json");
  const outputDir = path.join(dir, "assets");
  const outArticle = path.join(dir, "article.with-images.json");
  let calls = 0;

  fs.writeFileSync(articlePath, JSON.stringify({
    title: "标题",
    digest: "摘要",
    markdown: "{{image:look}}",
  }));
  fs.writeFileSync(planPath, JSON.stringify({
    profile: "example",
    images: [{ key: "look", role: "body", prompt: "Look image", alt: "图" }],
  }));

  const result = await main([
    "--mode", "generate",
    "--image-plan", planPath,
    "--article-json", articlePath,
    "--output-dir", outputDir,
    "--out-article", outArticle,
    "--profiles-dir", profilesDir,
  ], {
    IMAGE2_API_KEY: "secret",
    IMAGE2_TIMEOUT_MS: "1000",
    IMAGE2_MAX_RETRIES: "1",
  }, {
    fetchImpl: async (url, options) => {
      assert.equal(typeof options.signal.aborted, "boolean");
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 500, async text() { return "temporary failure"; } };
      }
      return jsonResponse({ data: [{ b64_json: Buffer.from("env-ok").toString("base64") }] });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-type", "application/json"]]),
    async text() {
      return JSON.stringify(payload);
    },
  };
}
