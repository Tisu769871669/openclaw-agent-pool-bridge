const fs = require("node:fs");
const path = require("node:path");

function defaultProfilesDir() {
  return path.join(__dirname, "..", "..", "profiles");
}

function normalizeProfile(raw, options = {}) {
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
    articleFooter: normalizeArticleFooter(raw.articleFooter, options),
  };
}

function normalizeArticleFooter(raw, options = {}) {
  const footer = raw && typeof raw === "object" ? raw : {};
  const baseDir = options.baseDir || "";
  return {
    enabled: footer.enabled === true,
    title: String(footer.title || "").trim(),
    description: String(footer.description || "").trim(),
    miniProgram: normalizeMiniProgram(footer.miniProgram),
    qrImages: Array.isArray(footer.qrImages)
      ? footer.qrImages.map((item, index) => normalizeFooterImage(item, index, baseDir))
      : [],
  };
}

function normalizeMiniProgram(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  return {
    appId: String(value.appId || "").trim(),
    path: String(value.path || "").trim(),
    title: String(value.title || "").trim(),
    imageUrl: String(value.imageUrl || "").trim(),
  };
}

function normalizeFooterImage(raw, index, baseDir) {
  const item = raw && typeof raw === "object" ? raw : {};
  const imagePath = String(item.path || "").trim();
  return {
    key: String(item.key || `footerQr${index + 1}`).trim(),
    path: resolveFooterPath(imagePath, baseDir),
    alt: String(item.alt || "").trim(),
    caption: String(item.caption || "").trim(),
  };
}

function resolveFooterPath(imagePath, baseDir) {
  if (!imagePath) {
    return "";
  }
  if (path.isAbsolute(imagePath)) {
    return imagePath;
  }
  return path.resolve(baseDir || process.cwd(), imagePath);
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
  if (profile.articleFooter?.enabled) {
    for (const image of profile.articleFooter.qrImages) {
      if (!image.key) {
        throw new Error("articleFooter.qrImages[].key is required");
      }
      if (!image.path) {
        throw new Error(`articleFooter.qrImages[${image.key}].path is required`);
      }
    }
  }
  return profile;
}

function loadProfile(profileId, options = {}) {
  const profilesDir = options.profilesDir || defaultProfilesDir();
  const filePath = path.join(profilesDir, `${profileId}.json`);
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return validateProfile(normalizeProfile(raw, { baseDir: path.dirname(filePath) }));
}

module.exports = {
  loadProfile,
  normalizeProfile,
  validateProfile,
};
