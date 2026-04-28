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
