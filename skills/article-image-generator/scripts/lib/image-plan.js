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
    const userPromptText = `${image.promptBody} ${image.negativePrompt}`.trim();
    for (const term of blockedTerms) {
      if (term && userPromptText.includes(term)) {
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
