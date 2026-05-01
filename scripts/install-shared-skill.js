#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const { loadConfig, loadDotEnv } = require("../src/config");
const { syncWorkerWorkspaces } = require("./sync-worker-workspaces");

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

function parseArgs(argv) {
  const out = { _: [], agents: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    if (["dry-run", "sync-workers"].includes(key)) {
      out[key] = true;
      continue;
    }
    if (key === "agent") {
      out.agents.push(...String(argv[index + 1] || "").split(",").map(cleanText).filter(Boolean));
      index += 1;
      continue;
    }
    out[key] = argv[index + 1];
    index += 1;
  }
  return out;
}

function installSharedSkill(config, skillName, options = {}) {
  const rootDir = path.resolve(options.rootDir || path.join(__dirname, ".."));
  const safeSkillName = assertSafeSkillName(skillName);
  const sourceDir = path.resolve(options.sourceDir || path.join(rootDir, "skills", safeSkillName));
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(`Shared skill source directory does not exist: ${sourceDir}`);
  }

  const agentIds = selectAgentIds(config, options.agents);
  const results = [];
  for (const agentId of agentIds) {
    const template = config.agentTemplates?.[agentId];
    if (!template?.templateWorkspace) {
      throw new Error(`No templateWorkspace configured for logical agent ${agentId}`);
    }

    const targetDir = path.join(template.templateWorkspace, "skills", safeSkillName);
    assertSkillTarget(template.templateWorkspace, targetDir, safeSkillName);

    const operations = [];
    mirrorDirectory(sourceDir, targetDir, {
      dryRun: Boolean(options.dryRun),
      operations,
    });

    const result = {
      logicalAgentId: agentId,
      sourceDir,
      targetDir,
      operations,
      sync: null,
    };

    if (options.syncWorkers) {
      const sync = syncWorkerWorkspaces(config, agentId, { dryRun: Boolean(options.dryRun) });
      result.sync = {
        workers: sync.workers,
        operations: sync.operations.length,
      };
    }

    results.push(result);
  }

  return {
    skillName: safeSkillName,
    agents: results,
    dryRun: Boolean(options.dryRun),
    syncWorkers: Boolean(options.syncWorkers),
  };
}

function selectAgentIds(config, requestedAgents) {
  const available = Object.keys(config.agentTemplates || {});
  const selected = Array.isArray(requestedAgents) && requestedAgents.length ? requestedAgents : available;
  if (!selected.length) {
    throw new Error("No logical agents with templateWorkspace are configured");
  }
  for (const agentId of selected) {
    if (!available.includes(agentId)) {
      throw new Error(`Unknown logical agent or missing templateWorkspace: ${agentId}`);
    }
  }
  return selected;
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
  options.operations.push({
    type: "copy",
    source: sourcePath,
    target: targetPath,
  });
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

function assertSafeSkillName(skillName) {
  const clean = cleanText(skillName);
  if (!clean) {
    throw new Error("skill name is required");
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(clean) || clean === "." || clean === "..") {
    throw new Error(`unsafe skill name: ${skillName}`);
  }
  return clean;
}

function assertSkillTarget(templateWorkspace, targetDir, skillName) {
  const templateRoot = path.resolve(templateWorkspace);
  const expected = path.resolve(templateRoot, "skills", skillName);
  if (path.resolve(targetDir) !== expected) {
    throw new Error(`Refusing to install outside template skills directory: ${targetDir}`);
  }
}

function cleanText(value) {
  return String(value || "").trim();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(__dirname, "..");
  loadDotEnv(path.join(rootDir, ".env"));
  if (args.config) {
    process.env.AGENT_POOL_CONFIG = args.config;
  }
  const config = loadConfig(process.env, rootDir);
  const result = installSharedSkill(config, args._[0], {
    rootDir,
    sourceDir: args["source-dir"],
    agents: args.agents,
    dryRun: Boolean(args["dry-run"]),
    syncWorkers: Boolean(args["sync-workers"]),
  });

  for (const agent of result.agents) {
    for (const operation of agent.operations) {
      if (operation.type === "copy") {
        console.log(`${result.dryRun ? "would copy" : "copied"} ${operation.source} -> ${operation.target}`);
      } else if (operation.type === "remove") {
        console.log(`${result.dryRun ? "would remove" : "removed"} ${operation.target}`);
      }
    }
    if (agent.sync) {
      console.log(
        `${result.dryRun ? "would sync" : "synced"} ${agent.logicalAgentId} workers=${agent.sync.workers.length} operations=${agent.sync.operations}`
      );
    }
  }

  console.log(
    JSON.stringify({
      skillName: result.skillName,
      agents: result.agents.map((agent) => ({
        logicalAgentId: agent.logicalAgentId,
        targetDir: agent.targetDir,
        operations: agent.operations.length,
        sync: agent.sync,
      })),
      dryRun: result.dryRun,
      syncWorkers: result.syncWorkers,
    })
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  assertSafeSkillName,
  installSharedSkill,
  parseArgs,
  selectAgentIds,
};
