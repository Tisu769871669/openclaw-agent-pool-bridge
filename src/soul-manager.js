const path = require("node:path");

const { SourceMdFileManager, normalizeMarkdownContent, sha256 } = require("./source-md-file-manager");

const SOUL_FILE_NAME = "SOUL.md";

class SoulManager extends SourceMdFileManager {
  constructor(options = {}) {
    super({
      ...options,
      fileName: SOUL_FILE_NAME,
      fileLabel: "SOUL.md",
      missingCode: "soul_not_found",
    });
  }
}

function createSoulManager(options = {}) {
  return new SoulManager(options);
}

function getSoulPath(workspace) {
  return path.join(workspace, SOUL_FILE_NAME);
}

function normalizeSoulContent(value) {
  return normalizeMarkdownContent(value, "SOUL.md");
}

module.exports = {
  SOUL_FILE_NAME,
  SoulManager,
  createSoulManager,
  getSoulPath,
  normalizeSoulContent,
  sha256,
};
