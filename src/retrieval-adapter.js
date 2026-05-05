const fs = require("node:fs");
const path = require("node:path");

function createRetrievalAdapter(options = {}) {
  if (!options.enabled) {
    return new NoopRetrievalAdapter();
  }

  const provider = cleanText(options.provider || "faq").toLowerCase();
  if (!provider || provider === "none") {
    return new NoopRetrievalAdapter();
  }
  if (provider === "faq") {
    return new FaqRetrievalAdapter(options);
  }
  if (provider === "rag") {
    return new RagEndpointRetrievalAdapter(options);
  }
  if (provider === "dify") {
    return new RagEndpointRetrievalAdapter({
      ...options,
      provider: "dify",
      requestFormat: options.requestFormat || "dify-workflow",
    });
  }
  throw new Error(`Unsupported RETRIEVAL_PROVIDER: ${provider}`);
}

class NoopRetrievalAdapter {
  async retrieve() {
    return emptyRetrieval();
  }

  snapshot() {
    return {
      enabled: false,
      provider: "none",
    };
  }
}

class FaqRetrievalAdapter {
  constructor(options = {}) {
    if (!cleanText(options.faqFile)) {
      throw new Error("FAQ_FILE is required when RETRIEVAL_PROVIDER=faq");
    }
    this.faqFile = path.resolve(options.faqFile);
    if (!fs.existsSync(this.faqFile)) {
      throw new Error(`FAQ_FILE not found: ${this.faqFile}`);
    }
    this.topK = positiveInteger(options.topK, 3);
    this.minScore = finiteNumber(options.minScore, 0.65);
    this.cachedMtimeMs = -1;
    this.cachedItems = [];
    this.lastHitCount = 0;
    this.lastError = null;
  }

  async retrieve(input = {}) {
    const items = this.readItems();
    const hits = items
      .map((item) => ({ ...normalizeFaqItem(item), score: scoreFaqItem(item, input.message) }))
      .filter((hit) => hit.score >= this.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, this.topK);

    this.lastHitCount = hits.length;
    this.lastError = null;
    return {
      context: formatRetrievalContext(hits),
      hits,
    };
  }

  snapshot() {
    return {
      enabled: true,
      provider: "faq",
      faqFile: this.faqFile,
      topK: this.topK,
      minScore: this.minScore,
      lastHitCount: this.lastHitCount,
      lastError: this.lastError,
    };
  }

  recordError(error) {
    this.lastError = serializeError(error);
  }

  readItems() {
    const stat = fs.statSync(this.faqFile);
    if (stat.mtimeMs !== this.cachedMtimeMs) {
      this.cachedItems = parseFaqFile(fs.readFileSync(this.faqFile, "utf8"));
      this.cachedMtimeMs = stat.mtimeMs;
    }
    return this.cachedItems;
  }
}

class RagEndpointRetrievalAdapter {
  constructor(options = {}) {
    if (!cleanText(options.ragEndpoint)) {
      throw new Error("RAG_ENDPOINT is required when RETRIEVAL_PROVIDER=rag or dify");
    }
    this.provider = cleanText(options.provider || "rag").toLowerCase();
    this.ragEndpoint = cleanText(options.ragEndpoint);
    this.ragApiKey = cleanText(options.ragApiKey || options.apiKey);
    this.requestFormat = normalizeRagRequestFormat(
      options.requestFormat || options.ragRequestFormat || (this.provider === "dify" ? "dify-workflow" : "generic")
    );
    if (this.requestFormat === "dify-workflow" && !this.ragApiKey) {
      throw new Error("RAG_API_KEY is required when RAG_REQUEST_FORMAT=dify-workflow");
    }
    this.topK = positiveInteger(options.topK, 3);
    this.minScore = finiteNumber(options.minScore, 0.65);
    this.fetch = options.fetch || globalThis.fetch;
    if (typeof this.fetch !== "function") {
      throw new Error("fetch is required when RETRIEVAL_PROVIDER=rag");
    }
    this.lastHitCount = 0;
    this.lastError = null;
  }

  async retrieve(input = {}) {
    const response = await this.fetch(this.ragEndpoint, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(this.buildBody(input)),
    });
    if (!response.ok) {
      throw new Error(`RAG endpoint returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    const result = normalizeRagResponse(payload, this.requestFormat);
    this.lastHitCount = result.hits.length || countContextHits(result.context);
    this.lastError = null;
    return result;
  }

  snapshot() {
    return {
      enabled: true,
      provider: this.provider,
      ragEndpoint: this.ragEndpoint,
      requestFormat: this.requestFormat,
      topK: this.topK,
      minScore: this.minScore,
      lastHitCount: this.lastHitCount,
      lastError: this.lastError,
    };
  }

  recordError(error) {
    this.lastError = serializeError(error);
  }

  buildHeaders() {
    const headers = {
      "Content-Type": "application/json",
    };
    if (this.ragApiKey) {
      headers.Authorization = `Bearer ${this.ragApiKey}`;
    }
    return headers;
  }

  buildBody(input = {}) {
    if (this.requestFormat === "dify-workflow") {
      return {
        inputs: {
          query: cleanText(input.message),
          logical_agent_id: cleanText(input.logicalAgentId),
          conversation_id: cleanText(input.conversationId),
          user_id: cleanText(input.userId),
          top_k: this.topK,
          min_score: this.minScore,
        },
        response_mode: "blocking",
        user: cleanText(input.userId || input.conversationId || input.logicalAgentId || "openclaw-agent-pool-bridge"),
      };
    }

    return {
      query: cleanText(input.message),
      logicalAgentId: cleanText(input.logicalAgentId),
      conversationId: cleanText(input.conversationId),
      userId: cleanText(input.userId),
      topK: this.topK,
      minScore: this.minScore,
    };
  }
}

function parseFaqFile(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (Array.isArray(parsed.items)) {
    return parsed.items;
  }
  if (Array.isArray(parsed.faqs)) {
    return parsed.faqs;
  }
  throw new Error("FAQ_FILE must be a JSON array or an object with items/faqs");
}

function normalizeFaqItem(item = {}) {
  if (typeof item === "string") {
    return {
      title: "",
      question: "",
      answer: item,
      text: item,
      source: "",
      keywords: [],
    };
  }
  return {
    title: cleanText(item.title),
    question: cleanText(item.question || item.q),
    answer: cleanText(item.answer || item.a || item.content || item.text),
    text: cleanText(item.text || item.content || item.answer || item.a),
    source: cleanText(item.source),
    keywords: normalizeKeywords(item.keywords),
  };
}

function normalizeRetrievalHits(hits) {
  if (!Array.isArray(hits)) {
    return [];
  }
  return hits.map((hit) => ({
    title: cleanText(hit.title),
    question: cleanText(hit.question || hit.q),
    answer: cleanText(hit.answer || hit.a || hit.text || hit.content),
    text: cleanText(hit.text || hit.content || hit.answer || hit.a),
    source: cleanText(hit.source),
    score: finiteNumber(hit.score, 0),
  }));
}

function normalizeRagResponse(payload = {}, requestFormat = "generic") {
  if (requestFormat === "dify-workflow") {
    const status = cleanText(payload?.data?.status).toLowerCase();
    if (status && status !== "succeeded") {
      throw new Error(`Dify workflow status ${status}`);
    }
  }

  const outputs = payload?.data?.outputs && typeof payload.data.outputs === "object"
    ? payload.data.outputs
    : {};
  const outputHits = firstPresent([
    outputs.hits,
    outputs.hits_json,
    outputs.resultArray,
    outputs.result,
    outputs.records,
    outputs.documents,
  ]);
  const rootHits = firstPresent([
    payload.hits,
    payload.hits_json,
    payload.resultArray,
    payload.result,
    payload.records,
    payload.documents,
  ]);
  const hits = normalizeRetrievalHits(parseHits(outputHits) || parseHits(rootHits) || []);
  const context = cleanText(
    outputs.answer_context ||
    outputs.context ||
    outputs.retrieval_context ||
    payload.answer_context ||
    payload.context ||
    payload.retrieval_context
  ) || formatRetrievalContext(hits);

  return {
    context,
    hits,
  };
}

function parseHits(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object") {
    for (const key of ["hits", "items", "result", "resultArray", "records", "documents"]) {
      if (Array.isArray(value[key])) {
        return value[key];
      }
    }
  }
  return null;
}

function firstPresent(values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function normalizeRagRequestFormat(value) {
  const format = cleanText(value || "generic").toLowerCase();
  if (["generic", "http", "rag"].includes(format)) {
    return "generic";
  }
  if (["dify", "dify-workflow", "workflow"].includes(format)) {
    return "dify-workflow";
  }
  throw new Error(`Unsupported RAG_REQUEST_FORMAT: ${format}`);
}

function countContextHits(context) {
  const text = cleanText(context);
  if (!text) {
    return 0;
  }
  const matches = text.match(/\[知识\d+\]/g) || text.match(/^\[\d+\]/gm);
  return matches?.length || 1;
}

function scoreFaqItem(item, query) {
  const normalized = normalizeFaqItem(item);
  const text = cleanText(query).toLowerCase();
  if (!text) {
    return 0;
  }

  for (const keyword of normalized.keywords) {
    const needle = keyword.toLowerCase();
    if (needle && (text.includes(needle) || needle.includes(text))) {
      return 1;
    }
  }

  const question = normalized.question.toLowerCase();
  const title = normalized.title.toLowerCase();
  const answer = normalized.answer.toLowerCase();
  if ((question && question.includes(text)) || (title && title.includes(text))) {
    return 0.95;
  }
  if (answer && answer.includes(text)) {
    return 0.75;
  }

  const searchText = [normalized.title, normalized.question, normalized.answer, ...normalized.keywords]
    .join("")
    .toLowerCase();
  return charOverlapScore(text, searchText);
}

function charOverlapScore(query, searchText) {
  const queryChars = uniqueChars(query);
  if (!queryChars.length) {
    return 0;
  }
  const haystack = new Set(uniqueChars(searchText));
  const matched = queryChars.filter((char) => haystack.has(char));
  return matched.length / queryChars.length;
}

function formatRetrievalContext(hits) {
  if (!Array.isArray(hits) || !hits.length) {
    return "";
  }
  return hits
    .map((hit, index) => {
      const lines = [`[${index + 1}] ${cleanText(hit.title || hit.source || "retrieval hit")}`];
      if (hit.question) {
        lines.push(`Q: ${hit.question}`);
      }
      const answer = cleanText(hit.answer || hit.text);
      if (answer) {
        lines.push(`A: ${answer}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function emptyRetrieval() {
  return { context: "", hits: [] };
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean);
  }
  return cleanText(value).split(/[,\s，、]+/).map(cleanText).filter(Boolean);
}

function uniqueChars(value) {
  return [...new Set(cleanText(value).replace(/\s+/g, "").split(""))];
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function serializeError(error) {
  return {
    code: cleanText(error?.code || error?.name || "Error"),
    message: cleanText(error?.message || error),
  };
}

function cleanText(value) {
  return String(value || "").trim();
}

module.exports = {
  FaqRetrievalAdapter,
  NoopRetrievalAdapter,
  RagEndpointRetrievalAdapter,
  createRetrievalAdapter,
  formatRetrievalContext,
  scoreFaqItem,
};
