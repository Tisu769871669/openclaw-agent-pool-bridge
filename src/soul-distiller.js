const fs = require("node:fs");
const path = require("node:path");

const { createApiError } = require("./errors");
const { runOpenClawAgent } = require("./openclaw-runner");

const DEFAULT_SKILL_SOURCE_URL =
  "https://raw.githubusercontent.com/openclaw/skills/HEAD/skills/kesslerio/soulcraft/SKILL.md";

class SoulDistiller {
  constructor(options = {}) {
    this.openclawBin = String(options.openclawBin || "openclaw").trim();
    this.agentId = String(options.agentId || "").trim();
    this.timeoutSeconds = Number(options.timeoutSeconds || 120);
    this.skillDir = options.skillDir || "";
    this.skillSourceUrl = options.skillSourceUrl || DEFAULT_SKILL_SOURCE_URL;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.runAgent = options.runAgent || defaultRunAgent;
  }

  async distill(input) {
    if (!this.agentId) {
      throw createApiError(503, "soul_distiller_not_configured", "SOUL_DISTILLER_AGENT_ID is required");
    }

    const skill = await ensureSoulDistillerSkill({
      skillDir: this.skillDir,
      sourceUrl: this.skillSourceUrl,
      fetchImpl: this.fetchImpl,
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
        name: path.basename(skill.path || this.skillDir || "customer-soul-distiller"),
        path: skill.path,
        file: skill.file,
        installed: skill.installed,
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
    return { path: "", file: "", content: "", installed: false, sourceUrl: "" };
  }

  const skillFile = path.join(skillDir, "SKILL.md");
  if (fs.existsSync(skillFile)) {
    return {
      path: skillDir,
      file: skillFile,
      content: fs.readFileSync(skillFile, "utf8"),
      installed: false,
      sourceUrl: options.sourceUrl || "",
    };
  }

  if (!options.sourceUrl) {
    throw createApiError(503, "soul_distiller_skill_missing", `Missing soul distiller skill: ${skillFile}`);
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
    content,
    installed: true,
    sourceUrl: options.sourceUrl,
  };
}

function buildSoulDistillationPrompt(input = {}) {
  return [
    "你正在为 OpenClaw 通用客服 agent 蒸馏 SOUL.md。",
    "请使用下方通用 skill 指令，把聊天记录中的稳定服务风格、身份边界、话术习惯、工作方式和需要长期保留的人格规则提炼为完整的 SOUL.md。",
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
    "【通用 skill 指令】",
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
  return text;
}

function sanitizeSessionId(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_.-]+/g, "_").slice(0, 80);
}

module.exports = {
  DEFAULT_SKILL_SOURCE_URL,
  SoulDistiller,
  buildSoulDistillationPrompt,
  createSoulDistiller,
  ensureSoulDistillerSkill,
  sanitizeDistilledSoul,
};
