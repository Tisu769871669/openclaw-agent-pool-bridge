# Integration Guide

This guide explains how existing business bridges can move from direct `openclaw agent` calls to `openclaw-agent-pool-bridge` without changing their public chat contract.

中文导读：这份文档说明 Sudan、TokyoClaw、WeCom 等现有业务桥如何接入 worker pool bridge。迁移目标是外部接口尽量不变，内部执行从“单个 agent 直跑”切换为“logical agent -> worker pool”。

## Shared Integration Rules / 通用接入规则

| Rule | 中文说明 |
| --- | --- |
| Keep caller contract stable | 调用方继续传 `conversationId`、`userId`、`content`，不要暴露 worker agent ID。 |
| Use one logical agent per customer-service persona | 每个客服人格/业务线对应一个 logical agent。 |
| Create multiple workers per logical agent | 每个 logical agent 配多个 worker，例如 5 个，才有真实并发。 |
| Maintain one source workspace | 人格、prompt、skills、knowledge 统一维护在 logical agent 源 workspace。 |
| Install shared skills from repo root | 通用 skill 以 `skills/<name>` 为源，用 `scripts/install-shared-skill.js` 装到每个 template。 |
| Sync before serving traffic | 源 workspace 变更后先同步到 template 和 worker，再重启/检查服务。 |
| Inspect runtime with `/admin/pool` | 排查并发、积压、卡死和最近错误时优先看运行态接口。 |

## Sudan Bridge / Sudan 业务桥

The Sudan bridge already has useful request normalization, prompt shaping, knowledge lookup, and per-conversation queueing. For migration:

中文说明：Sudan 侧已有请求归一化、prompt 组装、知识检索和会话排队能力。迁移时保留这些业务逻辑，只把最终 OpenClaw 调用切到 worker pool bridge。

1. Create worker agents such as `sudan-main-1` through `sudan-main-5`.
2. Keep the canonical source workspace at `/root/.openclaw/workspace`.
3. Create a generated template workspace at `/root/openclaw-agent-templates/sudan-main`.
4. Use `examples/agent-pool.sudan.json` as the pool config.
5. Run `agents-pool sync main --config examples/agent-pool.sudan.json` after every source workspace change.
6. Keep the Sudan-specific prompt builder and call the shared pool runner for the actual OpenClaw invocation.
7. Keep the public response schema unchanged.

Recommended `.env` additions:

```env
DEFAULT_AGENT_ID=main
AGENT_POOL_CONFIG=examples/agent-pool.sudan.json
QUEUE_TIMEOUT_SECONDS=30
STICKY_TTL_SECONDS=1800
DEBOUNCE_ENABLED=true
DEBOUNCE_WINDOW_MS=1500
DEBOUNCE_MAX_WAIT_MS=5000
INCOMPLETE_MESSAGE_EXTRA_WAIT_ENABLED=true
INCOMPLETE_MESSAGE_EXTRA_WAIT_MS=2500
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
- `debounce.pendingMessages` 大于 0 表示有同一客户的短消息正在等待合并；如果长期不归零，检查调用方是否保持 HTTP 连接等待回复。

## Debounce For Chat Bridges / 聊天桥防抖

For WeChat-style callers, enable debounce when customers often send one sentence split across several messages. The bridge merges only the same `logicalAgent + conversationId`; different customers still run concurrently.

The optional incomplete-message extra wait policy delays a little longer when the last message looks unfinished. This is useful for messages that end with connector words such as `还有`, `这个`, `然后`, or punctuation such as commas and colons. The wait is always capped by `DEBOUNCE_MAX_WAIT_MS`.

中文说明：防抖放在 agent pool bridge 内部以后，Sudan、TokyoClaw 或其他客服服务器都可以复用同一套机制。业务桥不用自己再实现“等一等再发给 agent”，只要保持 `conversationId` 稳定即可。

## Prompt And Retrieval Adapters / Prompt 和检索适配

Customer-specific prompt shaping, FAQ, and RAG should stay out of the pool core. Use adapters around the generic bridge flow so each customer service agent can opt in and configure its own behavior.

Prompt Adapter is the first adapter layer. It is off by default. Use `template` when you want a customer-service-specific Markdown prompt without changing pool code:

```env
PROMPT_ADAPTER=none
PROMPT_TEMPLATE_FILE=
```

Template variables:

- `{{logical_agent}}` / `{{agent_id}}`
- `{{conversation_id}}`
- `{{user_id}}`
- `{{history}}`
- `{{message}}`
- `{{message_text}}`
- `{{attachments}}`
- `{{response_options}}`
- `{{retrieval_context}}`

Example:

```md
你是 {{logical_agent}} 的客服。

最近对话：
{{history}}

业务资料：
{{retrieval_context}}

当前用户消息：
{{message}}
```

中文说明：这一步先解决“不同客服怎么用自己的 prompt”。每个服务器或每个 logical agent 可以维护自己的模板文件，然后通过 `.env` 指向它。模板文件建议放在私有运维目录或业务仓库里，不要把真实内部 SOP、价格策略、客户资料直接提交到开源仓库。
仓库里的 `examples/prompt-template.zh-CN.md` 只是通用示例，可以复制后按具体客服改写。

富消息说明：`{{message}}` 默认已经包含图片、文件、音频摘要和 TTS 请求提示，旧模板不用改也能看到完整上下文。如果你想把模板分区写得更细，可以用 `{{message_text}}` 放纯文本，用 `{{attachments}}` 放附件摘要，用 `{{response_options}}` 放 TTS 等回复要求。

Retrieval Adapter is the second adapter layer. It runs before Prompt Adapter and fills `{{retrieval_context}}`.

```env
RETRIEVAL_ENABLED=false
RETRIEVAL_PROVIDER=faq
FAQ_FILE=
RAG_ENDPOINT=
RAG_API_KEY=
RAG_REQUEST_FORMAT=generic
RETRIEVAL_TOP_K=3
RETRIEVAL_MIN_SCORE=0.65
```

Local FAQ mode:

```env
RETRIEVAL_ENABLED=true
RETRIEVAL_PROVIDER=faq
FAQ_FILE=/root/openclaw-agent-templates/sudan-main/faq.json
```

FAQ JSON:

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
RAG_REQUEST_FORMAT=generic
```

The RAG endpoint receives `query`, `logicalAgentId`, `conversationId`, `userId`, `topK`, and `minScore`. It may return either a ready-made `context` string or a `hits` array.

Dify workflow mode:

```env
RETRIEVAL_ENABLED=true
RETRIEVAL_PROVIDER=dify
RAG_ENDPOINT=https://your-dify.example/v1/workflows/run
RAG_API_KEY=app_xxx
RAG_REQUEST_FORMAT=dify-workflow
```

The Dify workflow receives `query`, `logical_agent_id`, `conversation_id`, `user_id`, `top_k`, and `min_score` under `inputs`. Return `answer_context` from the workflow output node; optionally return `hits_json` as a JSON string for debugging. When one workflow serves several customer-service agents, branch inside Dify by `logical_agent_id`.

中文说明：苏丹 prompt 可以迁，但不要写死进开源核心。更好的方式是让每个客服在 env 或配置里选择 prompt adapter、FAQ/RAG provider 和参数；FAQ/RAG 命中内容会填进 `{{retrieval_context}}`。检索服务短暂失败时，bridge 会记录错误并继续让客服回复，避免线上聊天直接失败。

## SOUL.md Management / 人格文件管理

The bridge exposes authenticated maintenance endpoints for each logical agent's source `SOUL.md`:

```http
GET /api/agents/:agentId/soul
PUT /api/agents/:agentId/soul
POST /api/agents/:agentId/soul/distill
```

中文说明：`GET` 用来查看 logical agent 源 workspace 的 `SOUL.md`；`PUT` 支持 JSON、`text/plain` 或 multipart 文件上传覆盖源 `SOUL.md`；`distill` 支持上传聊天记录文件，让 GitHub 上的同事.skill / dot-skill 先蒸馏，再覆盖对应 agent 的源 `SOUL.md`。

The write path updates:

1. `/root/.openclaw/workspace-<agent>/SOUL.md` or `/root/.openclaw/workspace/SOUL.md` for `main`
2. `/root/openclaw-agent-templates/<agent>/SOUL.md`
3. each configured `/root/.openclaw/workers/workspace/<worker>/SOUL.md`

It intentionally syncs only `SOUL.md`, not the whole template directory. Use `agents-pool sync <agent>` when you also changed skills, knowledge, or prompt files.

These endpoints require the logical agent config to use object form with `sourceWorkspace`; legacy shorthand arrays can still route chat, but they do not define a source `SOUL.md` for maintenance APIs.

Distillation setup:

```env
SOUL_DISTILLER_AGENT_ID=soul-distiller
SOUL_DISTILLER_SKILL_DIR=skills/dot-skill
SOUL_DISTILLER_SKILL_REPO=https://github.com/titanwings/colleague-skill.git
SOUL_DISTILLER_SKILL_SOURCE_URL=
SOUL_DISTILLER_TIMEOUT_SECONDS=120
```

`SOUL_DISTILLER_SKILL_SOURCE_URL` is only a raw `SKILL.md` fallback. Normal installs should clone the full repo so the bridge can read both `SKILL.md` and the colleague prompt files under `prompts/`.

中文判断：聊天记录里出现的订单号、手机号、wxid、当前价格、库存、活动时间等不应该被写进 `SOUL.md`。这些内容属于短期会话、FAQ/RAG 或实时业务 API；`SOUL.md` 只保留长期的人格、边界和服务方式。

## WeChat Article Persona / 公众号内容人设文件

The bridge also exposes authenticated maintenance endpoints for each logical agent's `WECHAT_ARTICLE_PERSONA.md`:

```http
GET /api/agents/:agentId/wechat-article-persona
PUT /api/agents/:agentId/wechat-article-persona
```

中文说明：这份文件专门给 `wechat-official-account` 和 `article-image-generator` 联动使用，控制公众号文章口吻、栏目感、商业分寸、选题偏好、配图风格和 image2 prompt 边界。它不替代 `SOUL.md`，也不应该从 `SOUL.md` 自动拼接。

The write path updates:

1. `/root/.openclaw/workspace-<agent>/WECHAT_ARTICLE_PERSONA.md` or `/root/.openclaw/workspace/WECHAT_ARTICLE_PERSONA.md` for `main`
2. `/root/openclaw-agent-templates/<agent>/WECHAT_ARTICLE_PERSONA.md`
3. each configured `/root/.openclaw/workers/workspace/<worker>/WECHAT_ARTICLE_PERSONA.md`

`PUT` accepts JSON (`content`, `persona`, `markdown`, or `prompt`), `text/plain`, and multipart file fields (`personaFile`, `wechatArticlePersonaFile`, `promptFile`, `file`, or `upload`). Use `?syncWorkers=false` only for staged source-only edits.

## WeChat Moments Persona / 朋友圈内容人设文件

The bridge exposes the same maintenance pattern for each logical agent's `WECHAT_MOMENTS_PERSONA.md`:

```http
GET /api/agents/:agentId/wechat-moments-persona
PUT /api/agents/:agentId/wechat-moments-persona
```

中文说明：`metast-im-sop` 已经有朋友圈最终发送/排程能力，即 `--action moment`。这份文件负责前置内容人设：朋友圈短文案、轻量 CTA、生活化配图、image2 prompt 边界和真实外发安全提醒。它不替代 `SOUL.md`，也不复用公众号文章人设。

The write path updates:

1. `/root/.openclaw/workspace-<agent>/WECHAT_MOMENTS_PERSONA.md` or `/root/.openclaw/workspace/WECHAT_MOMENTS_PERSONA.md` for `main`
2. `/root/openclaw-agent-templates/<agent>/WECHAT_MOMENTS_PERSONA.md`
3. each configured `/root/.openclaw/workers/workspace/<worker>/WECHAT_MOMENTS_PERSONA.md`

`PUT` accepts JSON (`content`, `persona`, `markdown`, or `prompt`), `text/plain`, and multipart file fields (`personaFile`, `wechatMomentsPersonaFile`, `promptFile`, `file`, or `upload`). Use `?syncWorkers=false` only for staged source-only edits.

## Active Status Whitelist / 主动发消息白名单

The bridge exposes authenticated maintenance endpoints for each logical agent's proactive-message allowlist:

```http
GET /api/agents/:agentId/active-status-whitelist
PUT /api/agents/:agentId/active-status-whitelist
```

中文说明：`ACTIVE_STATUS_WHITELIST.json` 是主动发消息白名单。只有在这份文件里的用户，agent 才允许主动发消息。它不是 Metast 上游 active-status callback 本身；上游 callback URL 仍然需要在 `metast-im-sop` profile 里单独配置。

The write path updates:

1. `/root/.openclaw/workspace-<agent>/ACTIVE_STATUS_WHITELIST.json` or `/root/.openclaw/workspace/ACTIVE_STATUS_WHITELIST.json` for `main`
2. `/root/openclaw-agent-templates/<agent>/ACTIVE_STATUS_WHITELIST.json`
3. each configured `/root/.openclaw/workers/workspace/<worker>/ACTIVE_STATUS_WHITELIST.json`

`PUT` accepts either a tenant-scoped content list:

```json
{ "tenantId": "tenant-a", "content": "recv-1,recv-2" }
```

or structured entries:

```json
{
  "entries": [
    { "tenantId": "tenant-a", "sendId": "sender-1", "recvId": "recv-1", "conversationId": "conv-1", "status": "enabled" }
  ]
}
```

## Publishing Checklist / 发布前检查

- Remove committed `.env` files from any source repository used for examples.
- Replace Bearer tokens in docs with `<token>`.
- Rotate tokens that were previously committed.
- Do not publish private keys, `.pem` files, customer chat exports, or live WeCom app secrets.

中文补充：

- 不提交真实 `.env`、Bearer token、企业微信密钥、私钥、客户聊天记录。
- 如果 token 曾经进过提交历史，按泄漏处理，先轮换再发布。
- 示例配置只保留占位符，例如 `<token>`、`replace_me`、`/path/to/workspace`。
