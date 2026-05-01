#!/usr/bin/env bash
set -euo pipefail

SKILL_NAME="aliyun-oss-skill"
DEFAULT_UPSTREAM_BASE="https://raw.githubusercontent.com/openclaw/skills/main/skills/aohoyo/aliyun-oss-skill"

TARGET_DIR="${TARGET_DIR:-}"
UPSTREAM_BASE="${ALIYUN_OSS_SKILL_BASE_URL:-$DEFAULT_UPSTREAM_BASE}"
ACCESS_KEY_ID="${ALIYUN_OSS_ACCESS_KEY_ID:-${ALIYUN_ACCESS_KEY_ID:-}}"
ACCESS_KEY_SECRET="${ALIYUN_OSS_ACCESS_KEY_SECRET:-${ALIYUN_ACCESS_KEY_SECRET:-}}"
OSS_ENDPOINT="${ALIYUN_OSS_ENDPOINT:-oss-cn-hangzhou.aliyuncs.com}"
OSS_REGION="${ALIYUN_OSS_REGION:-${ALIYUN_REGION:-}}"
OSS_BUCKET="${ALIYUN_OSS_BUCKET:-${ALIYUN_BUCKET:-openclawlist}}"
OSS_DOMAIN="${ALIYUN_OSS_DOMAIN:-}"
SKIP_NPM_INSTALL=false
SKIP_CONNECTION_TEST=false

usage() {
  cat <<'EOF'
Install and configure the OpenClaw aliyun-oss skill into a template workspace.

Required:
  --target-dir <path>              Template workspace skills dir, for example "$TEMPLATE_WORKSPACE/skills"

Credentials:
  Prefer environment variables so secrets do not appear in shell history:
    ALIYUN_ACCESS_KEY_ID
    ALIYUN_ACCESS_KEY_SECRET

Options:
  --access-key-id <id>             AccessKey ID
  --access-key-secret <secret>     AccessKey Secret
  --endpoint <endpoint>            OSS endpoint, default oss-cn-hangzhou.aliyuncs.com
  --region <region>                OSS region, default derived from endpoint
  --bucket <bucket>                OSS bucket, default openclawlist
  --domain <url>                   Public URL domain, default https://<bucket>.<endpoint>
  --source-base-url <url>          Raw upstream base URL
  --skip-npm-install               Do not run npm install in the skill directory
  --skip-connection-test           Do not run node scripts/oss_node.mjs test-connection
  -h, --help                       Show this help

Example:
  TARGET_DIR="$TEMPLATE_WORKSPACE/skills" \
  ALIYUN_ACCESS_KEY_ID="$ALIYUN_ACCESS_KEY_ID" \
  ALIYUN_ACCESS_KEY_SECRET="$ALIYUN_ACCESS_KEY_SECRET" \
  bash scripts/install-aliyun-oss-skill.sh
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target-dir)
      TARGET_DIR="$2"
      shift 2
      ;;
    --access-key-id)
      ACCESS_KEY_ID="$2"
      shift 2
      ;;
    --access-key-secret)
      ACCESS_KEY_SECRET="$2"
      shift 2
      ;;
    --endpoint)
      OSS_ENDPOINT="$2"
      shift 2
      ;;
    --region)
      OSS_REGION="$2"
      shift 2
      ;;
    --bucket)
      OSS_BUCKET="$2"
      shift 2
      ;;
    --domain)
      OSS_DOMAIN="$2"
      shift 2
      ;;
    --source-base-url)
      UPSTREAM_BASE="${2%/}"
      shift 2
      ;;
    --skip-npm-install)
      SKIP_NPM_INSTALL=true
      shift
      ;;
    --skip-connection-test)
      SKIP_CONNECTION_TEST=true
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

if [[ -z "$ACCESS_KEY_ID" || -z "$ACCESS_KEY_SECRET" ]]; then
  echo "Missing Aliyun AccessKey credentials. Set ALIYUN_ACCESS_KEY_ID and ALIYUN_ACCESS_KEY_SECRET." >&2
  exit 2
fi

if [[ -z "$OSS_BUCKET" ]]; then
  echo "Missing OSS bucket." >&2
  exit 2
fi

strip_endpoint() {
  local value="$1"
  value="${value#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  value="${value%.}"
  if [[ "$value" == "$OSS_BUCKET".* ]]; then
    value="${value#"$OSS_BUCKET".}"
  fi
  printf '%s' "$value"
}

OSS_ENDPOINT="$(strip_endpoint "$OSS_ENDPOINT")"

if [[ -z "$OSS_REGION" ]]; then
  OSS_REGION="${OSS_ENDPOINT%%.aliyuncs.com}"
  OSS_REGION="${OSS_REGION%-internal}"
fi

if [[ -z "$OSS_DOMAIN" ]]; then
  OSS_DOMAIN="https://${OSS_BUCKET}.${OSS_ENDPOINT}"
fi

INSTALL_DIR="$TARGET_DIR/$SKILL_NAME"
CONFIG_FILE="$INSTALL_DIR/config/oss-config.json"

fetch_file() {
  local relative_path="$1"
  local output="$INSTALL_DIR/$relative_path"
  local url="$UPSTREAM_BASE/$relative_path"
  local tmp_output="$output.tmp.$$"
  mkdir -p "$(dirname "$output")"

  rm -f "$tmp_output"

  if command -v curl >/dev/null 2>&1; then
    if curl -fsSL --retry 3 --retry-delay 2 --retry-connrefused "$url" -o "$tmp_output"; then
      mv "$tmp_output" "$output"
      return 0
    fi
    rm -f "$tmp_output"
  fi

  if command -v wget >/dev/null 2>&1; then
    if wget --tries=3 --waitretry=2 -qO "$tmp_output" "$url"; then
      mv "$tmp_output" "$output"
      return 0
    fi
    rm -f "$tmp_output"
  fi

  if command -v node >/dev/null 2>&1; then
    if DOWNLOAD_URL="$url" DOWNLOAD_OUTPUT="$tmp_output" node <<'NODE'
const fs = require('fs');
const http = require('http');
const https = require('https');

const url = process.env.DOWNLOAD_URL;
const output = process.env.DOWNLOAD_OUTPUT;

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
    file.on('finish', () => file.close());
    file.on('error', (error) => {
      console.error(error.message);
      process.exit(1);
    });
  });

  request.on('error', (error) => {
    console.error(error.message);
    process.exit(1);
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

  echo "Failed to download $url" >&2
  exit 1
}

mkdir -p "$INSTALL_DIR"

for file in \
  "SKILL.md" \
  "README.md" \
  "_meta.json" \
  "package.json" \
  "config/oss-config.example.json" \
  "docs/EXAMPLES.md" \
  "scripts/setup.sh" \
  "scripts/oss_node.mjs"
do
  fetch_file "$file"
done

chmod +x "$INSTALL_DIR/scripts/setup.sh" "$INSTALL_DIR/scripts/oss_node.mjs" 2>/dev/null || true

cat > "$INSTALL_DIR/config/.gitignore" <<'EOF'
oss-config.json
EOF

CONFIG_FILE="$CONFIG_FILE" \
ACCESS_KEY_ID="$ACCESS_KEY_ID" \
ACCESS_KEY_SECRET="$ACCESS_KEY_SECRET" \
OSS_BUCKET="$OSS_BUCKET" \
OSS_REGION="$OSS_REGION" \
OSS_ENDPOINT="$OSS_ENDPOINT" \
OSS_DOMAIN="$OSS_DOMAIN" \
node <<'NODE'
const fs = require('fs');

const config = {
  accessKeyId: process.env.ACCESS_KEY_ID,
  accessKeySecret: process.env.ACCESS_KEY_SECRET,
  bucket: process.env.OSS_BUCKET,
  region: process.env.OSS_REGION,
  endpoint: process.env.OSS_ENDPOINT,
  domain: process.env.OSS_DOMAIN,
  options: {
    secure: true,
    timeout: 60000,
    upload_threshold: 1048576,
    chunk_size: 1048576,
    retry_times: 3,
  },
};

fs.writeFileSync(process.env.CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
NODE

chmod 600 "$CONFIG_FILE" 2>/dev/null || true

if [[ "$SKIP_NPM_INSTALL" != true ]]; then
  (cd "$INSTALL_DIR" && npm install --omit=dev)
fi

if [[ "$SKIP_CONNECTION_TEST" != true ]]; then
  (cd "$INSTALL_DIR" && node scripts/oss_node.mjs test-connection)
fi

echo "Installed $SKILL_NAME into $INSTALL_DIR"
echo "Bucket: $OSS_BUCKET"
echo "Endpoint: $OSS_ENDPOINT"
echo "Region: $OSS_REGION"
echo "Config: $CONFIG_FILE"
