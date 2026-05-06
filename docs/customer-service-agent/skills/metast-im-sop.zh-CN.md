# Metast 私域 IM/SOP Skill

`skills/metast-im-sop/` 是 Metast 私域 IM/SOP 接口 skill，不属于微信公众号官方 API，也不替代 `wechat-official-account`。

中文说明：这份文档只维护私域 IM、SOP、朋友圈和相关外发安全边界。公众号文章草稿/发布走 `wechat-official-account`，实时订单/商品/快递查询走具体业务 skill。

适用范围：

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 个微联系人 | 已脚本化 | `GET /prod-api/system/api/im/getWxFrendList` |
| 企微联系人 | 已脚本化 | `GET /prod-api/system/api/im/getImFrendList` |
| 个微 SOP | 已脚本化 | `POST /prod-api/system/api/im/sendWxSopChatMesage` |
| 企微 SOP | 已脚本化 | `POST /prod-api/system/api/im/sendImSopChatMesage` |
| 个微朋友圈 | 已脚本化 | `POST /prod-api/system/api/im/sendWxMomentChatMesage`，body 为 Moment DTO |
| 企微客户朋友圈 | 已脚本化 | `POST /prod-api/system/api/im/sendImMomentChatMesage`，视频封面用 `mediaList.type=3` |
| 老私聊发消息 | 仅 body builder | SOP 文件没有给 endpoint，需要 profile 补 `sendChatMessagePath` |
| 主动状态接口 | 仅 body builder | SOP 文件没有给 endpoint，需要 profile 补 `activeStatusPath` |
| 知识库/聊天记录/朋友圈设定上传 | 仅 reference | SOP 文件没有给 endpoint，不能擅自发 live 请求 |

## Dry Run

```bash
node skills/metast-im-sop/scripts/metast-im-sop.js \
  --mode dry-run \
  --action sop-task \
  --platform wx \
  --profile example \
  --input-json task.json
```

dry-run 不调用网络，只生成 payload 并写审计文件：

- `logs/metast-im-sop/action-audit.jsonl`
- `docs/metast-im-sop/action-log.md`

## 朋友圈人设与发朋友圈链路

`metast-im-sop` 里已经有朋友圈配套能力：`--action moment`。它负责把 `moment.json` 变成 Metast 个微/企微朋友圈 DTO，并在 submit 模式下调用对应 Moment endpoint。

朋友圈内容人设不从 `SOUL.md` 走，也不复用公众号文章的 `WECHAT_ARTICLE_PERSONA.md`。每个 logical agent 维护独立的 `WECHAT_MOMENTS_PERSONA.md`：

```text
/root/.openclaw/workspace-<agent>/WECHAT_MOMENTS_PERSONA.md
  -> /root/openclaw-agent-templates/<agent>/WECHAT_MOMENTS_PERSONA.md
  -> /root/.openclaw/workers/workspace/<worker>/WECHAT_MOMENTS_PERSONA.md
```

维护接口：

```http
GET /api/agents/:agentId/wechat-moments-persona
PUT /api/agents/:agentId/wechat-moments-persona
```

推荐链路：

1. 读取 `WECHAT_MOMENTS_PERSONA.md`，生成朋友圈短文案和 image2 生图计划。
2. 如果本次需要配图，再通过 image2 生成原创图片，并上传/托管成 Metast 可访问的图片 URL；纯文本朋友圈可以不传图片。
3. 生成 `moment.json`，把文案写入 `content`；纯文本时 `media` / `mediaList` 可为空数组或省略。
4. 先用 `metast-im-sop --action moment --mode dry-run` 校验 payload 和审计日志。
5. 只有用户明确批准真实外发，并且 profile 开启 `safety.allowSubmit=true`，才使用 `--mode submit --confirm-send`。

## Live Submit

真实外发必须同时满足三个条件：

1. 用户明确批准真实发送。
2. profile 设置 `"safety": { "allowSubmit": true }`。
3. 命令显式带 `--mode submit --confirm-send`。
4. 主动触达类消息必须先确认目标用户在 `ACTIVE_STATUS_WHITELIST.json` 白名单里。

```bash
METAST_MCP_KEY="$METAST_MCP_KEY" \
METAST_MCP_SECRET="$METAST_MCP_SECRET" \
node skills/metast-im-sop/scripts/metast-im-sop.js \
  --mode submit \
  --confirm-send \
  --action sop-task \
  --platform im \
  --profile production-profile \
  --input-json task.json
```

真实 profile 只记录环境变量名，不记录真实 `mcpKey` / `mcpSecret`。

## 维护判断

- 公众号文章、草稿、发布：继续用 `skills/wechat-official-account/`。
- 私聊、好友列表、SOP 群发、朋友圈：用 `skills/metast-im-sop/`。
- 实时订单/商品/快递：仍优先用对应业务 skill，例如苏丹的 `metast-mcp` 或雪创的 `xuechuang-ordering`。
- 缺 URL 的接口不要靠猜；等上游补齐后再写入 profile 或 reference。

## 主动状态白名单

`ACTIVE_STATUS_WHITELIST.json` 维护允许被自动化客服主动触达的用户。它和上游 active-status callback URL 是两层：白名单负责“能不能主动发”，callback URL 负责“怎么通知/发送”。

维护接口：

```http
GET /api/agents/:agentId/active-status-whitelist
PUT /api/agents/:agentId/active-status-whitelist
POST /api/agents/:agentId/active-status-whitelist
```

简单覆盖：

```json
{
  "tenantId": "tenant-a",
  "content": "recv-1,recv-2"
}
```

主动状态事件：

```json
{
  "tenantId": "tenant-a",
  "sendId": "sender-1",
  "recvId": "recv-1",
  "conversationId": "conv-1",
  "status": "关闭"
}
```

`PUT` 是全量覆盖；`POST` 是状态合并。`status` 为开启/active/enabled 时加入或更新白名单，为 `关闭`、`disabled`、`off`、`0`、`false` 等关闭状态时，从白名单移除同一个用户。

结构化覆盖：

```json
{
  "entries": [
    {
      "tenantId": "tenant-a",
      "sendId": "sender-1",
      "recvId": "recv-1",
      "conversationId": "conv-1",
      "status": "enabled"
    }
  ]
}
```
