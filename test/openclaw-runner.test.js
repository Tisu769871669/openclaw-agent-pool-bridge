const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { buildRunnerEnv, extractOutputs } = require("../src/openclaw-runner");

test("buildRunnerEnv prepends the current node binary directory to PATH", () => {
  const nodeBinDir = path.join("/root", ".nvm", "versions", "node", "v22.22.2", "bin");
  const env = buildRunnerEnv(
    {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: "/root",
    },
    path.join(nodeBinDir, "node")
  );

  assert.equal(env.PATH.split(path.delimiter)[0], nodeBinDir);
  assert.equal(env.HOME, "/root");
  assert.equal(env.OPENCLAW_HIDE_BANNER, "1");
  assert.equal(env.OPENCLAW_SUPPRESS_NOTES, "1");
  assert.equal(env.NO_COLOR, "1");
});

test("extractOutputs normalizes rich OpenClaw payloads", () => {
  const outputs = extractOutputs({
    result: {
      payloads: [
        { type: "text", text: "文字回复" },
        {
          type: "image",
          url: "https://example.test/look.png",
          mimeType: "image/png",
          title: "搭配图",
        },
        {
          type: "audio",
          audioUrl: "https://example.test/reply.mp3",
          contentType: "audio/mpeg",
          durationMs: 1200,
        },
      ],
    },
  });

  assert.deepEqual(outputs, [
    {
      type: "image",
      url: "https://example.test/look.png",
      title: "搭配图",
      mime_type: "image/png",
    },
    {
      type: "audio",
      url: "https://example.test/reply.mp3",
      mime_type: "audio/mpeg",
      duration_ms: 1200,
    },
  ]);
});
