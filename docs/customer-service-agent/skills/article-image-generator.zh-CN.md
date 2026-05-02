# 文章生图 Skill / Article Image Generator

`skills/article-image-generator/` is the shared OpenClaw skill for article image generation. It is the canonical copy for all customer-service agents, including Snowchuang and Sudan.

中文说明：这个 skill 不再属于某一个特化客服。仓库根目录的 `skills/article-image-generator/` 是通用源，部署时把它安装进每个 logical agent 的 template workspace，然后同步到 worker。

## 运行位置 / Runtime Position

```text
openclaw-agent-pool-bridge/
  skills/article-image-generator/        # shared source in Git
    SKILL.md
    profiles/
      snowchuang-yihuang.json
      sudan-health.json
    scripts/

/root/openclaw-agent-templates/<agent>/  # per-agent template on server
  skills/article-image-generator/        # installed copy

/root/.openclaw/workers/workspace/<worker>/
  skills/article-image-generator/        # synced runtime copy
```

Do not edit only one worker workspace. Worker workspaces are runtime copies and can be overwritten.

## 安装到所有客服 / Install To All Configured Agents

Run from the bridge checkout on each server:

```bash
cd /opt/openclaw-agent-pool-bridge

node scripts/install-shared-skill.js article-image-generator \
  --config agent-pool.config.json \
  --sync-workers \
  --dry-run

node scripts/install-shared-skill.js article-image-generator \
  --config agent-pool.config.json \
  --sync-workers
```

`install-shared-skill.js` installs the root `skills/article-image-generator/` directory into every configured `templateWorkspace` in `agent-pool.config.json`. `--sync-workers` then mirrors each template into its worker pool.

If a server has multiple logical agents in one config, the same command covers all of them. To target one agent only:

```bash
node scripts/install-shared-skill.js article-image-generator \
  --config agent-pool.config.json \
  --agent main \
  --sync-workers
```

Restart the bridge after syncing:

```bash
sudo systemctl restart "$SERVICE_NAME"
curl -sS "http://127.0.0.1:$PORT/health"
```

## 验证 / Verify

List template copies:

```bash
find /root/openclaw-agent-templates -maxdepth 4 -type f \
  -path '*/skills/article-image-generator/SKILL.md' | sort
```

List worker copies:

```bash
find /root/.openclaw/workers/workspace -maxdepth 5 -type f \
  -path '*/skills/article-image-generator/SKILL.md' | sort
```

Expected result: every active specialized agent template and every worker under it has `skills/article-image-generator/SKILL.md`.

## 使用方式 / Usage

Dry-run validation does not call the image API:

```bash
node skills/article-image-generator/scripts/article-image-generator.js \
  --mode dry-run \
  --image-plan image-plan.json \
  --article-json article.json \
  --output-dir tmp/article-assets \
  --out-article article.with-images.json
```

Generate images only when paid image generation is intended:

```bash
IMAGE2_API_KEY="$IMAGE2_API_KEY" \
IMAGE2_MODEL=gpt-image-2 \
node skills/article-image-generator/scripts/article-image-generator.js \
  --mode generate \
  --image-plan image-plan.json \
  --article-json article.json \
  --output-dir tmp/article-assets \
  --out-article article.with-images.json
```

`article.with-images.json` can then be passed into `skills/wechat-official-account/`.

## 公众号人设联动 / WeChat Persona Handoff

当这套生图流程服务于微信公众号文章时，图片风格不从 `SOUL.md` 推导，也不要在 `article-image-generator` 里单独发明一份视觉人设。先读取当前 logical agent 的 `WECHAT_ARTICLE_PERSONA.md`，再把其中的口吻、读者、品牌边界、色彩材质、禁用元素转成 `image-plan.json` 的 prompt 约束。

维护接口：

```http
GET /api/agents/:agentId/wechat-article-persona
PUT /api/agents/:agentId/wechat-article-persona
```

生成的公开图片说明、alt 文本、正文 caption 不能泄露 `WECHAT_ARTICLE_PERSONA.md` 原文。

## 安全边界 / Security

- Do not commit `IMAGE2_API_KEY` or any image provider token.
- Keep generated images and manifests in `tmp/` or another operational output directory.
- Use `dry-run` before `generate` so the operator can see how many images will be created.
- Use the included profiles for customer style defaults; add new profiles only when a new客服 needs distinct image style constraints.
