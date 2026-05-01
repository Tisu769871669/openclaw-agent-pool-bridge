const fs = require("node:fs");
const path = require("node:path");

function defaultProfilesDir() {
  return path.join(__dirname, "..", "..", "profiles");
}

function loadProfile(profileId = "example", options = {}) {
  const profilesDir = options.profilesDir || defaultProfilesDir();
  const profilePath = path.join(profilesDir, `${profileId}.json`);
  if (!fs.existsSync(profilePath)) {
    throw new Error(`Profile not found: ${profilePath}`);
  }
  const raw = fs.readFileSync(profilePath, "utf8").replace(/^\uFEFF/, "");
  const profile = JSON.parse(raw);
  return validateProfile(profile, profilePath);
}

function validateProfile(profile, profilePath = "profile") {
  if (!profile || typeof profile !== "object") {
    throw new Error(`${profilePath} must be a JSON object`);
  }
  if (!profile.id) {
    throw new Error(`${profilePath} must include id`);
  }
  return {
    id: profile.id,
    name: profile.name || profile.id,
    baseUrl: profile.baseUrl || "https://lx.metast.cn",
    defaultPlatform: profile.defaultPlatform || "wx",
    credentialEnv: {
      mcpKey: profile.credentialEnv?.mcpKey || "METAST_MCP_KEY",
      mcpSecret: profile.credentialEnv?.mcpSecret || "METAST_MCP_SECRET",
    },
    endpoints: profile.endpoints || {},
    safety: {
      allowSubmit: profile.safety?.allowSubmit === true,
    },
  };
}

module.exports = {
  defaultProfilesDir,
  loadProfile,
  validateProfile,
};
