const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULT_SKILL_REPO,
  buildSoulDistillationPrompt,
  createSoulDistiller,
  ensureSoulDistillerSkill,
  looksLikeProviderError,
  loadDotSkillContext,
  sanitizeDistilledSoul,
} = require("../src/soul-distiller");

test("ensureSoulDistillerSkill clones titanwings dot-skill into the shared skill directory", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-soul-skill-"));
  const skillDir = path.join(dir, "dot-skill");
  const calls = [];

  const skill = await ensureSoulDistillerSkill({
    skillDir,
    repoUrl: DEFAULT_SKILL_REPO,
    spawnSyncImpl: (command, args) => {
      calls.push([command, ...args]);
      fs.mkdirSync(path.join(skillDir, "prompts"), { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# dot-skill\n\n同事.skill 主入口", "utf8");
      fs.writeFileSync(path.join(skillDir, "prompts", "work_analyzer.md"), "# Work Analyzer\n\n提取工作方式", "utf8");
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(calls, [["git", "clone", "--depth", "1", DEFAULT_SKILL_REPO, skillDir]]);
  assert.equal(skill.installed, true);
  assert.equal(skill.path, skillDir);
  assert.match(skill.content, /同事\.skill 主入口/);
  assert.match(skill.content, /提取工作方式/);
  assert.equal(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"), "# dot-skill\n\n同事.skill 主入口");
});

test("ensureSoulDistillerSkill can fall back to raw SKILL.md when clone fails", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-soul-skill-"));
  const skillDir = path.join(dir, "dot-skill");
  const fetchCalls = [];

  const skill = await ensureSoulDistillerSkill({
    skillDir,
    repoUrl: "https://github.invalid/titanwings/colleague-skill.git",
    sourceUrl: "https://raw.githubusercontent.test/titanwings/colleague-skill/SKILL.md",
    spawnSyncImpl: () => ({ status: 1, stdout: "", stderr: "network down" }),
    fetchImpl: async (url) => {
      fetchCalls.push(url);
      return {
        ok: true,
        text: async () => "# dot-skill\n\nfallback 同事.skill",
      };
    },
  });

  assert.deepEqual(fetchCalls, ["https://raw.githubusercontent.test/titanwings/colleague-skill/SKILL.md"]);
  assert.equal(skill.installed, true);
  assert.match(skill.content, /fallback 同事\.skill/);
});

test("SoulDistiller uses shared skill instructions and strips markdown fences", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-soul-skill-"));
  const skillDir = path.join(dir, "dot-skill");
  fs.mkdirSync(path.join(skillDir, "prompts"), { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# dot-skill\n\nKeep long-lived style only.", "utf8");
  fs.writeFileSync(path.join(skillDir, "prompts", "persona_analyzer.md"), "# Persona\n\n分析表达 DNA", "utf8");

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
  assert.equal(result.skill.name, "dot-skill");
  assert.match(prompts[0], /Keep long-lived style only/);
  assert.match(prompts[0], /分析表达 DNA/);
  assert.match(prompts[0], /您好，有什么可以帮助/);
});

test("loadDotSkillContext reads root skill and relevant dot-skill prompts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-soul-skill-"));
  fs.mkdirSync(path.join(dir, "prompts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "# dot-skill", "utf8");
  fs.writeFileSync(path.join(dir, "prompts", "work_builder.md"), "# Work Builder", "utf8");

  const content = loadDotSkillContext(dir);

  assert.match(content, /--- SKILL\.md ---/);
  assert.match(content, /# dot-skill/);
  assert.match(content, /--- prompts\/work_builder\.md ---/);
  assert.match(content, /# Work Builder/);
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

test("sanitizeDistilledSoul rejects provider error output before SOUL write", () => {
  assert.equal(looksLikeProviderError("HTTP 401: invalid access token or token expired"), true);
  assert.equal(looksLikeProviderError("400 Your account does not have a valid subscription"), true);
  assert.throws(
    () => sanitizeDistilledSoul("HTTP 401: invalid access token or token expired"),
    /provider\/API error/
  );
});
