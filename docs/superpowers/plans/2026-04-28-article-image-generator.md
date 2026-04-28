# Article Image Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable `article-image-generator` OpenClaw skill that turns an Agent-authored article package and image plan into generated local image assets plus `article.with-images.json`.

**Architecture:** The skill lives under `skills/article-image-generator/`, parallel to `skills/wechat-official-account/`, and communicates with it only through article JSON fields already supported by the WeChat skill: `coverPath`, `contentImages`, and `{{image:key}}` placeholders. Implementation is split into focused CommonJS modules for plan/profile validation, image2 client calls, article merging, manifest writing, and CLI orchestration.

**Tech Stack:** Node.js 20+ built-ins, CommonJS, `node:test`, image2-compatible HTTP API, existing repository `npm test` / `npm run check` workflow.

---

## File Map

- Create `skills/article-image-generator/SKILL.md`: Agent-facing workflow and safety instructions.
- Create `skills/article-image-generator/profiles/example.json`: neutral test profile.
- Create `skills/article-image-generator/profiles/snowchuang-yihuang.json`: Snowchuang fashion image defaults.
- Create `skills/article-image-generator/profiles/sudan-health.json`: Sudan restrained health/lifestyle image defaults.
- Create `skills/article-image-generator/references/image2-api.md`: image2 API notes and environment variables.
- Create `skills/article-image-generator/scripts/article-image-generator.js`: CLI entrypoint and orchestration.
- Create `skills/article-image-generator/scripts/lib/image-plan.js`: profile loading, image plan normalization, validation.
- Create `skills/article-image-generator/scripts/lib/article-merge.js`: merges generated asset records into article JSON.
- Create `skills/article-image-generator/scripts/lib/image2-client.js`: isolated API client with injectable `fetchImpl`.
- Create `skills/article-image-generator/scripts/lib/manifest.js`: safe file names, SHA-256 hashing, manifest writing.
- Create `test/article-image-generator/image-plan.test.js`: validation and profile tests.
- Create `test/article-image-generator/article-merge.test.js`: article merge tests.
- Create `test/article-image-generator/image2-client.test.js`: API client tests.
- Create `test/article-image-generator/cli.test.js`: dry-run and generate CLI tests.
- Modify `package.json`: include new CLI file in `npm run check`.
- Modify `docs/wechat-official-account.md`: add short handoff example from image generator to WeChat skill.

## Task 1: Image Plan And Profile Validation

**Files:**
- Create: `test/article-image-generator/image-plan.test.js`
- Create: `skills/article-image-generator/scripts/lib/image-plan.js`
- Create: `skills/article-image-generator/profiles/example.json`
- Create: `skills/article-image-generator/profiles/snowchuang-yihuang.json`
- Create: `skills/article-image-generator/profiles/sudan-health.json`

- [ ] **Step 1: Write the failing validation tests**

Create `test/article-image-generator/image-plan.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  loadImageProfile,
  normalizeImagePlan,
  validateImagePlan,
} = require("../../skills/article-image-generator/scripts/lib/image-plan");

const profilesDir = path.join(__dirname, "..", "..", "skills", "article-image-generator", "profiles");

test("loadImageProfile loads Snowchuang image defaults", () => {
  const profile = loadImageProfile("snowchuang-yihuang", { profilesDir });

  assert.equal(profile.id, "snowchuang-yihuang");
  assert.equal(profile.defaultModel, "gpt-image-2");
  assert.equal(profile.defaultSize, "1024x1024");
  assert.match(profile.styleGuide, /韩系低饱和/);
});

test("normalizeImagePlan applies profile defaults and prompt prefix", () => {
  const profile = loadImageProfile("example", { profilesDir });
  const plan = normalizeImagePlan({
    profile: "example",
    images: [{
      key: "coverMood",
      role: "cover",
      prompt: "A clean editorial cover image.",
      alt: "封面图",
    }],
  }, profile);

  assert.equal(plan.profile, "example");
  assert.equal(plan.images[0].model, "gpt-image-2");
  assert.equal(plan.images[0].size, "1024x1024");
  assert.match(plan.images[0].prompt, /^Create an original article image/);
});

test("validateImagePlan rejects duplicate keys", () => {
  const profile = loadImageProfile("example", { profilesDir });
  const plan = normalizeImagePlan({
    profile: "example",
    images: [
      { key: "look", role: "body", prompt: "Image one", alt: "图一" },
      { key: "look", role: "body", prompt: "Image two", alt: "图二" },
    ],
  }, profile);

  assert.throws(() => validateImagePlan(plan, profile), /duplicate image key: look/);
});

test("validateImagePlan rejects multiple cover images", () => {
  const profile = loadImageProfile("example", { profilesDir });
  const plan = normalizeImagePlan({
    profile: "example",
    images: [
      { key: "coverA", role: "cover", prompt: "Cover A", alt: "封面 A" },
      { key: "coverB", role: "cover", prompt: "Cover B", alt: "封面 B" },
    ],
  }, profile);

  assert.throws(() => validateImagePlan(plan, profile), /only one cover image is allowed/);
});

test("validateImagePlan rejects blocked prompt terms", () => {
  const profile = loadImageProfile("snowchuang-yihuang", { profilesDir });
  const plan = normalizeImagePlan({
    profile: "snowchuang-yihuang",
    images: [{
      key: "coverMood",
      role: "cover",
      prompt: "照搬小红书原图，保留水印",
      alt: "封面图",
    }],
  }, profile);

  assert.throws(() => validateImagePlan(plan, profile), /blocked prompt term/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test test/article-image-generator/image-plan.test.js
```

Expected: FAIL with `Cannot find module '../../skills/article-image-generator/scripts/lib/image-plan'`.

- [ ] **Step 3: Add profiles**

Create `skills/article-image-generator/profiles/example.json`:

```json
{
  "id": "example",
  "subject": "示例",
  "defaultModel": "gpt-image-2",
  "defaultSize": "1024x1024",
  "styleGuide": "通用公众号正文配图；原创；不含文字、水印、logo。",
  "promptPrefix": "Create an original article image.",
  "blockedPromptTerms": ["照搬", "水印", "logo"]
}
```

Create `skills/article-image-generator/profiles/snowchuang-yihuang.json`:

```json
{
  "id": "snowchuang-yihuang",
  "subject": "雪创",
  "defaultModel": "gpt-image-2",
  "defaultSize": "1024x1024",
  "styleGuide": "亲切、实用、有画面感；韩系低饱和；公众号正文图；不含文字、水印、logo。",
  "promptPrefix": "Create an original image for a WeChat official account fashion article.",
  "blockedPromptTerms": ["小红书原图", "照搬", "水印", "logo", "明星同款脸"]
}
```

Create `skills/article-image-generator/profiles/sudan-health.json`:

```json
{
  "id": "sudan-health",
  "subject": "苏丹",
  "defaultModel": "gpt-image-2",
  "defaultSize": "1024x1024",
  "styleGuide": "温和、可信、生活化；大健康生活方式配图；不展示医疗奇迹；不含文字、水印、logo。",
  "promptPrefix": "Create an original image for a restrained health and lifestyle WeChat official account article.",
  "blockedPromptTerms": ["治愈", "根治", "保证有效", "病前病后对比", "水印", "logo"]
}
```

- [ ] **Step 4: Implement validation module**

Create `skills/article-image-generator/scripts/lib/image-plan.js`:

```js
const fs = require("node:fs");
const path = require("node:path");

function cleanText(value) {
  return String(value || "").trim();
}

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function validateProfile(profile) {
  const id = cleanText(profile?.id);
  if (!id) throw new Error("profile.id is required");
  if (!cleanText(profile.defaultModel)) throw new Error("profile.defaultModel is required");
  if (!cleanText(profile.defaultSize)) throw new Error("profile.defaultSize is required");
  return {
    id,
    subject: cleanText(profile.subject),
    defaultModel: cleanText(profile.defaultModel),
    defaultSize: cleanText(profile.defaultSize),
    styleGuide: cleanText(profile.styleGuide),
    promptPrefix: cleanText(profile.promptPrefix),
    blockedPromptTerms: Array.isArray(profile.blockedPromptTerms)
      ? profile.blockedPromptTerms.map(cleanText).filter(Boolean)
      : [],
  };
}

function loadImageProfile(profileId, options = {}) {
  const profilesDir = options.profilesDir || path.join(__dirname, "..", "..", "profiles");
  const filePath = path.join(profilesDir, `${cleanText(profileId)}.json`);
  return validateProfile(loadJson(filePath));
}

function normalizeImagePlan(input, profile) {
  const planProfile = cleanText(input?.profile || profile?.id);
  const images = Array.isArray(input?.images) ? input.images : [];
  return {
    profile: planProfile,
    articleJson: cleanText(input?.articleJson),
    outputDir: cleanText(input?.outputDir),
    images: images.map((image, index) => {
      const promptBody = cleanText(image?.prompt);
      const prefix = cleanText(profile?.promptPrefix);
      const styleGuide = cleanText(profile?.styleGuide);
      const parts = [prefix, promptBody, styleGuide].filter(Boolean);
      return {
        key: cleanText(image?.key || `image${index + 1}`),
        role: cleanText(image?.role || "body"),
        prompt: parts.join(" "),
        promptBody,
        negativePrompt: cleanText(image?.negativePrompt),
        alt: cleanText(image?.alt),
        size: cleanText(image?.size || profile?.defaultSize),
        model: cleanText(image?.model || profile?.defaultModel),
        filename: cleanText(image?.filename),
      };
    }),
  };
}

function validateImagePlan(plan, profile, options = {}) {
  if (!cleanText(plan?.profile)) throw new Error("image plan profile is required");
  if (!Array.isArray(plan.images) || !plan.images.length) {
    throw new Error("image plan requires at least one image");
  }

  const keys = new Set();
  let coverCount = 0;
  const blockedTerms = Array.isArray(profile?.blockedPromptTerms) ? profile.blockedPromptTerms : [];
  for (const image of plan.images) {
    if (!image.key) throw new Error("image key is required");
    if (keys.has(image.key)) throw new Error(`duplicate image key: ${image.key}`);
    keys.add(image.key);

    if (!["cover", "body"].includes(image.role)) {
      throw new Error(`invalid image role for ${image.key}: ${image.role}`);
    }
    if (image.role === "cover") coverCount += 1;
    if (!image.promptBody) throw new Error(`image prompt is required for ${image.key}`);
    if (!image.alt) throw new Error(`image alt is required for ${image.key}`);
    if (!image.size) throw new Error(`image size is required for ${image.key}`);
    if (!image.model) throw new Error(`image model is required for ${image.key}`);
    for (const term of blockedTerms) {
      if (term && image.prompt.includes(term)) {
        throw new Error(`blocked prompt term for ${image.key}: ${term}`);
      }
    }
  }
  if (coverCount > 1) throw new Error("only one cover image is allowed");

  if (options.articleText && options.strictPlaceholders) {
    for (const image of plan.images.filter(item => item.role === "body")) {
      if (!options.articleText.includes(`{{image:${image.key}}}`)) {
        throw new Error(`missing article placeholder for image: ${image.key}`);
      }
    }
  }

  return plan;
}

module.exports = {
  loadImageProfile,
  normalizeImagePlan,
  validateImagePlan,
  validateProfile,
};
```

- [ ] **Step 5: Run test and verify GREEN**

Run:

```bash
node --test test/article-image-generator/image-plan.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add skills/article-image-generator/profiles skills/article-image-generator/scripts/lib/image-plan.js test/article-image-generator/image-plan.test.js
git commit -m "feat: add article image plan validation"
```

## Task 2: Article Merge And Manifest Utilities

**Files:**
- Create: `test/article-image-generator/article-merge.test.js`
- Create: `skills/article-image-generator/scripts/lib/article-merge.js`
- Create: `skills/article-image-generator/scripts/lib/manifest.js`

- [ ] **Step 1: Write failing tests**

Create `test/article-image-generator/article-merge.test.js`:

```js
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
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test test/article-image-generator/article-merge.test.js
```

Expected: FAIL with missing modules for `article-merge` and `manifest`.

- [ ] **Step 3: Implement article merge**

Create `skills/article-image-generator/scripts/lib/article-merge.js`:

```js
function cleanText(value) {
  return String(value || "").trim();
}

function normalizeContentImage(value) {
  return {
    key: cleanText(value?.key),
    path: cleanText(value?.path),
    alt: cleanText(value?.alt),
  };
}

function mergeArticleImages(article, assets) {
  const merged = {
    ...article,
  };
  const generated = Array.isArray(assets) ? assets : [];
  const cover = generated.find(asset => asset.role === "cover");
  if (cover?.path) {
    merged.coverPath = cover.path;
  }

  const byKey = new Map();
  for (const image of Array.isArray(article?.contentImages) ? article.contentImages : []) {
    const normalized = normalizeContentImage(image);
    if (normalized.key && normalized.path) byKey.set(normalized.key, normalized);
  }
  for (const asset of generated) {
    const normalized = normalizeContentImage(asset);
    if (normalized.key && normalized.path) byKey.set(normalized.key, normalized);
  }
  merged.contentImages = Array.from(byKey.values());
  return merged;
}

module.exports = {
  mergeArticleImages,
};
```

- [ ] **Step 4: Implement manifest utilities**

Create `skills/article-image-generator/scripts/lib/manifest.js`:

```js
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeImageFilename(filename, fallbackKey) {
  const fallback = `${String(fallbackKey || "image").replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
  const raw = String(filename || fallback).trim();
  const base = path.basename(raw || fallback).replace(/[^a-zA-Z0-9_.-]/g, "_");
  return base.includes(".") ? base : `${base}.png`;
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function buildAssetRecord({ image, filePath }) {
  return {
    key: image.key,
    role: image.role,
    path: filePath,
    alt: image.alt,
    size: image.size,
    model: image.model,
    sha256: sha256File(filePath),
  };
}

function writeJsonFile(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

function writeManifest(filePath, manifest) {
  return writeJsonFile(filePath, manifest);
}

module.exports = {
  buildAssetRecord,
  ensureDir,
  safeImageFilename,
  sha256File,
  writeJsonFile,
  writeManifest,
};
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
node --test test/article-image-generator/article-merge.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add skills/article-image-generator/scripts/lib/article-merge.js skills/article-image-generator/scripts/lib/manifest.js test/article-image-generator/article-merge.test.js
git commit -m "feat: merge generated article images"
```

## Task 3: Image2 Client

**Files:**
- Create: `test/article-image-generator/image2-client.test.js`
- Create: `skills/article-image-generator/scripts/lib/image2-client.js`

- [ ] **Step 1: Write failing client tests**

Create `test/article-image-generator/image2-client.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { Image2Client, Image2ApiError, redactSecret } = require("../../skills/article-image-generator/scripts/lib/image2-client");

test("redactSecret removes bearer token values", () => {
  assert.equal(redactSecret("Authorization: Bearer secret-token-value", "secret-token-value"), "Authorization: Bearer [REDACTED]");
});

test("generateImage returns bytes from b64_json response", async () => {
  const client = new Image2Client({
    apiKey: "secret",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.example.test/v1/images/generations");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer secret");
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, "gpt-image-2");
      assert.equal(payload.prompt, "A cover image");
      assert.equal(payload.size, "1024x1024");
      return jsonResponse({ data: [{ b64_json: Buffer.from("png-bytes").toString("base64") }] });
    },
    baseUrl: "https://api.example.test/v1",
  });

  const result = await client.generateImage({
    model: "gpt-image-2",
    prompt: "A cover image",
    size: "1024x1024",
  });

  assert.deepEqual(result.buffer, Buffer.from("png-bytes"));
  assert.equal(result.source, "b64_json");
});

test("generateImage downloads image URL responses", async () => {
  const client = new Image2Client({
    apiKey: "secret",
    baseUrl: "https://api.example.test/v1",
    fetchImpl: async (url) => {
      if (String(url).includes("/images/generations")) {
        return jsonResponse({ data: [{ url: "https://cdn.example.test/image.png" }] });
      }
      assert.equal(url, "https://cdn.example.test/image.png");
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "image/png"]]),
        async arrayBuffer() {
          return Buffer.from("downloaded-image");
        },
        async text() {
          return "downloaded-image";
        },
      };
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2",
    prompt: "A body image",
    size: "1024x1024",
  });

  assert.deepEqual(result.buffer, Buffer.from("downloaded-image"));
  assert.equal(result.source, "url");
});

test("generateImage throws useful redacted API error", async () => {
  const client = new Image2Client({
    apiKey: "secret-token",
    baseUrl: "https://api.example.test/v1",
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() {
        return JSON.stringify({ error: { message: "bad key secret-token" } });
      },
    }),
  });

  await assert.rejects(
    () => client.generateImage({ model: "gpt-image-2", prompt: "x", size: "1024x1024" }),
    (error) => {
      assert.equal(error instanceof Image2ApiError, true);
      assert.match(error.message, /Image2 API error 401/);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    }
  );
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
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test test/article-image-generator/image2-client.test.js
```

Expected: FAIL with missing `image2-client` module.

- [ ] **Step 3: Implement image2 client**

Create `skills/article-image-generator/scripts/lib/image2-client.js`:

```js
class Image2ApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "Image2ApiError";
    this.status = details.status;
  }
}

function cleanBaseUrl(value) {
  return String(value || "https://api.ohmygpt.com/v1").replace(/\/+$/, "");
}

function redactSecret(value, secret) {
  const text = String(value || "");
  const token = String(secret || "");
  if (!token) return text;
  return text.split(token).join("[REDACTED]");
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || "";
  if (headers instanceof Map) return headers.get(name) || headers.get(name.toLowerCase()) || "";
  return headers[name] || headers[name.toLowerCase()] || "";
}

class Image2Client {
  constructor(options = {}) {
    this.apiKey = String(options.apiKey || "").trim();
    this.baseUrl = cleanBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async generateImage({ model, prompt, size }) {
    if (!this.apiKey) throw new Image2ApiError("IMAGE2_API_KEY is required");
    const response = await this.fetchImpl(`${this.baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
      }),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Image2ApiError(`Image2 API error ${response.status}: ${redactSecret(text.slice(0, 300), this.apiKey)}`, {
        status: response.status,
      });
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Image2ApiError(`Image2 returned non-JSON response: ${redactSecret(text.slice(0, 120), this.apiKey)}`);
    }
    const first = Array.isArray(payload?.data) ? payload.data[0] : null;
    if (first?.b64_json) {
      return {
        buffer: Buffer.from(first.b64_json, "base64"),
        source: "b64_json",
      };
    }
    if (first?.url) {
      const downloaded = await this.downloadImage(first.url);
      return {
        buffer: downloaded,
        source: "url",
      };
    }
    throw new Image2ApiError(`Image2 response has no image data; keys=${Object.keys(payload || {}).join(",")}`);
  }

  async downloadImage(url) {
    const response = await this.fetchImpl(url);
    const contentType = headerValue(response.headers, "content-type");
    if (!response.ok) {
      const text = typeof response.text === "function" ? await response.text() : "";
      throw new Image2ApiError(`Image2 image download failed ${response.status}: ${text.slice(0, 120)}`);
    }
    if (contentType && !contentType.startsWith("image/")) {
      throw new Image2ApiError(`Image2 URL did not return an image: ${contentType}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

module.exports = {
  Image2ApiError,
  Image2Client,
  redactSecret,
};
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test test/article-image-generator/image2-client.test.js
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/article-image-generator/scripts/lib/image2-client.js test/article-image-generator/image2-client.test.js
git commit -m "feat: add image2 client"
```

## Task 4: CLI Dry-Run And Generate Flow

**Files:**
- Create: `test/article-image-generator/cli.test.js`
- Create: `skills/article-image-generator/scripts/article-image-generator.js`

- [ ] **Step 1: Write failing CLI tests**

Create `test/article-image-generator/cli.test.js`:

```js
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
      { key: "lookGrid", role: "body", prompt: "Outfit grid", alt: "穿搭图" }
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
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test test/article-image-generator/cli.test.js
```

Expected: FAIL with missing CLI module.

- [ ] **Step 3: Implement CLI**

Create `skills/article-image-generator/scripts/article-image-generator.js`:

```js
#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const { mergeArticleImages } = require("./lib/article-merge");
const { Image2Client } = require("./lib/image2-client");
const { loadImageProfile, normalizeImagePlan, validateImagePlan } = require("./lib/image-plan");
const { buildAssetRecord, ensureDir, safeImageFilename, writeJsonFile, writeManifest } = require("./lib/manifest");

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    imagePlan: "",
    articleJson: "",
    outputDir: "",
    outArticle: "",
    profilesDir: "",
    strictPlaceholders: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") args.mode = argv[++index];
    else if (arg === "--image-plan") args.imagePlan = argv[++index];
    else if (arg === "--article-json") args.articleJson = argv[++index];
    else if (arg === "--output-dir") args.outputDir = argv[++index];
    else if (arg === "--out-article") args.outArticle = argv[++index];
    else if (arg === "--profiles-dir") args.profilesDir = argv[++index];
    else if (arg === "--strict-placeholders") args.strictPlaceholders = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function loadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function resolvePath(baseDir, filePath) {
  if (!filePath) return "";
  if (path.isAbsolute(filePath)) return filePath;
  return path.resolve(baseDir, filePath);
}

function articleText(article) {
  return [article?.markdown, article?.html].filter(Boolean).join("\n");
}

function buildClient(env, options) {
  return new Image2Client({
    apiKey: env.IMAGE2_API_KEY,
    baseUrl: env.IMAGE2_API_BASE_URL,
    fetchImpl: options.fetchImpl,
  });
}

async function generateAssets({ plan, outputDir, client }) {
  ensureDir(outputDir);
  const assets = [];
  for (const image of plan.images) {
    const generated = await client.generateImage({
      model: image.model,
      prompt: image.prompt,
      size: image.size,
    });
    const fileName = safeImageFilename(image.filename, image.key);
    const filePath = path.join(outputDir, fileName);
    fs.writeFileSync(filePath, generated.buffer);
    assets.push(buildAssetRecord({ image, filePath }));
  }
  return assets;
}

async function main(argv = process.argv.slice(2), env = process.env, options = {}) {
  const args = parseArgs(argv);
  if (!["dry-run", "generate"].includes(args.mode)) {
    throw new Error("--mode must be dry-run or generate");
  }
  if (!args.imagePlan) throw new Error("--image-plan is required");

  const cwd = options.cwd || process.cwd();
  const planPath = resolvePath(cwd, args.imagePlan);
  const rawPlan = loadJson(planPath);
  const articlePath = resolvePath(path.dirname(planPath), args.articleJson || rawPlan.articleJson);
  if (!articlePath) throw new Error("--article-json or imagePlan.articleJson is required");
  const article = loadJson(articlePath);
  const profile = loadImageProfile(rawPlan.profile, { profilesDir: args.profilesDir || undefined });
  const normalizedPlan = normalizeImagePlan(rawPlan, profile);
  if (env.IMAGE2_MODEL) {
    for (const image of normalizedPlan.images) {
      image.model = env.IMAGE2_MODEL;
    }
  }
  const plan = validateImagePlan(
    normalizedPlan,
    profile,
    { articleText: articleText(article), strictPlaceholders: args.strictPlaceholders }
  );

  const outputDir = resolvePath(path.dirname(planPath), args.outputDir || rawPlan.outputDir || "article-image-assets");
  const outArticle = resolvePath(path.dirname(planPath), args.outArticle || path.join(outputDir, "..", "article.with-images.json"));
  const manifestPath = path.join(outputDir, "assets-manifest.json");
  const record = {
    createdAt: new Date().toISOString(),
    profile: plan.profile,
    model: env.IMAGE2_MODEL || profile.defaultModel,
    mode: args.mode,
    status: "planned",
    articleJson: articlePath,
    outArticle,
    images: plan.images.map(image => ({
      key: image.key,
      role: image.role,
      alt: image.alt,
      size: image.size,
      model: image.model,
      status: "planned",
    })),
  };

  if (args.mode === "dry-run") {
    writeManifest(manifestPath, record);
    return { ok: true, record, manifestPath };
  }

  const client = buildClient(env, options);
  const assets = await generateAssets({ plan, outputDir, client });
  const finalRecord = {
    ...record,
    status: "generated",
    images: assets,
  };
  writeManifest(manifestPath, finalRecord);
  writeJsonFile(outArticle, mergeArticleImages(article, assets));
  return { ok: true, record: finalRecord, manifestPath, outArticle };
}

if (require.main === module) {
  main().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  main,
  parseArgs,
};
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test test/article-image-generator/cli.test.js
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add skills/article-image-generator/scripts/article-image-generator.js test/article-image-generator/cli.test.js
git commit -m "feat: add article image generator cli"
```

## Task 5: Skill Documentation And Repository Checks

**Files:**
- Create: `skills/article-image-generator/SKILL.md`
- Create: `skills/article-image-generator/references/image2-api.md`
- Modify: `docs/wechat-official-account.md`
- Modify: `package.json`

- [ ] **Step 1: Add skill instructions**

Create `skills/article-image-generator/SKILL.md`:

```markdown
---
name: article-image-generator
description: Generate original article images through the image2 API from an Agent-authored image plan, then write local assets and article.with-images.json for downstream publishing skills.
---

# Article Image Generator

Use this skill when an article needs generated images before it is handed to a publishing skill such as `wechat-official-account`.

## Workflow

1. Draft `article.json` first.
2. Insert image placeholders in the body, such as `{{image:lookGrid}}`.
3. Write `image-plan.json` with one item per image.
4. Run dry-run validation.
5. Run generation only when image2 credentials are available and the user expects paid external image generation.
6. Pass `article.with-images.json` to the publishing skill.

## Commands

```bash
node skills/article-image-generator/scripts/article-image-generator.js \
  --mode dry-run \
  --image-plan image-plan.json \
  --article-json article.json \
  --output-dir tmp/article-assets \
  --out-article article.with-images.json
```

```bash
IMAGE2_API_KEY="$IMAGE2_API_KEY" \
node skills/article-image-generator/scripts/article-image-generator.js \
  --mode generate \
  --image-plan image-plan.json \
  --article-json article.json \
  --output-dir tmp/article-assets \
  --out-article article.with-images.json
```

## Safety

- Do not copy external platform source images.
- Do not request watermarks, logos, or identifiable private people.
- Do not write image API keys to Git, article JSON, manifest files, docs, or logs.
- State how many images will be generated before running `generate`.
```

- [ ] **Step 2: Add image2 reference**

Create `skills/article-image-generator/references/image2-api.md`:

```markdown
# image2 API Reference

The first supported provider is the image2-compatible endpoint that was verified from the Snowchuang server.

## Environment

```env
IMAGE2_API_BASE_URL=https://api.ohmygpt.com/v1
IMAGE2_API_KEY=runtime_secret_not_committed
IMAGE2_MODEL=gpt-image-2
IMAGE2_TIMEOUT_MS=180000
IMAGE2_MAX_RETRIES=2
```

## Request Shape

The client sends a POST request to:

```text
/images/generations
```

with:

```json
{
  "model": "gpt-image-2",
  "prompt": "Create an original image...",
  "size": "1024x1024"
}
```

## Response Shapes

Supported:

- `data[0].b64_json`
- `data[0].url`

Secrets must never be printed in errors or manifests.
```

- [ ] **Step 3: Update WeChat docs with handoff**

Append this section to `docs/wechat-official-account.md`:

```markdown
## Generated Image Handoff

For generated article images, use `skills/article-image-generator/` first. It writes `article.with-images.json`, which already contains `coverPath` and `contentImages`.

```bash
node skills/article-image-generator/scripts/article-image-generator.js \
  --mode generate \
  --image-plan image-plan.json \
  --article-json article.json \
  --out-article article.with-images.json

node skills/wechat-official-account/scripts/wechat-official-account.js \
  --mode draft-only \
  --profile snowchuang-yihuang \
  --article-json article.with-images.json
```
```

- [ ] **Step 4: Update package check script**

Modify `package.json` so `scripts.check` also checks the new CLI:

```json
"check": "node --check src/server.js && node --check src/debounce-queue.js && node --check src/prompt-adapter.js && node --check src/retrieval-adapter.js && node --check scripts/agents-pool.js && node --check scripts/create-worker-pool.js && node --check scripts/sync-worker-workspaces.js && node --check skills/wechat-official-account/scripts/wechat-official-account.js && node --check skills/article-image-generator/scripts/article-image-generator.js"
```

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
npm run check
```

Expected:

- `npm test`: existing tests plus new article-image-generator tests pass.
- `npm run check`: all listed files pass syntax checks.

- [ ] **Step 6: Commit**

```bash
git add skills/article-image-generator docs/wechat-official-account.md package.json
git commit -m "docs: add article image generator skill guide"
```

## Task 6: Local End-To-End Dry-Run

**Files:**
- No tracked file changes expected.

- [ ] **Step 1: Create temporary sample files outside Git**

Run in PowerShell:

```powershell
$dir = "tmp/article-image-generator-smoke"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
@'
{
  "title": "韩式穿搭公式",
  "author": "衣荒救星站",
  "digest": "低饱和色系照着穿。",
  "html": "<section>{{image:coverMood}}</section><section>{{image:lookGrid}}</section>"
}
'@ | Set-Content -Encoding UTF8 -LiteralPath "$dir/article.json"
@'
{
  "profile": "snowchuang-yihuang",
  "images": [
    {
      "key": "coverMood",
      "role": "cover",
      "prompt": "Photorealistic Korean women's fashion editorial cover, low-saturation palette, no text, no logo.",
      "alt": "韩系低饱和穿搭封面图"
    },
    {
      "key": "lookGrid",
      "role": "body",
      "prompt": "Four coordinated Korean-style outfits on a clean studio background, no text, no watermark.",
      "alt": "四套韩系低饱和穿搭示意图"
    }
  ]
}
'@ | Set-Content -Encoding UTF8 -LiteralPath "$dir/image-plan.json"
```

- [ ] **Step 2: Run local dry-run**

Run:

```bash
node skills/article-image-generator/scripts/article-image-generator.js \
  --mode dry-run \
  --image-plan tmp/article-image-generator-smoke/image-plan.json \
  --article-json tmp/article-image-generator-smoke/article.json \
  --output-dir tmp/article-image-generator-smoke/assets \
  --out-article tmp/article-image-generator-smoke/article.with-images.json \
  --strict-placeholders
```

Expected:

- command exits `0`;
- stdout JSON has `"ok": true`;
- `tmp/article-image-generator-smoke/assets/assets-manifest.json` exists;
- `tmp/article-image-generator-smoke/article.with-images.json` does not exist because dry-run does not generate images.

- [ ] **Step 3: Confirm Git stays clean except intended commits**

Run:

```bash
git status --short
```

Expected: no tracked changes. Temporary files under ignored `tmp/` may appear only if the repository does not ignore them; remove them if necessary.

## Task 7: Implementation Completion Handoff

**Files:**
- No new implementation files.

- [ ] **Step 1: Review commit history**

Run:

```bash
git log --oneline --decorate -6
```

Expected: commits for validation, article merge, image2 client, CLI, docs.

- [ ] **Step 2: Verify spec coverage**

Check each design requirement maps to implementation:

- standalone skill under `skills/article-image-generator`;
- image plan format and validation;
- profile defaults;
- image2 base64 and URL response handling;
- manifest with SHA-256;
- updated article with `coverPath` and `contentImages`;
- no WeChat upload in image generator;
- docs for handoff to `wechat-official-account`;
- tests and check script.

- [ ] **Step 3: Prepare PR summary**

Use this summary:

```markdown
## Summary
- Add reusable `article-image-generator` OpenClaw skill for image2-based article image generation
- Add profile-driven image plan validation, image2 client, manifest writing, and article JSON merge
- Document the generated-image handoff into `wechat-official-account`

## Verification
- npm test
- npm run check
- local dry-run with sample Snowchuang image plan
```

- [ ] **Step 4: Stop before server deployment**

Do not pull to `/opt/openclaw-agent-pool-bridge`, sync workers, run real image2 generation, or create WeChat drafts until the user explicitly approves deployment and any paid/API side effects.
