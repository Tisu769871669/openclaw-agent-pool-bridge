---
name: metast-im-sop
description: Use when handling Metast private-domain IM APIs for personal WeChat or WeCom friend lists, SOP chat tasks, Moments/customer Moments, rich private messages, or active-status callbacks.
---

# Metast IM SOP

This skill operates the Metast private-domain IM/SOP API layer, not the official WeChat public-account API. Use it for personal WeChat and WeCom customer-service actions where `mcpKey`/`mcpSecret` authenticate requests.

## Safety First

- Default to `--mode dry-run`; this writes an audit record and never calls the network.
- Use `--mode submit --confirm-send` only after the user explicitly approves a real external action.
- Keep `safety.allowSubmit` false in example or staging profiles. Enable it only in a real, intentionally configured profile.
- Never put `mcpKey`, `mcpSecret`, tokens, wxids, phone numbers, customer chat logs, or order data into Git or public docs.

## Main Actions

| Action | Platform | Purpose |
| --- | --- | --- |
| `list-friends` | `wx` or `im` | Query personal WeChat or WeCom friend contacts. |
| `sop-task` | `wx` or `im` | Create S0 single-event, S2 event, or S3 loop SOP chat tasks. |
| `moment` | `wx` or `im` | Send or schedule personal WeChat Moments / WeCom customer Moments. |
| `send-message` | profile endpoint | Build the updated rich private-message body when the legacy endpoint path is configured. |
| `active-status` | profile endpoint | Build the proactive status callback body when the endpoint path is configured. |

Read `references/metast-im-sop-api.md` for endpoint paths, body shapes, and known gaps from the source SOP file.

## Dry Run Examples

Create an SOP task JSON:

```json
{
  "sopNo": "S0",
  "taskName": "任务_2026-04-30_14:59:23",
  "fromDuration": "10:00",
  "endDuration": "10:30",
  "contacts": [
    { "accountId": "wxid_sender", "friendId": "wxid_friend", "friendName": "客户名" }
  ],
  "events": [
    {
      "content": "您好[呲牙]",
      "items": [
        { "kind": "text", "value": "您好[呲牙]" }
      ]
    }
  ]
}
```

Validate it without sending:

```bash
node skills/metast-im-sop/scripts/metast-im-sop.js \
  --mode dry-run \
  --action sop-task \
  --platform wx \
  --profile example \
  --input-json task.json
```

Build a scheduled Moment:

```bash
node skills/metast-im-sop/scripts/metast-im-sop.js \
  --mode dry-run \
  --action moment \
  --platform im \
  --profile example \
  --input-json moment.json
```

## Submit Example

Only run after explicit approval:

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

Submit mode requires both `--confirm-send` and a profile with `safety.allowSubmit: true`.

## Profile Contract

Profiles live in `profiles/*.json`:

```json
{
  "id": "example",
  "baseUrl": "https://lx.metast.cn",
  "defaultPlatform": "wx",
  "credentialEnv": {
    "mcpKey": "METAST_MCP_KEY",
    "mcpSecret": "METAST_MCP_SECRET"
  },
  "endpoints": {
    "sendChatMessagePath": "",
    "activeStatusPath": ""
  },
  "safety": {
    "allowSubmit": false
  }
}
```

The SOP source did not include URL paths for the legacy `sendChatMesage` update or active-status callback. Configure those paths in the profile before using `send-message` or `active-status`.

## Common Mistakes

- Do not merge this with `wechat-official-account`; that skill is for public-account articles, drafts, and publishing.
- Do not assume `wxid_*` IDs work for WeCom. WeCom examples use numeric account and friend IDs.
- For video Moments, personal WeChat uses `headImage` as the cover, while WeCom uses an extra `mediaList` item with `type: "3"`.
- For SOP message items, image/file/audio contents are JSON strings inside `content`, not nested objects.
