---
name: article-image-generator
description: Generate original article images through the image2 API from an Agent-authored image plan, then write local assets and article.with-images.json for downstream publishing skills.
---

# Article Image Generator

Use this skill when an article needs generated images before it is handed to a publishing skill such as `wechat-official-account`.

## Workflow

1. Draft `article.json` first.
2. Insert image placeholders in the body, such as `{{image:lookGrid}}`.
3. Write `image-plan.json` with one item per image.
4. Run dry-run validation.
5. Run generation only when image2 credentials are available and the user expects paid external image generation.
6. Pass `article.with-images.json` to the publishing skill.

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
