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
| 个微朋友圈 | 已脚本化 | 复用 `sendWxSopChatMesage`，body 为 Moment DTO |
| 企微客户朋友圈 | 已脚本化 | 复用 `sendImSopChatMesage`，视频封面用 `mediaList.type=3` |
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

## Live Submit

真实外发必须同时满足三个条件：

1. 用户明确批准真实发送。
2. profile 设置 `"safety": { "allowSubmit": true }`。
3. 命令显式带 `--mode submit --confirm-send`。

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
