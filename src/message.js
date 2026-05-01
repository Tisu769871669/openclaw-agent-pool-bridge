const crypto = require("node:crypto");

function normalizeChatBody(body = {}) {
  const rawContent = parseMaybeJson(body.content);
  const contentObject = rawContent && typeof rawContent === "object" && !Array.isArray(rawContent)
    ? rawContent
    : {};
  const contentText = typeof rawContent === "string" ? cleanText(rawContent) : pickMessageText(contentObject);
  const rawMessageList = parseMaybeJson(
    contentObject.messageList ?? body.messageList
  );
  const messageList = normalizeMessageList(rawMessageList);
  const attachments = normalizeAttachmentsFromContainers(body, contentObject);
  const responseOptions = normalizeResponseOptions(body, contentObject);
  const conversationId = cleanText(body.conversationId || body.conversation_id || body.sessionId || body.session_id);
  const userId = cleanText(body.userId || body.user_id || body.uid);
  const messageText =
    cleanText(body.message || body.text || body.query) || contentText || extractMessageFromList(messageList);
  const message = buildAgentMessage({
    text: messageText,
    attachments,
    responseOptions,
  });

  return {
    conversationId,
    userId,
    message,
    messageText,
    attachments,
    responseOptions,
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
      const attachments = normalizeAttachmentsFromMessage(entry);
      const messageText = buildAgentMessage({
        text,
        attachments,
      });
      if (!messageText) {
        return null;
      }
      const normalized = {
        role: pickMessageRole(entry),
        text: messageText,
      };
      if (attachments.length) {
        normalized.attachments = attachments;
      }
      return normalized;
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
  return messageList
    .filter((item) => item?.role === "user" || item?.role === "assistant")
    .map((item) => {
      const trusted = {
        role: item.role,
        text: item.text,
      };
      if (Array.isArray(item.attachments) && item.attachments.length) {
        trusted.attachments = item.attachments;
      }
      return trusted;
    });
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

function createSuccessPayload({
  logicalAgentId,
  conversationId,
  userId,
  reply,
  sessionId,
  traceId,
  responseOptions = {},
  outputs = [],
}) {
  const payload = {
    ok: true,
    agent_id: logicalAgentId,
    conversation_id: conversationId,
    user_id: userId,
    reply,
    session_id: sessionId,
    trace_id: traceId,
  };
  const normalizedOutputs = normalizeOutputItems(outputs);
  if (normalizedOutputs.length) {
    payload.outputs = normalizedOutputs;
  }
  const tts = serializeTtsRequest(responseOptions.tts);
  if (tts) {
    payload.tts = tts;
  }
  return payload;
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

  return [item.text, item.content, item.message, item.body, item.question, item.query, item.caption, item.transcript]
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

function buildAgentMessage({ text = "", attachments = [], responseOptions = {} } = {}) {
  const parts = [cleanText(text)];
  const attachmentBlock = formatAttachmentBlock(attachments);
  if (attachmentBlock) {
    parts.push(attachmentBlock);
  }
  const responseOptionsBlock = formatResponseOptionsBlock(responseOptions);
  if (responseOptionsBlock) {
    parts.push(responseOptionsBlock);
  }
  return parts.filter(Boolean).join("\n\n");
}

function normalizeAttachmentsFromContainers(...containers) {
  const attachments = [];
  for (const container of containers) {
    if (!container || typeof container !== "object") {
      continue;
    }
    attachments.push(
      ...normalizeAttachmentCollection(container.attachments),
      ...normalizeAttachmentCollection(container.media),
      ...normalizeAttachmentCollection(container.images, "image"),
      ...normalizeAttachmentCollection(container.image, "image"),
      ...normalizeAttachmentCollection(container.imageUrl || container.image_url, "image"),
      ...normalizeAttachmentCollection(container.files, "file"),
      ...normalizeAttachmentCollection(container.file, "file"),
      ...normalizeAttachmentCollection(container.fileUrl || container.file_url, "file"),
      ...normalizeAttachmentCollection(container.audio, "audio"),
      ...normalizeAttachmentCollection(container.voice, "audio"),
      ...normalizeAttachmentCollection(container.audioUrl || container.audio_url, "audio"),
      ...normalizeAttachmentCollection(container.voiceUrl || container.voice_url, "audio")
    );
  }
  return dedupeAttachments(attachments);
}

function normalizeAttachmentsFromMessage(entry) {
  const attachments = normalizeAttachmentsFromContainers(entry);
  if (attachments.length) {
    return dedupeAttachments(attachments);
  }
  if (!looksLikeAttachment(entry)) {
    return [];
  }
  const direct = normalizeAttachment(entry);
  if (direct) {
    attachments.push(direct);
  }
  return dedupeAttachments(attachments);
}

function looksLikeAttachment(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return false;
  }
  return Boolean(
    item.type ||
      item.mediaType ||
      item.media_type ||
      item.messageType ||
      item.message_type ||
      item.kind ||
      item.url ||
      item.href ||
      item.fileUrl ||
      item.file_url ||
      item.imageUrl ||
      item.image_url ||
      item.audioUrl ||
      item.audio_url ||
      item.voiceUrl ||
      item.voice_url ||
      item.mediaUrl ||
      item.media_url ||
      item.downloadUrl ||
      item.download_url ||
      item.mediaId ||
      item.media_id ||
      item.filename ||
      item.fileName ||
      item.file_name ||
      item.mimeType ||
      item.mime_type ||
      item.contentType ||
      item.content_type
  );
}

function normalizeAttachmentCollection(value, forcedType = "") {
  const parsed = parseMaybeJson(value);
  if (parsed === undefined || parsed === null || parsed === "") {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((item) => normalizeAttachment(item, forcedType)).filter(Boolean);
}

function normalizeAttachment(item, forcedType = "") {
  const parsed = parseMaybeJson(item);
  if (parsed === undefined || parsed === null || parsed === "") {
    return null;
  }
  if (typeof parsed === "string") {
    const url = cleanText(parsed);
    if (!url) {
      return null;
    }
    return {
      type: normalizeAttachmentType(forcedType, { url }),
      url,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const type = normalizeAttachmentType(
    forcedType ||
      parsed.type ||
      parsed.mediaType ||
      parsed.media_type ||
      parsed.messageType ||
      parsed.message_type ||
      parsed.kind,
    parsed
  );
  if (!["image", "file", "audio"].includes(type)) {
    return null;
  }

  const attachment = {
    type,
  };
  assignIfText(attachment, "url", parsed.url || parsed.href || parsed.fileUrl || parsed.file_url ||
    parsed.imageUrl || parsed.image_url || parsed.audioUrl || parsed.audio_url || parsed.voiceUrl ||
    parsed.voice_url || parsed.mediaUrl || parsed.media_url || parsed.downloadUrl || parsed.download_url);
  assignIfText(attachment, "mediaId", parsed.mediaId || parsed.media_id || parsed.id);
  assignIfText(attachment, "name", parsed.name || parsed.filename || parsed.fileName || parsed.file_name || parsed.title);
  assignIfText(attachment, "mimeType", parsed.mimeType || parsed.mime_type || parsed.contentType ||
    parsed.content_type || parsed.mime || parsed.mimetype);
  assignIfText(attachment, "alt", parsed.alt || parsed.caption || parsed.description);
  assignIfText(attachment, "transcript", parsed.transcript || parsed.recognitionText || parsed.recognition_text);
  assignIfFiniteNumber(attachment, "size", parsed.size || parsed.sizeBytes || parsed.size_bytes || parsed.fileSize ||
    parsed.file_size);
  assignIfFiniteNumber(attachment, "durationMs", parsed.durationMs || parsed.duration_ms || parsed.duration);

  if (Object.keys(attachment).length <= 1) {
    return null;
  }
  return attachment;
}

function normalizeAttachmentType(value, item = {}) {
  const raw = cleanText(value).toLowerCase();
  if (["image", "img", "photo", "picture", "pic"].includes(raw)) {
    return "image";
  }
  if (["audio", "voice", "sound", "speech", "tts"].includes(raw)) {
    return "audio";
  }
  if (["file", "document", "doc", "attachment"].includes(raw)) {
    return "file";
  }

  const mimeType = cleanText(item.mimeType || item.mime_type || item.contentType || item.content_type || item.mime)
    .toLowerCase();
  if (mimeType.startsWith("image/")) {
    return "image";
  }
  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  const nameOrUrl = cleanText(item.name || item.filename || item.fileName || item.url || item.fileUrl || item.imageUrl ||
    item.audioUrl).toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/.test(nameOrUrl)) {
    return "image";
  }
  if (/\.(mp3|wav|m4a|aac|ogg|opus|flac)(\?|#|$)/.test(nameOrUrl)) {
    return "audio";
  }
  return "file";
}

function dedupeAttachments(attachments) {
  const seen = new Set();
  const out = [];
  for (const attachment of attachments) {
    if (!attachment) {
      continue;
    }
    const key = JSON.stringify(attachment);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(attachment);
  }
  return out;
}

function formatAttachmentBlock(attachments = []) {
  const lines = formatAttachmentSummaries(attachments);
  if (!lines.length) {
    return "";
  }
  return ["Attachments:", ...lines.map((line, index) => `${index + 1}. ${line}`)].join("\n");
}

function formatAttachmentSummaries(attachments = []) {
  return (Array.isArray(attachments) ? attachments : [])
    .map(formatAttachmentSummary)
    .filter(Boolean);
}

function formatAttachmentSummary(attachment = {}) {
  const type = normalizeAttachmentType(attachment.type, attachment);
  if (!["image", "file", "audio"].includes(type)) {
    return "";
  }

  const head = cleanText(attachment.name)
    ? `${type}: ${cleanText(attachment.name)}`
    : `${type}:`;
  const details = [];
  pushDetail(details, "url", attachment.url);
  pushDetail(details, "mediaId", attachment.mediaId);
  pushDetail(details, "mime", attachment.mimeType);
  if (Number.isFinite(Number(attachment.size))) {
    details.push(`size=${Number(attachment.size)}`);
  }
  pushDetail(details, "alt", attachment.alt);
  pushDetail(details, "transcript", attachment.transcript);
  if (Number.isFinite(Number(attachment.durationMs))) {
    details.push(`durationMs=${Number(attachment.durationMs)}`);
  }
  if (!details.length) {
    return head;
  }
  return cleanText(attachment.name)
    ? `${head}; ${details.join("; ")}`
    : `${head} ${details.join("; ")}`;
}

function normalizeResponseOptions(body = {}, content = {}) {
  const ttsSource = firstDefined(
    content.tts,
    body.tts,
    content.voiceReply,
    body.voiceReply,
    content.voice_reply,
    body.voice_reply,
    content.audioReply,
    body.audioReply,
    content.audio_reply,
    body.audio_reply
  );
  return {
    tts: normalizeTtsOptions(ttsSource),
  };
}

function normalizeTtsOptions(value) {
  const parsed = parseMaybeJson(value);
  if (parsed === undefined || parsed === null || parsed === "") {
    return { enabled: false };
  }
  if (typeof parsed === "boolean") {
    return { enabled: parsed };
  }
  if (typeof parsed === "string") {
    const text = cleanText(parsed);
    if (!text || ["0", "false", "no", "off"].includes(text.toLowerCase())) {
      return { enabled: false };
    }
    if (["1", "true", "yes", "on"].includes(text.toLowerCase())) {
      return { enabled: true };
    }
    return { enabled: true, mode: text };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { enabled: false };
  }

  const enabled = parseBooleanLike(firstDefined(parsed.enabled, parsed.requested, parsed.request, true), true);
  const tts = { enabled };
  assignIfText(tts, "mode", parsed.mode || parsed.auto || parsed.policy);
  assignIfText(tts, "voice", parsed.voice || parsed.voiceName || parsed.voice_name);
  assignIfText(tts, "lang", parsed.lang || parsed.language || parsed.locale);
  assignIfText(tts, "format", parsed.format || parsed.audioFormat || parsed.audio_format);
  return tts;
}

function formatResponseOptionsBlock(responseOptions = {}) {
  const tts = responseOptions.tts || {};
  if (!tts.enabled) {
    return "";
  }
  const details = [];
  pushDetail(details, "mode", tts.mode);
  pushDetail(details, "voice", tts.voice);
  pushDetail(details, "lang", tts.lang);
  pushDetail(details, "format", tts.format);
  const suffix = details.length ? `: ${details.join("; ")}` : "";
  return ["Response options:", `- TTS requested${suffix}`].join("\n");
}

function serializeTtsRequest(tts = {}) {
  if (!tts.enabled) {
    return null;
  }
  const payload = { requested: true };
  assignIfText(payload, "mode", tts.mode);
  assignIfText(payload, "voice", tts.voice);
  assignIfText(payload, "lang", tts.lang);
  assignIfText(payload, "format", tts.format);
  return payload;
}

function normalizeOutputItems(items = []) {
  const normalized = [];
  const source = Array.isArray(items) ? items : [items];
  for (const item of source) {
    const output = normalizeOutputItem(item);
    if (output) {
      normalized.push(output);
    }
  }
  return normalized;
}

function normalizeOutputItem(item) {
  const parsed = parseMaybeJson(item);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const type = normalizeAttachmentType(
    parsed.type || parsed.mediaType || parsed.media_type || parsed.kind,
    parsed
  );
  if (!["image", "file", "audio"].includes(type)) {
    return null;
  }

  const output = { type };
  assignIfText(output, "url", parsed.url || parsed.href || parsed.fileUrl || parsed.file_url || parsed.imageUrl ||
    parsed.image_url || parsed.audioUrl || parsed.audio_url || parsed.mediaUrl || parsed.media_url);
  assignIfText(output, "media_id", parsed.media_id || parsed.mediaId || parsed.id);
  assignIfText(output, "name", parsed.name || parsed.filename || parsed.fileName || parsed.file_name);
  assignIfText(output, "title", parsed.title);
  assignIfText(output, "mime_type", parsed.mime_type || parsed.mimeType || parsed.content_type || parsed.contentType ||
    parsed.mime);
  assignIfFiniteNumber(output, "size", parsed.size || parsed.sizeBytes || parsed.size_bytes || parsed.fileSize ||
    parsed.file_size);
  assignIfFiniteNumber(output, "duration_ms", parsed.duration_ms || parsed.durationMs || parsed.duration);
  if (Object.keys(output).length <= 1) {
    return null;
  }
  return output;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function parseBooleanLike(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
}

function assignIfText(target, key, value) {
  const text = cleanText(value);
  if (text) {
    target[key] = text;
  }
}

function assignIfFiniteNumber(target, key, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const number = Number(value);
  if (Number.isFinite(number)) {
    target[key] = number;
  }
}

function pushDetail(details, key, value) {
  const text = cleanText(value);
  if (text) {
    details.push(`${key}=${text}`);
  }
}

function normalizeSessionPart(value, maxLength) {
  const text = cleanText(value).replace(/[^a-zA-Z0-9:_-]/g, "_");
  return (text || "unknown").slice(0, maxLength);
}

function cleanText(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    return "";
  }
  return String(value).trim();
}

module.exports = {
  buildAgentMessage,
  buildPrompt,
  buildRunSessionId,
  buildSessionId,
  buildTraceId,
  cleanText,
  createErrorPayload,
  createSuccessPayload,
  formatAttachmentBlock,
  formatAttachmentSummaries,
  formatResponseOptionsBlock,
  normalizeAttachment,
  normalizeAttachmentsFromContainers,
  normalizeChatBody,
  normalizeMessageList,
  normalizeOutputItems,
  normalizeResponseOptions,
  removeCurrentMessageFromContext,
  validateChatBody,
};
