# Integration Guide

## Sudan Bridge

The Sudan bridge already has useful request normalization, prompt shaping, knowledge lookup, and per-conversation queueing. For migration:

1. Create worker agents such as `sudan-main-1` through `sudan-main-5`.
2. Copy the same Sudan workspace files, persona files, skills, and knowledge files into each worker workspace.
3. Use `examples/agent-pool.sudan.json` as the pool config.
4. Keep the Sudan-specific prompt builder and call the shared pool runner for the actual OpenClaw invocation.
5. Keep the public response schema unchanged.

Recommended `.env` additions:

```env
DEFAULT_AGENT_ID=main
AGENT_POOL_CONFIG=examples/agent-pool.sudan.json
QUEUE_TIMEOUT_SECONDS=30
STICKY_TTL_SECONDS=1800
```

## TokyoClaw Agent Bridge

TokyoClaw currently exposes `snowchuang` and `yixiang` through `/api/agents/:agentId/chat`.

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

2. Copy each customer's agent workspace content into the matching worker workspaces.
3. Use `examples/agent-pool.tokyoclaw.json`.
4. Run this bridge as the `agent-bridge` PM2 process.
5. Keep callers using:

```http
POST /api/agents/snowchuang/chat
POST /api/agents/yixiang/chat
```

## WeCom Bridges

The WeCom callback should still return quickly:

1. Receive WeCom callback.
2. Send `success` immediately.
3. Asynchronously call this bridge.
4. Push the final `reply` back through WeCom.

This avoids WeCom callback timeouts while preserving bridge-level pool control.

## Publishing Checklist

- Remove committed `.env` files from any source repository used for examples.
- Replace Bearer tokens in docs with `<token>`.
- Rotate tokens that were previously committed.
- Do not publish private keys, `.pem` files, customer chat exports, or live WeCom app secrets.
