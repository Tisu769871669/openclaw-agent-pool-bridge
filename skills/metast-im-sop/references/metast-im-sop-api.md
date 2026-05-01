# Metast IM SOP API Reference

Source: user-provided SOP notes, normalized here without credentials or customer data.

## Authentication

All confirmed endpoints use headers:

```http
mcpKey: <MCP key>
mcpSecret: <MCP secret>
```

Default base URL:

```text
https://lx.metast.cn
```

## Platform Mapping

| Platform | Meaning | Friend List | SOP / Moment Endpoint |
| --- | --- | --- | --- |
| `wx` | 个微 / personal WeChat | `GET /prod-api/system/api/im/getWxFrendList` | `POST /prod-api/system/api/im/sendWxSopChatMesage` |
| `im` | 企微 / WeCom | `GET /prod-api/system/api/im/getImFrendList` | `POST /prod-api/system/api/im/sendImSopChatMesage` |

Friend list query params:

```json
{
  "pageNo": 1,
  "pageSize": 20,
  "sendId": "sender account id"
}
```

## SOP Task Body

Common fixed fields:

```json
{
  "sendLimit": "1000",
  "sendingDate": "1",
  "loopNums": "30",
  "fromDuration": "10:00",
  "endDuration": "22:00",
  "loopStatus": false,
  "senderType": "0"
}
```

`sopInfo.sopNo` values:

| Value | Meaning | Notes |
| --- | --- | --- |
| `S0` | 单事件 | First event only. |
| `S2` | 事件型 | `eventList[].day` can delay later sends by days. First `day` is usually empty. |
| `S3` | 循环型 | Supports `sopInfo.loopCount`; event days define each cycle step. |

SOP message item formats:

```json
{ "type": 0, "content": "文本和表情[呲牙]" }
```

```json
{
  "type": 1,
  "content": "{\"originUrl\":\"https://lx.metast.cn/imfile/image.jpg\",\"thumbUrl\":\"https://lx.metast.cn/imfile/image.jpg\"}"
}
```

```json
{
  "type": 2,
  "content": "{\"name\":\"报价.pdf\",\"size\":176899,\"url\":\"https://lx.metast.cn/imfile/file.pdf\"}"
}
```

```json
{
  "type": 3,
  "content": "{\"name\":\"voice.wav\",\"url\":\"https://lx.metast.cn/imfile/voice.wav\",\"duration\":5.632}"
}
```

Contact list:

```json
{
  "concatList": [
    {
      "accountId": "sender account id",
      "friendId": "receiver friend id",
      "friendName": "receiver display name"
    }
  ]
}
```

## Moment Body

Image Moment:

```json
{
  "planSendTime": "2026-04-30 18:12:37",
  "visibleType": 0,
  "headImage": "",
  "content": "测[呲牙]",
  "title": "",
  "contentUrl": "",
  "mediaList": [
    {
      "type": "1",
      "imgUrl": "https://lx.metast.cn/imfile/image.jpg"
    }
  ],
  "authorVids": ["sender account id"],
  "xid": "visible friend ids joined by comma"
}
```

Video cover difference:

| Platform | Cover Field |
| --- | --- |
| `wx` | `headImage: "<cover url>"` |
| `im` | extra `mediaList` item `{ "type": "3", "imgUrl": "<cover url>" }` |

Video media item:

```json
{
  "type": "2",
  "videoUrl": "https://lx.metast.cn/imfile/video.mp4",
  "videoLen": 10
}
```

## Legacy Rich Private Message

The SOP source says the old `sendChatMesage` request changed:

- add `sendId`
- add `recvId`
- change `content` into an object

Content object formats:

```json
{ "value": "1111", "type": "0" }
```

```json
{ "value": "https://lx.metast.cn/image.jpg", "type": "1" }
```

```json
{ "value": "https://lx.metast.cn/file.pdf", "name": "文件名", "type": "2" }
```

```json
{ "value": "https://lx.metast.cn/voice.wav", "duration": "时长", "type": "3" }
```

The source file did not include the endpoint URL. Configure `profile.endpoints.sendChatMessagePath` before live use.

## Pending URL Gaps

The source file lists these body contracts but does not provide endpoint paths:

| Capability | Body Fields |
| --- | --- |
| Knowledge upload | `content`, `tenantId` |
| SOP / so upload | `content`, `tenantId` |
| Chat record upload | `content`, `tenantId` |
| Moment setting upload | `content`, `tenantId` |
| Active status callback | `sendId`, `recvId`, `status`, `tenantId`, `conversationId` |

Do not invent endpoint paths. Add them to a profile after the upstream provider confirms the URLs.
