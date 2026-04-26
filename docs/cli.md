# Agents Pool CLI

`agents-pool` is an operator-friendly command for discovering local OpenClaw agents, creating worker pools, updating `agent-pool.config.json`, and syncing template workspaces into worker workspaces.

Inside a repository checkout, run it directly:

```bash
node scripts/agents-pool.js scan
```

To expose the short command on a server:

```bash
npm link
agents-pool scan
```

## Commands

```bash
agents-pool scan
agents-pool setup
agents-pool status
agents-pool sync <logicalAgent>
agents-pool doctor
```

`scan` discovers:

- `~/.openclaw/workspace`
- `~/.openclaw/workspace-*`
- `~/.openclaw/workspaces/*`
- `~/.openclaw/agents/*`
- `~/.openclaw/workers/agents/*`
- `openclaw agents list` output, when the OpenClaw CLI is available

`setup` asks which discovered workspaces should become logical agents, how many workers each pool should use, where templates and worker workspaces should live, and whether to create workers, sync files, and restart a service.

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

`doctor` checks whether OpenClaw, the config file, template workspaces, and worker workspaces are visible.

## Typical Setup

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

## Safety Rules

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

## Useful Examples

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
curl -sS http://127.0.0.1:9070/health
```

