# OpenClaw Agent Pool Bridge

A small Node.js HTTP bridge that maps one public logical OpenClaw agent to a pool of isolated worker agents.

It keeps the existing `/api/agents/chat` and `/api/agents/:agentId/chat` protocol, while preventing concurrent requests from piling onto one `main` agent session.

中文速览：这是一个 OpenClaw agent 并发桥接服务。外部仍然调用兼容的 chat HTTP 接口，bridge 在内部把请求分发到多个隔离 worker agent，并负责同一会话串行、不同会话并发、worker sticky、会话历史和运行态排查。

## Documentation / 文档

| Document | 中文说明 |
| --- | --- |
| `README.md` | 项目入口、快速启动、HTTP API、配置、并发规则。 |
| `docs/architecture.md` | 架构图、请求链路、pool/queue 行为、组件职责。 |
| `docs/cli.md` | `agents-pool` CLI 的命令、参数、安全规则和示例。 |
| `docs/integrations.md` | Sudan、TokyoClaw、WeCom 等业务桥接集成方式。 |
| `docs/aliyun-oss-skill.md` | 通用客服安装阿里云 OSS skill、配置 `openclawlist` bucket、同步 worker 和排查。 |
| `docs/openclaw-tts.md` | 通用客服配置 OpenClaw 原生 TTS、安装 `edge-tts` skill 和运行态验证。 |
| `docs/article-image-generator.md` | 通用客服安装 `article-image-generator` / `gpt-image-2` 生图 skill，让所有特化 agent 复用。 |
| `docs/ops.local.zh-CN.md` | 中文/English-friendly 本地和服务器运维手册，包含状态检查、同步、排障、回滚。 |

## Why

Wechat and WeCom integrations often receive several customer messages at the same time. Calling one `openclaw agent --agent main` directly for every request can mix context or overload the same runtime. This bridge separates concerns:

- one customer conversation is processed sequentially;
- short bursts from the same customer can be debounced into one agent turn;
- different customers can run concurrently;
- each worker agent handles only one request at a time;
- bridge-owned session history keeps continuity when a conversation is moved to another worker.

## Architecture

![OpenClaw Agent Pool Bridge architecture](docs/assets/openclaw-agent-pool-bridge-architecture.png)

See `docs/architecture.md` for the request flow, pool scheduling behavior, template workspace sync diagram, and editable Mermaid sources.

中文说明：如果你想先看“请求如何从外部服务进入 worker pool”，先读 `docs/architecture.md`；如果你是在服务器上维护服务，直接读 `docs/ops.local.zh-CN.md`。

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

Create and maintain one source workspace per logical agent. Templates and workers are generated from this source:

```text
/root/.openclaw/workspace/
  AGENTS.md
  SOUL.md
  IDENTITY.md
  skills/
  knowledge/
```

Sync source changes into the template and worker pool:

```bash
node scripts/agents-pool.js sync main --config agent-pool.config.local.json
```

Start the bridge:

```bash
npm start
```

## Agents Pool CLI

The `agents-pool` command provides an operator-friendly setup flow on top of the lower-level scripts.

中文说明：`agents-pool` 是运维入口，负责扫描本机 OpenClaw workspace/agent、创建或配置 worker pool、把 logical agent 源 workspace 同步到模板和 worker、做环境诊断。

```bash
# Inside a checkout, this always works:
node scripts/agents-pool.js scan

# Optional: expose the short command on the server PATH.
npm link

agents-pool scan
agents-pool help
agents-pool setup
agents-pool status
agents-pool pool --url http://127.0.0.1:9070
agents-pool sync main --source-workspace /root/.openclaw/workspace
agents-pool doctor
```

`gents-pool` is also installed as a forgiving alias for the same CLI.

中文说明：`agents-pool help` 会列出所有命令和说明；`gents-pool` 也会作为同一个命令的容错别名安装。

When `agent-pool.config.json` already has a logical agent, `agents-pool setup` reuses its existing template path and worker names by default. For example, an existing `main -> sudan-main-1..5` pool stays on `sudan-main-1..5` during `setup --dry-run`; pass `--count` or `--worker-prefix` only when you intentionally want to replan worker names.

中文说明：已经上线的服务器上，`setup` 默认保护旧配置。你截图里这种情况可以先按回车继续看 dry-run 计划，重点确认输出里的 workers 仍然是 `sudan-main-1..5`。

Typical server setup:

```bash
cd /opt/openclaw-agent-pool-bridge
npm install

agents-pool setup \
  --agents main \
  --count 5 \
  --template-root /root/openclaw-agent-templates \
  --worker-workspace-root /root/.openclaw/workers/workspace \
  --worker-agent-dir-root /root/.openclaw/workers/agents \
  --service sudan-agent-pool-bridge
```

Use `--dry-run` to preview filesystem, config, and OpenClaw CLI operations before writing:

```bash
agents-pool setup --agents main --count 5 --dry-run
```

The CLI preserves runtime state by excluding `.env`, `.sessions`, logs, temporary files, and `node_modules` when refreshing templates or workers.

See `docs/cli.md` for all commands and safety rules.

## HTTP API

`POST /api/agents/chat` uses `DEFAULT_AGENT_ID`.

`POST /api/agents/:agentId/chat` uses the `agentId` path segment as the logical agent.

中文说明：调用方只需要关心 logical agent 和 conversation。worker agent ID 不会暴露给业务调用方，避免外部依赖内部 worker 编号。

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

Rich chat content is also supported. Emoji stay in the text. Images, files, and audio should be passed as metadata or URLs, not as raw binary in this JSON API.

中文说明：通用 Agent 支持 emoji、图片、文件和语音输入。bridge 不负责上传二进制文件；上游需要先把素材放到业务侧可访问的位置，再把 URL、mediaId、文件名、mimeType、转写文本等传进来。

```json
{
  "conversationId": "wxid_customer_001",
  "userId": "wxid_customer_001",
  "content": {
    "text": "看看这个图，可以语音回复吗 😊",
    "attachments": [
      {
        "type": "image",
        "url": "https://example.com/customer-look.png",
        "filename": "customer-look.png",
        "mimeType": "image/png"
      },
      {
        "type": "file",
        "url": "https://example.com/order.pdf",
        "filename": "order.pdf",
        "mimeType": "application/pdf"
      },
      {
        "type": "audio",
        "url": "https://example.com/customer-voice.mp3",
        "filename": "customer-voice.mp3",
        "transcript": "我想听语音回复"
      }
    ],
    "tts": true
  }
}
```

`tts: true` means the caller wants a voice-friendly reply. Actual audio generation still depends on OpenClaw native `messages.tts` or the optional `edge-tts` skill being configured in the agent runtime.

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

If the agent runtime returns rich payloads, the bridge keeps `reply` as the primary text field and adds optional `outputs`. When TTS was requested, the response also includes `tts.requested`.

```json
{
  "ok": true,
  "reply": "可以，我给您发语音版。",
  "tts": { "requested": true },
  "outputs": [
    {
      "type": "audio",
      "url": "https://example.com/reply.mp3",
      "mime_type": "audio/mpeg"
    }
  ]
}
```

The response intentionally does not expose `worker_agent_id`.

### SOUL.md Management API

These endpoints require the same `Authorization: Bearer <token>` header as chat/admin requests when `AGENT_BRIDGE_TOKEN` is configured.

中文说明：这组接口的修改对象是 logical agent 的源 workspace，也就是 `agent-pool.config.json` 里的 `sourceWorkspace`。写入后会把这份 `SOUL.md` 同步到 template workspace 和该 agent 的 worker workspace。它不会把每个客服都做成一份特化 skill；聊天记录蒸馏默认使用 GitHub 上的同事.skill / dot-skill：`titanwings/colleague-skill`，并安装到 `skills/dot-skill`。

Read the current SOUL:

```http
GET /api/agents/:agentId/soul
```

Overwrite SOUL with JSON:

```bash
curl -X PUT \
  -H "Authorization: Bearer $AGENT_BRIDGE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"# SOUL\n\n新的客服人格"}' \
  http://127.0.0.1:9070/api/agents/snowchuang/soul
```

You can also upload a Markdown file:

```bash
curl -X PUT \
  -H "Authorization: Bearer $AGENT_BRIDGE_TOKEN" \
  -F "soulFile=@SOUL.md;type=text/markdown" \
  http://127.0.0.1:9070/api/agents/snowchuang/soul
```

Distill a chat log file and write the distilled result back to `SOUL.md`:

```bash
curl -X POST \
  -H "Authorization: Bearer $AGENT_BRIDGE_TOKEN" \
  -F "chatFile=@chat-history.txt;type=text/plain" \
  http://127.0.0.1:9070/api/agents/snowchuang/soul/distill
```

JSON upload is also supported:

```json
{
  "filename": "chat-history.txt",
  "chatLog": "用户：会员多少钱？\n客服：您好，会员价是 138 元。"
}
```

Response shape:

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "soul": {
    "path": "/root/.openclaw/workspace-snowchuang/SOUL.md",
    "bytes": 1280,
    "sha256": "...",
    "source_workspace": "/root/.openclaw/workspace-snowchuang"
  },
  "sync": {
    "sync_workers": true,
    "source": {
      "path": "/root/.openclaw/workspace-snowchuang/SOUL.md",
      "bytes": 1280,
      "sha256": "..."
    },
    "template": {
      "path": "/root/openclaw-agent-templates/snowchuang/SOUL.md",
      "bytes": 1280,
      "sha256": "..."
    },
    "workers": [
      {
        "worker": "snowchuang-1",
        "path": "/root/.openclaw/workers/workspace/snowchuang-1/SOUL.md",
        "bytes": 1280,
        "sha256": "..."
      }
    ]
  }
}
```

Use `?syncWorkers=false` or JSON field `"syncWorkers": false` only when you intentionally want to update the logical agent source first and sync template/workers later.

Distillation requires `SOUL_DISTILLER_AGENT_ID` to point to an OpenClaw agent that can run the common distiller prompt. The default skill source is the popular open-source colleague skill repo:

```env
SOUL_DISTILLER_SKILL_DIR=skills/dot-skill
SOUL_DISTILLER_SKILL_REPO=https://github.com/titanwings/colleague-skill.git
```

When `skills/dot-skill/SKILL.md` is missing, the bridge runs `git clone --depth 1` for that repo. `SOUL_DISTILLER_SKILL_SOURCE_URL` is only a raw `SKILL.md` fallback for restricted environments where `git clone` is unavailable.

## Pool Configuration

`agent-pool.config.json` maps public logical agents to private worker agents:

中文说明：`agents` 里的 key 是外部可见的 logical agent，`workers` 是内部真实执行的 worker agent 列表。

```json
{
  "defaultAgentId": "main",
  "agents": {
    "main": {
      "sourceWorkspace": "/root/.openclaw/workspace",
      "templateWorkspace": "/root/openclaw-agent-templates/main",
      "workerWorkspaceRoot": "/root/.openclaw/workers/workspace",
      "workers": ["main-1", "main-2", "main-3", "main-4", "main-5"]
    },
    "snowchuang": {
      "sourceWorkspace": "/root/.openclaw/workspace-snowchuang",
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

The shorthand is only for legacy chat routing. SOUL management requires the object form with `sourceWorkspace` configured.

If a logical agent is not configured, the bridge falls back to the default pool.

## Template Workspaces

Each logical customer service agent should have one canonical source workspace and one generated template workspace. Edit the source workspace, then sync it to the template and worker workspaces.

中文说明：每个 logical agent 的源 workspace 是权威内容；template 和 worker 都是从源同步出来的运行副本。不要直接改 worker workspace。

The sync flow mirrors normal customer-service files from source to template and workers while preserving runtime state. It skips:

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
- Optional debounce: when `DEBOUNCE_ENABLED=true`, short bursts for the same key are merged before they enter the conversation queue.
- Same key: strictly sequential.
- Different keys: run concurrently up to available workers.
- Pool full: requests wait up to `QUEUE_TIMEOUT_SECONDS`, then return HTTP 429 with `error: "queue_timeout"`.
- Soft stickiness: a conversation reuses its previous worker while available and inside `STICKY_TTL_SECONDS`; if that worker is busy, another free worker may be used.

中文说明：判断 5 并发是否真的生效时，一定要用 5 个不同的 `conversationId` 测试；同一个 `conversationId` 会先按配置防抖合并，再设计性串行。

## Debounce Merge

Debounce is off by default so existing deployments keep the old synchronous behavior. Enable it when your WeChat or WeCom caller can receive several short messages from the same customer in quick succession.

```env
DEBOUNCE_ENABLED=true
DEBOUNCE_WINDOW_MS=1500
DEBOUNCE_MAX_WAIT_MS=5000
DEBOUNCE_MAX_MESSAGES=20
INCOMPLETE_MESSAGE_EXTRA_WAIT_ENABLED=true
INCOMPLETE_MESSAGE_EXTRA_WAIT_MS=2500
```

With debounce enabled, requests with the same `logicalAgent + conversationId` that arrive within the debounce window share one OpenClaw worker run. The bridge combines the user messages in order and all waiting HTTP callers receive the same final reply. Different conversations are not merged and can still run concurrently.

`INCOMPLETE_MESSAGE_EXTRA_WAIT_ENABLED` is an optional extra wait policy. If the last message looks unfinished, such as ending with `我想问一下`, `还有`, `这个`, `然后`, a comma, or a colon, the bridge waits a bit longer, capped by `DEBOUNCE_MAX_WAIT_MS`. Clear questions, order numbers, logistics, refund, and after-sales queries are treated as complete.

中文说明：防抖合并解决“客户连发几句话，agent 回复多次”的问题。开启后，同一客户短时间内的多条消息会合成一次 agent 调用；不同客户不互相影响。不完整消息额外等待是可选策略，适合微信里用户一句话拆成几段发的场景。

## Extension Points

The bridge core keeps customer-specific behavior out of the pool. Prompt shaping, FAQ lookup, and RAG retrieval should be configured as separate adapters around the generic request flow, not hard-coded for one customer service persona.

Prompt Adapter is available now. The default is `none`, which preserves the existing bridge prompt exactly. Set `PROMPT_ADAPTER=template` to render a Markdown prompt template before each OpenClaw worker run:

```env
PROMPT_ADAPTER=none
PROMPT_TEMPLATE_FILE=
```

Template variables:

| Variable | Value |
| --- | --- |
| `{{logical_agent}}` / `{{agent_id}}` | Logical agent ID such as `main`. |
| `{{conversation_id}}` | Conversation ID from the caller. |
| `{{user_id}}` | User ID from the caller, if present. |
| `{{history}}` | Bridge-owned recent history formatted as numbered `user` / `assistant` lines. |
| `{{message}}` | Current user message after debounce, including rich attachment summaries and TTS request notes. |
| `{{message_text}}` | Current user text only, without attachment or response-option summaries. |
| `{{attachments}}` | Optional standalone attachment summary block for custom templates. |
| `{{response_options}}` | Optional standalone response-option block, currently used for TTS requests. |
| `{{retrieval_context}}` | Reserved for FAQ/RAG retrieval context; currently empty. |

Example:

```md
你是 {{logical_agent}} 客服。

最近对话：
{{history}}

可参考资料：
{{retrieval_context}}

当前用户消息：
{{message}}
```

See `examples/prompt-template.zh-CN.md` for a generic Chinese customer-service template.

Retrieval Adapter is available now. It runs before Prompt Adapter and fills `{{retrieval_context}}`. It is disabled by default.

```env
RETRIEVAL_ENABLED=false
RETRIEVAL_PROVIDER=faq
FAQ_FILE=
RAG_ENDPOINT=
RETRIEVAL_TOP_K=3
RETRIEVAL_MIN_SCORE=0.65
```

Local FAQ file mode:

```env
RETRIEVAL_ENABLED=true
RETRIEVAL_PROVIDER=faq
FAQ_FILE=/root/openclaw-agent-templates/sudan-main/faq.json
RETRIEVAL_TOP_K=3
RETRIEVAL_MIN_SCORE=0.65
```

FAQ JSON can be an array, or an object with `items` / `faqs`:

```json
[
  {
    "question": "会员费是多少？",
    "answer": "会员费是 138 元。",
    "keywords": ["会员费", "多少钱", "价格"]
  }
]
```

RAG endpoint mode:

```env
RETRIEVAL_ENABLED=true
RETRIEVAL_PROVIDER=rag
RAG_ENDPOINT=https://your-rag-service.example/search
```

The bridge sends a POST body with `query`, `logicalAgentId`, `conversationId`, `userId`, `topK`, and `minScore`. The endpoint can return either `{ "context": "..." }` or `{ "hits": [...] }`.

中文说明：苏丹式 prompt 现在可以先通过模板 adapter 迁移，不需要写死进开源核心。FAQ/RAG 已经作为 retrieval adapter 接入，命中内容会填入 `{{retrieval_context}}`。检索失败时 chat 请求会降级为空上下文继续跑，错误会出现在 `/admin/pool` 和 `agents-pool pool` 的 retrieval 状态里。

## Health And Metrics

```bash
curl http://127.0.0.1:9070/health
agents-pool pool --url http://127.0.0.1:9070
curl -H "Authorization: Bearer $AGENT_BRIDGE_TOKEN" http://127.0.0.1:9070/admin/pool
curl http://127.0.0.1:9070/metrics
```

`/health` exposes pool and queue counts. `/metrics` returns simple text counters that can be scraped or checked by PM2/systemd probes.
`/admin/pool` exposes per-worker runtime state for operators: busy flag, current session binding, sticky bound sessions, pool waiters, conversation queue depth, idle duration, and the most recent worker error. It requires the same bearer token as chat requests when `AGENT_BRIDGE_TOKEN` is configured. `agents-pool pool` is the CLI wrapper for the same endpoint and reads `AGENT_BRIDGE_TOKEN` from the environment or local `.env` by default.
`/health` and `/admin/pool` also expose debounce, prompt adapter, and retrieval adapter state: whether debounce is enabled, pending batches, pending messages, which prompt adapter is active, retrieval provider, last hit count, and the latest retrieval error.

中文说明：日常排查优先用 `agents-pool pool` 或直接看 `/admin/pool`。它能直接回答“哪个 worker 忙、绑了哪个 session、是否有积压、最近一次错误是什么”。

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
