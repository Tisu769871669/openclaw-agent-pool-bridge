const { removeCurrentMessageFromContext } = require("./message");

class DebounceQueue {
  constructor(options = {}) {
    this.enabled = Boolean(options.enabled);
    this.windowMs = Math.max(0, Number(options.windowMs || 0));
    this.maxWaitMs = Math.max(this.windowMs, Number(options.maxWaitMs || 0));
    this.maxMessages = Math.max(1, Math.floor(Number(options.maxMessages || 20)));
    this.batches = new Map();
    this.completedBatches = 0;
    this.mergedMessages = 0;
  }

  run(logicalAgentId, conversationId, normalized, task) {
    if (!this.enabled || this.windowMs <= 0) {
      return task(normalized);
    }

    const key = `${logicalAgentId || "main"}::${conversationId || "unknown"}`;
    const batch = this.getOrCreateBatch(key, logicalAgentId, conversationId, task);
    return new Promise((resolve, reject) => {
      batch.items.push(normalized);
      batch.waiters.push({ resolve, reject });
      if (batch.items.length >= this.maxMessages) {
        this.flush(key);
        return;
      }
      this.scheduleQuietFlush(key, batch);
    });
  }

  snapshot() {
    const currentTime = Date.now();
    const batches = Array.from(this.batches.entries()).map(([key, batch]) => ({
      key,
      logicalAgentId: batch.logicalAgentId,
      conversationId: batch.conversationId,
      messages: batch.items.length,
      waiters: batch.waiters.length,
      ageMs: Math.max(0, currentTime - batch.createdAt),
    }));

    return {
      enabled: this.enabled,
      windowMs: this.windowMs,
      maxWaitMs: this.maxWaitMs,
      maxMessages: this.maxMessages,
      pendingBatches: batches.length,
      pendingMessages: batches.reduce((total, item) => total + item.messages, 0),
      completedBatches: this.completedBatches,
      mergedMessages: this.mergedMessages,
      batches,
    };
  }

  getOrCreateBatch(key, logicalAgentId, conversationId, task) {
    const existing = this.batches.get(key);
    if (existing) {
      return existing;
    }

    const batch = {
      logicalAgentId: logicalAgentId || "main",
      conversationId: conversationId || "unknown",
      task,
      items: [],
      waiters: [],
      quietTimer: null,
      maxTimer: null,
      createdAt: Date.now(),
    };
    if (this.maxWaitMs > 0) {
      batch.maxTimer = setTimeout(() => this.flush(key), this.maxWaitMs);
      batch.maxTimer.unref?.();
    }
    this.batches.set(key, batch);
    return batch;
  }

  scheduleQuietFlush(key, batch) {
    if (batch.quietTimer) {
      clearTimeout(batch.quietTimer);
    }
    batch.quietTimer = setTimeout(() => this.flush(key), this.windowMs);
    batch.quietTimer.unref?.();
  }

  async flush(key) {
    const batch = this.batches.get(key);
    if (!batch) {
      return;
    }

    this.batches.delete(key);
    if (batch.quietTimer) {
      clearTimeout(batch.quietTimer);
    }
    if (batch.maxTimer) {
      clearTimeout(batch.maxTimer);
    }

    const merged = mergeNormalizedMessages(batch.items);
    try {
      const result = await batch.task(merged);
      this.completedBatches += 1;
      this.mergedMessages += batch.items.length;
      for (const waiter of batch.waiters) {
        waiter.resolve(result);
      }
    } catch (error) {
      for (const waiter of batch.waiters) {
        waiter.reject(error);
      }
    }
  }
}

function mergeNormalizedMessages(items) {
  const normalizedItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const last = normalizedItems[normalizedItems.length - 1] || {};
  const messages = normalizedItems.map((item) => item.message).filter(Boolean);
  const requestHistories = normalizedItems
    .map((item) => removeCurrentMessageFromContext(item.messageList, item.message))
    .filter((history) => history.length);

  return {
    ...last,
    message: formatDebouncedMessage(messages),
    messageList: [],
    historyOverride: requestHistories.at(-1) || [],
    debouncedMessages: messages,
  };
}

function formatDebouncedMessage(messages) {
  const cleanMessages = (Array.isArray(messages) ? messages : [])
    .map((message) => String(message || "").trim())
    .filter(Boolean);
  if (cleanMessages.length <= 1) {
    return cleanMessages[0] || "";
  }
  const numbered = cleanMessages.map((message, index) => `${index + 1}. ${collapseWhitespace(message)}`).join("\n");
  return [
    `Multiple user messages were received in quick succession. Respond to them together in order:`,
    numbered,
  ].join("\n");
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  DebounceQueue,
  formatDebouncedMessage,
  mergeNormalizedMessages,
};
