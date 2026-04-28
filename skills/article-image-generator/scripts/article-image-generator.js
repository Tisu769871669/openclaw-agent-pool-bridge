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
  const outArticle = resolvePath(
    path.dirname(planPath),
    args.outArticle || path.join(outputDir, "..", "article.with-images.json")
  );
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
