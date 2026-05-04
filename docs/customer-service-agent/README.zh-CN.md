# 通用客服 Agent 文档

这个目录专门维护通用客服 agent 相关文档：哪些能力是所有客服可复用的，哪些内容属于服务器运维，哪些内容只应该放在本地私有手册里。

## 文档分类

| 类别 | 文档 | 维护内容 |
| --- | --- | --- |
| 能力总览 | `README.zh-CN.md` | 通用客服 agent 文档入口、分类规则和维护边界。 |
| 服务器地图 | `operations/server-map.zh-CN.md` | 雪创 / 苏丹服务器上的服务、端口、路径、功能边界和排查入口。 |
| OSS 文件能力 | `skills/aliyun-oss.zh-CN.md` | 阿里云 OSS skill 的安装、同步、测试、安全边界。 |
| 语音能力 | `skills/tts.zh-CN.md` | OpenClaw 原生 TTS 与 `edge-tts` skill 的取舍、配置和验证。 |
| 文章生图 | `skills/article-image-generator.zh-CN.md` | 通用文章生图 skill 的部署、调用、与公众号文章包的交接。 |
| 公众号运营 | `skills/wechat-official-account.zh-CN.md` | 公众号文章包、素材上传、草稿、发布和 CTA 配置。 |
| 私域 IM/SOP | `skills/metast-im-sop.zh-CN.md` | Metast 私域联系人、SOP、朋友圈和真实外发安全规则。 |
| 雪创 SOP / SOUL / 内容人设 / 主动白名单 API | `api/snowchuang-sop-soul-postman.zh-CN.md` | 给同事对接用的 Snowchuang SOP skill、SOUL 蒸馏、公众号人设、朋友圈人设、主动消息白名单和 Postman 测试文档。 |

项目级 bridge 文档仍保留在上一级：

| 文档 | 内容 |
| --- | --- |
| `../architecture.md` | bridge 架构、请求链路、worker pool 和组件职责。 |
| `../cli.md` | `agents-pool` CLI 命令、参数和常用操作。 |
| `../integrations.md` | Sudan、TokyoClaw、WeCom 等业务桥接入方式。 |
| `../../README.md` | 项目入口、快速启动、HTTP API 和配置说明。 |

`../ops.local.zh-CN.md` 是本地/服务器运维手册，已加入 `.gitignore`。它可以记录当前服务器细节和临时操作，但不要把 token、API key、客户隐私、真实订单信息写进去。

## 维护规则

- 新增通用客服能力时，优先在 `skills/` 下建独立中文文档。
- 服务器现状、端口、服务名、路径和排查入口写入 `operations/server-map.zh-CN.md`。
- 具体上线命令如果会因服务器不同而变化，放在 `../ops.local.zh-CN.md`，并在这里保留稳定入口链接。
- 重复内容只保留一个权威版本：skill 的安装和安全边界以 `skills/*.zh-CN.md` 为准，本地运维手册只保留最短操作入口和指向链接。
- 涉及真实外发、删除、发布、批量推送的能力，默认保持 dry-run 或显式确认流程。
- 不直接改单个 worker workspace；改源 workspace 或 template workspace 后，通过 `agents-pool sync` 同步到 worker。
