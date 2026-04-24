const crypto = require("node:crypto");

function normalizeChatBody(body = {}) {
  const rawContent = parseMaybeJson(body.content);
  const contentText = typeof rawContent === "string" ? cleanText(rawContent) : "";
  const rawMessageList = parseMaybeJson(
    (rawContent && typeof rawContent === "object" ? rawContent.messageList : undefined) ?? body.messageList
  );
  const messageList = normalizeMessageList(rawMessageList);
  const conversationId = cleanText(body.conversationId || body.conversation_id || body.sessionId || body.session_id);
  const userId = cleanText(body.userId || body.user_id || body.uid);
  const message =
    cleanText(body.message || body.text || body.query) || contentText || extractMessageFromList(messageList);

  return {
    conversationId,
    userId,
    message,
    messageList,
  };
}

function validateChatBody(normalized) {
  if (!normalized.conversationId) {
    return "conversationId is required";
  }
  if (!normalized.message) {
    return "message/content.messageList is required";
  }
  return "";
}

function normalizeMessageList(messageList) {
  if (!Array.isArray(messageList)) {
    return [];
  }

  return messageList
    .map(parseMaybeJson)
    .map((entry) => {
      const text = pickMessageText(entry);
      if (!text) {
        return null;
      }
      return {
        role: pickMessageRole(entry),
        text,
      };
    })
    .filter(Boolean);
}

function removeCurrentMessageFromContext(messageList, message) {
  const text = cleanText(message);
  if (!Array.isArray(messageList) || !messageList.length || !text) {
    return trustedHistory(messageList || []);
  }

  const copy = [...messageList];
  const last = copy[copy.length - 1];
  if (cleanText(last?.text) === text) {
    copy.pop();
  }
  return trustedHistory(copy);
}

function trustedHistory(messageList) {
  return messageList.filter((item) => item?.role === "user" || item?.role === "assistant");
}

function buildSessionId(logicalAgentId, conversationId) {
  return `bridge_${normalizeSessionPart(logicalAgentId, 40)}_${normalizeSessionPart(conversationId, 120)}`;
}

function buildRunSessionId(logicalAgentId, conversationId, traceId) {
  const trace = cleanText(traceId).replace(/-/g, "").slice(0, 16);
  return `run_${normalizeSessionPart(logicalAgentId, 40)}_${normalizeSessionPart(conversationId, 80)}_${trace}`;
}

function buildTraceId() {
  return crypto.randomUUID();
}

function buildPrompt({ message, history = [] }) {
  if (!history.length) {
    return message;
  }

  const recent = history
    .slice(-12)
    .map((item, index) => `${index + 1}. ${item.role === "assistant" ? "assistant" : "user"}: ${item.text}`)
    .join("\n");

  return ["Recent conversation:", recent, "", `Current user message: ${message}`].join("\n");
}

function createSuccessPayload({ logicalAgentId, conversationId, userId, reply, sessionId, traceId }) {
  return {
    ok: true,
    agent_id: logicalAgentId,
    conversation_id: conversationId,
    user_id: userId,
    reply,
    session_id: sessionId,
    trace_id: traceId,
  };
}

function createErrorPayload({ code, message, traceId }) {
  return {
    ok: false,
    error: code,
    message,
    trace_id: traceId,
  };
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }

  const text = cleanText(value);
  if (!text) {
    return value;
  }

  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function pickMessageText(item) {
  if (!item) {
    return "";
  }
  if (typeof item === "string") {
    return cleanText(item);
  }

  return [item.text, item.content, item.message, item.body, item.question, item.query]
    .map(cleanText)
    .find(Boolean) || "";
}

function pickMessageRole(item) {
  const role = cleanText(
    item?.role || item?.senderRole || item?.sender_type || item?.senderType || item?.sender || item?.from || item?.type
  ).toLowerCase();
  if (["assistant", "agent", "bot", "ai", "客服"].includes(role)) {
    return "assistant";
  }
  if (["user", "customer", "client", "human", "用户", "客户"].includes(role)) {
    return "user";
  }
  if (item?.fromMe === true || item?.isFromMe === true || item?.isSelf === true || item?.self === true) {
    return "assistant";
  }
  return "unknown";
}

function extractMessageFromList(messageList) {
  if (!Array.isArray(messageList)) {
    return "";
  }

  for (let index = messageList.length - 1; index >= 0; index -= 1) {
    const item = messageList[index];
    if (item?.role === "user" && item.text) {
      return item.text;
    }
  }

  return messageList
    .slice()
    .reverse()
    .map((item) => item.text)
    .find(Boolean) || "";
}

function normalizeSessionPart(value, maxLength) {
  const text = cleanText(value).replace(/[^a-zA-Z0-9:_-]/g, "_");
  return (text || "unknown").slice(0, maxLength);
}

function cleanText(value) {
  return String(value || "").trim();
}

module.exports = {
  buildPrompt,
  buildRunSessionId,
  buildSessionId,
  buildTraceId,
  cleanText,
  createErrorPayload,
  createSuccessPayload,
  normalizeChatBody,
  normalizeMessageList,
  removeCurrentMessageFromContext,
  validateChatBody,
};
