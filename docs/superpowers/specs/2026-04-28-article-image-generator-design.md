# Article Image Generator Skill Design

Date: 2026-04-28

## Decision

Add a standalone reusable OpenClaw skill named `article-image-generator` under the generic `openclaw-agent-pool-bridge` repository:

```text
skills/article-image-generator/
```

The skill generates article images through the image2 API and writes local image assets plus an updated article package. It must not be part of the bridge runtime in `src/`. It sits beside `skills/wechat-official-account/` and feeds that existing skill through the already supported `coverPath`, `contentImages`, and `{{image:key}}` article fields.

## Goal

Turn an Agent-authored article package plus an Agent-authored image plan into a WeChat-ready article package with generated local images.

The target workflow is:

```text
User article request
  -> Agent writes article.json with html or markdown and image placeholders
  -> Agent writes image-plan.json with image2 prompts
  -> article-image-generator creates PNG files and manifest
  -> article-image-generator writes article.with-images.json
  -> wechat-official-account uploads images and creates draft or publish job
```

## Non-Goals

- Do not upload images to WeChat. That remains the job of `wechat-official-account`.
- Do not create drafts or publish articles.
- Do not generate the article body. The content Agent remains responsible for title, digest, body, and image prompt intent.
- Do not store image API keys in Git, generated manifests, docs, or audit logs.
- Do not directly edit server worker workspaces during development. Code changes still flow local repo -> GitHub -> server pull -> template sync.

## Repository Placement

Planned files:

```text
skills/article-image-generator/
  SKILL.md
  profiles/
    example.json
    snowchuang-yihuang.json
    sudan-health.json
  references/
    image2-api.md
  scripts/
    article-image-generator.js
    lib/
      article-merge.js
      image-plan.js
      image2-client.js
      manifest.js
test/article-image-generator/
  article-merge.test.js
  image-plan.test.js
  image2-client.test.js
  cli.test.js
```

The package stays dependency-light and uses Node 20+ built-ins where possible, matching the current repository style.

## Inputs

### Article Package

The existing `wechat-official-account` article package remains the canonical downstream format. It can contain `markdown` or `html`, and image placeholders such as:

```json
{
  "title": "韩式穿搭太会了！低饱和公式直接抄作业",
  "author": "衣荒救星站",
  "digest": "一篇小红书风格的低饱和韩系穿搭文章。",
  "html": "<section>{{image:coverMood}}</section><section>{{image:lookGrid}}</section>"
}
```

### Image Plan

The Agent writes `image-plan.json`. Each image item must be explicit enough that the generator can run without inventing the missing creative brief:

```json
{
  "profile": "snowchuang-yihuang",
  "articleJson": "article.json",
  "outputDir": "tmp/article-assets",
  "images": [
    {
      "key": "coverMood",
      "role": "cover",
      "prompt": "Photorealistic Korean women's fashion editorial cover, low-saturation beige and soft blue palette, spring outfits, clean WeChat article cover composition, no text, no logo.",
      "alt": "韩系低饱和穿搭真实感封面图",
      "size": "1024x1024"
    },
    {
      "key": "lookGrid",
      "role": "body",
      "prompt": "Four coordinated Korean-style outfits on a clean studio background, low saturation, practical daily styling, no text, no watermark.",
      "alt": "四套韩系低饱和穿搭真实感示意图",
      "size": "1024x1024"
    }
  ]
}
```

Required fields:

- `profile`
- `images[].key`
- `images[].role`, either `cover` or `body`
- `images[].prompt`
- `images[].alt`

Optional fields:

- `articleJson`
- `outputDir`
- `images[].size`, default from profile
- `images[].filename`
- `images[].negativePrompt`

Validation rules:

- Image keys must be unique.
- Exactly one `cover` image is recommended. If more than one cover is provided, the CLI fails.
- A `body` image key should appear in the article body as `{{image:key}}`. In non-strict mode missing placeholders are warnings; in strict mode they are errors.
- Prompts must reject requests to copy external-platform images, watermarks, logos, identifiable private people, or copyrighted characters.

## Profiles

Profiles set defaults, not secrets. They live in Git and can be reused across subjects:

```json
{
  "id": "snowchuang-yihuang",
  "subject": "雪创",
  "defaultModel": "gpt-image-2",
  "defaultSize": "1024x1024",
  "styleGuide": "亲切、实用、有画面感；韩系低饱和；公众号正文图；不含文字、水印、logo。",
  "promptPrefix": "Create an original image for a WeChat official account fashion article.",
  "blockedPromptTerms": ["小红书原图", "照搬", "水印", "logo", "明星同款脸"]
}
```

The first version includes:

- `snowchuang-yihuang`: fashion, outfit, apparel-commerce images.
- `sudan-health`: restrained health/lifestyle images that avoid medical miracle claims.
- `example`: neutral sample profile for tests and docs.

## CLI

Primary command:

```bash
node skills/article-image-generator/scripts/article-image-generator.js \
  --image-plan image-plan.json \
  --article-json article.json \
  --output-dir tmp/article-assets \
  --out-article article.with-images.json
```

Supported modes:

- `--mode dry-run`: validate plan and article, write a planned manifest, do not call image2.
- `--mode generate`: call image2, save image files, write manifest and updated article JSON.

Environment variables:

```env
IMAGE2_API_BASE_URL=https://api.ohmygpt.com/v1
IMAGE2_API_KEY=runtime_secret_not_committed
IMAGE2_MODEL=gpt-image-2
IMAGE2_TIMEOUT_MS=180000
IMAGE2_MAX_RETRIES=2
```

The API key is required only for `generate` mode. It must be supplied by environment variable or one-time process environment on the server. It is never written to `.env`, logs, manifests, or docs by the skill.

## Output Files

For a run directory such as `tmp/snowchuang-article-20260428`, the skill writes:

```text
tmp/snowchuang-article-20260428/
  assets/
    coverMood.png
    lookGrid.png
  assets-manifest.json
  article.with-images.json
```

Manifest shape:

```json
{
  "createdAt": "2026-04-28T10:00:00.000Z",
  "profile": "snowchuang-yihuang",
  "model": "gpt-image-2",
  "articleJson": "/abs/path/article.json",
  "outArticle": "/abs/path/article.with-images.json",
  "images": [
    {
      "key": "coverMood",
      "role": "cover",
      "path": "/abs/path/assets/coverMood.png",
      "alt": "韩系低饱和穿搭真实感封面图",
      "size": "1024x1024",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ]
}
```

The updated article package sets:

- `coverPath` to the generated cover image path.
- `contentImages` to all generated images, including the cover if the body uses its placeholder.
- existing article fields such as `title`, `digest`, `author`, `html`, `markdown`, and `sourceLinks` are preserved.

## Image2 API Contract

The first implementation targets the image2-compatible endpoint that previously worked from the Snowchuang server:

- Base URL: `https://api.ohmygpt.com/v1`
- Model: `gpt-image-2`

The client should be isolated in `scripts/lib/image2-client.js` so future providers can be swapped without changing plan validation or article merging. Tests use an injected `fetchImpl` and never call the real API.

The client accepts a prompt, model, size, and timeout, then returns PNG bytes. It should support common OpenAI-style response shapes:

- base64 image data in `data[0].b64_json`
- image URL in `data[0].url`, downloaded by the client

If the provider returns a different shape, the error should include the response keys and status without printing secrets.

## Integration With WeChat Skill

The skills remain loosely coupled by file contract:

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

`wechat-official-account` continues to upload the generated `coverPath` and `contentImages` to WeChat. This keeps API responsibilities clean:

- `article-image-generator`: image creation and local asset manifest.
- `wechat-official-account`: WeChat media upload, draft creation, publishing, and WeChat audit.

## Agent Instructions

`SKILL.md` should tell the Agent to:

1. Draft the article first.
2. Insert image placeholders where images should appear.
3. Write a matching `image-plan.json`.
4. Run `dry-run`.
5. Run `generate` only when image API credentials are available.
6. Review the generated manifest and updated article path.
7. Pass `article.with-images.json` to `wechat-official-account`.

For Snowchuang, the default article image set is:

- `coverMood`: cover image.
- `lookGrid`: outfit grid or main visual explanation.
- `palette`: colors, fabrics, or detail inspiration.
- `formula`: outfit formula or flat-lay composition.
- `scenes`: commute, dating, weekend, or other scenario image.

The Agent may use fewer images when the article does not need all five.

## Error Handling

The CLI should fail before generation when:

- the article JSON is missing or invalid;
- the image plan has duplicate keys;
- multiple cover images are present;
- a required prompt or alt text is empty;
- profile validation fails;
- blocked prompt terms are present.

The CLI should fail during generation when:

- `IMAGE2_API_KEY` is missing in `generate` mode;
- image2 returns a non-2xx response;
- response JSON cannot be parsed;
- response has no image data or URL;
- downloaded URL content is not image-like;
- file write fails.

Partial results are allowed only in a timestamped run directory. The manifest records `status: "failed"` for failed images. `article.with-images.json` is written only when every requested image succeeds.

## Security And Operations

- The skill never persists API keys.
- Logs and manifests include model, profile, prompt hash, image path, and file hash, but not API keys.
- Generated images should live in a run directory under `/tmp` on servers by default, unless the caller passes a different output directory.
- Existing server deployment policy still applies: implement locally, merge through GitHub, pull on server, sync template to workers.
- Real image generation is an external API call and should be treated like a paid side-effect. For production article runs, the Agent should state how many images will be generated before running `generate`.

## Testing Strategy

Unit tests:

- image plan validation accepts a complete plan;
- validation rejects duplicate keys and multiple covers;
- profile loading applies defaults;
- blocked prompt terms are rejected;
- article merge preserves article fields and writes `coverPath` plus `contentImages`;
- image2 client parses base64 image responses;
- image2 client downloads URL image responses;
- secret redaction keeps API keys out of errors and manifests.

CLI tests:

- `dry-run` validates and writes a planned manifest without requiring `IMAGE2_API_KEY`;
- `generate` with mocked fetch writes PNG files, manifest, and `article.with-images.json`;
- failed image generation does not write the updated article package.

Server smoke after deployment:

- run `dry-run` in the Snowchuang template workspace;
- run mocked or one-image real generation only with explicit user approval and a temporary API key;
- pass the generated article to `wechat-official-account --mode dry-run`;
- do not create a real WeChat draft unless separately approved.

## Rollout Plan

1. Implement the skill and tests in `D:\Study\codeXprojection\openclaw-agent-pool-bridge`.
2. Merge through GitHub.
3. Pull `/opt/openclaw-agent-pool-bridge` on the Snowchuang server.
4. Sync `skills/article-image-generator` into:
   - `/root/openclaw-agent-templates/snowchuang/skills/article-image-generator`
   - `/root/.openclaw/workers/workspace/snowchuang-1..5/skills/article-image-generator`
5. Run dry-run verification from a worker workspace.
6. With explicit approval and temporary API key, run one real image-generation smoke test.
7. Keep WeChat draft creation and public publish as separate approval gates.
