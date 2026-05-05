const http = require("node:http");

const { createActiveStatusWhitelistManager } = require("./active-status-whitelist-manager");
const { createApiError } = require("./errors");
const { DEFAULT_BODY_LIMIT_BYTES, readParsedBody } = require("./http-body");
const {
  buildPrompt,
  buildRunSessionId,
  buildSessionId,
  buildTraceId,
  createErrorPayload,
  createSuccessPayload,
  normalizeChatBody,
  removeCurrentMessageFromContext,
  validateChatBody,
} = require("./message");
const { createSoulManager } = require("./soul-manager");
const { createWechatArticlePersonaManager } = require("./wechat-article-persona-manager");
const { createWechatMomentsPersonaManager } = require("./wechat-moments-persona-manager");

function createApp(options = {}) {
  const token = String(options.token || "").trim();
  const defaultAgentId = String(options.defaultAgentId || "main").trim();
  const pool = options.pool;
  const queues = options.queues;
  const debounce = options.debounce;
  const promptAdapter = options.promptAdapter;
  const retrievalAdapter = options.retrievalAdapter;
  const sessionStore = options.sessionStore;
  const runner = options.runner;
  const soulManager = options.soulManager || createSoulManager({
    defaultAgentId,
    agentTemplates: options.agentTemplates || {},
  });
  const wechatArticlePersonaManager = options.wechatArticlePersonaManager || createWechatArticlePersonaManager({
    defaultAgentId,
    agentTemplates: options.agentTemplates || {},
  });
  const wechatMomentsPersonaManager = options.wechatMomentsPersonaManager || createWechatMomentsPersonaManager({
    defaultAgentId,
    agentTemplates: options.agentTemplates || {},
  });
  const activeStatusWhitelistManager = options.activeStatusWhitelistManager || createActiveStatusWhitelistManager({
    defaultAgentId,
    agentTemplates: options.agentTemplates || {},
  });
  const soulDistiller = options.soulDistiller;
  const bodyLimitBytes = Number(options.bodyLimitBytes || DEFAULT_BODY_LIMIT_BYTES);

  return http.createServer(async (req, res) => {
    const traceId = buildTraceId();
    try {
      const route = matchRoute(req, defaultAgentId);
      if (!route) {
        throw createApiError(404, "not_found", "Not found");
      }

      if (route.type === "health") {
        return sendJson(res, 200, {
          ok: true,
          service: "openclaw-agent-pool-bridge",
          default_agent_id: defaultAgentId,
          pool: pool.snapshot(),
          queues: queues.snapshot(),
          debounce: debounce?.snapshot?.() || null,
          prompt: promptAdapter?.snapshot?.() || { adapter: "none" },
          retrieval: retrievalAdapter?.snapshot?.() || { enabled: false, provider: "none" },
        });
      }

      if (route.type === "metrics") {
        return sendText(res, 200, renderMetrics({ pool, queues, debounce }));
      }

      if (route.type === "adminPool") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        return sendJson(
          res,
          200,
          renderPoolAdminStatus({ defaultAgentId, pool, queues, debounce, promptAdapter, retrievalAdapter })
        );
      }

      if (route.type === "soulGet") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        return sendJson(res, 200, renderSoulRead(soulManager.read(route.logicalAgentId)));
      }

      if (route.type === "soulPut") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        const parsed = await readParsedBody(req, { limitBytes: bodyLimitBytes });
        const content = extractSoulUploadContent(parsed);
        const write = soulManager.write(route.logicalAgentId, content, {
          syncWorkers: extractSyncWorkers(parsed, route.searchParams),
        });
        return sendJson(res, 200, renderSoulWrite(write));
      }

      if (route.type === "soulDistill") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        if (!soulDistiller?.distill) {
          throw createApiError(503, "soul_distiller_not_configured", "soul distiller is not configured");
        }
        const parsed = await readParsedBody(req, { limitBytes: bodyLimitBytes });
        const chatUpload = extractChatUpload(parsed);
        const currentSoul = soulManager.readOptional(route.logicalAgentId);
        const distillation = await soulDistiller.distill({
          logicalAgentId: route.logicalAgentId,
          currentSoul: currentSoul.content,
          chatLog: chatUpload.content,
          filename: chatUpload.filename,
          traceId,
        });
        const write = soulManager.write(route.logicalAgentId, distillation.content, {
          syncWorkers: extractSyncWorkers(parsed, route.searchParams),
        });
        return sendJson(res, 200, renderSoulDistill({ write, distillation }));
      }

      if (route.type === "wechatArticlePersonaGet") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        return sendJson(
          res,
          200,
          renderWechatArticlePersonaRead(wechatArticlePersonaManager.read(route.logicalAgentId))
        );
      }

      if (route.type === "wechatArticlePersonaPut") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        const parsed = await readParsedBody(req, { limitBytes: bodyLimitBytes });
        const content = extractWechatArticlePersonaUploadContent(parsed);
        const write = wechatArticlePersonaManager.write(route.logicalAgentId, content, {
          syncWorkers: extractSyncWorkers(parsed, route.searchParams),
        });
        return sendJson(res, 200, renderWechatArticlePersonaWrite(write));
      }

      if (route.type === "wechatMomentsPersonaGet") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        return sendJson(
          res,
          200,
          renderWechatMomentsPersonaRead(wechatMomentsPersonaManager.read(route.logicalAgentId))
        );
      }

      if (route.type === "wechatMomentsPersonaPut") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        const parsed = await readParsedBody(req, { limitBytes: bodyLimitBytes });
        const content = extractWechatMomentsPersonaUploadContent(parsed);
        const write = wechatMomentsPersonaManager.write(route.logicalAgentId, content, {
          syncWorkers: extractSyncWorkers(parsed, route.searchParams),
        });
        return sendJson(res, 200, renderWechatMomentsPersonaWrite(write));
      }

      if (route.type === "activeStatusWhitelistGet") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        return sendJson(
          res,
          200,
          renderActiveStatusWhitelistRead(activeStatusWhitelistManager.read(route.logicalAgentId))
        );
      }

      if (route.type === "activeStatusWhitelistPut") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        const parsed = await readParsedBody(req, { limitBytes: bodyLimitBytes });
        const payload = extractActiveStatusWhitelistUpload(parsed, route.searchParams);
        const write = activeStatusWhitelistManager.write(route.logicalAgentId, payload, {
          syncWorkers: extractSyncWorkers(parsed, route.searchParams),
        });
        return sendJson(res, 200, renderActiveStatusWhitelistWrite(write));
      }

      if (route.type === "activeStatusWhitelistPost") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        const parsed = await readParsedBody(req, { limitBytes: bodyLimitBytes });
        const payload = extractActiveStatusWhitelistUpload(parsed, route.searchParams);
        const write = activeStatusWhitelistManager.update(route.logicalAgentId, payload, {
          syncWorkers: extractSyncWorkers(parsed, route.searchParams),
        });
        return sendJson(res, 200, renderActiveStatusWhitelistWrite(write));
      }

      if (!authenticate(req, token)) {
        throw createApiError(401, "unauthorized", "missing or invalid bearer token");
      }

      const body = await readJsonBody(req);
      const normalized = normalizeChatBody(body);
      const validationError = validateChatBody(normalized);
      if (validationError) {
        throw createApiError(400, "invalid_request", validationError);
      }

      const runTurn = (debouncedNormalized) =>
        queues.run(route.logicalAgentId, debouncedNormalized.conversationId, async () =>
          handleChatTurn({
            logicalAgentId: route.logicalAgentId,
            normalized: debouncedNormalized,
            traceId,
            pool,
            promptAdapter,
            retrievalAdapter,
            sessionStore,
            runner,
          })
        );
      const result = debounce
        ? await debounce.run(route.logicalAgentId, normalized.conversationId, normalized, runTurn)
        : await runTurn(normalized);

      sendJson(res, 200, result);
    } catch (error) {
      sendJson(
        res,
        error.statusCode || 500,
        createErrorPayload({
          code: error.code || "internal_error",
          message: error.message || "Internal server error",
          traceId,
        })
      );
    }
  });
}

async function handleChatTurn({
  logicalAgentId,
  normalized,
  traceId,
  pool,
  promptAdapter,
  retrievalAdapter,
  sessionStore,
  runner,
}) {
  return pool.withWorker(logicalAgentId, normalized.conversationId, async (lease) => {
    const requestContext = Array.isArray(normalized.historyOverride)
      ? normalized.historyOverride
      : removeCurrentMessageFromContext(normalized.messageList, normalized.message);
    const storedContext = sessionStore.load(logicalAgentId, normalized.conversationId);
    const history = storedContext.length ? storedContext : requestContext;
    const sessionId = buildSessionId(logicalAgentId, normalized.conversationId);
    const runSessionId = buildRunSessionId(logicalAgentId, normalized.conversationId, traceId);
    const retrieval = await safeRetrieve(retrievalAdapter, {
      logicalAgentId,
      conversationId: normalized.conversationId,
      userId: normalized.userId,
      message: normalized.messageText || normalized.message,
      history,
      traceId,
    });
    const promptInput = {
      logicalAgentId,
      conversationId: normalized.conversationId,
      userId: normalized.userId,
      message: normalized.message,
      messageText: normalized.messageText,
      attachments: normalized.attachments,
      responseOptions: normalized.responseOptions,
      history,
      retrievalContext: retrieval.context,
    };
    const prompt = promptAdapter?.buildPrompt
      ? promptAdapter.buildPrompt(promptInput)
      : buildPrompt(promptInput);

    const result = await runner({
      logicalAgentId,
      workerAgentId: lease.workerAgentId,
      conversationId: normalized.conversationId,
      userId: normalized.userId,
      message: normalized.message,
      messageText: normalized.messageText,
      attachments: normalized.attachments,
      responseOptions: normalized.responseOptions,
      history,
      retrieval,
      prompt,
      runSessionId,
      traceId,
    });

    sessionStore.appendTurn(logicalAgentId, normalized.conversationId, normalized.message, result.reply);

    return createSuccessPayload({
      logicalAgentId,
      conversationId: normalized.conversationId,
      userId: normalized.userId,
      reply: result.reply,
      sessionId,
      traceId,
      responseOptions: normalized.responseOptions,
      outputs: result.outputs,
    });
  });
}

async function safeRetrieve(retrievalAdapter, input) {
  if (!retrievalAdapter?.retrieve) {
    return { context: "", hits: [] };
  }
  try {
    return await retrievalAdapter.retrieve(input);
  } catch (error) {
    retrievalAdapter.recordError?.(error);
    return { context: "", hits: [] };
  }
}

function matchRoute(req, defaultAgentId) {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return { type: "health" };
  }
  if (req.method === "GET" && url.pathname === "/metrics") {
    return { type: "metrics" };
  }
  if (req.method === "GET" && url.pathname === "/admin/pool") {
    return { type: "adminPool" };
  }
  if (req.method === "GET" && url.pathname === "/api/agents/soul") {
    return { type: "soulGet", logicalAgentId: defaultAgentId, searchParams: url.searchParams };
  }
  if (req.method === "PUT" && url.pathname === "/api/agents/soul") {
    return { type: "soulPut", logicalAgentId: defaultAgentId, searchParams: url.searchParams };
  }
  if (req.method === "POST" && url.pathname === "/api/agents/soul/distill") {
    return { type: "soulDistill", logicalAgentId: defaultAgentId, searchParams: url.searchParams };
  }
  if (req.method === "GET" && url.pathname === "/api/agents/wechat-article-persona") {
    return { type: "wechatArticlePersonaGet", logicalAgentId: defaultAgentId, searchParams: url.searchParams };
  }
  if (req.method === "PUT" && url.pathname === "/api/agents/wechat-article-persona") {
    return { type: "wechatArticlePersonaPut", logicalAgentId: defaultAgentId, searchParams: url.searchParams };
  }
  if (req.method === "GET" && url.pathname === "/api/agents/wechat-moments-persona") {
    return { type: "wechatMomentsPersonaGet", logicalAgentId: defaultAgentId, searchParams: url.searchParams };
  }
  if (req.method === "PUT" && url.pathname === "/api/agents/wechat-moments-persona") {
    return { type: "wechatMomentsPersonaPut", logicalAgentId: defaultAgentId, searchParams: url.searchParams };
  }
  if (req.method === "GET" && url.pathname === "/api/agents/active-status-whitelist") {
    return { type: "activeStatusWhitelistGet", logicalAgentId: defaultAgentId, searchParams: url.searchParams };
  }
  if (req.method === "PUT" && url.pathname === "/api/agents/active-status-whitelist") {
    return { type: "activeStatusWhitelistPut", logicalAgentId: defaultAgentId, searchParams: url.searchParams };
  }
  if (req.method === "POST" && url.pathname === "/api/agents/active-status-whitelist") {
    return { type: "activeStatusWhitelistPost", logicalAgentId: defaultAgentId, searchParams: url.searchParams };
  }

  const soulDistillMatch = /^\/api\/agents\/([^/]+)\/soul\/distill$/.exec(url.pathname);
  if (req.method === "POST" && soulDistillMatch) {
    return {
      type: "soulDistill",
      logicalAgentId: decodeURIComponent(soulDistillMatch[1]),
      searchParams: url.searchParams,
    };
  }

  const soulMatch = /^\/api\/agents\/([^/]+)\/soul$/.exec(url.pathname);
  if ((req.method === "GET" || req.method === "PUT") && soulMatch) {
    return {
      type: req.method === "GET" ? "soulGet" : "soulPut",
      logicalAgentId: decodeURIComponent(soulMatch[1]),
      searchParams: url.searchParams,
    };
  }

  const wechatArticlePersonaMatch = /^\/api\/agents\/([^/]+)\/wechat-article-persona$/.exec(url.pathname);
  if ((req.method === "GET" || req.method === "PUT") && wechatArticlePersonaMatch) {
    return {
      type: req.method === "GET" ? "wechatArticlePersonaGet" : "wechatArticlePersonaPut",
      logicalAgentId: decodeURIComponent(wechatArticlePersonaMatch[1]),
      searchParams: url.searchParams,
    };
  }

  const wechatMomentsPersonaMatch = /^\/api\/agents\/([^/]+)\/wechat-moments-persona$/.exec(url.pathname);
  if ((req.method === "GET" || req.method === "PUT") && wechatMomentsPersonaMatch) {
    return {
      type: req.method === "GET" ? "wechatMomentsPersonaGet" : "wechatMomentsPersonaPut",
      logicalAgentId: decodeURIComponent(wechatMomentsPersonaMatch[1]),
      searchParams: url.searchParams,
    };
  }

  const activeStatusWhitelistMatch = /^\/api\/agents\/([^/]+)\/active-status-whitelist$/.exec(url.pathname);
  if ((req.method === "GET" || req.method === "PUT" || req.method === "POST") && activeStatusWhitelistMatch) {
    return {
      type: req.method === "GET"
        ? "activeStatusWhitelistGet"
        : req.method === "PUT"
          ? "activeStatusWhitelistPut"
          : "activeStatusWhitelistPost",
      logicalAgentId: decodeURIComponent(activeStatusWhitelistMatch[1]),
      searchParams: url.searchParams,
    };
  }

  if (req.method === "POST" && url.pathname === "/api/agents/chat") {
    return { type: "chat", logicalAgentId: defaultAgentId };
  }

  const match = /^\/api\/agents\/([^/]+)\/chat$/.exec(url.pathname);
  if (req.method === "POST" && match) {
    return { type: "chat", logicalAgentId: decodeURIComponent(match[1]) };
  }

  return null;
}

function authenticate(req, token) {
  if (!token) {
    return true;
  }
  return String(req.headers.authorization || "").trim() === `Bearer ${token}`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(createApiError(413, "invalid_request", "Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        return resolve({});
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(createApiError(400, "invalid_request", "Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function renderMetrics({ pool, queues, debounce }) {
  const poolSnapshot = pool.snapshot();
  const queueSnapshot = queues.snapshot();
  const debounceSnapshot = debounce?.snapshot?.() || {};
  return [
    `openclaw_agent_pool_workers ${poolSnapshot.workerCount}`,
    `openclaw_agent_pool_busy_workers ${poolSnapshot.busyWorkers}`,
    `openclaw_agent_pool_queue_depth ${poolSnapshot.queueDepth}`,
    `openclaw_agent_pool_conversation_queues ${queueSnapshot.conversationQueues}`,
    `openclaw_agent_pool_debounce_pending_batches ${debounceSnapshot.pendingBatches || 0}`,
    `openclaw_agent_pool_debounce_pending_messages ${debounceSnapshot.pendingMessages || 0}`,
    "",
  ].join("\n");
}

function renderPoolAdminStatus({ defaultAgentId, pool, queues, debounce, promptAdapter, retrievalAdapter }) {
  return {
    ok: true,
    service: "openclaw-agent-pool-bridge",
    generatedAt: new Date().toISOString(),
    defaultAgentId,
    pool: pool.snapshot(),
    queues: queues.snapshot(),
    debounce: debounce?.snapshot?.() || null,
    prompt: promptAdapter?.snapshot?.() || { adapter: "none" },
    retrieval: retrievalAdapter?.snapshot?.() || { enabled: false, provider: "none" },
  };
}

function renderSoulRead(soul) {
  return {
    ok: true,
    agent_id: soul.logicalAgentId,
    soul: {
      path: soul.path,
      content: soul.content,
      bytes: soul.bytes,
      sha256: soul.sha256,
      source_workspace: soul.sourceWorkspace,
    },
  };
}

function renderSoulWrite(write) {
  return {
    ok: true,
    agent_id: write.logicalAgentId,
    soul: write.source,
    sync: {
      source: write.source,
      template: write.template,
      workers: write.workers,
      sync_workers: write.syncWorkers,
    },
  };
}

function renderSoulDistill({ write, distillation }) {
  return {
    ...renderSoulWrite(write),
    distillation: {
      skill: distillation.skill,
    },
  };
}

function renderWechatArticlePersonaRead(persona) {
  return {
    ok: true,
    agent_id: persona.logicalAgentId,
    persona: {
      name: persona.fileName,
      path: persona.path,
      content: persona.content,
      bytes: persona.bytes,
      sha256: persona.sha256,
      source_workspace: persona.sourceWorkspace,
    },
  };
}

function renderWechatArticlePersonaWrite(write) {
  return {
    ok: true,
    agent_id: write.logicalAgentId,
    persona: write.source,
    sync: {
      source: write.source,
      template: write.template,
      workers: write.workers,
      sync_workers: write.syncWorkers,
    },
  };
}

function renderWechatMomentsPersonaRead(persona) {
  return {
    ok: true,
    agent_id: persona.logicalAgentId,
    persona: {
      name: persona.fileName,
      path: persona.path,
      content: persona.content,
      bytes: persona.bytes,
      sha256: persona.sha256,
      source_workspace: persona.sourceWorkspace,
    },
  };
}

function renderWechatMomentsPersonaWrite(write) {
  return {
    ok: true,
    agent_id: write.logicalAgentId,
    persona: write.source,
    sync: {
      source: write.source,
      template: write.template,
      workers: write.workers,
      sync_workers: write.syncWorkers,
    },
  };
}

function renderActiveStatusWhitelistRead(whitelist) {
  return {
    ok: true,
    agent_id: whitelist.logicalAgentId,
    whitelist: {
      name: whitelist.fileName,
      path: whitelist.path,
      content: whitelist.content,
      entries: whitelist.entries,
      count: whitelist.entries.length,
      bytes: whitelist.bytes,
      sha256: whitelist.sha256,
      source_workspace: whitelist.sourceWorkspace,
    },
  };
}

function renderActiveStatusWhitelistWrite(write) {
  return {
    ok: true,
    agent_id: write.logicalAgentId,
    whitelist: write.source,
    sync: {
      source: write.source,
      template: write.template,
      workers: write.workers,
      sync_workers: write.syncWorkers,
    },
  };
}

function extractSoulUploadContent(parsed) {
  const body = parsed.body || {};
  const fields = parsed.fields || {};
  const files = parsed.files || [];
  return pickTextValue([
    body.content,
    body.soul,
    body.markdown,
    decodeBase64(body.contentBase64 || body.soulBase64),
    fields.content,
    fields.soul,
    fields.markdown,
    pickFileContent(files, ["soulFile", "soul", "file", "upload"]),
  ], "SOUL.md content is required");
}

function extractWechatArticlePersonaUploadContent(parsed) {
  const body = parsed.body || {};
  const fields = parsed.fields || {};
  const files = parsed.files || [];
  return pickTextValue([
    body.content,
    body.persona,
    body.markdown,
    body.prompt,
    decodeBase64(body.contentBase64 || body.personaBase64 || body.promptBase64),
    fields.content,
    fields.persona,
    fields.markdown,
    fields.prompt,
    pickFileContent(files, ["personaFile", "wechatArticlePersonaFile", "promptFile", "file", "upload"]),
  ], "WECHAT_ARTICLE_PERSONA.md content is required");
}

function extractWechatMomentsPersonaUploadContent(parsed) {
  const body = parsed.body || {};
  const fields = parsed.fields || {};
  const files = parsed.files || [];
  return pickTextValue([
    body.content,
    body.persona,
    body.markdown,
    body.prompt,
    decodeBase64(body.contentBase64 || body.personaBase64 || body.promptBase64),
    fields.content,
    fields.persona,
    fields.markdown,
    fields.prompt,
    pickFileContent(files, ["personaFile", "wechatMomentsPersonaFile", "promptFile", "file", "upload"]),
  ], "WECHAT_MOMENTS_PERSONA.md content is required");
}

function extractActiveStatusWhitelistUpload(parsed, searchParams) {
  const body = parsed.body || {};
  const fields = parsed.fields || {};
  const files = parsed.files || [];
  const pick = (key) => body[key] ?? fields[key] ?? searchParams?.get(key);
  const tenantId = pick("tenantId") || "";
  const fileContent = pickFileContent(files, ["whitelistFile", "activeStatusWhitelistFile", "file", "upload"]);
  const content = body.content ?? fields.content ?? fileContent;
  return {
    tenantId,
    content,
    id: pick("id"),
    sendId: pick("sendId"),
    recvId: pick("recvId"),
    userId: pick("userId"),
    wxid: pick("wxid"),
    phone: pick("phone"),
    conversationId: pick("conversationId"),
    status: pick("status"),
    note: pick("note"),
    entries: body.entries,
    users: body.users,
    whitelist: body.whitelist,
    allowlist: body.allowlist,
  };
}

function extractChatUpload(parsed) {
  const body = parsed.body || {};
  const fields = parsed.fields || {};
  const files = parsed.files || [];
  const selectedFile = pickFile(files, ["chatFile", "chatLog", "chat_log", "file", "upload"]);
  const content = pickTextValue([
    body.chatLog,
    body.chat_log,
    body.content,
    body.text,
    body.transcript,
    decodeBase64(body.chatLogBase64 || body.chat_log_base64 || body.contentBase64),
    fields.chatLog,
    fields.chat_log,
    fields.content,
    fields.text,
    fields.transcript,
    selectedFile?.content,
  ], "chat log content is required");

  return {
    content,
    filename: body.filename || fields.filename || selectedFile?.filename || "chat-log.txt",
  };
}

function extractSyncWorkers(parsed, searchParams) {
  const body = parsed.body || {};
  const fields = parsed.fields || {};
  for (const value of [body.syncWorkers, body.sync_workers, fields.syncWorkers, fields.sync_workers, searchParams?.get("syncWorkers")]) {
    if (value !== undefined && value !== null && value !== "") {
      return !["0", "false", "no", "off"].includes(String(value).trim().toLowerCase());
    }
  }
  return true;
}

function pickTextValue(values, missingMessage) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  throw createApiError(400, "invalid_request", missingMessage);
}

function pickFile(files, names) {
  for (const name of names) {
    const file = files.find((item) => item.fieldName === name);
    if (file) {
      return file;
    }
  }
  return files[0] || null;
}

function pickFileContent(files, names) {
  return pickFile(files, names)?.content;
}

function decodeBase64(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    return "";
  }
}

module.exports = {
  createApp,
  handleChatTurn,
  matchRoute,
  renderPoolAdminStatus,
  renderSoulDistill,
  renderSoulRead,
  renderSoulWrite,
  renderActiveStatusWhitelistRead,
  renderActiveStatusWhitelistWrite,
  renderWechatArticlePersonaRead,
  renderWechatArticlePersonaWrite,
  renderWechatMomentsPersonaRead,
  renderWechatMomentsPersonaWrite,
  renderMetrics,
  safeRetrieve,
};
