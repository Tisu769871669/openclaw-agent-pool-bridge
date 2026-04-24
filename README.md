# OpenClaw Agent Pool Bridge

A small Node.js HTTP bridge that maps one public logical OpenClaw agent to a pool of isolated worker agents.

It keeps the existing `/api/agents/chat` and `/api/agents/:agentId/chat` protocol, while preventing concurrent requests from piling onto one `main` agent session.

## Why

Wechat and WeCom integrations often receive several customer messages at the same time. Calling one `openclaw agent --agent main` directly for every request can mix context or overload the same runtime. This bridge separates concerns:

- one customer conversation is processed sequentially;
- different customers can run concurrently;
- each worker agent handles only one request at a time;
- bridge-owned session history keeps continuity when a conversation is moved to another worker.

## Architecture

![OpenClaw Agent Pool Bridge architecture](docs/assets/openclaw-agent-pool-bridge-architecture.png)

See `docs/architecture.md` for the request flow, pool scheduling behavior, template workspace sync diagram, and editable Mermaid sources.

## Quick Start

```bash
npm install
cp .env.example .env
cp agent-pool.config.json agent-pool.config.local.json
```

Edit `.env`:

```env
DEFAULT_AGENT_ID=main
AGENT_POOL_CONFIG=agent-pool.config.local.json
AGENT_BRIDGE_TOKEN=replace_me
```

Create worker agents:

```bash
node scripts/create-worker-pool.js main \
  --count 5 \
  --workspace-root /root/.openclaw/workers/workspace \
  --agent-dir-root /root/.openclaw/workers/agents
```

Create and maintain one template workspace per logical agent:

```text
/root/openclaw-agent-templates/main/
  AGENTS.md
  SOUL.md
  IDENTITY.md
  skills/
  knowledge/
```

Sync template changes into the worker pool:

```bash
node scripts/sync-worker-workspaces.js main --config agent-pool.config.local.json
```

Start the bridge:

```bash
npm start
```

## HTTP API

`POST /api/agents/chat` uses `DEFAULT_AGENT_ID`.

`POST /api/agents/:agentId/chat` uses the `agentId` path segment as the logical agent.

```json
{
  "conversationId": "wxid_customer_001",
  "userId": "wxid_customer_001",
  "content": {
    "messageList": [
      { "role": "assistant", "text": "您好，想了解哪款？" },
      { "role": "user", "text": "会员费是多少？" }
    ]
  }
}
```

Successful response:

```json
{
  "ok": true,
  "agent_id": "main",
  "conversation_id": "wxid_customer_001",
  "user_id": "wxid_customer_001",
  "reply": "这里是客服回复文本。",
  "session_id": "bridge_main_wxid_customer_001",
  "trace_id": "..."
}
```

The response intentionally does not expose `worker_agent_id`.

## Pool Configuration

`agent-pool.config.json` maps public logical agents to private worker agents:

```json
{
  "defaultAgentId": "main",
  "agents": {
    "main": {
      "templateWorkspace": "/root/openclaw-agent-templates/main",
      "workerWorkspaceRoot": "/root/.openclaw/workers/workspace",
      "workers": ["main-1", "main-2", "main-3", "main-4", "main-5"]
    },
    "snowchuang": {
      "templateWorkspace": "/root/openclaw-agent-templates/snowchuang",
      "workerWorkspaceRoot": "/root/.openclaw/workers/workspace",
      "workers": ["snowchuang-1", "snowchuang-2", "snowchuang-3"]
    }
  }
}
```

The older shorthand still works:

```json
{
  "agents": {
    "main": ["main-1", "main-2"]
  }
}
```

If a logical agent is not configured, the bridge falls back to the default pool.

## Template Workspaces

Each logical customer service agent should have exactly one canonical template workspace. Edit that template, then sync it to the worker workspaces.

The sync script mirrors normal customer-service files and preserves runtime state. It skips:

- `.git`
- `.env` / `.env.local`
- `.sessions`
- `node_modules`
- `logs`
- `tmp` / `.tmp`
- `*.log`

Preview changes without writing:

```bash
node scripts/sync-worker-workspaces.js main --config agent-pool.config.local.json --dry-run
```

## Concurrency Rules

- Key scope: `logicalAgentId + conversationId`.
- Same key: strictly sequential.
- Different keys: run concurrently up to available workers.
- Pool full: requests wait up to `QUEUE_TIMEOUT_SECONDS`, then return HTTP 429 with `error: "queue_timeout"`.
- Soft stickiness: a conversation reuses its previous worker while available and inside `STICKY_TTL_SECONDS`; if that worker is busy, another free worker may be used.

## Health And Metrics

```bash
curl http://127.0.0.1:9070/health
curl http://127.0.0.1:9070/metrics
```

`/health` exposes pool and queue counts. `/metrics` returns simple text counters that can be scraped or checked by PM2/systemd probes.

## Integration Notes

- Sudan service: keep the current product/persona/knowledge prompt builder, but send agent execution through this bridge or reuse its `AgentPool`, `ConversationQueueManager`, and `SessionStore` modules.
- TokyoClaw service: replace direct per-request `openclaw agent` calls with this bridge as the `node-services/agent-bridge` process.
- WeCom bridges should continue returning `success` immediately and push the final reply asynchronously.

See `docs/integrations.md` for concrete migration steps.

## Security

Do not commit real `.env`, Bearer tokens, WeCom credentials, private keys, or existing private API docs. Rotate any token that has already appeared in a committed document before publishing a public repository.

## Development

```bash
npm test
npm run check
```
