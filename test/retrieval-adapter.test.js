const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createRetrievalAdapter,
  formatRetrievalContext,
  scoreFaqItem,
} = require("../src/retrieval-adapter");

test("disabled retrieval adapter returns empty context", async () => {
  const adapter = createRetrievalAdapter({ enabled: false });

  const result = await adapter.retrieve({ message: "会员多少钱" });

  assert.deepEqual(result, { context: "", hits: [] });
  assert.deepEqual(adapter.snapshot(), {
    enabled: false,
    provider: "none",
  });
});

test("faq retrieval adapter returns top scored FAQ context", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-retrieval-"));
  const faqFile = path.join(dir, "faq.json");
  fs.writeFileSync(
    faqFile,
    JSON.stringify([
      {
        question: "会员费是多少？",
        answer: "会员费是 138 元。",
        keywords: ["会员费", "多少钱", "价格"],
      },
      {
        question: "怎么查询物流？",
        answer: "请提供订单号，我们帮您查询。",
        keywords: ["物流", "快递"],
      },
    ]),
    "utf8"
  );
  const adapter = createRetrievalAdapter({
    enabled: true,
    provider: "faq",
    faqFile,
    topK: 1,
    minScore: 0.5,
  });

  const result = await adapter.retrieve({ message: "会员多少钱" });

  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].question, "会员费是多少？");
  assert.match(result.context, /会员费是 138 元/);
  assert.equal(adapter.snapshot().lastHitCount, 1);
});

test("rag retrieval adapter posts query to an endpoint", async () => {
  const requests = [];
  const adapter = createRetrievalAdapter({
    enabled: true,
    provider: "rag",
    ragEndpoint: "https://rag.example.test/search",
    topK: 2,
    minScore: 0.7,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          hits: [
            {
              title: "会员 FAQ",
              text: "会员费是 138 元。",
              score: 0.91,
              source: "faq",
            },
          ],
        }),
      };
    },
  });

  const result = await adapter.retrieve({
    logicalAgentId: "main",
    conversationId: "customer-1",
    userId: "user-1",
    message: "会员多少钱",
  });

  assert.equal(requests[0].url, "https://rag.example.test/search");
  assert.equal(JSON.parse(requests[0].options.body).query, "会员多少钱");
  assert.equal(JSON.parse(requests[0].options.body).topK, 2);
  assert.match(result.context, /会员费是 138 元/);
});

test("formatRetrievalContext keeps empty hits empty", () => {
  assert.equal(formatRetrievalContext([]), "");
});

test("scoreFaqItem prefers keyword matches", () => {
  assert.equal(
    scoreFaqItem({ question: "会员费是多少？", answer: "138 元", keywords: ["会员费"] }, "会员费"),
    1
  );
});
