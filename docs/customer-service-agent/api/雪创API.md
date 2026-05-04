# 雪创客服富媒体聊天、SOP Skill、SOUL 蒸馏与内容人设接口文档

最后核验时间：2026-05-02 23:00 CST

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
| 多模态 / 富媒体聊天 | `POST /api/agents/snowchuang/chat` 支持文本、emoji、图片、文件、语音元数据和 TTS 请求 |
| 公众号人设接口 | `GET/PUT /api/agents/snowchuang/wechat-article-persona` |
| 朋友圈人设接口 | `GET/PUT /api/agents/snowchuang/wechat-moments-persona` |
| 主动消息白名单接口 | `GET/PUT /api/agents/snowchuang/active-status-whitelist` |
| 服务器测试 | 以当前部署验证输出为准 |

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
| `CHAT_BRIDGE_TOKEN` | 调用雪创客服 chat 接口，覆盖普通聊天、富媒体聊天和 SOP skill 编排 | Postman 环境变量 |
| `POOL_BRIDGE_TOKEN` | 调用 SOUL、公众号人设、朋友圈人设、主动消息白名单读取、写入、蒸馏等维护接口 | Postman 环境变量 |
| `METAST_MCP_KEY` / `METAST_MCP_SECRET` | 直连 Metast 私域 IM/SOP 上游 API | Postman 环境变量或服务器 env |

公开 Base URL：

```text
https://tokyoclaw.metast.cn
```

Metast 私域 IM/SOP 上游 Base URL：

```text
https://lx.metast.cn
```

## 3. 多模态 / 富媒体聊天接口

这是雪创客服的主聊天入口。它仍然是 JSON HTTP API，不上传、不存储二进制文件；图片、文件、语音需要业务系统先上传到自己的素材服务或微信素材系统，再把可访问 URL、`mediaId`、文件名、MIME、语音转写等元数据传给 bridge。

```http
POST {{BASE_URL}}/api/agents/snowchuang/chat
Authorization: Bearer {{CHAT_BRIDGE_TOKEN}}
Content-Type: application/json
```

### 3.1 普通文本 / emoji

```json
{
  "conversationId": "wxid_customer_001",
  "userId": "wxid_customer_001",
  "message": "您好，我想咨询一下会员权益 😊"
}
```

### 3.2 带上下文聊天记录

`conversationId` 要保持稳定，这样 bridge 才能接上同一个客户的短期会话记忆。测试新会话时再换新的 `conversationId`。

```json
{
  "conversationId": "wxid_customer_001",
  "userId": "wxid_customer_001",
  "content": {
    "messageList": [
      { "role": "assistant", "text": "您好，有什么可以帮助？" },
      { "role": "user", "text": "这件衣服适合通勤吗？" }
    ]
  }
}
```

### 3.3 图片、文件、语音和 TTS 请求

支持的附件类型是 `image`、`file`、`audio`；`voice` 会归一成 `audio`。语音输入建议同时传 `transcript`，否则 agent 只能看到音频 URL / 文件名等元数据，不能保证理解语音内容。

```json
{
  "conversationId": "wxid_customer_001",
  "userId": "wxid_customer_001",
  "content": {
    "text": "帮我看看这张图适合怎么搭配，可以语音回复吗 😊",
    "attachments": [
      {
        "type": "image",
        "url": "https://example.com/customer-look.png",
        "filename": "customer-look.png",
        "mimeType": "image/png",
        "caption": "客户上传的穿搭照片"
      },
      {
        "type": "file",
        "url": "https://example.com/size-table.pdf",
        "filename": "size-table.pdf",
        "mimeType": "application/pdf"
      },
      {
        "type": "audio",
        "url": "https://example.com/customer-voice.mp3",
        "filename": "customer-voice.mp3",
        "mimeType": "audio/mpeg",
        "transcript": "我想问这套适不适合面试"
      }
    ],
    "tts": {
      "enabled": true,
      "voice": "zh-CN-XiaoxiaoNeural",
      "lang": "zh-CN"
    }
  }
}
```

`content.tts` 是“本次希望语音回复”的请求信号。bridge 会把这个意图传给 OpenClaw，并在响应里返回 `tts.requested=true`；是否真的生成音频，取决于 OpenClaw 原生 TTS 配置或 agent 内的 TTS skill。

### 3.4 预期返回

普通文本返回：

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "conversation_id": "wxid_customer_001",
  "user_id": "wxid_customer_001",
  "reply": "可以，这套更适合偏正式通勤...",
  "session_id": "bridge_snowchuang_wxid_customer_001",
  "trace_id": "..."
}
```

如果 agent / OpenClaw 返回了图片、文件或音频，bridge 会透出 `outputs`：

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "conversation_id": "wxid_customer_001",
  "user_id": "wxid_customer_001",
  "reply": "我给您整理了一版语音回复。",
  "session_id": "bridge_snowchuang_wxid_customer_001",
  "trace_id": "...",
  "tts": {
    "requested": true,
    "voice": "zh-CN-XiaoxiaoNeural",
    "lang": "zh-CN"
  },
  "outputs": [
    {
      "type": "audio",
      "url": "https://example.com/reply.mp3",
      "mime_type": "audio/mpeg",
      "title": "TTS 语音回复"
    }
  ]
}
```

Postman `Tests` 可加：

```javascript
pm.test("chat ok", function () {
  pm.response.to.have.status(200);
  const json = pm.response.json();
  pm.expect(json.ok).to.eql(true);
  pm.expect(json.reply).to.be.a("string").and.not.empty;
  pm.expect(json.trace_id).to.be.a("string");
});
```

说明：

- `content` 可以是字符串，也可以是对象；对象里常用 `text`、`messageList`、`attachments`、`tts`。
- 附件字段支持 `url` / `mediaId`、`filename` / `name`、`mimeType`、`caption` / `alt`、`transcript`。
- 不要把 base64 或二进制原文塞进 chat JSON。
- 媒体 URL 建议短期有效或带访问控制，避免把客户隐私素材公开暴露。

## 4. 通过雪创客服调用 SOP Skill

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

## 5. 直连 Metast SOP API 的 Postman 测试

这组接口是直连上游，带真实 `mcpKey` / `mcpSecret` 时可能产生真实查询或外发。只在测试账号、测试联系人、确认过的场景下使用。

### 5.1 个微好友列表

```http
GET {{METAST_BASE_URL}}/prod-api/system/api/im/getWxFrendList?pageNo=1&pageSize=20&sendId={{SEND_ID}}
mcpKey: {{METAST_MCP_KEY}}
mcpSecret: {{METAST_MCP_SECRET}}
```

### 5.2 企微好友列表

```http
GET {{METAST_BASE_URL}}/prod-api/system/api/im/getImFrendList?pageNo=1&pageSize=20&sendId={{SEND_ID}}
mcpKey: {{METAST_MCP_KEY}}
mcpSecret: {{METAST_MCP_SECRET}}
```

### 5.3 创建个微 SOP 任务

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

### 5.4 创建企微 SOP 任务

把 URL 换成：

```http
POST {{METAST_BASE_URL}}/prod-api/system/api/im/sendImSopChatMesage
```

Body 结构同上，但 `accountId` / `friendId` 使用企微侧 ID。

### 5.5 图片、文件、语音消息 item

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

## 6. SOUL 读取、写入与蒸馏接口

这些接口走通用 pool bridge，必须使用 `POOL_BRIDGE_TOKEN`。

### 6.1 读取 Snowchuang SOUL.md

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

### 6.2 用 JSON 覆盖 SOUL.md

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

### 6.3 上传 Markdown 文件覆盖 SOUL.md

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

### 6.4 从聊天记录蒸馏并写入 SOUL.md

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

## 7. 公众号文章与配图人设接口

这组接口维护 Snowchuang logical agent 源 workspace 的 `WECHAT_ARTICLE_PERSONA.md`。它专门给 `wechat-official-account` 和 `article-image-generator` 联动使用，不替代 `SOUL.md`。

可先参考仓库里的 `examples/WECHAT_ARTICLE_PERSONA.zh-CN.md`，再通过下面的 `PUT` 接口写入 Snowchuang 源 workspace。

### 7.1 读取 WECHAT_ARTICLE_PERSONA.md

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

### 7.2 用 JSON 覆盖 WECHAT_ARTICLE_PERSONA.md

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

### 7.3 上传 Markdown 文件覆盖

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

## 8. 朋友圈文案与配图人设接口

这组接口维护 Snowchuang logical agent 源 workspace 的 `WECHAT_MOMENTS_PERSONA.md`。它专门给朋友圈文案、image2 生图和 `metast-im-sop --action moment` 联动使用，不替代 `SOUL.md`，也不复用公众号文章人设。

可先参考仓库里的 `examples/WECHAT_MOMENTS_PERSONA.zh-CN.md`，再通过下面的 `PUT` 接口写入 Snowchuang 源 workspace。

### 8.1 读取 WECHAT_MOMENTS_PERSONA.md

```http
GET {{BASE_URL}}/api/agents/snowchuang/wechat-moments-persona
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
```

预期返回：

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "persona": {
    "name": "WECHAT_MOMENTS_PERSONA.md",
    "path": "/root/.openclaw/workspace-snowchuang/WECHAT_MOMENTS_PERSONA.md",
    "content": "# WECHAT_MOMENTS_PERSONA\n...",
    "bytes": 880,
    "sha256": "...",
    "source_workspace": "/root/.openclaw/workspace-snowchuang"
  }
}
```

### 8.2 用 JSON 覆盖 WECHAT_MOMENTS_PERSONA.md

```http
PUT {{BASE_URL}}/api/agents/snowchuang/wechat-moments-persona
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
Content-Type: application/json
```

Body：

```json
{
  "content": "# WECHAT_MOMENTS_PERSONA\n\n这里填写朋友圈短文案、轻量 CTA、生活化配图和 image2 prompt 约束。",
  "syncWorkers": true
}
```

### 8.3 上传 Markdown 文件覆盖

Postman Body 选择 `form-data`：

| Key | Type | Value |
| --- | --- | --- |
| `personaFile` | File | 选择本地 `WECHAT_MOMENTS_PERSONA.md` |
| `syncWorkers` | Text | `true` |

请求：

```http
PUT {{BASE_URL}}/api/agents/snowchuang/wechat-moments-persona
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
```

注意：

- 默认会同步 source workspace、template workspace 和 5 个 worker。
- `?syncWorkers=false` 或 `"syncWorkers": false` 只会避免同步 template/workers，但仍会改 source workspace。
- `metast-im-sop` 已有朋友圈动作 `moment`；这份文件只控制朋友圈内容人设，真实外发仍要先 dry-run，再经用户明确批准后 submit。
- 这份文件不放客服聊天人格、公众号长文人设、订单号、手机号、wxid、实时价格、库存或客户聊天原文。

## 9. 主动消息白名单接口

这组接口维护 Snowchuang logical agent 源 workspace 的 `ACTIVE_STATUS_WHITELIST.json`。它的作用是限制自动化客服主动发消息的对象：只有白名单里的用户，agent 才允许主动触达。

注意：这不是 Metast 上游 active-status callback URL 本身；上游 URL 仍需在 `metast-im-sop` profile 里单独配置。

### 9.1 读取 ACTIVE_STATUS_WHITELIST.json

```http
GET {{BASE_URL}}/api/agents/snowchuang/active-status-whitelist
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
```

预期返回：

```json
{
  "ok": true,
  "agent_id": "snowchuang",
  "whitelist": {
    "name": "ACTIVE_STATUS_WHITELIST.json",
    "path": "/root/.openclaw/workspace-snowchuang/ACTIVE_STATUS_WHITELIST.json",
    "count": 2,
    "entries": [
      { "tenantId": "tenant-a", "recvId": "recv-1" },
      { "tenantId": "tenant-a", "recvId": "recv-2" }
    ],
    "source_workspace": "/root/.openclaw/workspace-snowchuang"
  }
}
```

### 9.2 用 tenantId + content 覆盖白名单

`content` 支持逗号、中文逗号、分号、换行或空格分隔多个 `recvId`。

```http
PUT {{BASE_URL}}/api/agents/snowchuang/active-status-whitelist
Authorization: Bearer {{POOL_BRIDGE_TOKEN}}
Content-Type: application/json
```

Body：

```json
{
  "tenantId": "tenant-a",
  "content": "recv-1,recv-2",
  "syncWorkers": true
}
```

### 9.3 用结构化 entries 覆盖白名单

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

允许的目标标识字段包括 `recvId`、`userId`、`wxid`、`phone`、`conversationId`。主动触达前应至少命中其中一个字段。

默认会同步 source workspace、template workspace 和 5 个 worker。`?syncWorkers=false` 或 `"syncWorkers": false` 只会避免同步 template/workers，但仍会改 source workspace。

## 10. Postman 环境变量

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

## 11. 常见错误

| HTTP 状态 / 现象 | 常见原因 | 处理 |
| --- | --- | --- |
| `401 unauthorized` | token 用错，或把 chat token 用到了维护接口 | 区分 `CHAT_BRIDGE_TOKEN` 和 `POOL_BRIDGE_TOKEN` |
| `400 invalid_request` | JSON 格式错误、缺 `conversationId`、缺 `content` / `message` | 检查 Body 和 Content-Type |
| `message/content.messageList is required` | chat 请求没有可用文本，也没有可提取的用户消息 | 传 `message`、`content.text` 或 `content.messageList` |
| 富媒体附件 agent 看不懂内容 | 只传了不可访问 URL，或语音没有 `transcript` | 先上传到可访问地址；语音同时传转写文本 |
| 请求了 TTS 但没有音频输出 | `content.tts` 只是请求信号，OpenClaw TTS 或 TTS skill 未产出音频 | 检查响应里的 `tts.requested`，再查 OpenClaw TTS 配置 |
| `SOUL.md content is required` | `PUT /soul` 没有传 `content` 或 `soulFile` | 用 raw JSON 或 form-data 文件 |
| `WECHAT_ARTICLE_PERSONA.md content is required` | `PUT /wechat-article-persona` 没有传 `content` 或 `personaFile` | 用 raw JSON 或 form-data 文件 |
| `WECHAT_MOMENTS_PERSONA.md content is required` | `PUT /wechat-moments-persona` 没有传 `content` 或 `personaFile` | 用 raw JSON 或 form-data 文件 |
| `ACTIVE_STATUS_WHITELIST.json must include at least one user` | `PUT /active-status-whitelist` 没有传用户 ID | 传 `content` 或 `entries` |
| `chat log content is required` | `POST /soul/distill` 没有传 `chatLog` 或 `chatFile` | 补充聊天记录 |
| `soul_distiller_not_configured` | 服务器没有配置 `SOUL_DISTILLER_AGENT_ID` | 联系运维检查 pool bridge `.env` |
| SOP 直连接口返回失败 | Metast mcp 凭据、账号 ID、好友 ID、权限或请求体不正确 | 先测好友列表，再测 SOP 创建 |

## 12. 安全边界

- chat 调用 SOP skill 时，默认要求 dry-run。
- 富媒体 chat 不接收 base64 / 二进制原文，只传 URL、mediaId 和必要元数据。
- 客户图片、语音、文件 URL 不要长期裸露公网；生产建议使用短期签名 URL 或平台 mediaId。
- 直连 Metast SOP API 是真实上游请求，Postman 测试必须使用测试账号和测试好友。
- 自动化客服主动发消息前必须先查 `ACTIVE_STATUS_WHITELIST.json`，不在白名单里不能主动触达。
- 不要把 `mcpKey`、`mcpSecret`、bridge token、wxid、手机号、订单号、真实聊天记录写入 Git、截图或公开文档。
- 缺 endpoint 的能力不要猜路径。目前老私聊发消息、主动状态回调、知识库/聊天记录/朋友圈设定上传都需要上游确认 URL 后再配置。
