class WeChatApiError extends Error {
  constructor(message, payload = {}) {
    super(message);
    this.name = "WeChatApiError";
    this.payload = payload;
    this.errcode = payload.errcode;
    this.errmsg = payload.errmsg;
  }
}

class WeChatMpClient {
  constructor(options) {
    this.appId = options.appId;
    this.appSecret = options.appSecret;
    this.fetchImpl = options.fetchImpl || fetch;
    this.now = options.now || (() => Date.now());
    this.baseUrl = options.baseUrl || "https://api.weixin.qq.com";
    this.cachedToken = null;
  }

  async getAccessToken() {
    if (this.cachedToken && this.cachedToken.expiresAt > this.now()) {
      return this.cachedToken.value;
    }
    const url = `${this.baseUrl}/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(this.appId)}&secret=${encodeURIComponent(this.appSecret)}`;
    const payload = await this.getJson(url);
    if (!payload.access_token) {
      throw new WeChatApiError("WeChat access_token missing", payload);
    }
    const ttlMs = Math.max(60, Number(payload.expires_in || 7200) - 300) * 1000;
    this.cachedToken = {
      value: payload.access_token,
      expiresAt: this.now() + ttlMs,
    };
    return this.cachedToken.value;
  }

  async addDraft(articles) {
    return this.postJson("/cgi-bin/draft/add", { articles });
  }

  async submitFreePublish(mediaId) {
    return this.postJson("/cgi-bin/freepublish/submit", { media_id: mediaId });
  }

  async getFreePublishStatus(publishId) {
    return this.postJson("/cgi-bin/freepublish/get", { publish_id: publishId });
  }

  async postJson(path, body) {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}${path}?access_token=${encodeURIComponent(token)}`;
    return this.getJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
  }

  async getJson(url, options = {}) {
    const response = await this.fetchImpl(url, options);
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new WeChatApiError(`WeChat returned non-JSON response: ${text.slice(0, 120)}`);
    }
    if (payload.errcode && payload.errcode !== 0) {
      throw new WeChatApiError(`WeChat API error ${payload.errcode}: ${payload.errmsg || ""}`, payload);
    }
    return payload;
  }
}

module.exports = {
  WeChatApiError,
  WeChatMpClient,
};
