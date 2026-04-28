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
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return validateArticlePackage(JSON.parse(raw));
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
