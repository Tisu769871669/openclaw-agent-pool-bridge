const { createApiError } = require("./errors");

const DEFAULT_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

async function readParsedBody(req, options = {}) {
  const limitBytes = Number(options.limitBytes || DEFAULT_BODY_LIMIT_BYTES);
  const raw = await readRawBody(req, limitBytes);
  const rawContentType = String(req.headers["content-type"] || "");
  const contentType = rawContentType.toLowerCase();

  if (!raw.length) {
    return { type: "empty", body: {}, fields: {}, files: [] };
  }

  if (contentType.includes("application/json")) {
    try {
      return { type: "json", body: JSON.parse(raw.toString("utf8")), fields: {}, files: [] };
    } catch {
      throw createApiError(400, "invalid_request", "Invalid JSON body");
    }
  }

  if (contentType.includes("multipart/form-data")) {
    const boundary = parseMultipartBoundary(rawContentType);
    if (!boundary) {
      throw createApiError(400, "invalid_request", "multipart boundary is required");
    }
    return { type: "multipart", body: {}, ...parseMultipartBody(raw, boundary) };
  }

  if (
    contentType.includes("text/") ||
    contentType.includes("markdown") ||
    contentType.includes("application/octet-stream")
  ) {
    return {
      type: "text",
      body: {},
      fields: { content: raw.toString("utf8") },
      files: [],
    };
  }

  throw createApiError(415, "unsupported_media_type", "Use JSON, text/plain, or multipart/form-data");
}

function readRawBody(req, limitBytes = DEFAULT_BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;

    req.on("data", (chunk) => {
      length += chunk.length;
      if (length > limitBytes) {
        reject(createApiError(413, "invalid_request", "Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipartBoundary(contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return match ? String(match[1] || match[2] || "").trim() : "";
}

function parseMultipartBody(raw, boundary) {
  const fields = {};
  const files = [];
  const delimiter = `--${boundary}`;
  const parts = raw.toString("utf8").split(delimiter).slice(1, -1);

  for (let part of parts) {
    if (part.startsWith("\r\n")) {
      part = part.slice(2);
    }
    if (part.endsWith("\r\n")) {
      part = part.slice(0, -2);
    }

    const splitIndex = part.indexOf("\r\n\r\n");
    if (splitIndex === -1) {
      continue;
    }

    const headerText = part.slice(0, splitIndex);
    const content = part.slice(splitIndex + 4);
    const headers = parsePartHeaders(headerText);
    const disposition = headers["content-disposition"] || "";
    const fieldName = parseDispositionValue(disposition, "name");
    if (!fieldName) {
      continue;
    }

    const filename = parseDispositionValue(disposition, "filename");
    if (filename) {
      files.push({
        fieldName,
        filename,
        content,
        contentType: headers["content-type"] || "application/octet-stream",
      });
    } else {
      fields[fieldName] = content;
    }
  }

  return { fields, files };
}

function parsePartHeaders(headerText) {
  const headers = {};
  for (const line of headerText.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index === -1) {
      continue;
    }
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function parseDispositionValue(disposition, key) {
  const pattern = new RegExp(`${key}="([^"]*)"`, "i");
  const quoted = pattern.exec(disposition);
  if (quoted) {
    return quoted[1];
  }
  const bare = new RegExp(`${key}=([^;]+)`, "i").exec(disposition);
  return bare ? bare[1].trim() : "";
}

module.exports = {
  DEFAULT_BODY_LIMIT_BYTES,
  parseMultipartBody,
  parseMultipartBoundary,
  readParsedBody,
  readRawBody,
};
