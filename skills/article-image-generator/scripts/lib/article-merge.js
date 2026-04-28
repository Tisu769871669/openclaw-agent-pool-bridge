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
