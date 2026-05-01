# Aliyun OSS Skill / 阿里云 OSS 技能

This guide installs the OpenClaw `aliyun-oss` skill into a logical customer-service agent template workspace, then syncs it to all worker workspaces.

中文说明：这里配置的是通用客服可用的 OSS skill。真实请求跑在 worker workspace，所以安装位置应是 logical agent 的模板 workspace，再同步到 worker；不要只装到旧的单体 workspace，也不要把 AK/SK 提交到 Git。

## Current OSS Target / 当前 OSS 配置

| Item | Value |
| --- | --- |
| Skill source | `https://lobehub.com/skills/openclaw-skills-aliyun-oss-skill` |
| Upstream repo path | `openclaw/skills/skills/aohoyo/aliyun-oss-skill` |
| Template skill dir | `$TEMPLATE_WORKSPACE/skills/aliyun-oss-skill` |
| Endpoint | `oss-cn-hangzhou.aliyuncs.com` |
| Region | `oss-cn-hangzhou` |
| Bucket | `openclawlist` |
| Public domain | `https://openclawlist.oss-cn-hangzhou.aliyuncs.com` |

## Install / 安装

Set the usual bridge variables first, then read credentials without putting the secret directly into command history:

```bash
cd "$BRIDGE_DIR"

read -r -p "Aliyun AccessKey ID: " ALIYUN_ACCESS_KEY_ID
read -r -s -p "Aliyun AccessKey Secret: " ALIYUN_ACCESS_KEY_SECRET
echo
export ALIYUN_ACCESS_KEY_ID
export ALIYUN_ACCESS_KEY_SECRET
export ALIYUN_OSS_ENDPOINT=oss-cn-hangzhou.aliyuncs.com
export ALIYUN_OSS_BUCKET=openclawlist

bash scripts/install-aliyun-oss-skill.sh \
  --target-dir "$TEMPLATE_WORKSPACE/skills"
```

The installer downloads the official skill files, writes a private `config/oss-config.json`, installs `ali-oss`, and runs `test-connection`. It does not call the upstream `setup.sh` with credentials, because that script also appends secrets to shell rc files.

If the server cannot reach OSS during deployment, install without the live check:

```bash
bash scripts/install-aliyun-oss-skill.sh \
  --target-dir "$TEMPLATE_WORKSPACE/skills" \
  --skip-connection-test
```

## Sync To Workers / 同步到 worker

```bash
cd "$BRIDGE_DIR"

node scripts/sync-worker-workspaces.js "$LOGICAL_AGENT" --config "$CONFIG_FILE" --dry-run
node scripts/sync-worker-workspaces.js "$LOGICAL_AGENT" --config "$CONFIG_FILE"

sudo systemctl restart "$SERVICE_NAME"
curl -sS "http://127.0.0.1:$PORT/health"
```

Confirm every worker has the skill and private config:

```bash
LOGICAL_AGENT="$LOGICAL_AGENT" node -e '
  const c = require("./agent-pool.config.json");
  const a = c.agents[process.env.LOGICAL_AGENT];
  for (const worker of a.workers) {
    console.log(`${a.workerWorkspaceRoot}/${worker}/skills/aliyun-oss-skill/config/oss-config.json`);
  }
' | xargs -r ls -l
```

## Smoke Test / 冒烟测试

Run from the template workspace first:

```bash
cd "$TEMPLATE_WORKSPACE/skills/aliyun-oss-skill"
node scripts/oss_node.mjs test-connection
node scripts/oss_node.mjs list --prefix "" --limit 5
```

Optional upload/download test:

```bash
printf 'openclaw oss smoke test\n' > /tmp/openclaw-oss-smoke.txt
node scripts/oss_node.mjs upload \
  --local /tmp/openclaw-oss-smoke.txt \
  --key smoke/openclaw-oss-smoke.txt
node scripts/oss_node.mjs stat --key smoke/openclaw-oss-smoke.txt
node scripts/oss_node.mjs delete --key smoke/openclaw-oss-smoke.txt --force
```

## Agent Usage / 给客服的使用边界

The skill supports upload, download, list, delete, URL, stat, move, copy, and connection testing through `node scripts/oss_node.mjs ...`.

中文建议：

- 客服可以用 OSS 存放图片、素材、临时文件和可发给用户的资源链接。
- 私有文件默认用 `url --private --expires 3600` 生成短期签名 URL。
- 删除文件属于破坏性操作，正式对话里先确认对象 key，再执行 `delete --force`。
- AK/SK 只保存在服务器私有配置里，不写进 prompt、FAQ、聊天记录或 Git。

## Troubleshooting / 排查

| Symptom | Check |
| --- | --- |
| `Cannot find module 'ali-oss'` | Run `npm install --omit=dev` inside `$TEMPLATE_WORKSPACE/skills/aliyun-oss-skill`. |
| `403 Forbidden` | Check RAM policy, bucket permission, AccessKey status, and whether the bucket is `openclawlist`. |
| Connection timeout | Check outbound network and endpoint `oss-cn-hangzhou.aliyuncs.com`. |
| Worker cannot use skill | Re-run `sync-worker-workspaces.js`, restart the bridge, and verify each worker skill path. |
| Public URL wrong | Confirm `domain` is `https://openclawlist.oss-cn-hangzhou.aliyuncs.com` in `config/oss-config.json`. |

## Security Notes / 安全注意

- Do not commit `config/oss-config.json`.
- Avoid passing secrets as command-line arguments on shared servers; prefer `read -s` or a private environment file with `chmod 600`.
- Rotate the AccessKey if it appears in a commit, public log, screenshot, or shell transcript.
