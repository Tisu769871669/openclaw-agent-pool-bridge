const { createApiError } = require("./errors");

function nowMs() {
  return Date.now();
}

function normalizeAgentId(value, fallback = "main") {
  const text = String(value || "").trim();
  return text || fallback;
}

function createQueueTimeoutError(logicalAgentId) {
  return createApiError(
    429,
    "queue_timeout",
    `No worker became available for agent ${logicalAgentId} before the queue timeout`
  );
}

class AgentPool {
  constructor(options = {}) {
    this.defaultAgentId = normalizeAgentId(options.defaultAgentId);
    this.queueTimeoutMs = Number.isFinite(options.queueTimeoutMs)
      ? Math.max(0, options.queueTimeoutMs)
      : 30_000;
    this.stickyTtlMs = Number.isFinite(options.stickyTtlMs)
      ? Math.max(0, options.stickyTtlMs)
      : 1_800_000;
    this.agents = normalizeAgents(options.agents, this.defaultAgentId);
    this.busy = new Set();
    this.sticky = new Map();
    this.waiters = [];
    this.workerState = new Map();
    this.startedAt = nowMs();
  }

  async withWorker(logicalAgentId, conversationId, fn) {
    const lease = await this.acquire(logicalAgentId, conversationId);
    try {
      return await fn(lease);
    } catch (error) {
      this.recordLeaseError(lease, error);
      throw error;
    } finally {
      this.release(lease);
    }
  }

  acquire(logicalAgentId, conversationId) {
    const normalizedLogicalAgentId = normalizeAgentId(logicalAgentId, this.defaultAgentId);
    const normalizedConversationId = normalizeConversationId(conversationId);
    const immediate = this.tryAcquire(normalizedLogicalAgentId, normalizedConversationId);

    if (immediate) {
      return Promise.resolve(immediate);
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        logicalAgentId: normalizedLogicalAgentId,
        conversationId: normalizedConversationId,
        sessionId: buildSessionId(normalizedLogicalAgentId, normalizedConversationId),
        enqueuedAt: nowMs(),
        resolve,
        reject,
        timer: null,
      };

      waiter.timer = setTimeout(() => {
        this.removeWaiter(waiter);
        reject(createQueueTimeoutError(normalizedLogicalAgentId));
      }, this.queueTimeoutMs);

      this.waiters.push(waiter);
      this.drainWaiters();
    });
  }

  release(lease) {
    if (!lease || !lease.workerAgentId) {
      return;
    }

    this.busy.delete(lease.workerAgentId);
    const state = this.ensureWorkerState(lease.workerAgentId);
    state.busy = false;
    state.currentSession = null;
    state.currentLogicalAgentId = null;
    state.currentConversationId = null;
    state.acquiredAt = null;
    state.lastReleasedAt = nowMs();

    this.setSticky(lease.logicalAgentId, lease.conversationId, lease.workerAgentId);
    this.drainWaiters();
  }

  snapshot() {
    const currentTime = nowMs();
    const agents = {};
    for (const [logicalAgentId, workers] of Object.entries(this.agents)) {
      agents[logicalAgentId] = {
        workers: workers.length,
        busy: workers.filter((worker) => this.busy.has(worker)).length,
        queued: this.waiters.filter((waiter) => waiter.logicalAgentId === logicalAgentId).length,
      };
    }

    const configuredWorkers = Object.entries(this.agents).flatMap(([logicalAgentId, workers]) =>
      workers.map((workerAgentId) => ({ logicalAgentId, workerAgentId }))
    );

    return {
      defaultAgentId: this.defaultAgentId,
      workerCount: Object.values(this.agents).reduce((total, workers) => total + workers.length, 0),
      busyWorkers: this.busy.size,
      queueDepth: this.waiters.length,
      agents,
      workers: configuredWorkers.map(({ logicalAgentId, workerAgentId }) =>
        this.workerSnapshot(logicalAgentId, workerAgentId, currentTime)
      ),
      waiters: this.waiters.map((waiter) => ({
        logicalAgentId: waiter.logicalAgentId,
        conversationId: waiter.conversationId,
        sessionId: waiter.sessionId,
        queuedForMs: Math.max(0, currentTime - waiter.enqueuedAt),
      })),
    };
  }

  tryAcquire(logicalAgentId, conversationId) {
    const workers = this.getWorkers(logicalAgentId);
    const workerAgentId = this.pickWorker(logicalAgentId, conversationId, workers);

    if (!workerAgentId) {
      return null;
    }

    this.busy.add(workerAgentId);
    const state = this.ensureWorkerState(workerAgentId);
    const acquiredAt = nowMs();
    state.busy = true;
    state.currentSession = buildSessionId(logicalAgentId, conversationId);
    state.currentLogicalAgentId = logicalAgentId;
    state.currentConversationId = conversationId;
    state.acquiredAt = acquiredAt;

    return {
      logicalAgentId,
      conversationId,
      workerAgentId,
      sessionId: state.currentSession,
      acquiredAt,
    };
  }

  pickWorker(logicalAgentId, conversationId, workers) {
    const key = stickyKey(logicalAgentId, conversationId);
    const sticky = this.sticky.get(key);

    if (sticky && sticky.expiresAt > nowMs() && workers.includes(sticky.workerAgentId)) {
      if (!this.busy.has(sticky.workerAgentId)) {
        return sticky.workerAgentId;
      }
    } else if (sticky) {
      this.sticky.delete(key);
    }

    const freeWorkers = workers.filter((worker) => !this.busy.has(worker));
    if (!freeWorkers.length) {
      return null;
    }

    const stickyWorkers = new Set(
      Array.from(this.sticky.values())
        .filter((entry) => entry.expiresAt > nowMs())
        .map((entry) => entry.workerAgentId)
    );

    return freeWorkers.find((worker) => !stickyWorkers.has(worker)) || freeWorkers[0];
  }

  setSticky(logicalAgentId, conversationId, workerAgentId) {
    if (!this.stickyTtlMs) {
      return;
    }

    this.sticky.set(stickyKey(logicalAgentId, conversationId), {
      workerAgentId,
      expiresAt: nowMs() + this.stickyTtlMs,
    });
  }

  getWorkers(logicalAgentId) {
    if (this.agents[logicalAgentId]?.length) {
      return this.agents[logicalAgentId];
    }

    if (this.agents[this.defaultAgentId]?.length) {
      return this.agents[this.defaultAgentId];
    }

    return [logicalAgentId];
  }

  drainWaiters() {
    for (const waiter of [...this.waiters]) {
      const lease = this.tryAcquire(waiter.logicalAgentId, waiter.conversationId);
      if (!lease) {
        continue;
      }

      this.removeWaiter(waiter);
      waiter.resolve(lease);
    }
  }

  removeWaiter(waiter) {
    const index = this.waiters.indexOf(waiter);
    if (index !== -1) {
      this.waiters.splice(index, 1);
    }
    if (waiter.timer) {
      clearTimeout(waiter.timer);
      waiter.timer = null;
    }
  }

  recordLeaseError(lease, error) {
    if (!lease?.workerAgentId) {
      return;
    }
    const state = this.ensureWorkerState(lease.workerAgentId);
    state.lastError = {
      at: new Date().toISOString(),
      code: error?.code || "",
      statusCode: error?.statusCode || 0,
      message: String(error?.message || "Unknown error").slice(0, 500),
      sessionId: lease.sessionId || buildSessionId(lease.logicalAgentId, lease.conversationId),
    };
  }

  ensureWorkerState(workerAgentId) {
    if (!this.workerState.has(workerAgentId)) {
      this.workerState.set(workerAgentId, {
        busy: false,
        currentSession: null,
        currentLogicalAgentId: null,
        currentConversationId: null,
        acquiredAt: null,
        lastReleasedAt: this.startedAt,
        lastError: null,
      });
    }
    return this.workerState.get(workerAgentId);
  }

  workerSnapshot(configuredLogicalAgentId, workerAgentId, currentTime) {
    const state = this.ensureWorkerState(workerAgentId);
    const boundSessions = this.boundSessionsForWorker(workerAgentId, currentTime);
    return {
      logicalAgentId: configuredLogicalAgentId,
      workerAgentId,
      busy: state.busy,
      currentSession: state.currentSession,
      currentLogicalAgentId: state.currentLogicalAgentId,
      currentConversationId: state.currentConversationId,
      boundSessions,
      busyForMs: state.busy && state.acquiredAt ? Math.max(0, currentTime - state.acquiredAt) : 0,
      idleForMs: state.busy ? 0 : Math.max(0, currentTime - (state.lastReleasedAt || this.startedAt)),
      lastError: state.lastError,
    };
  }

  boundSessionsForWorker(workerAgentId, currentTime) {
    const sessions = [];
    for (const [key, sticky] of this.sticky.entries()) {
      if (sticky.workerAgentId !== workerAgentId) {
        continue;
      }
      if (sticky.expiresAt <= currentTime) {
        continue;
      }
      const { logicalAgentId, conversationId } = parseStickyKey(key);
      sessions.push({
        logicalAgentId,
        conversationId,
        sessionId: buildSessionId(logicalAgentId, conversationId),
        stickyExpiresInMs: Math.max(0, sticky.expiresAt - currentTime),
      });
    }
    return sessions;
  }
}

function normalizeAgents(agents, defaultAgentId) {
  const normalized = {};
  const source = agents && typeof agents === "object" ? agents : {};

  for (const [logicalAgentId, workerList] of Object.entries(source)) {
    const key = normalizeAgentId(logicalAgentId, defaultAgentId);
    const workers = Array.isArray(workerList)
      ? workerList
      : workerList && typeof workerList === "object" && Array.isArray(workerList.workers)
        ? workerList.workers
        : String(workerList || "").split(",");
    normalized[key] = workers.map((worker) => normalizeAgentId(worker, "")).filter(Boolean);
  }

  if (!Object.keys(normalized).length) {
    normalized[defaultAgentId] = [defaultAgentId];
  }

  return normalized;
}

function normalizeConversationId(value) {
  return String(value || "").trim() || "unknown";
}

function stickyKey(logicalAgentId, conversationId) {
  return `${logicalAgentId}::${conversationId}`;
}

function parseStickyKey(key) {
  const separatorIndex = key.indexOf("::");
  if (separatorIndex === -1) {
    return {
      logicalAgentId: key,
      conversationId: "unknown",
    };
  }
  return {
    logicalAgentId: key.slice(0, separatorIndex),
    conversationId: key.slice(separatorIndex + 2),
  };
}

function buildSessionId(logicalAgentId, conversationId) {
  return `bridge_${logicalAgentId}_${conversationId}`;
}

module.exports = {
  AgentPool,
  buildSessionId,
  createQueueTimeoutError,
  normalizeAgents,
};
