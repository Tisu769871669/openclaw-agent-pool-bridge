# WeChat Official Account Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在通用 `openclaw-agent-pool-bridge` 仓库中新增一套可复用的微信公众号运营技能，支持文章生成指导、素材上传、草稿创建和自动发布。

**Architecture:** 公众号能力作为 `skills/wechat-official-account/` 下的通用 skill 包存在，不进入 bridge runtime。脚本层负责微信 API、profile、合规、审计和 dry-run/publish 流程；业务差异通过 profile 配置表达，苏丹只是第一个 `sudan-health` profile。

**Tech Stack:** Node.js 20、CommonJS、`node:test`、微信公众平台官方 HTTP API、零新增运行时依赖。

---

## 范围检查

这份计划只实现“通用微信公众号 skill 包”的 MVP，不修改 `src/http-server.js`、`src/agent-pool.js` 等 bridge 运行时代码。服务器部署、微信凭证配置、IP 白名单、自动化 cron 都是后续上线步骤，实施时必须另走用户授权和本地 Markdown 记录。

## 文件结构

在 `D:\Study\codeXprojection\openclaw-agent-pool-bridge` 中新增：

```text
skills/wechat-official-account/
  SKILL.md
  profiles/
    example.json
    sudan-health.json
  scripts/
    wechat-official-account.js
    lib/
      article-package.js
      audit-log.js
      compliance.js
      profile.js
      wechat-client.js
  references/
    wechat-api.md
docs/
  wechat-official-account.md
test/
  wechat-official-account/
    article-package.test.js
    audit-log.test.js
    compliance.test.js
    profile.test.js
    wechat-client.test.js
```

设计取舍：

- MVP 使用 JSON profile，不引入 YAML 依赖；后续如果确实需要 YAML，再独立加解析层。
- 写作主要由 agent 按 `SKILL.md` 指导完成；脚本负责可测试的确定性工作：profile 校验、合规检查、文章包校验、微信 API、审计日志。
- 自动发布通过 CLI 明确 `--mode publish` 触发，默认 `dry-run`。

### Task 1: Profile 和合规规则

**Files:**
- Create: `skills/wechat-official-account/profiles/example.json`
- Create: `skills/wechat-official-account/profiles/sudan-health.json`
- Create: `skills/wechat-official-account/scripts/lib/profile.js`
- Create: `skills/wechat-official-account/scripts/lib/compliance.js`
- Test: `test/wechat-official-account/profile.test.js`
- Test: `test/wechat-official-account/compliance.test.js`

- [ ] **Step 1: 写 profile 测试**

创建 `test/wechat-official-account/profile.test.js`：

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadProfile, validateProfile } = require("../../skills/wechat-official-account/scripts/lib/profile");

test("loadProfile loads sudan-health profile", () => {
  const profile = loadProfile("sudan-health", {
    profilesDir: path.join(__dirname, "..", "..", "skills", "wechat-official-account", "profiles"),
  });

  assert.equal(profile.id, "sudan-health");
  assert.equal(profile.subject, "苏丹");
  assert.equal(profile.publishPolicy.defaultMode, "publish");
  assert.equal(profile.publishPolicy.requireComplianceCheck, true);
});

test("validateProfile rejects missing publish policy", () => {
  assert.throws(
    () => validateProfile({ id: "broken", subject: "测试" }),
    /publishPolicy is required/
  );
});
```

- [ ] **Step 2: 写合规测试**

创建 `test/wechat-official-account/compliance.test.js`：

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { checkCompliance } = require("../../skills/wechat-official-account/scripts/lib/compliance");

const profile = {
  id: "sudan-health",
  contentRules: {
    avoid: ["治愈", "根治", "保证有效", "替代医生"],
  },
};

test("checkCompliance passes restrained health content", () => {
  const result = checkCompliance("这是一份日常饮食参考，个体情况不同，建议结合自身情况选择。", profile);

  assert.equal(result.passed, true);
  assert.deepEqual(result.matches, []);
});

test("checkCompliance flags high-risk health claims", () => {
  const result = checkCompliance("这款产品可以根治问题，并且保证有效。", profile);

  assert.equal(result.passed, false);
  assert.deepEqual(result.matches.map((item) => item.term), ["根治", "保证有效"]);
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
npm test -- test/wechat-official-account/profile.test.js test/wechat-official-account/compliance.test.js
```

Expected: FAIL，提示找不到 `profile` 和 `compliance` 模块。

- [ ] **Step 4: 添加 profile 文件**

创建 `skills/wechat-official-account/profiles/example.json`：

```json
{
  "id": "example",
  "subject": "示例主体",
  "officialAccount": "示例公众号",
  "direction": ["行业内容"],
  "defaultAuthor": "示例作者",
  "defaultTheme": "general",
  "publishPolicy": {
    "defaultMode": "dry-run",
    "requireManualConfirmation": true,
    "requireComplianceCheck": true,
    "maxAutoPublishPerDay": 1
  },
  "contentRules": {
    "voice": "清楚、可信、不过度承诺",
    "avoid": ["保证收益", "保证有效", "绝对安全"]
  },
  "sourcePreferences": ["用户提供资料", "已确认知识库"]
}
```

创建 `skills/wechat-official-account/profiles/sudan-health.json`：

```json
{
  "id": "sudan-health",
  "subject": "苏丹",
  "officialAccount": "大健康",
  "direction": ["大健康", "卖货"],
  "defaultAuthor": "苏丹",
  "defaultTheme": "health-commerce",
  "publishPolicy": {
    "defaultMode": "publish",
    "requireManualConfirmation": false,
    "requireComplianceCheck": true,
    "maxAutoPublishPerDay": 3
  },
  "contentRules": {
    "voice": "温和、可信、生活化、适度成交",
    "avoid": ["治愈", "根治", "保证有效", "替代医生", "包治", "立刻见效"]
  },
  "sourcePreferences": ["苏丹商品和活动数据", "已确认的知识库内容", "用户提供的来源链接"]
}
```

- [ ] **Step 5: 实现 profile 模块**

创建 `skills/wechat-official-account/scripts/lib/profile.js`：

```js
const fs = require("node:fs");
const path = require("node:path");

function defaultProfilesDir() {
  return path.join(__dirname, "..", "..", "profiles");
}

function normalizeProfile(raw) {
  return {
    id: String(raw.id || "").trim(),
    subject: String(raw.subject || "").trim(),
    officialAccount: String(raw.officialAccount || "").trim(),
    direction: Array.isArray(raw.direction) ? raw.direction.map(String) : [],
    defaultAuthor: String(raw.defaultAuthor || "").trim(),
    defaultTheme: String(raw.defaultTheme || "general").trim(),
    publishPolicy: raw.publishPolicy || {},
    contentRules: raw.contentRules || {},
    sourcePreferences: Array.isArray(raw.sourcePreferences) ? raw.sourcePreferences.map(String) : [],
  };
}

function validateProfile(profile) {
  if (!profile || typeof profile !== "object") {
    throw new Error("profile must be an object");
  }
  if (!profile.id) {
    throw new Error("profile.id is required");
  }
  if (!profile.subject) {
    throw new Error("profile.subject is required");
  }
  if (!profile.publishPolicy || Object.keys(profile.publishPolicy).length === 0) {
    throw new Error("publishPolicy is required");
  }
  const mode = profile.publishPolicy.defaultMode;
  if (!["dry-run", "draft-only", "publish"].includes(mode)) {
    throw new Error("publishPolicy.defaultMode must be dry-run, draft-only, or publish");
  }
  return profile;
}

function loadProfile(profileId, options = {}) {
  const profilesDir = options.profilesDir || defaultProfilesDir();
  const filePath = path.join(profilesDir, `${profileId}.json`);
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return validateProfile(normalizeProfile(raw));
}

module.exports = {
  loadProfile,
  normalizeProfile,
  validateProfile,
};
```

- [ ] **Step 6: 实现合规模块**

创建 `skills/wechat-official-account/scripts/lib/compliance.js`：

```js
function checkCompliance(text, profile) {
  const content = String(text || "");
  const avoid = Array.isArray(profile?.contentRules?.avoid) ? profile.contentRules.avoid : [];
  const matches = [];

  for (const term of avoid) {
    const keyword = String(term || "").trim();
    if (keyword && content.includes(keyword)) {
      matches.push({ term: keyword, severity: "high" });
    }
  }

  return {
    passed: matches.length === 0,
    matches,
  };
}

module.exports = {
  checkCompliance,
};
```

- [ ] **Step 7: 运行测试确认通过**

Run:

```bash
npm test -- test/wechat-official-account/profile.test.js test/wechat-official-account/compliance.test.js
```

Expected: PASS，2 个测试文件全部通过。

- [ ] **Step 8: 提交**

```bash
git add skills/wechat-official-account/profiles skills/wechat-official-account/scripts/lib/profile.js skills/wechat-official-account/scripts/lib/compliance.js test/wechat-official-account/profile.test.js test/wechat-official-account/compliance.test.js
git commit -m "feat: add wechat account profiles"
```

### Task 2: 文章包校验和 HTML 渲染

**Files:**
- Create: `skills/wechat-official-account/scripts/lib/article-package.js`
- Test: `test/wechat-official-account/article-package.test.js`

- [ ] **Step 1: 写文章包测试**

创建 `test/wechat-official-account/article-package.test.js`：

```js
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
  });

  assert.equal(article.title, "春天吃得清爽一点");
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
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- test/wechat-official-account/article-package.test.js
```

Expected: FAIL，提示找不到 `article-package` 模块。

- [ ] **Step 3: 实现文章包模块**

创建 `skills/wechat-official-account/scripts/lib/article-package.js`：

```js
function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function validateArticlePackage(input) {
  const article = {
    title: String(input?.title || "").trim(),
    digest: String(input?.digest || "").trim(),
    author: String(input?.author || "").trim(),
    markdown: String(input?.markdown || "").trim(),
    coverPath: String(input?.coverPath || "").trim(),
    contentImagePaths: Array.isArray(input?.contentImagePaths) ? input.contentImagePaths.map(String) : [],
    sourceLinks: Array.isArray(input?.sourceLinks) ? input.sourceLinks.map(String) : [],
  };

  if (!article.title) {
    throw new Error("title is required");
  }
  if (!article.digest) {
    throw new Error("digest is required");
  }
  if (!article.markdown) {
    throw new Error("markdown is required");
  }
  return article;
}

function renderInline(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderWechatHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listOpen = false;

  function closeList() {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      html.push(`<h2>${renderInline(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      html.push(`<h1>${renderInline(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("- ")) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInline(line.slice(2))}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${renderInline(line)}</p>`);
  }
  closeList();
  return html.join("\n");
}

module.exports = {
  renderWechatHtml,
  validateArticlePackage,
};
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
npm test -- test/wechat-official-account/article-package.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add skills/wechat-official-account/scripts/lib/article-package.js test/wechat-official-account/article-package.test.js
git commit -m "feat: add wechat article package renderer"
```

### Task 3: 微信 API Client

**Files:**
- Create: `skills/wechat-official-account/scripts/lib/wechat-client.js`
- Test: `test/wechat-official-account/wechat-client.test.js`

- [ ] **Step 1: 写微信 client 测试**

创建 `test/wechat-official-account/wechat-client.test.js`：

```js
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
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- test/wechat-official-account/wechat-client.test.js
```

Expected: FAIL，提示找不到 `wechat-client`。

- [ ] **Step 3: 实现微信 client**

创建 `skills/wechat-official-account/scripts/lib/wechat-client.js`：

```js
class WeChatApiError extends Error {
  constructor(message, payload = {}) {
    super(message);
    this.name = "WeChatApiError";
    this.payload = payload;
    this.errcode = payload.errcode;
    this.errmsg = payload.errmsg;
  }
}

class WeChatMpClient {
  constructor(options) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now || (() => Date.now());
    this.baseUrl = options.baseUrl || "https://api.weixin.qq.com";
    this.cachedToken = null;
  }

  async getAccessToken() {
    if (this.cachedToken && this.cachedToken.expiresAt > this.now()) {
      return this.cachedToken.value;
    }
    const url = `${this.baseUrl}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(this.appId)}&secret=${encodeURIComponent(this.appSecret)}`;
    const payload = await this.getJson(url);
    if (!payload.access_token) {
      throw new WeChatApiError("WeChat access_token missing", payload);
    }
    const ttlMs = Math.max(60, Number(payload.expires_in || 7200) - 300) * 1000;
    this.cachedToken = {
      value: payload.access_token,
      expiresAt: this.now() + ttlMs,
    };
    return this.cachedToken.value;
  }

  async addDraft(articles) {
    return this.postJson("/cgi-bin/draft/add", { articles });
  }

  async submitFreePublish(mediaId) {
    return this.postJson("/cgi-bin/freepublish/submit", { media_id: mediaId });
  }

  async getFreePublishStatus(publishId) {
    return this.postJson("/cgi-bin/freepublish/get", { publish_id: publishId });
  }

  async postJson(path, body) {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}${path}?access_token=${encodeURIComponent(token)}`;
    return this.getJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  }

  async getJson(url, options = {}) {
    const response = await this.fetchImpl(url, options);
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new WeChatApiError(`WeChat returned non-JSON response: ${text.slice(0, 120)}`);
    }
    if (payload.errcode && payload.errcode !== 0) {
      throw new WeChatApiError(`WeChat API error ${payload.errcode}: ${payload.errmsg || ""}`, payload);
    }
    return payload;
  }
}

module.exports = {
  WeChatApiError,
  WeChatMpClient,
};
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
npm test -- test/wechat-official-account/wechat-client.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add skills/wechat-official-account/scripts/lib/wechat-client.js test/wechat-official-account/wechat-client.test.js
git commit -m "feat: add wechat official account client"
```

### Task 4: 审计日志

**Files:**
- Create: `skills/wechat-official-account/scripts/lib/audit-log.js`
- Test: `test/wechat-official-account/audit-log.test.js`

- [ ] **Step 1: 写审计测试**

创建 `test/wechat-official-account/audit-log.test.js`：

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { redactSecrets, writeAuditRecord } = require("../../skills/wechat-official-account/scripts/lib/audit-log");

test("redactSecrets removes sensitive values", () => {
  const redacted = redactSecrets({
    title: "标题",
    access_token: "secret-token",
    nested: { WECHAT_MP_APP_SECRET: "secret" },
  });

  assert.equal(redacted.title, "标题");
  assert.equal(redacted.access_token, "[REDACTED]");
  assert.equal(redacted.nested.WECHAT_MP_APP_SECRET, "[REDACTED]");
});

test("writeAuditRecord writes jsonl and markdown summary", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-audit-"));
  const result = writeAuditRecord({
    rootDir: dir,
    record: {
      timestamp: "2026-04-28T12:00:00+08:00",
      profileId: "sudan-health",
      mode: "publish",
      title: "标题",
      status: "submitted",
      access_token: "secret-token",
    },
  });

  assert.equal(fs.existsSync(result.jsonlPath), true);
  assert.equal(fs.existsSync(result.markdownPath), true);
  assert.match(fs.readFileSync(result.jsonlPath, "utf8"), /\\[REDACTED\\]/);
  assert.match(fs.readFileSync(result.markdownPath, "utf8"), /sudan-health/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npm test -- test/wechat-official-account/audit-log.test.js
```

Expected: FAIL，提示找不到 `audit-log`。

- [ ] **Step 3: 实现审计模块**

创建 `skills/wechat-official-account/scripts/lib/audit-log.js`：

```js
const fs = require("node:fs");
const path = require("node:path");

const SECRET_KEYS = /secret|token|password|authorization/i;

function redactSecrets(value) {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = SECRET_KEYS.test(key) ? "[REDACTED]" : redactSecrets(nested);
    }
    return result;
  }
  return value;
}

function writeAuditRecord({ rootDir = process.cwd(), record }) {
  const clean = redactSecrets(record);
  const logsDir = path.join(rootDir, "logs", "wechat-official-account");
  const docsDir = path.join(rootDir, "docs", "wechat-official-account");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(docsDir, { recursive: true });

  const jsonlPath = path.join(logsDir, "publish-audit.jsonl");
  const markdownPath = path.join(docsDir, "publish-log.md");

  fs.appendFileSync(jsonlPath, `${JSON.stringify(clean)}\n`, "utf8");
  const lines = [
    "",
    `## ${clean.timestamp || new Date().toISOString()} ${clean.title || ""}`,
    "",
    `- Profile: ${clean.profileId || ""}`,
    `- Mode: ${clean.mode || ""}`,
    `- Status: ${clean.status || ""}`,
    `- Draft media_id: ${clean.draftMediaId || ""}`,
    `- Publish id: ${clean.publishId || ""}`,
  ];
  fs.appendFileSync(markdownPath, `${lines.join("\n")}\n`, "utf8");

  return { jsonlPath, markdownPath };
}

module.exports = {
  redactSecrets,
  writeAuditRecord,
};
```

- [ ] **Step 4: 运行测试确认通过**

Run:

```bash
npm test -- test/wechat-official-account/audit-log.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add skills/wechat-official-account/scripts/lib/audit-log.js test/wechat-official-account/audit-log.test.js
git commit -m "feat: add wechat publish audit log"
```

### Task 5: CLI 串联 dry-run、draft-only、publish

**Files:**
- Create: `skills/wechat-official-account/scripts/wechat-official-account.js`
- Modify: `package.json`

- [ ] **Step 1: 创建 CLI 入口**

创建 `skills/wechat-official-account/scripts/wechat-official-account.js`：

```js
#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const { validateArticlePackage, renderWechatHtml } = require("./lib/article-package");
const { writeAuditRecord } = require("./lib/audit-log");
const { checkCompliance } = require("./lib/compliance");
const { loadProfile } = require("./lib/profile");
const { WeChatMpClient } = require("./lib/wechat-client");

function parseArgs(argv) {
  const args = {
    mode: "dry-run",
    profile: "sudan-health",
    rootDir: process.cwd(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") args.mode = argv[++index];
    else if (arg === "--profile") args.profile = argv[++index];
    else if (arg === "--article-json") args.articleJson = argv[++index];
    else if (arg === "--thumb-media-id") args.thumbMediaId = argv[++index];
    else if (arg === "--root-dir") args.rootDir = argv[++index];
    else if (arg === "--profiles-dir") args.profilesDir = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function loadArticle(filePath) {
  if (!filePath) {
    throw new Error("--article-json is required");
  }
  return validateArticlePackage(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function createClientFromEnv(env) {
  if (!env.WECHAT_MP_APP_ID || !env.WECHAT_MP_APP_SECRET) {
    throw new Error("WECHAT_MP_APP_ID and WECHAT_MP_APP_SECRET are required for draft-only or publish mode");
  }
  return new WeChatMpClient({
    appId: env.WECHAT_MP_APP_ID,
    appSecret: env.WECHAT_MP_APP_SECRET,
  });
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  if (!["dry-run", "draft-only", "publish"].includes(args.mode)) {
    throw new Error("--mode must be dry-run, draft-only, or publish");
  }

  const profile = loadProfile(args.profile, { profilesDir: args.profilesDir });
  const article = loadArticle(args.articleJson);
  const html = renderWechatHtml(article.markdown);
  const compliance = checkCompliance(`${article.title}\n${article.digest}\n${article.markdown}`, profile);

  if (profile.publishPolicy.requireComplianceCheck && !compliance.passed) {
    throw new Error(`Compliance check failed: ${compliance.matches.map((item) => item.term).join(", ")}`);
  }

  const record = {
    timestamp: new Date().toISOString(),
    profileId: profile.id,
    mode: args.mode,
    title: article.title,
    digest: article.digest,
    status: "dry-run",
    compliance,
    articlePath: path.resolve(args.articleJson),
  };

  if (args.mode !== "dry-run") {
    if (!args.thumbMediaId) {
      throw new Error("--thumb-media-id is required for draft-only or publish mode");
    }
    const client = createClientFromEnv(env);
    const draft = await client.addDraft([{
      title: article.title,
      author: article.author || profile.defaultAuthor,
      digest: article.digest,
      content: html,
      thumb_media_id: args.thumbMediaId,
      need_open_comment: 0,
      only_fans_can_comment: 0,
    }]);
    record.status = "draft-created";
    record.draftMediaId = draft.media_id;

    if (args.mode === "publish") {
      const publish = await client.submitFreePublish(draft.media_id);
      record.status = "publish-submitted";
      record.publishId = publish.publish_id;
    }
  }

  const audit = writeAuditRecord({ rootDir: args.rootDir, record });
  process.stdout.write(`${JSON.stringify({ ok: true, record, audit }, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  createClientFromEnv,
  main,
  parseArgs,
};
```

- [ ] **Step 2: 给 CLI 加语法检查**

修改 `package.json` 的 `scripts.check`，在现有命令后追加：

```json
"check": "node --check src/server.js && node --check src/debounce-queue.js && node --check src/prompt-adapter.js && node --check src/retrieval-adapter.js && node --check scripts/agents-pool.js && node --check scripts/create-worker-pool.js && node --check scripts/sync-worker-workspaces.js && node --check skills/wechat-official-account/scripts/wechat-official-account.js"
```

- [ ] **Step 3: 本地 dry-run 验证**

创建临时文章文件：

```powershell
$tmp = Join-Path $env:TEMP 'wechat-article.json'
@'
{
  "title": "春天吃得清爽一点",
  "digest": "一份适合日常阅读的大健康饮食参考。",
  "author": "苏丹",
  "markdown": "## 饮食参考\n\n多吃新鲜食材，少一点负担。",
  "coverPath": "cover.jpg"
}
'@ | Set-Content -LiteralPath $tmp -Encoding UTF8
node skills/wechat-official-account/scripts/wechat-official-account.js --mode dry-run --profile sudan-health --article-json $tmp --root-dir $env:TEMP
```

Expected: 输出 JSON，`ok` 为 `true`，`record.status` 为 `dry-run`。

- [ ] **Step 4: 运行全量检查**

Run:

```bash
npm test
npm run check
```

Expected: PASS；`npm run check` 不出现语法错误。

- [ ] **Step 5: 提交**

```bash
git add package.json skills/wechat-official-account/scripts/wechat-official-account.js
git commit -m "feat: add wechat official account CLI"
```

### Task 6: Skill 文档和 API 参考

**Files:**
- Create: `skills/wechat-official-account/SKILL.md`
- Create: `skills/wechat-official-account/references/wechat-api.md`
- Create: `docs/wechat-official-account.md`

- [ ] **Step 1: 写 skill 入口文档**

创建 `skills/wechat-official-account/SKILL.md`：

```markdown
---
name: wechat-official-account
description: 编写微信公众号文章、搜索整理素材、上传草稿并通过微信官方 API 自动发布。适用于多主体公众号运营；业务定位通过 profiles/*.json 控制。
---

# 微信公众号运营技能

使用本技能处理微信公众号内容运营任务：

- 编写公众号文章；
- 搜索和整理素材；
- 创建文章包；
- 上传草稿；
- 自动发布；
- 查询和记录发布结果。

## 默认流程

1. 选择 profile，例如 `sudan-health`。
2. 明确文章主题、目标读者、参考资料和发布模式。
3. 先生成文章包，包含标题、摘要、作者、Markdown 正文、封面说明。
4. 对大健康、金融、法律等高风险领域做合规检查。
5. 使用 `scripts/wechat-official-account.js --mode dry-run` 预检查。
6. 只有在用户明确要求自动发布，且 profile 允许时，才使用 `--mode publish`。
7. 发布后检查输出和审计日志。

## 发布模式

- `dry-run`：不调用微信 API。
- `draft-only`：创建草稿，不发布。
- `publish`：创建草稿并提交发布。

## Sudan 大健康 profile

`profiles/sudan-health.json` 用于苏丹大健康公众号。写作时保持可信、生活化、适度成交，不承诺疗效，不制造焦虑，不把产品描述成医疗建议。

## 安全要求

- 不把 `WECHAT_MP_APP_SECRET`、access token、密码写进 Git 或日志。
- 服务器上配置凭证、改 env、改服务，必须先得到用户同意。
- 自动发布必须留下审计日志。
```

- [ ] **Step 2: 写微信 API 参考**

创建 `skills/wechat-official-account/references/wechat-api.md`：

```markdown
# 微信公众号 API 参考

本技能优先使用微信公众平台官方 API。

## 关键接口

- 获取 access_token：`GET /cgi-bin/token`
- 新增草稿：`POST /cgi-bin/draft/add`
- 发布草稿：`POST /cgi-bin/freepublish/submit`
- 查询发布状态：`POST /cgi-bin/freepublish/get`
- 上传永久素材：`POST /cgi-bin/material/add_material`

## 常见问题

- `invalid credential`：检查 AppID、AppSecret、IP 白名单。
- `access_token expired`：重新获取 token。
- 素材上传失败：检查文件格式、大小、账号权限。
- 发布失败：先查询 publish status，再看微信返回的 errcode/errmsg。

## 凭证

凭证通过环境变量传入：

```env
WECHAT_MP_APP_ID=
WECHAT_MP_APP_SECRET=
```

不要把真实值提交到仓库。
```

- [ ] **Step 3: 写仓库级说明**

创建 `docs/wechat-official-account.md`：

```markdown
# 微信公众号运营技能

本仓库包含通用 OpenClaw agentpool，也可以承载通用 skill 包。`skills/wechat-official-account/` 是微信公众号运营技能，不属于 bridge runtime。

## 使用方式

```bash
node skills/wechat-official-account/scripts/wechat-official-account.js \
  --mode dry-run \
  --profile sudan-health \
  --article-json article.json
```

自动发布：

```bash
node skills/wechat-official-account/scripts/wechat-official-account.js \
  --mode publish \
  --profile sudan-health \
  --article-json article.json \
  --thumb-media-id COVER_MEDIA_ID
```

## 部署到 worker

修改 logical agent 的模板 workspace 后，使用：

```bash
agents-pool sync main --source-workspace /root/.openclaw/workspace
```

不要直接修改单个 worker workspace。
```

- [ ] **Step 4: 文档自检**

Run:

```bash
Select-String -Path "skills/wechat-official-account/**/*.md","docs/wechat-official-account.md" -Pattern "待补|占位|password|token-value" -CaseSensitive:$false
```

Expected: 没有匹配真实密钥或未完成占位标记。

- [ ] **Step 5: 提交**

```bash
git add skills/wechat-official-account/SKILL.md skills/wechat-official-account/references/wechat-api.md docs/wechat-official-account.md
git commit -m "docs: add wechat official account skill guide"
```

### Task 7: 最终验证和交付准备

**Files:**
- Modify only if needed after verification.

- [ ] **Step 1: 运行完整测试**

Run:

```bash
npm test
npm run check
```

Expected: 所有测试通过，所有 `node --check` 通过。

- [ ] **Step 2: 检查没有密钥落盘**

Run:

```bash
git grep -n -i "WECHAT_MP_APP_SECRET=" -- .
git grep -n -i "access_token" -- .
```

Expected: 没有真实密钥。允许出现空变量名、文档说明和测试里的占位词。

- [ ] **Step 3: 检查 git diff**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: 工作区干净，最近提交包含本计划中的分阶段 commit。

- [ ] **Step 4: 交付说明**

最终回复用户时说明：

- 通用 skill 包在 `openclaw-agent-pool-bridge/skills/wechat-official-account/`；
- Sudan profile 是 `profiles/sudan-health.json`；
- 自动发布 CLI 是 `scripts/wechat-official-account.js`；
- 当前实现不配置服务器凭证，也不改服务器；
- 真正上线前需要用户提供/确认公众号 AppID、AppSecret、微信 IP 白名单和服务器部署方式。

## 自检结果

- Spec 覆盖：通用 skill、Sudan profile、文章、素材、草稿、自动发布、合规、安全、审计、部署边界都已映射到任务。
- 占位扫描：计划中不使用未完成占位标记；示例密钥为空变量名或测试占位词，不是真实凭证。
- 类型一致性：profile 字段统一使用 camelCase；发布模式统一为 `dry-run`、`draft-only`、`publish`；审计字段统一为 `draftMediaId`、`publishId`。
