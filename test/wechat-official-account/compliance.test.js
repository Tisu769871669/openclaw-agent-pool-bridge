const test = require("node:test");
const assert = require("node:assert/strict");

const { checkCompliance } = require("../../skills/wechat-official-account/scripts/lib/compliance");

const profile = {
  id: "sudan-health",
  contentRules: {
    avoid: ["治愈", "根治", "保证有效", "替代医生"],
  },
};

test("checkCompliance passes restrained health content", () => {
  const result = checkCompliance("这是一份日常饮食参考，个体情况不同，建议结合自身情况选择。", profile);

  assert.equal(result.passed, true);
  assert.deepEqual(result.matches, []);
});

test("checkCompliance flags high-risk health claims", () => {
  const result = checkCompliance("这款产品可以根治问题，并且保证有效。", profile);

  assert.equal(result.passed, false);
  assert.deepEqual(result.matches.map((item) => item.term), ["根治", "保证有效"]);
});
