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
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = parseNonNegativeInteger(options.timeoutMs, 0);
    this.maxRetries = parseNonNegativeInteger(options.maxRetries, 0);

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

module.exports = {
  Image2ApiError,
  Image2Client,
  redactSecret,
};
