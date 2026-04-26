class ConversationQueueManager {
  constructor() {
    this.queues = new Map();
  }

  run(logicalAgentId, conversationId, task) {
    const key = `${logicalAgentId || "main"}::${conversationId || "unknown"}`;
    const entry = this.getOrCreateEntry(key, logicalAgentId, conversationId);
    entry.pending += 1;

    const result = entry.tail.then(async () => {
      entry.pending -= 1;
      entry.active += 1;
      entry.startedAt = Date.now();
      try {
        return await task();
      } finally {
        entry.active -= 1;
        entry.lastFinishedAt = Date.now();
      }
    });
    const nextTail = result.catch(() => {}).finally(() => {
      if (this.queues.get(key) === entry && entry.tail === nextTail && entry.pending === 0 && entry.active === 0) {
        this.queues.delete(key);
      }
    });

    entry.tail = nextTail;

    return result;
  }

  snapshot() {
    const currentTime = Date.now();
    const conversations = Array.from(this.queues.entries()).map(([key, entry]) => ({
      key,
      logicalAgentId: entry.logicalAgentId,
      conversationId: entry.conversationId,
      active: entry.active,
      pending: entry.pending,
      queuedForMs: Math.max(0, currentTime - entry.enqueuedAt),
    }));

    return {
      conversationQueues: this.queues.size,
      activeTurns: conversations.reduce((total, item) => total + item.active, 0),
      queuedTurns: conversations.reduce((total, item) => total + item.pending, 0),
      conversations,
    };
  }

  getOrCreateEntry(key, logicalAgentId, conversationId) {
    const existing = this.queues.get(key);
    if (existing) {
      return existing;
    }

    const entry = {
      logicalAgentId: logicalAgentId || "main",
      conversationId: conversationId || "unknown",
      tail: Promise.resolve(),
      pending: 0,
      active: 0,
      enqueuedAt: Date.now(),
      startedAt: null,
      lastFinishedAt: null,
    };
    this.queues.set(key, entry);
    return entry;
  }
}

module.exports = {
  ConversationQueueManager,
};
