const test = require("node:test");
const assert = require("node:assert/strict");

const { Image2Client, Image2ApiError, redactSecret } = require("../../skills/article-image-generator/scripts/lib/image2-client");

test("redactSecret removes bearer token values", () => {
  assert.equal(redactSecret("Authorization: Bearer secret-token-value", "secret-token-value"), "Authorization: Bearer [REDACTED]");
});

test("generateImage returns bytes from b64_json response", async () => {
  const client = new Image2Client({
    apiKey: "secret",
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.example.test/v1/images/generations");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer secret");
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, "gpt-image-2");
      assert.equal(payload.prompt, "A cover image");
      assert.equal(payload.size, "1024x1024");
      return jsonResponse({ data: [{ b64_json: Buffer.from("png-bytes").toString("base64") }] });
    },
    baseUrl: "https://api.example.test/v1",
  });

  const result = await client.generateImage({
    model: "gpt-image-2",
    prompt: "A cover image",
    size: "1024x1024",
  });

  assert.deepEqual(result.buffer, Buffer.from("png-bytes"));
  assert.equal(result.source, "b64_json");
});

test("generateImage downloads image URL responses", async () => {
  const client = new Image2Client({
    apiKey: "secret",
    baseUrl: "https://api.example.test/v1",
    fetchImpl: async (url) => {
      if (String(url).includes("/images/generations")) {
        return jsonResponse({ data: [{ url: "https://cdn.example.test/image.png" }] });
      }
      assert.equal(url, "https://cdn.example.test/image.png");
      return {
        ok: true,
        status: 200,
        headers: new Map([["content-type", "image/png"]]),
        async arrayBuffer() {
          return Buffer.from("downloaded-image");
        },
        async text() {
          return "downloaded-image";
        },
      };
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2",
    prompt: "A body image",
    size: "1024x1024",
  });

  assert.deepEqual(result.buffer, Buffer.from("downloaded-image"));
  assert.equal(result.source, "url");
});

test("generateImage throws useful redacted API error", async () => {
  const client = new Image2Client({
    apiKey: "secret-token",
    baseUrl: "https://api.example.test/v1",
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      async text() {
        return JSON.stringify({ error: { message: "bad key secret-token" } });
      },
    }),
  });

  await assert.rejects(
    () => client.generateImage({ model: "gpt-image-2", prompt: "x", size: "1024x1024" }),
    (error) => {
      assert.equal(error instanceof Image2ApiError, true);
      assert.match(error.message, /Image2 API error 401/);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    }
  );
});

test("generateImage retries transient API failures", async () => {
  let calls = 0;
  const client = new Image2Client({
    apiKey: "secret",
    baseUrl: "https://api.example.test/v1",
    maxRetries: 1,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: false,
          status: 500,
          async text() {
            return "temporary failure";
          },
        };
      }
      return jsonResponse({ data: [{ b64_json: Buffer.from("retry-ok").toString("base64") }] });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2",
    prompt: "retry image",
    size: "1024x1024",
  });

  assert.equal(calls, 2);
  assert.deepEqual(result.buffer, Buffer.from("retry-ok"));
});

test("generateImage passes an abort signal when timeout is configured", async () => {
  const client = new Image2Client({
    apiKey: "secret",
    baseUrl: "https://api.example.test/v1",
    timeoutMs: 1000,
    fetchImpl: async (url, options) => {
      assert.equal(String(url).includes("/images/generations"), true);
      assert.equal(typeof options.signal.aborted, "boolean");
      return jsonResponse({ data: [{ b64_json: Buffer.from("timeout-ok").toString("base64") }] });
    },
  });

  const result = await client.generateImage({
    model: "gpt-image-2",
    prompt: "timeout image",
    size: "1024x1024",
  });

  assert.deepEqual(result.buffer, Buffer.from("timeout-ok"));
});

test("generateImage reports response keys for unsupported response shapes", async () => {
  const client = new Image2Client({
    apiKey: "secret",
    baseUrl: "https://api.example.test/v1",
    fetchImpl: async () => jsonResponse({ created: 1, data: [{ revised_prompt: "x" }] }),
  });

  await assert.rejects(
    () => client.generateImage({ model: "gpt-image-2", prompt: "x", size: "1024x1024" }),
    /response keys: created,data; item keys: revised_prompt/
  );
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    headers: new Map([["content-type", "application/json"]]),
    async text() {
      return JSON.stringify(payload);
    },
  };
}
