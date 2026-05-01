#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const { loadConfig, loadDotEnv } = require("../src/config");

const DEFAULT_EXCLUDES = new Set([
  ".git",
  ".env",
  ".env.local",
  ".sessions",
  "node_modules",
  "logs",
  "tmp",
  ".tmp",
]);

function syncWorkerWorkspaces(config, logicalAgentId, options = {}) {
  const agentId = String(logicalAgentId || config.defaultAgentId || "main").trim();
  const template = config.agentTemplates?.[agentId];
  if (!template) {
    throw new Error(`No templateWorkspace configured for logical agent ${agentId}`);
  }
  if (!fs.existsSync(template.templateWorkspace)) {
    throw new Error(`Template workspace does not exist: ${template.templateWorkspace}`);
  }

  const operations = [];
  for (const worker of template.workers) {
    const workspace = template.workerWorkspaces[worker];
    if (!workspace) {
      throw new Error(`No worker workspace configured for ${worker}`);
    }

    mirrorDirectory(template.templateWorkspace, workspace, {
      dryRun: Boolean(options.dryRun),
      operations,
    });
  }

  syncWorkerAgentModels(config, template, agentId, {
    dryRun: Boolean(options.dryRun),
    operations,
    openclawConfigPath: options.openclawConfigPath,
  });

  return {
    logicalAgentId: agentId,
    templateWorkspace: template.templateWorkspace,
    workers: template.workers,
    operations,
  };
}

function mirrorDirectory(sourceDir, targetDir, options) {
  if (!options.dryRun) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const sourceEntries = listDirectory(sourceDir).filter((entry) => !isExcluded(entry.name, entry.path));
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name));

  for (const targetEntry of listDirectory(targetDir)) {
    if (isExcluded(targetEntry.name, targetEntry.path)) {
      continue;
    }
    if (!sourceNames.has(targetEntry.name)) {
      removePath(targetEntry.path, options);
    }
  }

  for (const sourceEntry of sourceEntries) {
    const targetPath = path.join(targetDir, sourceEntry.name);
    if (sourceEntry.stats.isDirectory()) {
      mirrorDirectory(sourceEntry.path, targetPath, options);
    } else if (sourceEntry.stats.isFile()) {
      copyFile(sourceEntry.path, targetPath, options);
    }
  }
}

function copyFile(sourcePath, targetPath, options) {
  const operation = {
    type: "copy",
    source: sourcePath,
    target: targetPath,
  };
  options.operations.push(operation);
  if (options.dryRun) {
    return;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function removePath(targetPath, options) {
  options.operations.push({
    type: "remove",
    target: targetPath,
  });
  if (options.dryRun) {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function listDirectory(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => {
    const entryPath = path.join(dir, entry.name);
    return {
      name: entry.name,
      path: entryPath,
      stats: fs.statSync(entryPath),
    };
  });
}

function isExcluded(name, fullPath) {
  if (DEFAULT_EXCLUDES.has(name)) {
    return true;
  }
  if (name.endsWith(".log")) {
    return true;
  }
  const normalized = fullPath.replace(/\\/g, "/");
  return normalized.includes("/.git/") || normalized.includes("/.sessions/");
}

function syncWorkerAgentModels(config, template, logicalAgentId, options = {}) {
  const openclawConfigPath = resolveOpenClawConfigPath(config, template, options);
  if (!openclawConfigPath || !fs.existsSync(openclawConfigPath)) {
    return [];
  }

  const openclawConfig = JSON.parse(fs.readFileSync(openclawConfigPath, "utf8"));
  const agentList = openclawConfig?.agents?.list;
  if (!Array.isArray(agentList)) {
    return [];
  }

  const logicalAgent = agentList.find((agent) => agent?.id === logicalAgentId);
  const logicalModel = cleanText(logicalAgent?.model);
  if (!logicalModel) {
    return [];
  }

  const modelOperations = [];
  for (const worker of template.workers || []) {
    const workerAgent = agentList.find((agent) => agent?.id === worker);
    if (!workerAgent || workerAgent.model === logicalModel) {
      continue;
    }

    const operation = {
      type: "sync-model",
      openclawConfigPath,
      logicalAgentId,
      worker,
      from: workerAgent.model || "",
      to: logicalModel,
    };
    options.operations?.push(operation);
    modelOperations.push(operation);
    if (!options.dryRun) {
      workerAgent.model = logicalModel;
    }
  }

  if (modelOperations.length && !options.dryRun) {
    fs.writeFileSync(openclawConfigPath, `${JSON.stringify(openclawConfig, null, 2)}\n`, "utf8");
  }

  return modelOperations;
}

function resolveOpenClawConfigPath(config, template, options = {}) {
  const explicit = cleanText(options.openclawConfigPath || template.openclawConfigPath || config.openclawConfigPath);
  if (explicit) {
    return explicit;
  }

  const candidatePaths = [
    template.sourceWorkspace,
    template.templateWorkspace,
    template.workerWorkspaceRoot,
    ...Object.values(template.workerWorkspaces || {}),
  ].filter(Boolean);

  for (const candidatePath of candidatePaths) {
    const openclawDir = inferOpenClawDir(candidatePath);
    if (!openclawDir) {
      continue;
    }
    const openclawConfigPath = path.join(openclawDir, "openclaw.json");
    if (fs.existsSync(openclawConfigPath)) {
      return openclawConfigPath;
    }
  }

  return "";
}

function inferOpenClawDir(candidatePath) {
  const normalized = path.resolve(candidatePath);
  const parts = normalized.split(path.sep);
  const index = parts.lastIndexOf(".openclaw");
  if (index === -1) {
    return "";
  }
  const prefix = parts.slice(0, index + 1).join(path.sep);
  if (prefix) {
    return prefix;
  }
  return `${path.sep}.openclaw`;
}

function cleanText(value) {
  return String(value || "").trim();
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(__dirname, "..");
  loadDotEnv(path.join(rootDir, ".env"));
  if (args.config) {
    process.env.AGENT_POOL_CONFIG = args.config;
  }
  const config = loadConfig(process.env, rootDir);
  const logicalAgentId = args._[0] || config.defaultAgentId;
  const result = syncWorkerWorkspaces(config, logicalAgentId, {
    dryRun: Boolean(args["dry-run"]),
  });

  for (const operation of result.operations) {
    if (operation.type === "copy") {
      console.log(`${args["dry-run"] ? "would copy" : "copied"} ${operation.source} -> ${operation.target}`);
    } else if (operation.type === "remove") {
      console.log(`${args["dry-run"] ? "would remove" : "removed"} ${operation.target}`);
    } else if (operation.type === "sync-model") {
      console.log(
        `${args["dry-run"] ? "would sync" : "synced"} model ${operation.worker}: ${operation.from || "(empty)"} -> ${operation.to}`
      );
    }
  }
  console.log(
    JSON.stringify({
      logicalAgentId: result.logicalAgentId,
      workers: result.workers,
      operations: result.operations.length,
      dryRun: Boolean(args["dry-run"]),
    })
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  inferOpenClawDir,
  isExcluded,
  parseArgs,
  resolveOpenClawConfigPath,
  syncWorkerAgentModels,
  syncWorkerWorkspaces,
};
