#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${OPENCLAW_CONFIG_FILE:-$HOME/.openclaw/openclaw.json}"
AUTO_MODE="${OPENCLAW_TTS_AUTO:-tagged}"
PROVIDER="${OPENCLAW_TTS_PROVIDER:-microsoft}"
VOICE="${OPENCLAW_TTS_VOICE:-zh-CN-XiaoxiaoNeural}"
LANG="${OPENCLAW_TTS_LANG:-zh-CN}"
RATE="${OPENCLAW_TTS_RATE:-default}"
PITCH="${OPENCLAW_TTS_PITCH:-default}"
VOLUME="${OPENCLAW_TTS_VOLUME:-default}"
OUTPUT_FORMAT="${OPENCLAW_TTS_OUTPUT_FORMAT:-audio-24khz-48kbitrate-mono-mp3}"
MAX_TEXT_LENGTH="${OPENCLAW_TTS_MAX_TEXT_LENGTH:-2000}"
TIMEOUT_MS="${OPENCLAW_TTS_TIMEOUT_MS:-30000}"
INIT_FILE=false
DRY_RUN=false

usage() {
  cat <<'EOF'
Configure OpenClaw built-in TTS in openclaw.json.

The Microsoft provider uses Edge-backed node-edge-tts and does not need an API key.
This is the native OpenClaw path for voice replies across messaging channels.

Options:
  --config-file <path>       OpenClaw config path, default ~/.openclaw/openclaw.json
  --auto <mode>              off | always | inbound | tagged, default tagged
  --provider <provider>      microsoft | openai | elevenlabs | minimax, default microsoft
  --voice <voice>            Microsoft neural voice, default zh-CN-XiaoxiaoNeural
  --lang <lang>              Language code, default zh-CN
  --rate <value>             Prosody rate, default default
  --pitch <value>            Prosody pitch, default default
  --volume <value>           Prosody volume, default default
  --output-format <format>   Microsoft output format
  --max-text-length <n>      Max TTS input length, default 2000
  --timeout-ms <n>           TTS timeout, default 30000
  --init                     Create config file if missing
  --dry-run                  Print resulting JSON without writing
  -h, --help                 Show this help

Examples:
  bash scripts/configure-openclaw-tts.sh --auto tagged
  bash scripts/configure-openclaw-tts.sh --auto always --voice zh-CN-YunxiNeural
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --config-file)
      CONFIG_FILE="$2"
      shift 2
      ;;
    --auto)
      AUTO_MODE="$2"
      shift 2
      ;;
    --provider)
      PROVIDER="$2"
      shift 2
      ;;
    --voice)
      VOICE="$2"
      shift 2
      ;;
    --lang)
      LANG="$2"
      shift 2
      ;;
    --rate)
      RATE="$2"
      shift 2
      ;;
    --pitch)
      PITCH="$2"
      shift 2
      ;;
    --volume)
      VOLUME="$2"
      shift 2
      ;;
    --output-format)
      OUTPUT_FORMAT="$2"
      shift 2
      ;;
    --max-text-length)
      MAX_TEXT_LENGTH="$2"
      shift 2
      ;;
    --timeout-ms)
      TIMEOUT_MS="$2"
      shift 2
      ;;
    --init)
      INIT_FILE=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$AUTO_MODE" in
  off|always|inbound|tagged) ;;
  *)
    echo "--auto must be one of: off, always, inbound, tagged." >&2
    exit 2
    ;;
esac

case "$PROVIDER" in
  microsoft|edge|openai|elevenlabs|minimax) ;;
  *)
    echo "--provider must be one of: microsoft, openai, elevenlabs, minimax." >&2
    exit 2
    ;;
esac

if [[ "$PROVIDER" == "edge" ]]; then
  PROVIDER="microsoft"
fi

if [[ ! -f "$CONFIG_FILE" && "$INIT_FILE" != true ]]; then
  echo "Config file not found: $CONFIG_FILE" >&2
  echo "Pass --init to create a minimal config file." >&2
  exit 1
fi

mkdir -p "$(dirname "$CONFIG_FILE")"
if [[ ! -f "$CONFIG_FILE" ]]; then
  printf '{}\n' > "$CONFIG_FILE"
fi

CONFIG_FILE="$CONFIG_FILE" \
AUTO_MODE="$AUTO_MODE" \
PROVIDER="$PROVIDER" \
VOICE="$VOICE" \
LANG="$LANG" \
RATE="$RATE" \
PITCH="$PITCH" \
VOLUME="$VOLUME" \
OUTPUT_FORMAT="$OUTPUT_FORMAT" \
MAX_TEXT_LENGTH="$MAX_TEXT_LENGTH" \
TIMEOUT_MS="$TIMEOUT_MS" \
DRY_RUN="$DRY_RUN" \
node <<'NODE'
const fs = require('fs');
const path = require('path');

const configFile = process.env.CONFIG_FILE;
const dryRun = process.env.DRY_RUN === 'true';

let config = {};
try {
  const raw = fs.readFileSync(configFile, 'utf8').trim();
  config = raw ? JSON.parse(raw) : {};
} catch (error) {
  console.error(`Failed to read JSON config ${configFile}: ${error.message}`);
  process.exit(1);
}

config.messages ||= {};
config.messages.tts ||= {};
config.messages.tts.auto = process.env.AUTO_MODE;
config.messages.tts.provider = process.env.PROVIDER;
config.messages.tts.maxTextLength = Number(process.env.MAX_TEXT_LENGTH);
config.messages.tts.timeoutMs = Number(process.env.TIMEOUT_MS);
config.messages.tts.providers ||= {};
config.messages.tts.providers.microsoft ||= {};
Object.assign(config.messages.tts.providers.microsoft, {
  enabled: true,
  voice: process.env.VOICE,
  lang: process.env.LANG,
  outputFormat: process.env.OUTPUT_FORMAT,
  rate: process.env.RATE,
  pitch: process.env.PITCH,
  volume: process.env.VOLUME,
});

const output = `${JSON.stringify(config, null, 2)}\n`;
if (dryRun) {
  process.stdout.write(output);
  process.exit(0);
}

const backup = `${configFile}.bak.${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`;
if (fs.existsSync(configFile)) {
  fs.copyFileSync(configFile, backup);
  console.log(`Backup: ${backup}`);
}
fs.writeFileSync(configFile, output);
console.log(`Updated: ${configFile}`);
console.log(`OpenClaw TTS: auto=${config.messages.tts.auto} provider=${config.messages.tts.provider}`);
NODE
