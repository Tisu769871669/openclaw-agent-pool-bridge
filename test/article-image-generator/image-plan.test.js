const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  loadImageProfile,
  normalizeImagePlan,
  validateImagePlan,
} = require("../../skills/article-image-generator/scripts/lib/image-plan");

const profilesDir = path.join(__dirname, "..", "..", "skills", "article-image-generator", "profiles");

test("loadImageProfile loads Snowchuang image defaults", () => {
  const profile = loadImageProfile("snowchuang-yihuang", { profilesDir });

  assert.equal(profile.id, "snowchuang-yihuang");
  assert.equal(profile.defaultModel, "gpt-image-2");
  assert.equal(profile.defaultSize, "1024x1024");
  assert.match(profile.styleGuide, /韩系低饱和/);
});

test("normalizeImagePlan applies profile defaults and prompt prefix", () => {
  const profile = loadImageProfile("example", { profilesDir });
  const plan = normalizeImagePlan({
    profile: "example",
    images: [{
      key: "coverMood",
      role: "cover",
      prompt: "A clean editorial cover image.",
      alt: "封面图",
    }],
  }, profile);

  assert.equal(plan.profile, "example");
  assert.equal(plan.images[0].model, "gpt-image-2");
  assert.equal(plan.images[0].size, "1024x1024");
  assert.match(plan.images[0].prompt, /^Create an original article image/);
});

test("validateImagePlan rejects duplicate keys", () => {
  const profile = loadImageProfile("example", { profilesDir });
  const plan = normalizeImagePlan({
    profile: "example",
    images: [
      { key: "look", role: "body", prompt: "Image one", alt: "图一" },
      { key: "look", role: "body", prompt: "Image two", alt: "图二" },
    ],
  }, profile);

  assert.throws(() => validateImagePlan(plan, profile), /duplicate image key: look/);
});

test("validateImagePlan rejects multiple cover images", () => {
  const profile = loadImageProfile("example", { profilesDir });
  const plan = normalizeImagePlan({
    profile: "example",
    images: [
      { key: "coverA", role: "cover", prompt: "Cover A", alt: "封面 A" },
      { key: "coverB", role: "cover", prompt: "Cover B", alt: "封面 B" },
    ],
  }, profile);

  assert.throws(() => validateImagePlan(plan, profile), /only one cover image is allowed/);
});

test("validateImagePlan rejects blocked prompt terms", () => {
  const profile = loadImageProfile("snowchuang-yihuang", { profilesDir });
  const plan = normalizeImagePlan({
    profile: "snowchuang-yihuang",
    images: [{
      key: "coverMood",
      role: "cover",
      prompt: "照搬小红书原图，保留水印",
      alt: "封面图",
    }],
  }, profile);

  assert.throws(() => validateImagePlan(plan, profile), /blocked prompt term/);
});
