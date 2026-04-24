class ConversationQueueManager {
  constructor() {
    this.queues = new Map();
  }

  run(logicalAgentId, conversationId, task) {
    const key = `${logicalAgentId || "main"}::${conversationId || "unknown"}`;
    const tail = this.queues.get(key) || Promise.resolve();
    const result = tail.then(() => task());
    const nextTail = result.catch(() => {}).finally(() => {
      if (this.queues.get(key) === nextTail) {
        this.queues.delete(key);
      }
    });

    this.queues.set(key, nextTail);

    return result;
  }

  snapshot() {
    return {
      conversationQueues: this.queues.size,
    };
  }
}

module.exports = {
  ConversationQueueManager,
};
