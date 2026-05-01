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
