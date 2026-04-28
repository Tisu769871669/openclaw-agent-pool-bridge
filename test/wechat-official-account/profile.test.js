const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { loadProfile, validateProfile } = require("../../skills/wechat-official-account/scripts/lib/profile");

test("loadProfile loads sudan-health profile", () => {
  const profile = loadProfile("sudan-health", {
    profilesDir: path.join(__dirname, "..", "..", "skills", "wechat-official-account", "profiles"),
  });

  assert.equal(profile.id, "sudan-health");
  assert.equal(profile.subject, "苏丹");
  assert.equal(profile.publishPolicy.defaultMode, "publish");
  assert.equal(profile.publishPolicy.requireComplianceCheck, true);
});

test("loadProfile loads snowchuang-yihuang profile", () => {
  const profile = loadProfile("snowchuang-yihuang", {
    profilesDir: path.join(__dirname, "..", "..", "skills", "wechat-official-account", "profiles"),
  });

  assert.equal(profile.id, "snowchuang-yihuang");
  assert.equal(profile.subject, "雪创");
  assert.equal(profile.officialAccount, "衣荒救星站");
  assert.deepEqual(profile.direction, ["卖货", "穿搭", "服饰"]);
  assert.equal(profile.publishPolicy.defaultMode, "publish");
  assert.equal(profile.publishPolicy.requireComplianceCheck, true);
  assert.equal(profile.articleFooter.enabled, true);
  assert.equal(profile.articleFooter.qrImages.length, 2);
  assert.equal(path.isAbsolute(profile.articleFooter.qrImages[0].path), true);
});

test("validateProfile rejects missing publish policy", () => {
  assert.throws(
    () => validateProfile({ id: "broken", subject: "测试" }),
    /publishPolicy is required/
  );
});
