const { getPlatformConfig } = require("./payloads");

class MetastImApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "MetastImApiError";
    this.status = details.status;
    this.payload = details.payload;
    this.url = details.url;
  }
}

class MetastImClient {
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl || "https://lx.metast.cn").replace(/\/+$/, "");
    this.mcpKey = options.mcpKey;
    this.mcpSecret = options.mcpSecret;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof this.fetchImpl !== "function") {
      throw new Error("fetch is not available; pass fetchImpl explicitly");
    }
  }

  async listFriends(platform, query = {}) {
    return this.requestJson("GET", getPlatformConfig(platform).friendsPath, { query });
  }

  async submitSopTask(platform, task) {
    return this.requestJson("POST", getPlatformConfig(platform).sopPath, { body: task });
  }

  async submitMoment(platform, moment) {
    return this.requestJson("POST", getPlatformConfig(platform).momentPath, { body: moment });
  }

  async postCustom(path, body) {
    return this.requestJson("POST", path, { body });
  }

  async requestJson(method, requestPath, options = {}) {
    const url = new URL(requestPath, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = {
      mcpKey: this.mcpKey,
      mcpSecret: this.mcpSecret,
    };
    const request = { method, headers };
    if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      request.body = JSON.stringify(options.body);
    }

    const response = await this.fetchImpl(url.toString(), request);
    const text = await response.text();
    const payload = parseJsonMaybe(text);
    if (!response.ok) {
      throw new MetastImApiError(`Metast IM API HTTP ${response.status}`, {
        status: response.status,
        payload,
        url: url.toString(),
      });
    }
    if (payload && Object.prototype.hasOwnProperty.call(payload, "code") && !isSuccessCode(payload.code)) {
      throw new MetastImApiError(`Metast IM API error ${payload.code}: ${payload.msg || "unknown error"}`, {
        status: response.status,
        payload,
        url: url.toString(),
      });
    }
    return payload;
  }
}

function isSuccessCode(code) {
  return code === 0 || code === 200 || code === "0" || code === "200";
}

function parseJsonMaybe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { raw: text };
  }
}

module.exports = {
  MetastImApiError,
  MetastImClient,
};
