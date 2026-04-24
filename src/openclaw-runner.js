const { spawn } = require("node:child_process");

function runOpenClawAgent(options = {}) {
  const openclawBin = String(options.openclawBin || "openclaw").trim();
  const timeoutSeconds = Number(options.timeoutSeconds || 120);
  const args = [
    "agent",
    "--agent",
    options.workerAgentId,
    "--session-id",
    options.runSessionId,
    "--message",
    options.prompt,
    "--json",
    "--timeout",
    String(timeoutSeconds),
  ];

  if (options.thinking) {
    args.push("--thinking", String(options.thinking));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(openclawBin, args, {
      cwd: options.cwd || process.cwd(),
      env: {
        ...process.env,
        OPENCLAW_HIDE_BANNER: "1",
        OPENCLAW_SUPPRESS_NOTES: "1",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32" && openclawBin.toLowerCase().endsWith(".cmd"),
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`openclaw timed out after ${timeoutSeconds}s`));
    }, Math.max(timeoutSeconds, 1) * 1000 + 1000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      const parsed = tryParseJson(stdout);
      const reply = extractReply(parsed, stripAnsi(stdout));
      if (code !== 0) {
        return reject(new Error(stripAnsi(stderr) || `openclaw exited with code ${code}`));
      }
      if (!reply) {
        return reject(new Error("openclaw returned no readable reply"));
      }

      resolve({
        reply,
        raw: parsed || stripAnsi(stdout),
      });
    });
  });
}

function extractReply(payload, fallbackText = "") {
  if (!payload || typeof payload !== "object") {
    return String(fallbackText || "").trim();
  }

  const payloadText = payload?.payloads?.find((item) => typeof item?.text === "string" && item.text.trim())?.text;
  if (payloadText) {
    return payloadText.trim();
  }

  const nestedPayloadText = payload?.result?.payloads?.find(
    (item) => typeof item?.text === "string" && item.text.trim()
  )?.text;
  if (nestedPayloadText) {
    return nestedPayloadText.trim();
  }

  for (const value of [
    payload.reply,
    payload.response,
    payload.content,
    payload.message,
    payload.output_text,
    payload.text,
    payload?.data?.reply,
    payload?.data?.response,
    payload?.result?.reply,
    payload?.result?.content,
  ]) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return String(fallbackText || "").trim();
}

function tryParseJson(raw) {
  const text = stripAnsi(raw).trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
}

module.exports = {
  extractReply,
  runOpenClawAgent,
  stripAnsi,
  tryParseJson,
};
