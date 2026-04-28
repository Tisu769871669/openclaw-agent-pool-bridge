class Image2ApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "Image2ApiError";
    this.status = options.status;
    this.body = options.body;
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

    if (!this.apiKey) throw new Error("image2 api key is required");
    if (typeof this.fetchImpl !== "function") throw new Error("fetch implementation is required");
  }

  async generateImage(image) {
    const payload = {
      model: cleanText(image?.model),
      prompt: cleanText(image?.prompt),
      size: cleanText(image?.size),
    };

    const response = await this.fetchImpl(joinUrl(this.baseUrl, "/images/generations"), {
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
      return this.downloadImage(item.url);
    }

    throw new Image2ApiError("Image2 API response did not include b64_json or url", {
      status: response.status,
      body: redactSecret(text, this.apiKey),
    });
  }

  async downloadImage(url) {
    const response = await this.fetchImpl(url);
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
}

module.exports = {
  Image2ApiError,
  Image2Client,
  redactSecret,
};
