const fs = require("node:fs");
const path = require("node:path");

const {
  buildPrompt,
  formatAttachmentBlock,
  formatResponseOptionsBlock,
} = require("./message");

function createPromptAdapter(options = {}) {
  const adapter = cleanText(options.adapter || "none").toLowerCase();
  if (!adapter || adapter === "none") {
    return new NonePromptAdapter();
  }
  if (adapter === "template") {
    return new TemplatePromptAdapter(options.templateFile);
  }
  throw new Error(`Unsupported PROMPT_ADAPTER: ${adapter}`);
}

class NonePromptAdapter {
  buildPrompt({ message, history }) {
    return buildPrompt({ message, history });
  }

  snapshot() {
    return { adapter: "none" };
  }
}

class TemplatePromptAdapter {
  constructor(templateFile) {
    if (!cleanText(templateFile)) {
      throw new Error("PROMPT_TEMPLATE_FILE is required when PROMPT_ADAPTER=template");
    }
    this.templateFile = path.resolve(templateFile);
    if (!fs.existsSync(this.templateFile)) {
      throw new Error(`PROMPT_TEMPLATE_FILE not found: ${this.templateFile}`);
    }
    this.cachedTemplate = "";
    this.cachedMtimeMs = -1;
  }

  buildPrompt(input = {}) {
    return renderPromptTemplate(this.readTemplate(), buildTemplateVariables(input));
  }

  snapshot() {
    return {
      adapter: "template",
      templateFile: this.templateFile,
    };
  }

  readTemplate() {
    const stat = fs.statSync(this.templateFile);
    if (stat.mtimeMs !== this.cachedMtimeMs) {
      this.cachedTemplate = fs.readFileSync(this.templateFile, "utf8");
      this.cachedMtimeMs = stat.mtimeMs;
    }
    return this.cachedTemplate;
  }
}

function buildTemplateVariables(input = {}) {
  const logicalAgentId = cleanText(input.logicalAgentId);
  const conversationId = cleanText(input.conversationId);
  const userId = cleanText(input.userId);
  const message = cleanText(input.message);
  const messageText = cleanText(input.messageText);
  const history = formatHistory(input.history);
  const retrievalContext = cleanText(input.retrievalContext);
  const attachments = formatAttachmentBlock(input.attachments);
  const responseOptions = formatResponseOptionsBlock(input.responseOptions);

  return {
    logical_agent: logicalAgentId,
    logicalAgentId,
    agent_id: logicalAgentId,
    conversation_id: conversationId,
    conversationId,
    user_id: userId,
    userId,
    message,
    message_text: messageText,
    messageText,
    history,
    attachments,
    response_options: responseOptions,
    responseOptions,
    tts_request: responseOptions,
    ttsRequest: responseOptions,
    retrieval_context: retrievalContext,
    retrievalContext,
  };
}

function renderPromptTemplate(template, variables = {}) {
  return String(template || "").replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key) =>
    cleanText(variables[key])
  );
}

function formatHistory(history = []) {
  if (!Array.isArray(history) || !history.length) {
    return "";
  }
  return history
    .slice(-12)
    .map((item, index) => {
      const role = item?.role === "assistant" ? "assistant" : "user";
      return `${index + 1}. ${role}: ${cleanText(item?.text)}`;
    })
    .join("\n");
}

function cleanText(value) {
  return String(value || "").trim();
}

module.exports = {
  NonePromptAdapter,
  TemplatePromptAdapter,
  buildTemplateVariables,
  createPromptAdapter,
  formatHistory,
  renderPromptTemplate,
};
