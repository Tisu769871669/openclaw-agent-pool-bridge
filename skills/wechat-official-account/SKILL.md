---
name: wechat-official-account
description: 编写微信公众号文章、搜索整理素材、上传草稿并通过微信官方 API 自动发布。适用于多主体公众号运营；业务定位通过 profiles/*.json 控制。
---

# 微信公众号运营技能

使用本技能处理微信公众号内容运营任务：

- 编写公众号文章；
- 搜索和整理素材；
- 创建文章包；
- 上传草稿；
- 自动发布；
- 查询和记录发布结果。

## 默认流程

1. 选择 profile，例如 `sudan-health`。
2. 明确文章主题、目标读者、参考资料和发布模式。
3. 先生成文章包，包含标题、摘要、作者、Markdown 正文、封面说明。
4. 对大健康、金融、法律等高风险领域做合规检查。
5. 使用 `scripts/wechat-official-account.js --mode dry-run` 预检查。
6. 只有在用户明确要求自动发布，且 profile 允许时，才使用 `--mode publish`。
7. 发布后检查输出和审计日志。

## 发布模式

- `dry-run`：不调用微信 API。
- `draft-only`：创建草稿，不发布。
- `publish`：创建草稿并提交发布。

## 图片与排版

- 正文图片不要直接复制外部平台图片；优先使用原创图片、授权图片或用户提供图片。
- `article.json` 可用 `coverPath` 指向新封面图；脚本会上传为永久图片素材，并把返回的 `media_id` 用作草稿封面。
- `article.json` 可用 `contentImages` 声明正文图片，并在 `markdown` 中写 `{{image:key}}` 插入位置。
- 正文渲染会使用公众号友好的简单 HTML：`h1`、`h2`、`p`、`ul/li`、`strong`、`img`。
- 如果需要更强的公众号排版，可在 `article.json` 中提供 `html` 字段，直接写公众号兼容 HTML；`{{image:key}}` 占位符同样可用。
- `html` 字段会拒绝明显危险的脚本、iframe、事件属性和 `javascript:` 链接；不要把外部平台原文或图片直接搬运进来。
- 不要把写作指导放进正文，例如“这篇直接按小红书穿搭笔记的方式来”“短句、公式、避雷点、一屏一个重点”。这些只能放在 Agent prompt 里，不能进入 `markdown` 或 `html`。
- 文末引导区由 profile 的 `articleFooter` 自动追加。生成正文时不要手写二维码区，避免重复。

## 文末 CTA

profile 可配置 `articleFooter`：

- `qrImages`：文末二维码图片，脚本会在 `draft-only`/`publish` 时上传并插入正文末尾。
- `miniProgram`：可选小程序卡片，只有配置了 `appId`、`path`、`title`、`imageUrl` 才会渲染 `<mp-miniprogram>`。

雪创 `snowchuang-yihuang` 已配置企业微信和个人微信两个二维码；小程序参数未配置前不会插入无效小程序卡片。

## 业务 profiles

`profiles/sudan-health.json` 用于苏丹大健康公众号。写作时保持可信、生活化、适度成交，不承诺疗效，不制造焦虑，不把产品描述成医疗建议。

`profiles/snowchuang-yihuang.json` 用于雪创“衣荒救星站”。写作时保持亲切、实用、有画面感、适度成交；可以参考小红书标题节奏和穿搭公式，但必须原创，不照搬平台原文或图片。

## 安全要求

- 不把 `WECHAT_MP_APP_SECRET`、access token、密码写进 Git 或日志。
- 服务器上配置凭证、改 env、改服务，必须先得到用户同意。
- 自动发布必须留下审计日志。
