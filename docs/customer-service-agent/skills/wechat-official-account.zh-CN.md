# 微信公众号运营 Skill

本仓库包含通用 OpenClaw agentpool，也可以承载通用 skill 包。`skills/wechat-official-account/` 是微信公众号运营技能，不属于 bridge runtime。

中文说明：这份文档只维护公众号文章、素材、草稿和发布相关能力。私域 IM/SOP、朋友圈和个人微信外发走 `metast-im-sop`；文章配图走 `article-image-generator`。

## 公众号人设文件

公众号文章和配图不再从 `SOUL.md` 推导人设。每个 logical agent 维护独立的 `WECHAT_ARTICLE_PERSONA.md`：

```text
/root/.openclaw/workspace-<agent>/WECHAT_ARTICLE_PERSONA.md
  -> /root/openclaw-agent-templates/<agent>/WECHAT_ARTICLE_PERSONA.md
  -> /root/.openclaw/workers/workspace/<worker>/WECHAT_ARTICLE_PERSONA.md
```

这份文件只约束公众号内容运营：文章口吻、栏目感、选题偏好、商业分寸、配图风格、image2 prompt 边界。客服日常聊天人格仍然放在 `SOUL.md`。

示例模板在仓库根目录 `examples/WECHAT_ARTICLE_PERSONA.zh-CN.md`。运行时写入 logical agent workspace 时，文件名使用 `WECHAT_ARTICLE_PERSONA.md`。

维护接口：

```http
GET {{BASE_URL}}/api/agents/:agentId/wechat-article-persona
PUT {{BASE_URL}}/api/agents/:agentId/wechat-article-persona
```

写公众号文章前，先读取当前 logical agent 的 `WECHAT_ARTICLE_PERSONA.md`。需要生图时，把同一份约束带入 `image-plan.json`，不要单独创造另一套视觉人设。

## 使用方式

```bash
node skills/wechat-official-account/scripts/wechat-official-account.js \
  --mode dry-run \
  --profile sudan-health \
  --article-json article.json
```

自动发布：

```bash
node skills/wechat-official-account/scripts/wechat-official-account.js \
  --mode publish \
  --profile sudan-health \
  --article-json article.json \
  --thumb-media-id COVER_MEDIA_ID
```

带新图片创建草稿：

```bash
node skills/wechat-official-account/scripts/wechat-official-account.js \
  --mode draft-only \
  --profile snowchuang-yihuang \
  --article-json article.json \
  --cover-path cover.jpg
```

`article.json` 可以声明正文图片。脚本会先上传图片到微信，再把返回的微信图片 URL 插入正文 HTML：

```json
{
  "title": "低饱和韩系穿搭公式",
  "author": "衣荒救星站",
  "digest": "用基础款穿出韩系日常感。",
  "coverPath": "cover.jpg",
  "markdown": "## 搭配公式\n\n{{image:look1}}\n\n低饱和色系更耐看。",
  "contentImages": [
    { "key": "look1", "path": "look1.png", "alt": "韩系低饱和穿搭示意图" }
  ]
}
```

如果需要更细的公众号排版，例如小红书笔记式分区、色块、短句卡片，可以直接提供 `html` 字段。脚本会保留这段公众号兼容 HTML，并替换正文图片占位符：

```json
{
  "title": "低饱和韩系穿搭公式",
  "author": "衣荒救星站",
  "digest": "用基础款穿出韩系日常感。",
  "coverPath": "cover.jpg",
  "html": "<section style=\"padding:16px;background:#fff8f0;\"><p><strong>今天这套太适合通勤了。</strong></p>{{image:look1}}</section>",
  "contentImages": [
    { "key": "look1", "path": "look1.png", "alt": "韩系低饱和穿搭示意图" }
  ]
}
```

`html` 字段会拒绝明显危险的脚本、iframe、事件属性和 `javascript:` 链接。公众号素材仍应使用原创图片、授权图片或用户提供图片，不要直接搬运小红书原图。

不要把生成方式写进正文。比如“这篇直接按小红书穿搭笔记的方式来：短句、公式、避雷点，一屏一个重点”属于给 Agent 的写作约束，不属于读者正文，脚本会直接拒绝这类 article package。

## 文末 CTA 与二维码

profile 可以配置 `articleFooter`。它会在正文末尾自动追加引导区，并在创建草稿/发布时上传二维码图片：

```json
{
  "articleFooter": {
    "enabled": true,
    "title": "想要更多穿搭建议？",
    "description": "扫码添加雪创，获取更适合你的日常搭配建议。",
    "qrImages": [
      {
        "key": "snowchuangWecomQr",
        "path": "../assets/snowchuang/wecom-qr.jpg",
        "alt": "雪创连科企业微信二维码",
        "caption": "扫码添加企业微信"
      }
    ]
  }
}
```

如果要插入小程序卡片，在 `articleFooter.miniProgram` 里配置完整字段：

```json
{
  "miniProgram": {
    "appId": "小程序 AppID",
    "path": "pages/index/index",
    "title": "卡片标题",
    "imageUrl": "已上传到微信素材或可用的封面图 URL"
  }
}
```

小程序字段不完整时，脚本不会渲染 `<mp-miniprogram>`，避免生成无效卡片。二维码和小程序 CTA 都由 profile 自动追加，文章正文里不要手写。

运行 `draft-only` 或 `publish` 前，需要通过环境变量提供公众号凭证：

```env
WECHAT_MP_APP_ID=
WECHAT_MP_APP_SECRET=
```

## 部署到 worker

修改 logical agent 的模板 workspace 后，使用：

```bash
agents-pool sync main --source-workspace /root/.openclaw/workspace
```

不要直接修改单个 worker workspace。

## Generated Image Handoff / 生图交接

需要文章配图时，先运行通用 `skills/article-image-generator/`。它会生成本地图片资产和 `article.with-images.json`，里面已经包含 `coverPath` 和 `contentImages`，可以直接交给公众号 skill。

```bash
node skills/article-image-generator/scripts/article-image-generator.js \
  --mode generate \
  --image-plan image-plan.json \
  --article-json article.json \
  --out-article article.with-images.json

node skills/wechat-official-account/scripts/wechat-official-account.js \
  --mode draft-only \
  --profile snowchuang-yihuang \
  --article-json article.with-images.json
```
