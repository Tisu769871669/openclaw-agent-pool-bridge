const { removeCurrentMessageFromContext } = require("./message");

class DebounceQueue {
  constructor(options = {}) {
    this.enabled = Boolean(options.enabled);
    this.windowMs = Math.max(0, Number(options.windowMs || 0));
    this.maxWaitMs = Math.max(this.windowMs, Number(options.maxWaitMs || 0));
    this.maxMessages = Math.max(1, Math.floor(Number(options.maxMessages || 20)));
    this.incompleteMessageExtraWaitEnabled = Boolean(options.incompleteMessageExtraWaitEnabled);
    this.incompleteMessageExtraWaitMs = Math.max(0, Number(options.incompleteMessageExtraWaitMs || 0));
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
      incompleteMessageExtraWaitEnabled: this.incompleteMessageExtraWaitEnabled,
      incompleteMessageExtraWaitMs: this.incompleteMessageExtraWaitMs,
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
    }
    this.batches.set(key, batch);
    return batch;
  }

  scheduleQuietFlush(key, batch) {
    if (batch.quietTimer) {
      clearTimeout(batch.quietTimer);
    }
    batch.quietTimer = setTimeout(() => this.flush(key), this.calculateQuietDelayMs(batch));
  }

  calculateQuietDelayMs(batch) {
    const base = this.windowMs;
    const last = batch.items[batch.items.length - 1];
    const extra = this.incompleteMessageExtraWaitEnabled && looksIncompleteMessage(last?.message)
      ? this.incompleteMessageExtraWaitMs
      : 0;
    const desired = base + extra;
    if (!this.maxWaitMs) {
      return desired;
    }
    const elapsed = Math.max(0, Date.now() - batch.createdAt);
    return Math.max(0, Math.min(desired, this.maxWaitMs - elapsed));
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

function looksIncompleteMessage(message) {
  const text = String(message || "").trim();
  if (!text) {
    return false;
  }

  const normalized = text.replace(/\s+/g, "");
  const explicitCompletePatterns = [
    /[?？]$/,
    /(多少钱|怎么卖|有没有|还有吗|怎么吃|怎么用|帮我查|查一下|订单号|快递|发货|退款|售后)/,
    /\d{8,}/,
  ];
  if (explicitCompletePatterns.some((pattern) => pattern.test(normalized))) {
    return false;
  }

  const incompleteTailPatterns = [
    /[，,、:：]$/,
    /(我想问|问一下|我想咨询|就是|然后|还有|另外|那个|这个|嗯|额|呃)$/,
  ];
  if (incompleteTailPatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  if (Array.from(normalized).length <= 4 && !/(你好|您好|谢谢|好的|收到|在吗|早上好|晚上好)/.test(normalized)) {
    return true;
  }

  return false;
}

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

module.exports = {
  DebounceQueue,
  formatDebouncedMessage,
  looksIncompleteMessage,
  mergeNormalizedMessages,
};
