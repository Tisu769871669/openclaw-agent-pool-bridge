#!/usr/bin/env bash
set -euo pipefail

SKILL_NAME="edge-tts"
DEFAULT_UPSTREAM_BASE="https://raw.githubusercontent.com/openclaw/skills/main/skills/i3130002/edge-tts"

TARGET_DIR="${TARGET_DIR:-}"
UPSTREAM_BASE="${OPENCLAW_EDGE_TTS_SKILL_BASE_URL:-$DEFAULT_UPSTREAM_BASE}"
SOURCE_DIR="${OPENCLAW_EDGE_TTS_SOURCE_DIR:-}"
SKIP_NPM_INSTALL=false
SKIP_TEST=false

usage() {
  cat <<'EOF'
Install the OpenClaw edge-tts skill into a template workspace.

This skill complements OpenClaw's built-in tts tool. Use it when the agent needs
explicit TTS workflow guidance or direct script-level audio generation.

Required:
  --target-dir <path>              Template workspace skills dir, for example "$TEMPLATE_WORKSPACE/skills"

Options:
  --source-base-url <url>          Raw upstream base URL
  --source-dir <path>              Copy files from an already downloaded edge-tts skill directory
  --skip-npm-install               Do not run npm install in scripts/
  --skip-test                      Do not run npm test in scripts/
  -h, --help                       Show this help

Example:
  bash scripts/install-openclaw-edge-tts-skill.sh \
    --target-dir "$TEMPLATE_WORKSPACE/skills"
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-dir)
      TARGET_DIR="$2"
      shift 2
      ;;
    --source-base-url)
      UPSTREAM_BASE="${2%/}"
      shift 2
      ;;
    --source-dir)
      SOURCE_DIR="$2"
      shift 2
      ;;
    --skip-npm-install)
      SKIP_NPM_INSTALL=true
      shift
      ;;
    --skip-test)
      SKIP_TEST=true
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

if [[ -z "$TARGET_DIR" ]]; then
  echo "Missing --target-dir or TARGET_DIR." >&2
  usage >&2
  exit 2
fi

INSTALL_DIR="$TARGET_DIR/$SKILL_NAME"

fetch_file() {
  local relative_path="$1"
  local output="$INSTALL_DIR/$relative_path"
  local url="$UPSTREAM_BASE/$relative_path"
  local tmp_output="$output.tmp.$$"
  mkdir -p "$(dirname "$output")"
  rm -f "$tmp_output"

  if [[ -n "$SOURCE_DIR" ]]; then
    cp "$SOURCE_DIR/$relative_path" "$output"
    return 0
  fi

  if command -v node >/dev/null 2>&1; then
    if DOWNLOAD_URL="$url" DOWNLOAD_OUTPUT="$tmp_output" node <<'NODE'
const fs = require('fs');
const http = require('http');
const https = require('https');

const url = process.env.DOWNLOAD_URL;
const output = process.env.DOWNLOAD_OUTPUT;
const timeoutMs = 45000;

function download(currentUrl, redirects = 0) {
  const client = currentUrl.startsWith('https:') ? https : http;
  const request = client.get(currentUrl, (response) => {
    if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
      if (redirects >= 5) {
        console.error(`Too many redirects while downloading ${url}`);
        process.exit(1);
      }
      const nextUrl = new URL(response.headers.location, currentUrl).toString();
      response.resume();
      download(nextUrl, redirects + 1);
      return;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      console.error(`Download failed with HTTP ${response.statusCode}: ${currentUrl}`);
      response.resume();
      process.exit(1);
    }
    const file = fs.createWriteStream(output, { mode: 0o644 });
    response.pipe(file);
    file.on('finish', () => file.close(() => process.exit(0)));
    file.on('error', (error) => {
      console.error(error.message);
      process.exit(1);
    });
  });
  request.on('error', (error) => {
    console.error(error.message);
    process.exit(1);
  });
  request.setTimeout(timeoutMs, () => {
    request.destroy(new Error(`Download timed out after ${timeoutMs}ms`));
  });
}

download(url);
NODE
    then
      mv "$tmp_output" "$output"
      return 0
    fi
    rm -f "$tmp_output"
  fi

  if command -v curl >/dev/null 2>&1; then
    if curl -fsSL --connect-timeout 15 --max-time 45 --retry 1 --retry-delay 2 --retry-connrefused "$url" -o "$tmp_output"; then
      mv "$tmp_output" "$output"
      return 0
    fi
    rm -f "$tmp_output"
  fi

  if command -v wget >/dev/null 2>&1; then
    if wget --tries=2 --waitretry=2 -qO "$tmp_output" "$url"; then
      mv "$tmp_output" "$output"
      return 0
    fi
    rm -f "$tmp_output"
  fi

  echo "Failed to download $url" >&2
  exit 1
}

mkdir -p "$INSTALL_DIR"

for file in \
  "SKILL.md" \
  "DISTRIBUTION.md" \
  "_meta.json" \
  "install.sh" \
  "skill-info.json" \
  "references/node_edge_tts_guide.md" \
  "scripts/config-manager.js" \
  "scripts/package.json" \
  "scripts/tts-converter.js"
do
  fetch_file "$file"
done

chmod +x "$INSTALL_DIR/install.sh" "$INSTALL_DIR/scripts/tts-converter.js" "$INSTALL_DIR/scripts/config-manager.js" 2>/dev/null || true

cat > "$INSTALL_DIR/scripts/.gitignore" <<'EOF'
node_modules/
package-lock.json
test-output.mp3
*.mp3
*.ogg
*.wav
*.json
!package.json
EOF

if [[ "$SKIP_NPM_INSTALL" != true ]]; then
  (cd "$INSTALL_DIR/scripts" && npm install --omit=dev)
fi

if [[ "$SKIP_TEST" != true ]]; then
  (cd "$INSTALL_DIR/scripts" && npm test)
fi

echo "Installed $SKILL_NAME into $INSTALL_DIR"
