# Agents Pool CLI

`agents-pool` is an operator-friendly command for discovering local OpenClaw agents, creating worker pools, updating `agent-pool.config.json`, and syncing template workspaces into worker workspaces.

中文导读：`agents-pool` 是这个项目的主要运维命令。它帮助你扫描本机 OpenClaw 环境、配置 logical agent 到 worker pool 的映射、刷新模板 workspace、同步 worker workspace，并做上线前诊断。

Inside a repository checkout, run it directly:

```bash
node scripts/agents-pool.js scan
```

To expose the short command on a server:

```bash
npm link
agents-pool scan
agents-pool help
```

`gents-pool` is installed as a forgiving alias for the same command. 中文：如果少打了开头的 `a`，`gents-pool help` 也会进入同一个 CLI。

## Commands / 命令

```bash
agents-pool scan
agents-pool setup
agents-pool status
agents-pool pool
agents-pool sync <logicalAgent>
agents-pool doctor
agents-pool help
```

| Command | 中文用途 |
| --- | --- |
| `scan` | 扫描本机 OpenClaw workspace、agent 目录和 `openclaw agents list`。 |
| `setup` | 交互式或参数化创建/更新 worker pool 配置。 |
| `status` | 打印当前 `agent-pool.config.json`。 |
| `pool` | 读取运行中的 bridge `/admin/pool`，查看每个 worker 的 busy、绑定 session、等待队列和最近错误。 |
| `sync <logicalAgent>` | 同步某个 logical agent 的模板和 worker workspace。 |
| `doctor` | 检查 OpenClaw CLI、配置文件、模板目录和 worker workspace 是否可见。 |
| `help` | 显示所有命令、参数和中英文说明。 |

`scan` discovers:

- `~/.openclaw/workspace`
- `~/.openclaw/workspace-*`
- `~/.openclaw/workspaces/*`
- `~/.openclaw/agents/*`
- `~/.openclaw/workers/agents/*`
- `openclaw agents list` output, when the OpenClaw CLI is available

`setup` asks which discovered workspaces should become logical agents, how many workers each pool should use, where templates and worker workspaces should live, and whether to create workers, sync files, and restart a service.

When `agent-pool.config.json` already contains the selected logical agent, `setup` reuses that agent's existing `templateWorkspace`, `workerWorkspaceRoot`, and worker names by default. Passing `--count` regenerates the worker list while keeping the inferred existing worker prefix, and `--worker-prefix` overrides that prefix explicitly.

中文说明：如果当前服务器已经配置过 `main -> sudan-main-1..5`，再次执行 `agents-pool setup --dry-run` 会默认沿用 `sudan-main-1..5`，不会悄悄改成 `main-1..5`。只有你明确传 `--count` 或 `--worker-prefix`，才会重新规划 worker 名。

`sync` refreshes a logical agent pool:

```bash
agents-pool sync main --source-workspace /root/.openclaw/workspace
```

When `--source-workspace` is provided, the CLI copies:

```text
source workspace -> template workspace -> worker workspaces
```

Without `--source-workspace`, it only copies:

```text
template workspace -> worker workspaces
```

`status` prints the current pool config.

`pool` prints live runtime state from the running bridge:

```bash
agents-pool pool --url http://127.0.0.1:9070
agents-pool pool --url http://127.0.0.1:9070 --json
```

中文说明：`status` 看的是本地配置文件，`pool` 看的是正在运行的服务状态。排查“5 个 worker 是否真的并发”“哪个 worker 卡住”“哪些 session sticky 到同一个 worker”“当前是否启用了 prompt adapter”时，用 `pool`。输出里的 `promptAdapter=none` 表示沿用默认 prompt，`promptAdapter=template` 表示请求会先经过模板渲染再交给 OpenClaw。

`doctor` checks whether OpenClaw, the config file, template workspaces, and worker workspaces are visible.

## Common Options / 常用参数

| Option | 中文说明 |
| --- | --- |
| `--config agent-pool.config.json` | 指定 pool 配置文件。 |
| `--json` | 输出 JSON，适合脚本消费。 |
| `--url http://127.0.0.1:9070` | `pool` 命令访问的 bridge 地址。 |
| `--token TOKEN` | `pool` 命令访问 `/admin/pool` 时使用的 Bearer token。 |
| `--token-env AGENT_BRIDGE_TOKEN` | 从指定环境变量读取 Bearer token；默认读取 `AGENT_BRIDGE_TOKEN`。 |
| `--dry-run` | 只预览，不写文件、不创建 worker、不同步。 |
| `--yes` | 尽量跳过交互确认，适合自动化脚本。 |
| `--agents main,agent1` | 指定要配置的 logical agents。 |
| `--count 5` | 每个 logical agent 创建多少个 worker。 |
| `--worker-prefix sudan-main` | 显式指定 worker 命名前缀；例如生成 `sudan-main-1..5`。 |
| `--template-root PATH` | logical agent 模板 workspace 的根目录。 |
| `--worker-workspace-root PATH` | worker workspace 根目录。 |
| `--worker-agent-dir-root PATH` | worker agent 配置目录根目录。 |
| `--source-workspace PATH` | `sync` 时先从源 workspace 刷新模板，再同步 worker。 |
| `--service SERVICE_NAME` | setup 完成后可重启的 systemd 服务名。 |

## Typical Setup / 典型安装配置

```bash
cd /opt/openclaw-agent-pool-bridge
npm install
npm link

agents-pool setup \
  --agents main \
  --count 5 \
  --template-root /root/openclaw-agent-templates \
  --worker-workspace-root /root/.openclaw/workers/workspace \
  --worker-agent-dir-root /root/.openclaw/workers/agents \
  --service sudan-agent-pool-bridge
```

Preview before writing:

```bash
agents-pool setup --agents main --count 5 --dry-run
```

中文建议：第一次操作一定先加 `--dry-run`。确认模板路径、worker 路径、删除列表都符合预期后，再去掉 `--dry-run`。

## Safety Rules / 安全规则

The CLI excludes runtime state when refreshing templates and workers:

- `.git`
- `.env`
- `.env.local`
- `.sessions`
- `node_modules`
- `logs`
- `tmp`
- `.tmp`
- `*.log`

Before writing `agent-pool.config.json`, the CLI creates a timestamped backup next to the config file.

If a worker agent already appears in `openclaw agents list` or in the worker agent directory, creation is skipped.

The CLI refuses to mirror a source workspace into the same path or into obviously unsafe target paths such as the filesystem root or home directory.

中文补充：worker workspace 是运行副本，尽量不要手改。日常维护应改源 workspace 或模板 workspace，再通过 CLI 同步。

## Useful Examples / 常用示例

Scan in JSON:

```bash
agents-pool scan --json
```

Configure two logical agents:

```bash
agents-pool setup --agents main,agent1 --count 5
```

Refresh `main` from a source workspace:

```bash
agents-pool sync main --source-workspace /root/.openclaw/workspace --dry-run
agents-pool sync main --source-workspace /root/.openclaw/workspace
```

Check the deployment:

```bash
agents-pool doctor
agents-pool pool --url http://127.0.0.1:9070
curl -sS http://127.0.0.1:9070/health
curl -sS -H "Authorization: Bearer $AGENT_BRIDGE_TOKEN" http://127.0.0.1:9070/admin/pool
```

中文判断：如果你要确认 5 并发是否跑起来，`doctor` 只能证明配置和目录大体可用；真正的运行态要看 `agents-pool pool` 或 `/admin/pool` 里的 `pool.workerCount`、`pool.busyWorkers`、`pool.queueDepth` 和每个 worker 的 `busy`/`idleForMs`。
