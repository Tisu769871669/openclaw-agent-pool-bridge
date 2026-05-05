const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { createApiError } = require("./errors");
const { runOpenClawAgent } = require("./openclaw-runner");

const DEFAULT_SKILL_REPO = "https://github.com/titanwings/colleague-skill.git";
const DEFAULT_SKILL_SOURCE_URL =
  "https://raw.githubusercontent.com/titanwings/colleague-skill/HEAD/SKILL.md";

const DOT_SKILL_CONTEXT_FILES = [
  "SKILL.md",
  path.join("prompts", "intake.md"),
  path.join("prompts", "work_analyzer.md"),
  path.join("prompts", "persona_analyzer.md"),
  path.join("prompts", "work_builder.md"),
  path.join("prompts", "persona_builder.md"),
  path.join("prompts", "merger.md"),
];

class SoulDistiller {
  constructor(options = {}) {
    this.openclawBin = String(options.openclawBin || "openclaw").trim();
    this.agentId = String(options.agentId || "").trim();
    this.timeoutSeconds = Number(options.timeoutSeconds || 120);
    this.skillDir = options.skillDir || "";
    this.skillRepo = options.skillRepo || DEFAULT_SKILL_REPO;
    this.skillSourceUrl = options.skillSourceUrl || "";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.spawnSyncImpl = options.spawnSyncImpl || spawnSync;
    this.runAgent = options.runAgent || defaultRunAgent;
  }

  async distill(input) {
    if (!this.agentId) {
      throw createApiError(503, "soul_distiller_not_configured", "SOUL_DISTILLER_AGENT_ID is required");
    }

    const skill = await ensureSoulDistillerSkill({
      skillDir: this.skillDir,
      repoUrl: this.skillRepo,
      sourceUrl: this.skillSourceUrl,
      fetchImpl: this.fetchImpl,
      spawnSyncImpl: this.spawnSyncImpl,
    });
    const prompt = buildSoulDistillationPrompt({
      ...input,
      skillContent: skill.content,
    });
    const result = await this.runAgent({
      openclawBin: this.openclawBin,
      timeoutSeconds: this.timeoutSeconds,
      agentId: this.agentId,
      runSessionId: `bridge_soul_distill_${sanitizeSessionId(input.logicalAgentId)}_${sanitizeSessionId(input.traceId)}`,
      prompt,
    });
    const content = sanitizeDistilledSoul(result.reply || result.content || result.text || "");

    return {
      content,
      skill: {
        name: path.basename(skill.path || this.skillDir || "dot-skill"),
        path: skill.path,
        file: skill.file,
        installed: skill.installed,
        sourceRepo: skill.sourceRepo,
        sourceUrl: skill.sourceUrl,
      },
      raw: result.raw,
    };
  }
}

function createSoulDistiller(options = {}) {
  return new SoulDistiller(options);
}

async function defaultRunAgent(options) {
  return runOpenClawAgent({
    openclawBin: options.openclawBin,
    timeoutSeconds: options.timeoutSeconds,
    workerAgentId: options.agentId,
    runSessionId: options.runSessionId,
    prompt: options.prompt,
  });
}

async function ensureSoulDistillerSkill(options = {}) {
  const skillDir = options.skillDir ? path.resolve(options.skillDir) : "";
  if (!skillDir) {
    return { path: "", file: "", content: "", installed: false, sourceRepo: "", sourceUrl: "" };
  }

  const skillFile = path.join(skillDir, "SKILL.md");
  if (fs.existsSync(skillFile)) {
    return {
      path: skillDir,
      file: skillFile,
      content: loadDotSkillContext(skillDir),
      installed: false,
      sourceRepo: options.repoUrl || "",
      sourceUrl: options.sourceUrl || "",
    };
  }

  if (options.repoUrl) {
    const cloned = cloneSkillRepo({
      repoUrl: options.repoUrl,
      skillDir,
      spawnSyncImpl: options.spawnSyncImpl || spawnSync,
    });
    if (cloned.ok && fs.existsSync(skillFile)) {
      return {
        path: skillDir,
        file: skillFile,
        content: loadDotSkillContext(skillDir),
        installed: true,
        sourceRepo: options.repoUrl,
        sourceUrl: options.sourceUrl || "",
      };
    }
    if (!options.sourceUrl) {
      throw createApiError(
        503,
        "soul_distiller_skill_install_failed",
        `Failed to clone soul distiller skill from ${options.repoUrl}: ${cloned.error}`
      );
    }
  }

  if (!options.sourceUrl) {
    throw createApiError(503, "soul_distiller_skill_missing", `Missing dot-skill directory: ${skillDir}`);
  }
  if (!options.fetchImpl) {
    throw createApiError(503, "soul_distiller_skill_missing", "fetch is unavailable for installing soul distiller skill");
  }

  const response = await options.fetchImpl(options.sourceUrl);
  if (!response?.ok) {
    throw createApiError(
      503,
      "soul_distiller_skill_install_failed",
      `Failed to download soul distiller skill from ${options.sourceUrl}`
    );
  }

  const content = await response.text();
  if (!String(content || "").trim()) {
    throw createApiError(503, "soul_distiller_skill_install_failed", "Downloaded soul distiller skill is empty");
  }

  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillFile, content, "utf8");
  return {
    path: skillDir,
    file: skillFile,
    content: loadDotSkillContext(skillDir),
    installed: true,
    sourceRepo: options.repoUrl || "",
    sourceUrl: options.sourceUrl,
  };
}

function cloneSkillRepo(options = {}) {
  fs.mkdirSync(path.dirname(options.skillDir), { recursive: true });
  const result = options.spawnSyncImpl("git", ["clone", "--depth", "1", options.repoUrl, options.skillDir], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    return { ok: false, error: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, error: String(result.stderr || result.stdout || `exit ${result.status}`).trim() };
  }
  return { ok: true, error: "" };
}

function loadDotSkillContext(skillDir) {
  const sections = [];
  for (const relativePath of DOT_SKILL_CONTEXT_FILES) {
    const filePath = path.join(skillDir, relativePath);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const content = fs.readFileSync(filePath, "utf8").trim();
    if (!content) {
      continue;
    }
    sections.push([
      `--- ${relativePath.replace(/\\/g, "/")} ---`,
      content,
    ].join("\n"));
  }
  return sections.join("\n\n");
}

function buildSoulDistillationPrompt(input = {}) {
  return [
    "你正在为 OpenClaw 通用客服 agent 蒸馏 SOUL.md。",
    "请使用下方 dot-skill / 同事.skill 指令，把聊天记录中的稳定服务风格、身份边界、话术习惯、工作方式和需要长期保留的人格规则提炼为完整的 SOUL.md。",
    "重要边界：不要把一次性订单号、手机号、客户隐私、实时价格、库存、活动时间这类事实写入 SOUL.md；这类内容应进入 FAQ/RAG/API。",
    "只输出可直接覆盖 SOUL.md 的 Markdown 正文，不要输出解释、JSON、diff 或代码围栏。",
    "",
    "【logical agent】",
    String(input.logicalAgentId || ""),
    "",
    "【当前 SOUL.md】",
    String(input.currentSoul || "(empty)"),
    "",
    "【聊天记录文件名】",
    String(input.filename || "chat-log.txt"),
    "",
    "【dot-skill / 同事.skill 指令】",
    String(input.skillContent || "(no external skill content loaded)"),
    "",
    "【聊天记录】",
    String(input.chatLog || ""),
  ].join("\n");
}

function sanitizeDistilledSoul(value) {
  let text = String(value || "").trim();
  const fenced = /^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced) {
    text = fenced[1].trim();
  }
  if (!text) {
    throw createApiError(502, "soul_distillation_empty", "Soul distiller returned empty content");
  }
  if (looksLikeProviderError(text)) {
    throw createApiError(502, "soul_distillation_failed", "Soul distiller returned a provider/API error");
  }
  return text;
}

function looksLikeProviderError(text) {
  const normalized = String(text || "").trim();
  return [
    /^HTTP\s+\d{3}\s*:/i,
    /^(?:400|401|403|429|500|502|503|504)\s+/,
    /\binvalid access token\b/i,
    /\bapi key\b.*\b(?:invalid|expired|incorrect)\b/i,
    /\bsubscription\b.*\b(?:expired|not have|invalid)\b/i,
    /\bdoes not have a valid\b/i,
  ].some((pattern) => pattern.test(normalized));
}

function sanitizeSessionId(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 80);
}

module.exports = {
  DEFAULT_SKILL_REPO,
  DEFAULT_SKILL_SOURCE_URL,
  DOT_SKILL_CONTEXT_FILES,
  SoulDistiller,
  buildSoulDistillationPrompt,
  cloneSkillRepo,
  createSoulDistiller,
  ensureSoulDistillerSkill,
  looksLikeProviderError,
  loadDotSkillContext,
  sanitizeDistilledSoul,
};
