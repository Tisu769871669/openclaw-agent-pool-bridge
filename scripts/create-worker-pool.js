#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function main() {
  const args = parseArgs(process.argv.slice(2));
  const logicalAgent = args.agent || args._[0] || "main";
  const count = Number(args.count || 5);
  const workspaceRoot = required(args["workspace-root"], "--workspace-root is required");
  const agentDirRoot = required(args["agent-dir-root"], "--agent-dir-root is required");
  const openclawBin = args.openclaw || "openclaw";
  const dryRun = Boolean(args["dry-run"]);

  for (let index = 1; index <= count; index += 1) {
    const workerName = `${logicalAgent}-${index}`;
    const workspace = path.resolve(workspaceRoot, workerName);
    const agentDir = path.resolve(agentDirRoot, workerName);

    const command = [
      openclawBin,
      "agents",
      "add",
      "--non-interactive",
      "--workspace",
      workspace,
      "--agent-dir",
      agentDir,
      workerName,
    ];

    if (dryRun) {
      console.log(command.map(shellQuote).join(" "));
      continue;
    }

    fs.mkdirSync(workspace, { recursive: true });
    fs.mkdirSync(agentDir, { recursive: true });

    const result = spawnSync(openclawBin, command.slice(1), {
      stdio: "inherit",
      shell: process.platform === "win32" && openclawBin.toLowerCase().endsWith(".cmd"),
    });

    if (result.status !== 0) {
      process.exit(result.status || 1);
    }
  }
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === "dry-run") {
      out[key] = true;
      continue;
    }
    out[key] = argv[index + 1];
    index += 1;
  }
  return out;
}

function required(value, message) {
  if (!value) {
    console.error(message);
    process.exit(2);
  }
  return value;
}

function shellQuote(value) {
  const text = String(value);
  return /\s/.test(text) ? JSON.stringify(text) : text;
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
};
