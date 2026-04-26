const http = require("node:http");

const { createApiError } = require("./errors");
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

function createApp(options = {}) {
  const token = String(options.token || "").trim();
  const defaultAgentId = String(options.defaultAgentId || "main").trim();
  const pool = options.pool;
  const queues = options.queues;
  const sessionStore = options.sessionStore;
  const runner = options.runner;

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
        });
      }

      if (route.type === "metrics") {
        return sendText(res, 200, renderMetrics({ pool, queues }));
      }

      if (route.type === "adminPool") {
        if (!authenticate(req, token)) {
          throw createApiError(401, "unauthorized", "missing or invalid bearer token");
        }
        return sendJson(res, 200, renderPoolAdminStatus({ defaultAgentId, pool, queues }));
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

      const result = await queues.run(route.logicalAgentId, normalized.conversationId, async () =>
        handleChatTurn({
          logicalAgentId: route.logicalAgentId,
          normalized,
          traceId,
          pool,
          sessionStore,
          runner,
        })
      );

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

async function handleChatTurn({ logicalAgentId, normalized, traceId, pool, sessionStore, runner }) {
  return pool.withWorker(logicalAgentId, normalized.conversationId, async (lease) => {
    const requestContext = removeCurrentMessageFromContext(normalized.messageList, normalized.message);
    const storedContext = sessionStore.load(logicalAgentId, normalized.conversationId);
    const history = storedContext.length ? storedContext : requestContext;
    const sessionId = buildSessionId(logicalAgentId, normalized.conversationId);
    const runSessionId = buildRunSessionId(logicalAgentId, normalized.conversationId, traceId);
    const prompt = buildPrompt({
      message: normalized.message,
      history,
    });

    const result = await runner({
      logicalAgentId,
      workerAgentId: lease.workerAgentId,
      conversationId: normalized.conversationId,
      userId: normalized.userId,
      message: normalized.message,
      history,
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
    });
  });
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

function renderMetrics({ pool, queues }) {
  const poolSnapshot = pool.snapshot();
  const queueSnapshot = queues.snapshot();
  return [
    `openclaw_agent_pool_workers ${poolSnapshot.workerCount}`,
    `openclaw_agent_pool_busy_workers ${poolSnapshot.busyWorkers}`,
    `openclaw_agent_pool_queue_depth ${poolSnapshot.queueDepth}`,
    `openclaw_agent_pool_conversation_queues ${queueSnapshot.conversationQueues}`,
    "",
  ].join("\n");
}

function renderPoolAdminStatus({ defaultAgentId, pool, queues }) {
  return {
    ok: true,
    service: "openclaw-agent-pool-bridge",
    generatedAt: new Date().toISOString(),
    defaultAgentId,
    pool: pool.snapshot(),
    queues: queues.snapshot(),
  };
}

module.exports = {
  createApp,
  handleChatTurn,
  matchRoute,
  renderPoolAdminStatus,
  renderMetrics,
};
