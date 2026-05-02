---
name: article-image-generator
description: Generate original article images through the image2 API from an Agent-authored image plan, then write local assets and article.with-images.json for downstream publishing skills.
---

# Article Image Generator

Use this skill when an article needs generated images before it is handed to a publishing skill such as `wechat-official-account`.

## Workflow

1. Draft `article.json` first.
2. If the image plan is for a WeChat official-account article, read the current logical agent's `WECHAT_ARTICLE_PERSONA.md` and use it as the image style/persona constraint.
3. Insert image placeholders in the body, such as `{{image:lookGrid}}`.
4. Write `image-plan.json` with one item per image.
5. Run dry-run validation.
6. Run generation only when image2 credentials are available and the user expects paid external image generation.
7. Pass `article.with-images.json` to the publishing skill.

## WeChat Article Persona

- `WECHAT_ARTICLE_PERSONA.md` is the shared persona source for WeChat article copy and image prompts.
- Keep image prompts aligned with that file's tone, audience, brand constraints, color/material preferences, and forbidden content.
- Do not invent a separate visual persona when `wechat-official-account` and this skill are used together.
- Do not copy the persona prompt text into `article.json`, `image-plan.json` public captions, logs, or published content.

## Commands

```bash
node skills/article-image-generator/scripts/article-image-generator.js \
  --mode dry-run \
  --image-plan image-plan.json \
  --article-json article.json \
  --output-dir tmp/article-assets \
  --out-article article.with-images.json
```

```bash
IMAGE2_API_KEY="$IMAGE2_API_KEY" \
node skills/article-image-generator/scripts/article-image-generator.js \
  --mode generate \
  --image-plan image-plan.json \
  --article-json article.json \
  --output-dir tmp/article-assets \
  --out-article article.with-images.json
```

## Safety

- Do not copy external platform source images.
- Do not request watermarks, logos, or identifiable private people.
- Do not write image API keys to Git, article JSON, manifest files, docs, or logs.
- State how many images will be generated before running `generate`.
