# 雪创客服 SOP Skill 与 SOUL 蒸馏接口文档

最后核验时间：2026-05-02 22:52 CST

## 1. 当前线上状态

| 项目 | 状态 |
| --- | --- |
| 通用 bridge 服务 | `/opt/openclaw-agent-pool-bridge` |
| 分支 | `codex/rich-chat-soul-apis` |
| 当前提交 | 以部署备注和 `git rev-parse HEAD` 为准 |
| systemd 服务 | `snowchuang-agent-pool-bridge` active |
| Snowchuang workers | 5 个，当前 idle |
| SOP skill | 已同步到 source workspace、template workspace、5 个 worker |
| SOP skill 文件哈希 | `8abb40077222ab42b2f5c18fcff07606f7c1ee24` |
| 公众号人设接口 | `GET/PUT /api/agents/snowchuang/wechat-article-persona` |
| 服务器测试 | `npm test` 143 passed，`npm run check` passed |

SOP skill 已在以下位置可用：

```text
/root/.openclaw/workspace-snowchuang/skills/metast-im-sop/
/root/openclaw-agent-templates/snowchuang/skills/metast-im-sop/
/root/.openclaw/workers/workspace/snowchuang-1..5/skills/metast-im-sop/
```

## 2. Token 与 Base URL

不要混用三类 token / credential：

| 名称 | 用途 | 放在哪里 |
| --- | --- | --- |
| `CHAT_BRIDGE_TOKEN` | 调用雪创客服 chat 接口，让 agent 使用 SOP skill | Postman 环境变量 |
| `POOL_BRIDGE_TOKEN` | 调用 SOUL 和公众号人设读取、写入、蒸馏等维护接口 | Postman 环境变量 |
| `METAST_MCP_KEY` / `METAST_MCP_SECRET` | 直连 Metast 私域 IM/SOP 上游 API | Postman 环境变量或服务器 env |

公开 Base URL：

```text
https://tokyoclaw.metast.cn
```

Metast 私域 IM/SOP 上游 Base URL：

```text
https://lx.metast.cn
```

## 3. 通过雪创客服调用 SOP Skill

这是推荐给业务系统的调用方式。业务系统仍然调用雪创客服 chat API，由 agent 在内部使用 `metast-im-sop` skill。

```http
POST {{BASE_URL}}/api/agents/snowchuang/chat
Authorization: Bearer {{CHAT_BRIDGE_TOKEN}}
Content-Type: application/json
```

Postman Body 选择 `raw` + `JSON`：

```json
{
  "conversationId": "postman-sop-{{$timestamp}}",
  "userId": "postman-tester",
  "message": "请使用 metast-im-sop skill，以 dry-run 模式生成一个个微 S0 SOP 任务。平台 wx；联系人 accountId=wxid_sender_demo，friendId=wxid_friend_demo，friendName=测试客户；任务名=Postman SOP dry-run；发送时间 10:00-10:30；消息内容=您好[呲牙]。不要真实发送，只返回 dry-run payload 摘要和审计文件路径。"
}
```

预期返回：

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "conversation_id": "postman-sop-...",
  "reply": "..."
}
```

说明：

- 这是 agent 编排接口，`reply` 是自然语言结果；如果需要固定 JSON，让 prompt 里明确要求“只输出 JSON”。
- 默认要求 agent 使用 dry-run，不会调用 Metast 上游网络。
- 真实外发必须另外确认，并且对应 profile 要启用 `safety.allowSubmit=true`。

## 4. 直连 Metast SOP API 的 Postman 测试

这组接口是直连上游，带真实 `mcpKey` / `mcpSecret` 时可能产生真实查询或外发。只在测试账号、测试联系人、确认过的场景下使用。

### 4.1 个微好友列表

```http
GET {{METAST_BASE_URL}}/prod-api/system/api/im/getWxFrendList?pageNo=1&pageSize=20&sendId={{SEND_ID}}
mcpKey: {{METAST_MCP_KEY}}
mcpSecret: {{METAST_MCP_SECRET}}
```

### 4.2 企微好友列表

```http
GET {{METAST_BASE_URL}}/prod-api/system/api/im/getImFrendList?pageNo=1&pageSize=20&sendId={{SEND_ID}}
mcpKey: {{METAST_MCP_KEY}}
mcpSecret: {{METAST_MCP_SECRET}}
```

### 4.3 创建个微 SOP 任务

```http
POST {{METAST_BASE_URL}}/prod-api/system/api/im/sendWxSopChatMesage
mcpKey: {{METAST_MCP_KEY}}
mcpSecret: {{METAST_MCP_SECRET}}
Content-Type: application/json
```

Body：

```json
{
  "sendLimit": "1000",
  "sendingDate": "1",
  "loopNums": "30",
  "fromDuration": "10:00",
  "endDuration": "22:00",
  "loopStatus": false,
  "senderType": "0",
  "taskName": "Postman SOP 测试任务",
  "sopInfo": {
    "sopNo": "S0",
    "fromDuration": "10:00",
    "endDuration": "10:30",
    "eventList": [
      {
        "day": "",
        "cont": "您好[呲牙]",
        "items": [
          {
            "type": 0,
            "content": "您好[呲牙]"
          }
        ]
      }
    ]
  },
  "concatList": [
    {
      "accountId": "{{SEND_ID}}",
      "friendId": "{{FRIEND_ID}}",
      "friendName": "测试客户"
    }
  ]
}
```

### 4.4 创建企微 SOP 任务

把 URL 换成：

```http
POST {{METAST_BASE_URL}}/prod-api/system/api/im/sendImSopChatMesage
```

Body 结构同上，但 `accountId` / `friendId` 使用企微侧 ID。

### 4.5 图片、文件、语音消息 item

SOP `items` 中非文本消息的 `content` 是 JSON 字符串，不是嵌套对象。

图片：

```json
{
  "type": 1,
  "content": "{\"originUrl\":\"https://lx.metast.cn/imfile/image.jpg\",\"thumbUrl\":\"https://lx.metast.cn/imfile/image.jpg\"}"
}
```

文件：

```json
{
  "type": 2,
  "content": "{\"name\":\"报价.pdf\",\"size\":176899,\"url\":\"https://lx.metast.cn/imfile/file.pdf\"}"
}
```

语音：

```json
{
  "type": 3,
  "content": "{\"name\":\"voice.wav\",\"url\":\"https://lx.metast.cn/imfile/voice.wav\",\"duration\":5.632}"
}
```

## 5. SOUL 读取、写入与蒸馏接口

这些接口走通用 pool bridge，必须使用 `POOL_BRIDGE_TOKEN`。

### 5.1 读取 Snowchuang SOUL.md

```http
GET {{BASE_URL}}/api/agents/snowchuang/soul
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
```

预期返回：

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "soul": {
    "path": "/root/.openclaw/workspace-snowchuang/SOUL.md",
    "content": "# SOUL\n...",
    "bytes": 5140,
    "sha256": "...",
    "source_workspace": "/root/.openclaw/workspace-snowchuang"
  }
}
```

### 5.2 用 JSON 覆盖 SOUL.md

这是真实写入接口。默认会同步 source workspace、template workspace 和 5 个 worker。

```http
PUT {{BASE_URL}}/api/agents/snowchuang/soul
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
Content-Type: application/json
```

Body：

```json
{
  "content": "# SOUL\n\n这里填写新的雪创客服人格、长期偏好和稳定工作方式。",
  "syncWorkers": true
}
```

### 5.3 上传 Markdown 文件覆盖 SOUL.md

Postman Body 选择 `form-data`：

| Key | Type | Value |
| --- | --- | --- |
| `soulFile` | File | 选择本地 `SOUL.md` |
| `syncWorkers` | Text | `true` |

请求：

```http
PUT {{BASE_URL}}/api/agents/snowchuang/soul
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
```

### 5.4 从聊天记录蒸馏并写入 SOUL.md

这是真实写入接口，会调用 `soul-distiller` agent，把聊天记录蒸馏成新的 `SOUL.md`，再同步 worker。

Postman Body 推荐选择 `form-data`：

| Key | Type | Value |
| --- | --- | --- |
| `chatFile` | File | 选择聊天记录 `.txt` / `.md` |
| `syncWorkers` | Text | `true` |

请求：

```http
POST {{BASE_URL}}/api/agents/snowchuang/soul/distill
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
```

也可以用 raw JSON：

```json
{
  "filename": "chat-history.txt",
  "chatLog": "用户：会员多少钱？\n客服：您好，会员价是 138 元。",
  "syncWorkers": true
}
```

返回结构：

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "soul": {
    "path": "/root/.openclaw/workspace-snowchuang/SOUL.md",
    "bytes": 1280,
    "sha256": "..."
  },
  "sync": {
    "sync_workers": true,
    "source": { "path": "...", "sha256": "..." },
    "template": { "path": "...", "sha256": "..." },
    "workers": [
      { "worker": "snowchuang-1", "path": "...", "sha256": "..." }
    ]
  },
  "distillation": {
    "skill": {
      "name": "dot-skill",
      "path": "/opt/openclaw-agent-pool-bridge/skills/dot-skill",
      "installed": false,
      "sourceRepo": "https://github.com/titanwings/colleague-skill.git"
    }
  }
}
```

注意：

- 生产环境没有 SOUL dry-run。测试 `PUT` 或 `distill` 前，先用 `GET /soul` 保存当前内容。
- `?syncWorkers=false` 或 `"syncWorkers": false` 只会避免同步 template/workers，但仍会改 source workspace。
- 蒸馏内容只适合沉淀长期人格、表达风格、稳定工作方式；不要把一次性订单号、手机号、隐私、实时价格写进 SOUL。

## 6. 公众号文章与配图人设接口

这组接口维护 Snowchuang logical agent 源 workspace 的 `WECHAT_ARTICLE_PERSONA.md`。它专门给 `wechat-official-account` 和 `article-image-generator` 联动使用，不替代 `SOUL.md`。

可先参考仓库里的 `examples/WECHAT_ARTICLE_PERSONA.zh-CN.md`，再通过下面的 `PUT` 接口写入 Snowchuang 源 workspace。

### 6.1 读取 WECHAT_ARTICLE_PERSONA.md

```http
GET {{BASE_URL}}/api/agents/snowchuang/wechat-article-persona
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
```

预期返回：

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "persona": {
    "name": "WECHAT_ARTICLE_PERSONA.md",
    "path": "/root/.openclaw/workspace-snowchuang/WECHAT_ARTICLE_PERSONA.md",
    "content": "# WECHAT_ARTICLE_PERSONA\n...",
    "bytes": 960,
    "sha256": "...",
    "source_workspace": "/root/.openclaw/workspace-snowchuang"
  }
}
```

### 6.2 用 JSON 覆盖 WECHAT_ARTICLE_PERSONA.md

```http
PUT {{BASE_URL}}/api/agents/snowchuang/wechat-article-persona
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
Content-Type: application/json
```

Body：

```json
{
  "content": "# WECHAT_ARTICLE_PERSONA\n\n这里填写公众号文章口吻、栏目感、商业分寸、选题偏好、配图风格和 image2 prompt 约束。",
  "syncWorkers": true
}
```

### 6.3 上传 Markdown 文件覆盖

Postman Body 选择 `form-data`：

| Key | Type | Value |
| --- | --- | --- |
| `personaFile` | File | 选择本地 `WECHAT_ARTICLE_PERSONA.md` |
| `syncWorkers` | Text | `true` |

请求：

```http
PUT {{BASE_URL}}/api/agents/snowchuang/wechat-article-persona
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
```

注意：

- 默认会同步 source workspace、template workspace 和 5 个 worker。
- `?syncWorkers=false` 或 `"syncWorkers": false` 只会避免同步 template/workers，但仍会改 source workspace。
- 这份文件只放公众号内容运营人设，不放客服聊天人格、订单号、手机号、wxid、实时价格、库存或客户聊天原文。

## 7. Postman 环境变量

建议建一个 Postman Environment：

| 变量 | 示例 |
| --- | --- |
| `BASE_URL` | `https://tokyoclaw.metast.cn` |
| `CHAT_BRIDGE_TOKEN` | 从现有雪创客服 chat bridge 配置获取 |
| `POOL_BRIDGE_TOKEN` | 从 `/opt/openclaw-agent-pool-bridge/.env` 获取 |
| `METAST_BASE_URL` | `https://lx.metast.cn` |
| `METAST_MCP_KEY` | 由 Metast 后台提供 |
| `METAST_MCP_SECRET` | 由 Metast 后台提供 |
| `SEND_ID` | 测试发送账号 ID |
| `FRIEND_ID` | 测试接收好友 ID |

## 8. 常见错误

| HTTP 状态 / 现象 | 常见原因 | 处理 |
| --- | --- | --- |
| `401 unauthorized` | token 用错，或把 chat token 用到了维护接口 | 区分 `CHAT_BRIDGE_TOKEN` 和 `POOL_BRIDGE_TOKEN` |
| `400 invalid_request` | JSON 格式错误、缺 `conversationId`、缺 `content` / `message` | 检查 Body 和 Content-Type |
| `SOUL.md content is required` | `PUT /soul` 没有传 `content` 或 `soulFile` | 用 raw JSON 或 form-data 文件 |
| `WECHAT_ARTICLE_PERSONA.md content is required` | `PUT /wechat-article-persona` 没有传 `content` 或 `personaFile` | 用 raw JSON 或 form-data 文件 |
| `chat log content is required` | `POST /soul/distill` 没有传 `chatLog` 或 `chatFile` | 补充聊天记录 |
| `soul_distiller_not_configured` | 服务器没有配置 `SOUL_DISTILLER_AGENT_ID` | 联系运维检查 pool bridge `.env` |
| SOP 直连接口返回失败 | Metast mcp 凭据、账号 ID、好友 ID、权限或请求体不正确 | 先测好友列表，再测 SOP 创建 |

## 9. 安全边界

- chat 调用 SOP skill 时，默认要求 dry-run。
- 直连 Metast SOP API 是真实上游请求，Postman 测试必须使用测试账号和测试好友。
- 不要把 `mcpKey`、`mcpSecret`、bridge token、wxid、手机号、订单号、真实聊天记录写入 Git、截图或公开文档。
- 缺 endpoint 的能力不要猜路径。目前老私聊发消息、主动状态回调、知识库/聊天记录/朋友圈设定上传都需要上游确认 URL 后再配置。
