#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const { writeAuditRecord } = require("./lib/audit-log");
const { MetastImClient } = require("./lib/metast-client");
const { loadProfile } = require("./lib/profile");
const {
  buildActiveStatusBody,
  buildMoment,
  buildSendMessageBody,
  buildSopTask,
  getPlatformConfig,
  normalizePlatform,
} = require("./lib/payloads");

function parseArgs(argv) {
  const args = {
    action: "sop-task",
    confirmSend: false,
    mode: "dry-run",
    pageNo: "1",
    pageSize: "20",
    platform: "wx",
    profile: "example",
    rootDir: process.cwd(),
    sendId: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mode") args.mode = argv[++index];
    else if (arg === "--action") args.action = argv[++index];
    else if (arg === "--platform") args.platform = argv[++index];
    else if (arg === "--profile") args.profile = argv[++index];
    else if (arg === "--input-json") args.inputJson = argv[++index];
    else if (arg === "--root-dir") args.rootDir = argv[++index];
    else if (arg === "--profiles-dir") args.profilesDir = argv[++index];
    else if (arg === "--page-no") args.pageNo = argv[++index];
    else if (arg === "--page-size") args.pageSize = argv[++index];
    else if (arg === "--send-id") args.sendId = argv[++index];
    else if (arg === "--confirm-send") args.confirmSend = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function resolveFromCwd(filePath, cwd = process.cwd()) {
  if (!filePath) return filePath;
  return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
}

function readJson(filePath) {
  if (!filePath) throw new Error("--input-json is required for this action");
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function buildRequest(args, profile, options = {}) {
  const platform = normalizePlatform(args.platform || profile.defaultPlatform);
  const config = getPlatformConfig(platform);
  const cwd = options.cwd || process.cwd();

  if (args.action === "list-friends") {
    return {
      endpoint: config.friendsPath,
      method: "GET",
      query: {
        pageNo: args.pageNo,
        pageSize: args.pageSize,
        sendId: args.sendId,
      },
    };
  }

  const input = readJson(resolveFromCwd(args.inputJson, cwd));
  if (args.action === "sop-task") {
    return {
      endpoint: config.sopPath,
      method: "POST",
      payload: buildSopTask(input),
    };
  }
  if (args.action === "moment") {
    return {
      endpoint: config.sopPath,
      method: "POST",
      payload: buildMoment({ platform, ...input }),
    };
  }
  if (args.action === "send-message") {
    if (!profile.endpoints.sendChatMessagePath) {
      throw new Error("profile.endpoints.sendChatMessagePath is required for send-message");
    }
    return {
      endpoint: profile.endpoints.sendChatMessagePath,
      method: "POST",
      payload: buildSendMessageBody(input),
    };
  }
  if (args.action === "active-status") {
    if (!profile.endpoints.activeStatusPath) {
      throw new Error("profile.endpoints.activeStatusPath is required for active-status");
    }
    return {
      endpoint: profile.endpoints.activeStatusPath,
      method: "POST",
      payload: buildActiveStatusBody(input),
    };
  }
  throw new Error(`Unsupported action: ${args.action}`);
}

function createClient(profile, env, fetchImpl) {
  const mcpKey = env[profile.credentialEnv.mcpKey];
  const mcpSecret = env[profile.credentialEnv.mcpSecret];
  if (!mcpKey || !mcpSecret) {
    throw new Error(`${profile.credentialEnv.mcpKey} and ${profile.credentialEnv.mcpSecret} are required for submit mode`);
  }
  return new MetastImClient({
    baseUrl: profile.baseUrl,
    mcpKey,
    mcpSecret,
    fetchImpl,
  });
}

async function main(argv = process.argv.slice(2), env = process.env, options = {}) {
  const args = parseArgs(argv);
  if (!["dry-run", "submit"].includes(args.mode)) {
    throw new Error("--mode must be dry-run or submit");
  }

  const profile = loadProfile(args.profile, { profilesDir: args.profilesDir });
  const request = buildRequest(args, profile, options);
  const platform = normalizePlatform(args.platform || profile.defaultPlatform);
  const record = {
    timestamp: new Date().toISOString(),
    profileId: profile.id,
    action: args.action,
    platform,
    mode: args.mode,
    endpoint: request.endpoint,
    status: "planned",
    request: {
      method: request.method,
      query: request.query,
    },
  };

  let response;
  if (args.mode === "submit") {
    if (!args.confirmSend) {
      throw new Error("--confirm-send is required for submit mode");
    }
    if (!profile.safety.allowSubmit) {
      throw new Error(`Profile ${profile.id} does not allow submit mode`);
    }
    const client = createClient(profile, env, options.fetchImpl);
    if (args.action === "list-friends") {
      response = await client.listFriends(platform, request.query);
      record.status = "fetched";
    } else if (args.action === "sop-task") {
      response = await client.submitSopTask(platform, request.payload);
      record.status = "submitted";
    } else if (args.action === "moment") {
      response = await client.submitMoment(platform, request.payload);
      record.status = "submitted";
    } else {
      response = await client.postCustom(request.endpoint, request.payload);
      record.status = "submitted";
    }
    record.response = responseSummary(response);
  }

  const audit = writeAuditRecord({ rootDir: args.rootDir, record });
  return {
    ok: true,
    record,
    audit,
    payload: request.payload,
    response,
  };
}

function responseSummary(response) {
  if (!response || typeof response !== "object") return response;
  return {
    code: response.code,
    msg: response.msg,
    data: response.data && typeof response.data === "object" ? Object.keys(response.data) : response.data,
  };
}

if (require.main === module) {
  main().then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  buildRequest,
  createClient,
  main,
  parseArgs,
};
