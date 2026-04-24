const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { buildRunnerEnv } = require("../src/openclaw-runner");

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

