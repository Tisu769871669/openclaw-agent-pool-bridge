const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildSoulDistillationPrompt,
  createSoulDistiller,
  ensureSoulDistillerSkill,
  sanitizeDistilledSoul,
} = require("../src/soul-distiller");

test("ensureSoulDistillerSkill downloads missing skill into the shared skill directory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-soul-skill-"));
  const skillDir = path.join(dir, "customer-soul-distiller");
  const calls = [];

  const skill = await ensureSoulDistillerSkill({
    skillDir,
    sourceUrl: "https://raw.githubusercontent.test/colleague/SKILL.md",
    fetchImpl: async (url) => {
      calls.push(url);
      return {
        ok: true,
        text: async () => "# Colleague Skill\n\nOnly output SOUL.md.",
      };
    },
  });

  assert.deepEqual(calls, ["https://raw.githubusercontent.test/colleague/SKILL.md"]);
  assert.equal(skill.installed, true);
  assert.equal(skill.path, skillDir);
  assert.equal(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"), "# Colleague Skill\n\nOnly output SOUL.md.");
});

test("SoulDistiller uses shared skill instructions and strips markdown fences", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-soul-skill-"));
  const skillDir = path.join(dir, "customer-soul-distiller");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# Skill\n\nKeep long-lived style only.", "utf8");

  const prompts = [];
  const distiller = createSoulDistiller({
    agentId: "soul-distiller",
    skillDir,
    runAgent: async (input) => {
      prompts.push(input.prompt);
      return { reply: "```markdown\n# SOUL\n\n蒸馏后内容\n```" };
    },
  });

  const result = await distiller.distill({
    logicalAgentId: "main",
    currentSoul: "# SOUL\n\n旧内容",
    chatLog: "用户：你好\n客服：您好，有什么可以帮助？",
    filename: "chat.txt",
    traceId: "trace-1",
  });

  assert.equal(result.content, "# SOUL\n\n蒸馏后内容");
  assert.equal(result.skill.name, "customer-soul-distiller");
  assert.match(prompts[0], /Keep long-lived style only/);
  assert.match(prompts[0], /您好，有什么可以帮助/);
});

test("buildSoulDistillationPrompt keeps volatile facts out of SOUL instructions", () => {
  const prompt = buildSoulDistillationPrompt({
    logicalAgentId: "main",
    currentSoul: "# SOUL",
    chatLog: "订单号 123，手机号 13800000000",
    filename: "chat.txt",
    skillContent: "# Skill",
  });

  assert.match(prompt, /不要把一次性订单号/);
  assert.match(prompt, /FAQ\/RAG\/API/);
});

test("sanitizeDistilledSoul rejects empty output", () => {
  assert.throws(() => sanitizeDistilledSoul("  "), /empty content/);
});
