# 微信公众号运营技能

本仓库包含通用 OpenClaw agentpool，也可以承载通用 skill 包。`skills/wechat-official-account/` 是微信公众号运营技能，不属于 bridge runtime。

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
