# image2 API Reference

The first supported provider is the image2-compatible endpoint that was verified from the Snowchuang server.

## Environment

```env
IMAGE2_API_BASE_URL=https://api.ohmygpt.com/v1
IMAGE2_API_KEY=runtime_secret_not_committed
IMAGE2_MODEL=gpt-image-2
IMAGE2_TIMEOUT_MS=180000
IMAGE2_MAX_RETRIES=2
```

## Request Shape

The client sends a POST request to:

```text
/images/generations
```

with:

```json
{
  "model": "gpt-image-2",
  "prompt": "Create an original image...",
  "size": "1024x1024"
}
```

## Response Shapes

Supported:

- `data[0].b64_json`
- `data[0].url`

Secrets must never be printed in errors or manifests.
