# OpenClaw TTS / 通用客服语音能力

OpenClaw already has native text-to-speech support. For this project, treat TTS as two layers:

| Layer | Best For | Where To Configure |
| --- | --- | --- |
| OpenClaw built-in `messages.tts` + `tts` tool | Voice replies across Telegram, WhatsApp, Feishu, Matrix, and other channels OpenClaw can send audio to | `openclaw.json` |
| `edge-tts` skill | Agent-level guidance, explicit user-triggered audio generation, direct script usage | `$TEMPLATE_WORKSPACE/skills/edge-tts` |

中文判断：我们这个通用客服项目主要跑在 OpenClaw 框架上，所以主路线应该是 OpenClaw 原生 TTS；workspace skill 是补充能力，不是唯一入口。

## Bridge Contract / Bridge 调用约定

The chat API can receive a TTS request flag, but it does not synthesize audio by itself:

```json
{
  "conversationId": "wxid_customer_001",
  "content": {
    "text": "可以语音回复吗？",
    "tts": {
      "enabled": true,
      "voice": "zh-CN-XiaoxiaoNeural",
      "lang": "zh-CN"
    }
  }
}
```

The bridge passes this intent into the agent prompt and returns `tts.requested=true` in the HTTP response. To actually produce audio, configure OpenClaw native `messages.tts` or install an agent TTS skill as described below.

中文说明：`content.tts` 是“本次回复希望出语音”的业务信号，不等于 bridge 自己生成 MP3。真正的语音输出仍然要靠 OpenClaw 的 TTS 配置或 `edge-tts` skill。

## Native TTS / OpenClaw 原生配置

OpenClaw docs list Microsoft speech as a supported provider. The Microsoft provider currently uses Edge-backed `node-edge-tts`, does not need an API key, and legacy `edge` settings are normalized to `microsoft`.

Recommended conservative default for customer service:

```bash
cd "$BRIDGE_DIR"

bash scripts/configure-openclaw-tts.sh \
  --config-file "$HOME/.openclaw/openclaw.json" \
  --auto tagged \
  --provider microsoft \
  --voice zh-CN-XiaoxiaoNeural \
  --lang zh-CN
```

Why `tagged` by default:

- It avoids turning every text reply into audio.
- The agent or operator can intentionally trigger audio.
- It is safer for normal customer-service channels where users often expect text.

If the business channel should always send audio replies:

```bash
bash scripts/configure-openclaw-tts.sh --auto always
```

If you only want audio after a user sends an inbound voice message:

```bash
bash scripts/configure-openclaw-tts.sh --auto inbound
```

The script backs up the config before writing:

```text
~/.openclaw/openclaw.json.bak.YYYYMMDDHHMMSS
```

Preview without writing:

```bash
bash scripts/configure-openclaw-tts.sh --dry-run
```

## Install Edge-TTS Skill / 安装 OpenClaw edge-tts skill

Use this when you want the agent workspace to explicitly know how to handle user requests like “把这段话转成语音”.

```bash
cd "$BRIDGE_DIR"

bash scripts/install-openclaw-edge-tts-skill.sh \
  --target-dir "$TEMPLATE_WORKSPACE/skills" \
  --skip-test
```

Run the live network test only when you are ready for Microsoft Edge TTS outbound access:

```bash
cd "$TEMPLATE_WORKSPACE/skills/edge-tts/scripts"
npm test
```

If the server cannot reach `raw.githubusercontent.com`, download the `openclaw/skills` `skills/i3130002/edge-tts` directory through another route, upload it to the server, then install from the local directory:

```bash
bash scripts/install-openclaw-edge-tts-skill.sh \
  --target-dir "$TEMPLATE_WORKSPACE/skills" \
  --source-dir /tmp/edge-tts \
  --skip-test
```

Then sync workers:

```bash
cd "$BRIDGE_DIR"
node scripts/sync-worker-workspaces.js "$LOGICAL_AGENT" --config "$CONFIG_FILE" --dry-run
node scripts/sync-worker-workspaces.js "$LOGICAL_AGENT" --config "$CONFIG_FILE"
sudo systemctl restart "$SERVICE_NAME"
```

Confirm the skill exists in every worker:

```bash
LOGICAL_AGENT="$LOGICAL_AGENT" node -e '
  const c = require("./agent-pool.config.json");
  const a = c.agents[process.env.LOGICAL_AGENT];
  for (const worker of a.workers) {
    console.log(`${a.workerWorkspaceRoot}/${worker}/skills/edge-tts/SKILL.md`);
  }
' | xargs -r ls -l
```

## Runtime Verification / 运行态验证

OpenClaw slash command checks:

```text
/tts status
/tts tagged
/tts audio 你好，这是一条 OpenClaw 语音测试。
```

Service checks:

```bash
sudo systemctl restart "$SERVICE_NAME"
curl -sS "http://127.0.0.1:$PORT/health"
```

Skill script checks:

```bash
cd "$TEMPLATE_WORKSPACE/skills/edge-tts/scripts"
node tts-converter.js "你好，这是一条语音测试。" \
  --voice zh-CN-XiaoxiaoNeural \
  --lang zh-CN \
  --output /tmp/openclaw-edge-tts-test.mp3
ls -lh /tmp/openclaw-edge-tts-test.mp3
```

## Operational Choice / 方案取舍

| Need | Use |
| --- | --- |
| All or selected outbound replies should become audio | OpenClaw native `messages.tts` |
| User asks the agent to generate an MP3 file from text | `edge-tts` skill |
| Guaranteed quotas, SLA, or commercial support | OpenAI / ElevenLabs provider |
| Free best-effort speech | Microsoft provider / Edge-backed `node-edge-tts` |

## Security Notes / 安全注意

- Microsoft/Edge TTS does not need an API key.
- If you later use OpenAI, ElevenLabs, or MiniMax, keep API keys in env/private config, not in Git.
- `edge-tts` uses Microsoft online endpoints; do not send sensitive customer secrets into TTS audio generation unless the business has approved that data flow.
