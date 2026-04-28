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
