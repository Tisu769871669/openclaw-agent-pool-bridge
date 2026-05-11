const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

class Image2ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "Image2ApiError";
    this.status = options.status;
    this.body = options.body;
    this.retryable = Boolean(options.retryable);
  }
}

function cleanText(value) {
  return String(value || "").trim();
}

function redactSecret(text, secret) {
  let output = String(text || "");
  const token = cleanText(secret);
  if (token) {
    output = output.split(token).join("[REDACTED]");
  }
  return output.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]");
}

function joinUrl(baseUrl, suffix) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(suffix || "").replace(/^\/+/, "")}`;
}

function getContentType(headers) {
  if (!headers) return "";
  if (typeof headers.get === "function") return cleanText(headers.get("content-type"));
  if (headers instanceof Map) return cleanText(headers.get("content-type"));
  return cleanText(headers["content-type"] || headers["Content-Type"]);
}

function parseNonNegativeInteger(value, fallback = 0) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function isTransientStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function shouldRetry(error) {
  if (error instanceof Image2ApiError) return error.retryable;
  return true;
}

function responseShape(data, item) {
  const responseKeys = data && typeof data === "object" ? Object.keys(data).join(",") : "";
  const itemKeys = item && typeof item === "object" ? Object.keys(item).join(",") : "";
  return `response keys: ${responseKeys || "(none)"}; item keys: ${itemKeys || "(none)"}`;
}

function parseJson(text, apiKey) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const safeText = redactSecret(text, apiKey);
    throw new Image2ApiError(`Image2 API returned invalid JSON: ${safeText}`, { body: safeText });
  }
}

class Image2Client {
  constructor(options = {}) {
    this.apiKey = cleanText(options.apiKey);
    this.baseUrl = cleanText(options.baseUrl || "https://api.openai.com/v1");
    this.timeoutMs = parseNonNegativeInteger(options.timeoutMs, 0);
    this.maxRetries = parseNonNegativeInteger(options.maxRetries, 0);
    this.fetchImpl = options.fetchImpl || selectFetchImpl(options);

    if (!this.apiKey) throw new Error("image2 api key is required");
    if (typeof this.fetchImpl !== "function") throw new Error("fetch implementation is required");
  }

  async generateImage(image) {
    let generated;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        generated = await this.requestGeneration(image);
        break;
      } catch (error) {
        if (attempt >= this.maxRetries || !shouldRetry(error)) throw error;
      }
    }

    if (generated.url) return this.downloadImage(generated.url);
    return generated;
  }

  async requestGeneration(image) {
    const payload = {
      model: cleanText(image?.model),
      prompt: cleanText(image?.prompt),
      size: cleanText(image?.size),
    };

    const response = await this.fetchWithTimeout(joinUrl(this.baseUrl, "/images/generations"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    if (!response.ok) {
      const safeText = redactSecret(text, this.apiKey);
      throw new Image2ApiError(`Image2 API error ${response.status}: ${safeText}`, {
        status: response.status,
        body: safeText,
        retryable: isTransientStatus(response.status),
      });
    }

    const data = parseJson(text, this.apiKey);
    const item = Array.isArray(data?.data) ? data.data[0] : undefined;
    if (item?.b64_json) {
      return {
        buffer: Buffer.from(item.b64_json, "base64"),
        contentType: "image/png",
        source: "b64_json",
      };
    }
    if (item?.url) {
      return { url: item.url };
    }

    throw new Image2ApiError(`Image2 API response did not include b64_json or url (${responseShape(data, item)})`, {
      status: response.status,
      body: redactSecret(text, this.apiKey),
    });
  }

  async downloadImage(url) {
    const response = await this.fetchWithTimeout(url);
    const textForError = async () => {
      if (typeof response.text === "function") return response.text();
      return "";
    };

    if (!response.ok) {
      const body = redactSecret(await textForError(), this.apiKey);
      throw new Image2ApiError(`Image2 image download error ${response.status}: ${body}`, {
        status: response.status,
        body,
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: getContentType(response.headers) || "image/png",
      source: "url",
    };
  }

  async fetchWithTimeout(url, options = {}) {
    if (!this.timeoutMs) return this.fetchImpl(url, options);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, {
        ...options,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function selectFetchImpl(options = {}) {
  if (cleanText(options.fetchImplName).toLowerCase() === "curl") {
    return createCurlFetch({
      timeoutMs: options.timeoutMs,
    });
  }
  return globalThis.fetch;
}

function createCurlFetch(options = {}) {
  const timeoutMs = parseNonNegativeInteger(options.timeoutMs, 0);
  const timeoutSeconds = timeoutMs > 0 ? Math.max(1, Math.ceil(timeoutMs / 1000)) : 0;
  return async function curlFetch(url, request = {}) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "image2-curl-"));
    const headersPath = path.join(tempDir, "headers.txt");
    const bodyPath = path.join(tempDir, "body.bin");
    try {
      const config = buildCurlConfig(url, request);
      const args = [
        "--silent",
        "--show-error",
        "--location",
        "--dump-header",
        headersPath,
        "--output",
        bodyPath,
        "--write-out",
        "%{http_code}",
        "--config",
        "-",
      ];
      if (timeoutSeconds > 0) {
        args.splice(args.length - 2, 0, "--max-time", String(timeoutSeconds));
      }
      const result = spawnSync("curl", args, {
        input: config,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Image2ApiError(`curl exited with code ${result.status}: ${result.stderr || ""}`.trim(), {
          body: result.stderr || "",
          retryable: true,
        });
      }
      const status = Number.parseInt(String(result.stdout || "").trim(), 10) || 0;
      const body = fs.existsSync(bodyPath) ? fs.readFileSync(bodyPath) : Buffer.alloc(0);
      const headers = parseCurlHeaders(fs.existsSync(headersPath) ? fs.readFileSync(headersPath, "utf8") : "");
      return {
        ok: status >= 200 && status < 300,
        status,
        headers,
        async text() {
          return body.toString("utf8");
        },
        async arrayBuffer() {
          return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
        },
      };
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function buildCurlConfig(url, request = {}) {
  const lines = [`url = ${quoteCurlConfigValue(url)}`];
  if (request.method) {
    lines.push(`request = ${quoteCurlConfigValue(request.method)}`);
  }
  const headers = request.headers || {};
  for (const [key, value] of Object.entries(headers)) {
    lines.push(`header = ${quoteCurlConfigValue(`${key}: ${value}`)}`);
  }
  if (request.body !== undefined) {
    lines.push(`data = ${quoteCurlConfigValue(String(request.body))}`);
  }
  return `${lines.join("\n")}\n`;
}

function quoteCurlConfigValue(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseCurlHeaders(raw) {
  const blocks = String(raw || "").trim().split(/\r?\n\r?\n/).filter(Boolean);
  const last = blocks[blocks.length - 1] || "";
  const map = new Map();
  for (const line of last.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    map.set(line.slice(0, index).trim().toLowerCase(), line.slice(index + 1).trim());
  }
  return {
    get(name) {
      return map.get(String(name || "").toLowerCase()) || "";
    },
  };
}

module.exports = {
  createCurlFetch,
  Image2ApiError,
  Image2Client,
  redactSecret,
};
