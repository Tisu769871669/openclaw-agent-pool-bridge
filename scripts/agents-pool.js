#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");
const { spawnSync } = require("node:child_process");

const { normalizeAgentConfig } = require("../src/config");
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
  const out = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (["yes", "dry-run", "json", "no-create-workers", "no-sync", "no-template-refresh"].includes(key)) {
      out[key] = true;
      continue;
    }
    out[key] = argv[index + 1];
    index += 1;
  }
  return out;
}

function discoverLocalWorkspaces(options = {}) {
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const openclawDir = path.join(homeDir, ".openclaw");
  const candidates = [];
  addWorkspaceCandidate(candidates, path.join(openclawDir, "workspace"), "main");
  for (const entry of listDir(openclawDir)) {
    if (!entry.stats.isDirectory() || !entry.name.startsWith("workspace-")) {
      continue;
    }
    addWorkspaceCandidate(candidates, entry.path, entry.name.slice("workspace-".length));
  }
  for (const entry of listDir(path.join(openclawDir, "workspaces"))) {
    if (entry.stats.isDirectory()) {
      addWorkspaceCandidate(candidates, entry.path, entry.name);
    }
  }
  return uniqueBy(candidates, (item) => item.workspace);
}

function addWorkspaceCandidate(candidates, workspace, fallbackAgentId) {
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    return;
  }
  candidates.push({
    logicalAgentId: sanitizeAgentId(fallbackAgentId || path.basename(workspace)),
    workspace,
  });
}

function discoverAgentDirs(options = {}) {
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const openclawDir = path.join(homeDir, ".openclaw");
  const roots = [
    path.join(openclawDir, "agents"),
    path.join(openclawDir, "workers", "agents"),
  ];
  const out = [];
  for (const root of roots) {
    for (const entry of listDir(root)) {
      if (entry.stats.isDirectory()) {
        out.push({ agentId: entry.name, agentDir: entry.path });
      }
    }
  }
  return uniqueBy(out, (item) => item.agentId);
}

function listOpenClawAgents(options = {}) {
  const openclawBin = options.openclawBin || "openclaw";
  const spawn = options.spawnSync || spawnSync;
  const result = spawn(openclawBin, ["agents", "list"], {
    encoding: "utf8",
    shell: process.platform === "win32" && openclawBin.toLowerCase().endsWith(".cmd"),
  });
  if (result.error || result.status !== 0) {
    return {
      ok: false,
      agents: [],
      error: result.error?.message || String(result.stderr || "").trim() || `exit ${result.status}`,
    };
  }
  return {
    ok: true,
    agents: parseOpenClawAgentList(result.stdout || ""),
    raw: result.stdout || "",
  };
}

function parseOpenClawAgentList(raw) {
  const ignored = new Set(["name", "agent", "agents", "workspace", "path", "id"]);
  const names = [];
  for (const line of String(raw || "").split(/\r?\n/)) {
    const cleaned = line
      .replace(/[│┃║┆┊├┤└┘┌┐┬┴┼─━╭╮╰╯|]/g, " ")
      .replace(/^[\s*>\-•]+/, "")
      .trim();
    if (!cleaned) {
      continue;
    }
    const first = cleaned.split(/\s+/)[0].replace(/[:,]/g, "").trim();
    if (!first || ignored.has(first.toLowerCase()) || /^-+$/.test(first)) {
      continue;
    }
    if (/^[a-zA-Z0-9_-]+$/.test(first)) {
      names.push(first);
    }
  }
  return [...new Set(names)];
}

function scanEnvironment(options = {}) {
  const localWorkspaces = discoverLocalWorkspaces(options);
  const agentDirs = discoverAgentDirs(options);
  const openclaw = listOpenClawAgents(options);
  return {
    homeDir: path.resolve(options.homeDir || os.homedir()),
    workspaces: localWorkspaces,
    agentDirs,
    openclawAgents: openclaw.agents,
    openclawOk: openclaw.ok,
    openclawError: openclaw.error || "",
  };
}

function parseSelection(input, max) {
  const text = String(input || "").trim().toLowerCase();
  if (!text) {
    return [];
  }
  if (text === "all") {
    return Array.from({ length: max }, (_, index) => index);
  }
  const indexes = text.split(",").map((part) => {
    const value = Number(part.trim());
    if (!Number.isInteger(value) || value < 1 || value > max) {
      throw new Error(`Invalid selection: ${part.trim()}`);
    }
    return value - 1;
  });
  return [...new Set(indexes)];
}

function buildAgentDefinition(options) {
  const logicalAgentId = sanitizeAgentId(options.logicalAgentId);
  const workerCount = Math.max(1, Math.floor(Number(options.workerCount || 5)));
  const workerPrefix = sanitizeAgentId(options.workerPrefix || logicalAgentId);
  return {
    templateWorkspace: joinPath(options.templateRoot, logicalAgentId),
    workerWorkspaceRoot: options.workerWorkspaceRoot,
    workers: Array.from({ length: workerCount }, (_, index) => `${workerPrefix}-${index + 1}`),
  };
}

function buildSetupPlan(options) {
  const workerCount = Math.max(1, Math.floor(Number(options.workerCount || 5)));
  const templateRoot = requiredValue(options.templateRoot, "templateRoot is required");
  const workerWorkspaceRoot = requiredValue(options.workerWorkspaceRoot, "workerWorkspaceRoot is required");
  const workerAgentDirRoot = requiredValue(options.workerAgentDirRoot, "workerAgentDirRoot is required");
  const agents = options.selectedWorkspaces.map((workspace) => {
    const logicalAgentId = sanitizeAgentId(workspace.logicalAgentId);
    const definition = buildAgentDefinition({
      logicalAgentId,
      workerPrefix: workspace.workerPrefix || logicalAgentId,
      workerCount: workspace.workerCount || workerCount,
      templateRoot,
      workerWorkspaceRoot,
    });
    const workerWorkspaces = Object.fromEntries(
      definition.workers.map((worker) => [worker, joinPath(workerWorkspaceRoot, worker)])
    );
    const workerAgentDirs = Object.fromEntries(
      definition.workers.map((worker) => [worker, joinPath(workerAgentDirRoot, worker)])
    );
    return {
      logicalAgentId,
      sourceWorkspace: workspace.workspace,
      templateWorkspace: definition.templateWorkspace,
      workerWorkspaceRoot: definition.workerWorkspaceRoot,
      workers: definition.workers,
      workerWorkspaces,
      workerAgentDirs,
    };
  });
  return { agents };
}

function mergeAgentConfig(existingConfig, plan) {
  const next = {
    ...existingConfig,
    defaultAgentId: existingConfig.defaultAgentId || plan.agents[0]?.logicalAgentId || "main",
    agents: {
      ...(existingConfig.agents || {}),
    },
  };
  for (const agent of plan.agents) {
    next.agents[agent.logicalAgentId] = {
      templateWorkspace: agent.templateWorkspace,
      workerWorkspaceRoot: agent.workerWorkspaceRoot,
      workers: agent.workers,
    };
  }
  return next;
}

async function runCli(argv = process.argv.slice(2), io = {}) {
  const args = parseArgs(argv);
  const command = args._[0] || "setup";
  const rootDir = path.resolve(__dirname, "..");
  const homeDir = args.home || os.homedir();
  const configPath = path.resolve(rootDir, args.config || "agent-pool.config.json");
  const context = {
    args,
    rootDir,
    homeDir,
    configPath,
    stdin: io.stdin || process.stdin,
    stdout: io.stdout || process.stdout,
    stderr: io.stderr || process.stderr,
  };

  if (command === "scan") {
    return commandScan(context);
  }
  if (command === "status") {
    return commandStatus(context);
  }
  if (command === "sync") {
    return commandSync(context);
  }
  if (command === "doctor") {
    return commandDoctor(context);
  }
  if (command === "setup") {
    return commandSetup(context);
  }
  if (command === "help" || args.help) {
    printHelp(context.stdout);
    return 0;
  }
  throw new Error(`Unknown command: ${command}`);
}

async function commandScan(context) {
  const scan = scanEnvironment({
    homeDir: context.homeDir,
    openclawBin: context.args.openclaw || "openclaw",
  });
  if (context.args.json) {
    writeLine(context.stdout, JSON.stringify(scan, null, 2));
    return 0;
  }
  printScan(scan, context.stdout);
  return 0;
}

async function commandStatus(context) {
  const config = readJsonIfExists(context.configPath, { agents: {} });
  if (context.args.json) {
    writeLine(context.stdout, JSON.stringify(config, null, 2));
    return 0;
  }
  writeLine(context.stdout, `Config: ${context.configPath}`);
  writeLine(context.stdout, `Default agent: ${config.defaultAgentId || "main"}`);
  for (const [logicalAgentId, definition] of Object.entries(config.agents || {})) {
    const workers = Array.isArray(definition) ? definition : definition.workers || [];
    writeLine(context.stdout, "");
    writeLine(context.stdout, `- ${logicalAgentId}`);
    if (!Array.isArray(definition)) {
      writeLine(context.stdout, `  templateWorkspace: ${definition.templateWorkspace || ""}`);
      writeLine(context.stdout, `  workerWorkspaceRoot: ${definition.workerWorkspaceRoot || ""}`);
    }
    writeLine(context.stdout, `  workers: ${workers.join(", ")}`);
  }
  return 0;
}

async function commandSetup(context) {
  const args = context.args;
  const scan = scanEnvironment({
    homeDir: context.homeDir,
    openclawBin: args.openclaw || "openclaw",
  });
  const answers = await collectSetupAnswers(context, scan);
  const plan = buildSetupPlan(answers);
  const existingConfig = readJsonIfExists(context.configPath, {});
  const nextConfig = mergeAgentConfig(existingConfig, plan);

  printPlan(plan, context.stdout);
  writeLine(context.stdout, "");
  writeLine(context.stdout, `Config will be written to: ${context.configPath}`);

  if (!args.yes) {
    const ok = await askConfirm(context, "Apply this plan?", false);
    if (!ok) {
      writeLine(context.stdout, "Cancelled.");
      return 0;
    }
  }

  executeSetupPlan(plan, {
    rootDir: context.rootDir,
    configPath: context.configPath,
    nextConfig,
    dryRun: Boolean(args["dry-run"]),
    openclawBin: args.openclaw || "openclaw",
    createWorkers: !args["no-create-workers"] && answers.createWorkers,
    refreshTemplates: !args["no-template-refresh"] && answers.refreshTemplates,
    syncWorkers: !args["no-sync"] && answers.syncWorkers,
    restartService: answers.restartService,
    serviceName: answers.serviceName,
    existingAgentNames: new Set([...scan.openclawAgents, ...scan.agentDirs.map((item) => item.agentId)]),
    stdout: context.stdout,
  });

  return 0;
}

async function commandSync(context) {
  const args = context.args;
  const logicalAgentId = args.agent || args._[1] || "main";
  const config = readJsonIfExists(context.configPath, {});
  const runtimeConfig = runtimeConfigFromRaw(config, context.rootDir);
  const template = runtimeConfig.agentTemplates[logicalAgentId];
  if (!template) {
    throw new Error(`No templateWorkspace configured for logical agent ${logicalAgentId}`);
  }

  if (args["source-workspace"]) {
    mirrorSourceToTemplate(args["source-workspace"], template.templateWorkspace, {
      dryRun: Boolean(args["dry-run"]),
      stdout: context.stdout,
    });
  }

  const result = syncWorkerWorkspaces(runtimeConfig, logicalAgentId, {
    dryRun: Boolean(args["dry-run"]),
  });
  writeLine(
    context.stdout,
    JSON.stringify({
      logicalAgentId: result.logicalAgentId,
      workers: result.workers,
      operations: result.operations.length,
      dryRun: Boolean(args["dry-run"]),
    }, null, 2)
  );
  return 0;
}

async function commandDoctor(context) {
  const checks = [];
  const openclaw = listOpenClawAgents({ openclawBin: context.args.openclaw || "openclaw" });
  checks.push(["openclaw agents list", openclaw.ok, openclaw.error || `${openclaw.agents.length} agents visible`]);
  checks.push(["config file", fs.existsSync(context.configPath), context.configPath]);
  try {
    const config = readJsonIfExists(context.configPath, {});
    const runtimeConfig = runtimeConfigFromRaw(config, context.rootDir);
    for (const [logicalAgentId, template] of Object.entries(runtimeConfig.agentTemplates)) {
      checks.push([`${logicalAgentId} template`, fs.existsSync(template.templateWorkspace), template.templateWorkspace]);
      for (const workspace of Object.values(template.workerWorkspaces)) {
        checks.push([`${logicalAgentId} worker workspace`, fs.existsSync(workspace), workspace]);
      }
    }
  } catch (error) {
    checks.push(["config parse", false, error.message]);
  }
  for (const [name, ok, detail] of checks) {
    writeLine(context.stdout, `${ok ? "OK" : "FAIL"} ${name}: ${detail}`);
  }
  return checks.every(([, ok]) => ok) ? 0 : 1;
}

async function collectSetupAnswers(context, scan) {
  const args = context.args;
  const rl = args.yes
    ? null
    : readline.createInterface({ input: context.stdin, output: context.stdout });
  try {
    printScan(scan, context.stdout);
    const selectedWorkspaces = await chooseWorkspaces(context, rl, scan.workspaces);
    const workerCount = Number(args.count || (rl ? await ask(rl, "Worker count per logical agent [5]: ") : 5) || 5);
    const templateRoot = args["template-root"] || await askDefault(
      rl,
      "Template workspace root",
      joinPath(context.homeDir, "openclaw-agent-templates")
    );
    const workerWorkspaceRoot = args["worker-workspace-root"] || await askDefault(
      rl,
      "Worker workspace root",
      path.join(context.homeDir, ".openclaw", "workers", "workspace")
    );
    const workerAgentDirRoot = args["worker-agent-dir-root"] || await askDefault(
      rl,
      "Worker agent dir root",
      path.join(context.homeDir, ".openclaw", "workers", "agents")
    );
    const refreshTemplates = args.yes || await askConfirm(context, "Refresh template workspaces from source workspaces?", true, rl);
    const createWorkers = args.yes || await askConfirm(context, "Create missing worker agents?", true, rl);
    const syncWorkers = args.yes || await askConfirm(context, "Sync templates into worker workspaces?", true, rl);
    const restartService = args.service
      ? true
      : !args.yes && await askConfirm(context, "Restart a systemd service after setup?", false, rl);
    const serviceName = args.service || (restartService ? await askDefault(rl, "Systemd service name", "sudan-agent-pool-bridge") : "");

    return {
      selectedWorkspaces,
      workerCount,
      templateRoot,
      workerWorkspaceRoot,
      workerAgentDirRoot,
      refreshTemplates,
      createWorkers,
      syncWorkers,
      restartService,
      serviceName,
    };
  } finally {
    rl?.close();
  }
}

async function chooseWorkspaces(context, rl, workspaces) {
  const args = context.args;
  if (args.agents) {
    const names = new Set(String(args.agents).split(",").map((item) => sanitizeAgentId(item)));
    const selected = workspaces.filter((item) => names.has(item.logicalAgentId));
    if (selected.length !== names.size) {
      throw new Error(`Some --agents values were not found in discovered workspaces: ${args.agents}`);
    }
    return selected;
  }
  if (args["source-workspace"]) {
    return [{
      logicalAgentId: sanitizeAgentId(args.agent || "main"),
      workspace: path.resolve(args["source-workspace"]),
    }];
  }
  if (context.args.yes) {
    if (!workspaces.length) {
      throw new Error("No workspaces discovered. Pass --source-workspace when using --yes.");
    }
    return workspaces.slice(0, 1);
  }
  if (!workspaces.length) {
    const logicalAgentId = sanitizeAgentId(await ask(rl, "No workspace discovered. Logical agent id [main]: ") || "main");
    const workspace = await ask(rl, "Source workspace path: ");
    if (!workspace) {
      throw new Error("Source workspace path is required");
    }
    return [{ logicalAgentId, workspace: path.resolve(workspace) }];
  }
  const answer = await ask(rl, "Select workspaces by number, comma-separated, or all [all]: ");
  const indexes = parseSelection(answer || "all", workspaces.length);
  return indexes.map((index) => workspaces[index]);
}

function executeSetupPlan(plan, options) {
  if (options.refreshTemplates) {
    for (const agent of plan.agents) {
      mirrorSourceToTemplate(agent.sourceWorkspace, agent.templateWorkspace, options);
    }
  }
  if (options.createWorkers) {
    createMissingWorkerAgents(plan, options);
  }
  writeAgentConfig(options.configPath, options.nextConfig, options);
  if (options.syncWorkers) {
    const runtimeConfig = runtimeConfigFromRaw(options.nextConfig, options.rootDir);
    for (const agent of plan.agents) {
      if (options.dryRun && !fs.existsSync(agent.templateWorkspace)) {
        writeLine(
          options.stdout,
          `would sync ${agent.logicalAgentId}: skipped detailed dry-run because template would be created at ${agent.templateWorkspace}`
        );
        continue;
      }
      const result = syncWorkerWorkspaces(runtimeConfig, agent.logicalAgentId, { dryRun: options.dryRun });
      writeLine(options.stdout, `${options.dryRun ? "would sync" : "synced"} ${agent.logicalAgentId}: ${result.operations.length} operations`);
    }
  }
  if (options.restartService && options.serviceName) {
    runCommand("systemctl", ["restart", options.serviceName], options);
  }
}

function mirrorSourceToTemplate(sourceWorkspace, templateWorkspace, options = {}) {
  assertSafeMirror(sourceWorkspace, templateWorkspace);
  const operations = [];
  mirrorDirectory(path.resolve(sourceWorkspace), path.resolve(templateWorkspace), {
    dryRun: Boolean(options.dryRun),
    operations,
  });
  writeLine(
    options.stdout,
    `${options.dryRun ? "would refresh" : "refreshed"} template ${templateWorkspace} from ${sourceWorkspace}: ${operations.length} operations`
  );
  return operations;
}

function mirrorDirectory(sourceDir, targetDir, options) {
  if (!options.dryRun) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  const sourceEntries = listDir(sourceDir).filter((entry) => !isExcluded(entry.name, entry.path));
  const sourceNames = new Set(sourceEntries.map((entry) => entry.name));
  for (const targetEntry of listDir(targetDir)) {
    if (isExcluded(targetEntry.name, targetEntry.path)) {
      continue;
    }
    if (!sourceNames.has(targetEntry.name)) {
      options.operations.push({ type: "remove", target: targetEntry.path });
      if (!options.dryRun) {
        fs.rmSync(targetEntry.path, { recursive: true, force: true });
      }
    }
  }
  for (const sourceEntry of sourceEntries) {
    const targetPath = path.join(targetDir, sourceEntry.name);
    if (sourceEntry.stats.isDirectory()) {
      mirrorDirectory(sourceEntry.path, targetPath, options);
    } else if (sourceEntry.stats.isFile()) {
      options.operations.push({ type: "copy", source: sourceEntry.path, target: targetPath });
      if (!options.dryRun) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourceEntry.path, targetPath);
      }
    }
  }
}

function createMissingWorkerAgents(plan, options) {
  for (const agent of plan.agents) {
    for (const worker of agent.workers) {
      const workspace = agent.workerWorkspaces[worker];
      const agentDir = agent.workerAgentDirs[worker];
      if (options.existingAgentNames?.has(worker) || fs.existsSync(agentDir)) {
        writeLine(options.stdout, `skip existing worker agent ${worker}`);
        continue;
      }
      runCommand(options.openclawBin || "openclaw", [
        "agents",
        "add",
        "--non-interactive",
        "--workspace",
        workspace,
        "--agent-dir",
        agentDir,
        worker,
      ], options);
    }
  }
}

function writeAgentConfig(configPath, config, options = {}) {
  if (options.dryRun) {
    writeLine(options.stdout, `would write ${configPath}`);
    writeLine(options.stdout, JSON.stringify(config, null, 2));
    return;
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  if (fs.existsSync(configPath)) {
    const backup = `${configPath}.bak.${timestamp()}`;
    fs.copyFileSync(configPath, backup);
    writeLine(options.stdout, `backed up config to ${backup}`);
  }
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  writeLine(options.stdout, `wrote ${configPath}`);
}

function runtimeConfigFromRaw(rawConfig, rootDir) {
  const normalized = normalizeAgentConfig(rawConfig.agents || {}, rootDir);
  return {
    defaultAgentId: rawConfig.defaultAgentId || "main",
    agents: normalized.agents,
    agentTemplates: normalized.agentTemplates,
  };
}

function runCommand(command, args, options = {}) {
  const text = [command, ...args].map(shellQuote).join(" ");
  if (options.dryRun) {
    writeLine(options.stdout, `would run ${text}`);
    return;
  }
  writeLine(options.stdout, `run ${text}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32" && String(command).toLowerCase().endsWith(".cmd"),
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status}`);
  }
}

function printScan(scan, stdout) {
  writeLine(stdout, `Home: ${scan.homeDir}`);
  writeLine(stdout, "");
  writeLine(stdout, "Discovered workspaces:");
  if (!scan.workspaces.length) {
    writeLine(stdout, "  (none)");
  }
  scan.workspaces.forEach((item, index) => {
    writeLine(stdout, `  ${index + 1}. ${item.logicalAgentId} -> ${item.workspace}`);
  });
  writeLine(stdout, "");
  writeLine(stdout, `OpenClaw agents list: ${scan.openclawOk ? "ok" : `failed (${scan.openclawError})`}`);
  if (scan.openclawAgents.length) {
    writeLine(stdout, `  ${scan.openclawAgents.join(", ")}`);
  }
  if (scan.agentDirs.length) {
    writeLine(stdout, "");
    writeLine(stdout, "Local agent dirs:");
    for (const item of scan.agentDirs) {
      writeLine(stdout, `  ${item.agentId} -> ${item.agentDir}`);
    }
  }
}

function printPlan(plan, stdout) {
  writeLine(stdout, "");
  writeLine(stdout, "Planned agent pool setup:");
  for (const agent of plan.agents) {
    writeLine(stdout, `- ${agent.logicalAgentId}`);
    writeLine(stdout, `  sourceWorkspace: ${agent.sourceWorkspace}`);
    writeLine(stdout, `  templateWorkspace: ${agent.templateWorkspace}`);
    writeLine(stdout, `  workerWorkspaceRoot: ${agent.workerWorkspaceRoot}`);
    writeLine(stdout, `  workers: ${agent.workers.join(", ")}`);
  }
}

function printHelp(stdout) {
  writeLine(stdout, [
    "Usage:",
    "  agents-pool setup [--dry-run] [--yes]",
    "  agents-pool scan [--json]",
    "  agents-pool status [--config agent-pool.config.json]",
    "  agents-pool sync <logicalAgent> [--source-workspace PATH] [--dry-run]",
    "  agents-pool doctor",
    "",
    "Setup options:",
    "  --agents main,agent1",
    "  --count 5",
    "  --template-root /root/openclaw-agent-templates",
    "  --worker-workspace-root /root/.openclaw/workers/workspace",
    "  --worker-agent-dir-root /root/.openclaw/workers/agents",
    "  --service sudan-agent-pool-bridge",
  ].join("\n"));
}

function readJsonIfExists(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listDir(dir) {
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
  if (DEFAULT_EXCLUDES.has(name) || name.endsWith(".log")) {
    return true;
  }
  const normalized = fullPath.replace(/\\/g, "/");
  return normalized.includes("/.git/") || normalized.includes("/.sessions/");
}

function assertSafeMirror(sourceWorkspace, templateWorkspace) {
  const source = path.resolve(sourceWorkspace);
  const target = path.resolve(templateWorkspace);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Source workspace does not exist: ${source}`);
  }
  if (source === target) {
    throw new Error("Source workspace and template workspace are the same path");
  }
  if (isDangerousTarget(target)) {
    throw new Error(`Refusing to mirror into unsafe target: ${target}`);
  }
}

function isDangerousTarget(target) {
  const parsed = path.parse(target);
  const normalized = path.resolve(target);
  return normalized === parsed.root || normalized === os.homedir() || normalized.length < parsed.root.length + 4;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function sanitizeAgentId(value) {
  const text = String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  return text || "main";
}

function joinPath(base, child) {
  const text = String(base || "");
  if (text.includes("\\") && !text.includes("/")) {
    return path.win32.join(text, child);
  }
  if (text.startsWith("/")) {
    return path.posix.join(text, child);
  }
  return path.join(text, child);
}

function requiredValue(value, message) {
  if (!value) {
    throw new Error(message);
  }
  return value;
}

async function ask(rl, question) {
  if (!rl) {
    return "";
  }
  return String(await rl.question(question)).trim();
}

async function askDefault(rl, label, defaultValue) {
  const answer = await ask(rl, `${label} [${defaultValue}]: `);
  return answer || defaultValue;
}

async function askConfirm(context, question, defaultValue, rlArg) {
  const rl = rlArg || readline.createInterface({ input: context.stdin, output: context.stdout });
  const suffix = defaultValue ? "Y/n" : "y/N";
  try {
    const answer = String(await rl.question(`${question} [${suffix}]: `)).trim().toLowerCase();
    if (!answer) {
      return defaultValue;
    }
    return ["y", "yes"].includes(answer);
  } finally {
    if (!rlArg) {
      rl.close();
    }
  }
}

function writeLine(stdout, value) {
  if (stdout && typeof stdout.write === "function") {
    stdout.write(`${value}\n`);
  }
}

function shellQuote(value) {
  const text = String(value);
  return /[\s"'$`\\]/.test(text) ? JSON.stringify(text) : text;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

if (require.main === module) {
  runCli().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  buildAgentDefinition,
  buildSetupPlan,
  discoverAgentDirs,
  discoverLocalWorkspaces,
  executeSetupPlan,
  mergeAgentConfig,
  parseOpenClawAgentList,
  parseArgs,
  parseSelection,
  runCli,
  scanEnvironment,
};
