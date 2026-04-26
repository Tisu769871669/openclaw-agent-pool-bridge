# Integration Guide

This guide explains how existing business bridges can move from direct `openclaw agent` calls to `openclaw-agent-pool-bridge` without changing their public chat contract.

中文导读：这份文档说明 Sudan、TokyoClaw、WeCom 等现有业务桥如何接入 worker pool bridge。迁移目标是外部接口尽量不变，内部执行从“单个 agent 直跑”切换为“logical agent -> worker pool”。

## Shared Integration Rules / 通用接入规则

| Rule | 中文说明 |
| --- | --- |
| Keep caller contract stable | 调用方继续传 `conversationId`、`userId`、`content`，不要暴露 worker agent ID。 |
| Use one logical agent per customer-service persona | 每个客服人格/业务线对应一个 logical agent。 |
| Create multiple workers per logical agent | 每个 logical agent 配多个 worker，例如 5 个，才有真实并发。 |
| Maintain one template workspace | 人格、prompt、skills、knowledge 统一维护在模板 workspace。 |
| Sync before serving traffic | 模板变更后先同步到 worker，再重启/检查服务。 |
| Inspect runtime with `/admin/pool` | 排查并发、积压、卡死和最近错误时优先看运行态接口。 |

## Sudan Bridge / Sudan 业务桥

The Sudan bridge already has useful request normalization, prompt shaping, knowledge lookup, and per-conversation queueing. For migration:

中文说明：Sudan 侧已有请求归一化、prompt 组装、知识检索和会话排队能力。迁移时保留这些业务逻辑，只把最终 OpenClaw 调用切到 worker pool bridge。

1. Create worker agents such as `sudan-main-1` through `sudan-main-5`.
2. Create a canonical template workspace at `/root/openclaw-agent-templates/sudan-main`.
3. Put the Sudan workspace files, persona files, skills, and knowledge files in that template.
4. Use `examples/agent-pool.sudan.json` as the pool config.
5. Run `node scripts/sync-worker-workspaces.js main --config examples/agent-pool.sudan.json` after every template change.
6. Keep the Sudan-specific prompt builder and call the shared pool runner for the actual OpenClaw invocation.
7. Keep the public response schema unchanged.

Recommended `.env` additions:

```env
DEFAULT_AGENT_ID=main
AGENT_POOL_CONFIG=examples/agent-pool.sudan.json
QUEUE_TIMEOUT_SECONDS=30
STICKY_TTL_SECONDS=1800
```

## TokyoClaw Agent Bridge / TokyoClaw 业务桥

TokyoClaw currently exposes `snowchuang` and `yixiang` through `/api/agents/:agentId/chat`.

中文说明：TokyoClaw 已经按 `agentId` 区分 `snowchuang`、`yixiang`。这类结构很适合直接映射为多个 logical agent，每个 logical agent 各自维护 worker pool。

1. Create five workers for each logical customer service agent:

```bash
node scripts/create-worker-pool.js snowchuang \
  --count 5 \
  --workspace-root /root/.openclaw/workers/workspace \
  --agent-dir-root /root/.openclaw/workers/agents

node scripts/create-worker-pool.js yixiang \
  --count 5 \
  --workspace-root /root/.openclaw/workers/workspace \
  --agent-dir-root /root/.openclaw/workers/agents
```

2. Put each customer's agent workspace content in its canonical template.
3. Maintain templates at `/root/openclaw-agent-templates/snowchuang` and `/root/openclaw-agent-templates/yixiang`.
4. Use `examples/agent-pool.tokyoclaw.json`.
5. Run `node scripts/sync-worker-workspaces.js snowchuang --config examples/agent-pool.tokyoclaw.json` after every SnowChuang template change.
6. Run `node scripts/sync-worker-workspaces.js yixiang --config examples/agent-pool.tokyoclaw.json` after every Yixiang template change.
7. Run this bridge as the `agent-bridge` PM2 process.
8. Keep callers using:

```http
POST /api/agents/snowchuang/chat
POST /api/agents/yixiang/chat
```

## WeCom Bridges / 企业微信桥

The WeCom callback should still return quickly:

中文说明：企业微信回调有超时限制，不要在回调请求里同步等待长时间 agent 执行。正确做法是先回 `success`，后台异步调用 bridge，再把最终回复推回企业微信。

1. Receive WeCom callback.
2. Send `success` immediately.
3. Asynchronously call this bridge.
4. Push the final `reply` back through WeCom.

This avoids WeCom callback timeouts while preserving bridge-level pool control.

## Runtime Checks After Integration / 接入后检查

```bash
curl -sS http://127.0.0.1:9070/health
curl -sS http://127.0.0.1:9070/metrics
agents-pool pool --url http://127.0.0.1:9070
curl -sS -H "Authorization: Bearer $AGENT_BRIDGE_TOKEN" http://127.0.0.1:9070/admin/pool
```

中文判断：

- `/health` 用来看服务是否活着，以及 pool/queue 聚合计数。
- `/metrics` 适合探活脚本和监控采集。
- `agents-pool pool` 是 `/admin/pool` 的命令行包装，适合日常 SSH 排查。
- `/admin/pool` 用来看每个 worker 的 busy 状态、当前 session、sticky 绑定、队列长度、最近错误和 idle/busy 时长。

## Publishing Checklist / 发布前检查

- Remove committed `.env` files from any source repository used for examples.
- Replace Bearer tokens in docs with `<token>`.
- Rotate tokens that were previously committed.
- Do not publish private keys, `.pem` files, customer chat exports, or live WeCom app secrets.

中文补充：

- 不提交真实 `.env`、Bearer token、企业微信密钥、私钥、客户聊天记录。
- 如果 token 曾经进过提交历史，按泄漏处理，先轮换再发布。
- 示例配置只保留占位符，例如 `<token>`、`replace_me`、`/path/to/workspace`。
