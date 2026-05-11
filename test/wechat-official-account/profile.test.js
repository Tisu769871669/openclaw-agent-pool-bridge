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

test("loadProfile loads huizhong-yun-qifu profile", () => {
  const profile = loadProfile("huizhong-yun-qifu", {
    profilesDir: path.join(__dirname, "..", "..", "skills", "wechat-official-account", "profiles"),
  });

  assert.equal(profile.id, "huizhong-yun-qifu");
  assert.equal(profile.subject, "惠众云祈福");
  assert.equal(profile.officialAccount, "惠众云祈福");
  assert.deepEqual(profile.direction, ["传统文化", "节气", "祭拜"]);
  assert.equal(profile.publishPolicy.defaultMode, "publish");
  assert.equal(profile.publishPolicy.requireManualConfirmation, false);
  assert.equal(profile.publishPolicy.maxAutoPublishPerDay, 1);
  assert.match(profile.contentRules.voice, /庄重/);
  assert.ok(profile.contentRules.avoid.includes("保证灵验"));
});

test("validateProfile rejects missing publish policy", () => {
  assert.throws(
    () => validateProfile({ id: "broken", subject: "测试" }),
    /publishPolicy is required/
  );
});

test("validateProfile accepts notify as an explicit mass-send mode", () => {
  const profile = validateProfile({
    id: "notify-profile",
    subject: "通知测试",
    publishPolicy: {
      defaultMode: "notify",
    },
  });

  assert.equal(profile.publishPolicy.defaultMode, "notify");
});
