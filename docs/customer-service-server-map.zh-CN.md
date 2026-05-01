# 客服服务器功能地图：雪创 / 苏丹

核验时间：2026-05-01 22:04 CST
核验方式：SSH 只读检查服务器目录、systemd/PM2 状态、监听端口、agent-pool 配置、template/worker workspace 和本机 health endpoint。

本文只记录主机、服务、路径和功能边界，不记录 SSH 密码、token、API key 或业务密钥。

## 总览

| 客服 | 公网 IP | 服务器主机名 | 通用 agent-pool | 特化项目来源 | 当前入口形态 |
| --- | --- | --- | --- | --- | --- |
| 雪创 | `43.133.190.124` | `VM-4-9-ubuntu` | `/opt/openclaw-agent-pool-bridge`，systemd `snowchuang-agent-pool-bridge`，端口 `9071` | 本地 `D:\Study\claw`，服务器 `/opt/claw` | `/opt/claw/node-services/agent-bridge` 在 `9070` 接收外部请求，再转发到通用 pool `9071` |
| 苏丹 | `43.155.219.86` | `VM-0-7-ubuntu` | `/opt/openclaw-agent-pool-bridge`，systemd `sudan-agent-pool-bridge`，端口 `9070` | 本地 `D:\Study\codeXprojection\苏丹小龙虾`，内容部署到 `sudan-main` template | 通用 pool 本身在 `9070` 承载客服入口；旧 `openclaw-agent-bridge.service` 当前 inactive |

核心结论：

| 层级 | 雪创 | 苏丹 |
| --- | --- | --- |
| 通用层 | 已部署 agent-pool，logical agent 为 `snowchuang`，5 个 worker | 已部署 agent-pool，logical agent 为 `main`，5 个 worker |
| 特化层 | 额外有 `/opt/claw` 五个 PM2 服务，负责 CRM、企业微信、晨报、看板、外部 agent bridge、订货通和待付款提醒 | 无 PM2 业务服务；苏丹特化能力主要在 OpenClaw template 里：人格、FAQ、prompt-template、`metast-mcp` skill |
| 当前维护重点 | `/opt/claw` 和 `/opt/openclaw-agent-pool-bridge` 都要看，`9070 -> 9071` 是关键链路 | 主要看 `/opt/openclaw-agent-pool-bridge` 和 `/root/openclaw-agent-templates/sudan-main` |

## 通用功能

两台服务器都部署了 `openclaw-agent-pool-bridge`，职责是把外部看到的 logical agent 映射到多个隔离的 OpenClaw worker agent：

| 通用能力 | 说明 | 维护位置 |
| --- | --- | --- |
| 并发 worker pool | 一个 logical agent 对应 5 个 worker，同一会话串行，不同会话并发 | `/opt/openclaw-agent-pool-bridge/agent-pool.config.json` |
| 会话排队和 sticky | `logicalAgent + conversationId` 串行；有空闲 worker 时优先复用之前绑定的 worker | 通用 bridge 运行时 |
| bridge-owned session history | bridge 自己保存最近历史，避免会话换 worker 后丢上下文 | `/opt/openclaw-agent-pool-bridge/.sessions` |
| template -> worker 同步 | 修改人格、prompt、knowledge、skills 后，应先改 canonical template，再同步到 worker | `/root/openclaw-agent-templates/<agent>` -> `/root/.openclaw/workers/workspace/<worker>` |
| 运行态观测 | `/health` 返回服务状态；`/admin/pool` 返回 worker busy、队列、绑定 session、最近错误、prompt/retrieval 状态 | `curl http://127.0.0.1:<port>/health`，或 `agents-pool pool` |
| prompt/retrieval adapter | 支持 `PROMPT_ADAPTER=template` 和 FAQ/RAG retrieval；是否启用由服务器 `.env` 决定 | `/opt/openclaw-agent-pool-bridge/.env` 仅看 key，不在文档记录值 |
| 通用内容 skill | 公众号和文章生图 skill 以仓库根 `skills/` 为 canonical source；不同客服通过 profile 区分 | `skills/wechat-official-account`、`skills/article-image-generator` |
| OpenClaw Gateway | 两台都有 `openclaw-gateway.service`；雪创 `127.0.0.1:8080/health` 返回 live，苏丹本次只确认 systemd active，未在 `8080/health` 得到响应 | 改动前先看 `systemctl status openclaw-gateway` 和实际监听端口 |

## 通用 agent-pool 当前配置

| 项 | 雪创 | 苏丹 |
| --- | --- | --- |
| 服务名 | `snowchuang-agent-pool-bridge` | `sudan-agent-pool-bridge` |
| 端口 | `9071` | `9070` |
| default agent | `snowchuang` | `main` |
| template workspace | `/root/openclaw-agent-templates/snowchuang` | `/root/openclaw-agent-templates/sudan-main` |
| worker root | `/root/.openclaw/workers/workspace` | `/root/.openclaw/workers/workspace` |
| workers | `snowchuang-1` 到 `snowchuang-5` | `sudan-main-1` 到 `sudan-main-5` |
| debounce | 当前关闭 | 当前开启，`windowMs=5000`，`incompleteMessageExtraWait` 开启 |
| prompt adapter | 当前 `none` | 当前 `template`，模板 `/root/openclaw-agent-templates/sudan-main/prompt-template.md` |
| retrieval | 当前关闭 | 当前 FAQ retrieval 开启，FAQ `/root/openclaw-agent-templates/sudan-main/knowledge/faq.json`，`topK=8` |
| 核验时 worker 状态 | 5 个 worker 都 idle，队列为 0 | 5 个 worker 都 idle，队列为 0 |

## 雪创特化功能

雪创服务器除了通用 agent-pool，还有完整 `/opt/claw` 项目。当前 PM2 上 5 个服务均为 online。

| 功能 | 服务/端口 | 维护路径 | 作用 | 备注 |
| --- | --- | --- | --- | --- |
| 邮件线索 CRM | `personal-crm` / `9030` | `/opt/claw/node-services/personal-crm` | 轮询邮箱、LLM 分析线索、保存 SQLite、生成回复草稿、通知企业微信 | health 返回 `ok=true` |
| 企业微信桥 | `wecom-bridge` / `9050` | `/opt/claw/node-services/wecom-bridge` | 企业微信回调、CRM 命令入口、内部通知、普通聊天兜底 | health 返回 `ok=true` |
| 销售晨报 | `custom-morning-brief` / `9040` | `/opt/claw/node-services/custom-morning-brief` | 读取 CRM SQLite，生成并推送销售晨报 | health 显示最近一次 cron 成功 |
| 销售看板 | `dynamic-dashboard` / `9060` | `/opt/claw/node-services/dynamic-dashboard` | 读取 CRM SQLite，提供销售数据看板 | 无应用层鉴权时不要公网裸露 |
| 雪创外部 agent bridge | `agent-bridge` / `9070` | `/opt/claw/node-services/agent-bridge` | 外部系统调用入口、本地 FAQ、会话历史、好友欢迎事件、wxid 绑定、待付款提醒 | 当前 `agent_execution_backend=agent-pool`，转发到 `http://127.0.0.1:9071` |
| 本地 FAQ | 随 `agent-bridge` 启动加载 | `/opt/claw/node-services/agent-bridge/客服回复优化.txt` | 给雪创客服回复提供轻量知识检索 | 本次 health 显示 `knowledge_entries=112` |
| wxid -> 订货通用户绑定 | `agent-bridge` 内置 | `/opt/claw/node-services/agent-bridge/.sessions/wxid-bindings.json` | 维护微信用户与订货通手机号/用户信息绑定 | 当前 `wxid_binding_enabled=true` |
| 待付款提醒 | `agent-bridge` 内置 | `/opt/claw/node-services/agent-bridge/.sessions/payment-reminders.json` | 根据待付款订单生成提醒和去重记录 | 当前 `payment_reminder_enabled=true`，但真实发送 `payment_reminder_send_enabled=false` |
| 雪创订货通 skill | OpenClaw skill | `/root/openclaw-agent-templates/snowchuang/skills/xuechuang-ordering`，worker 中同名目录 | 查询雪创订货通会员、订单、订单状态、收货信息等实时数据 | 需要服务器环境注入 `XCDHT_MCP_*`，不要写入文档 |
| 文章配图 skill | OpenClaw skill | `/root/openclaw-agent-templates/snowchuang/skills/article-image-generator` | 文章/公众号内容的图片生成辅助 | 通用源为 `$BRIDGE_DIR/skills/article-image-generator`，用 `install-shared-skill.js` 同步 |
| 微信公众号 skill | OpenClaw skill | `/root/openclaw-agent-templates/snowchuang/skills/wechat-official-account` | 公众号文章包、素材、草稿/发布 dry-run/publish 流程 | profile/凭证走环境配置 |

雪创维护判断：

| 问题类型 | 优先看哪里 |
| --- | --- |
| 外部客服接口不通 | `curl http://127.0.0.1:9070/health`，再看 PM2 `agent-bridge` 日志 |
| OpenClaw worker 并发/排队异常 | `curl http://127.0.0.1:9071/health` 或 `/admin/pool` |
| 订货通查不到数据 | 先看 `xuechuang-ordering` skill 是否在 template 和 worker，再看凭证环境是否注入 |
| 待付款提醒没有真实发送 | 先确认是否仍为 `payment_reminder_send_enabled=false`；这是安全默认，不要随手开启 |
| CRM/企业微信/晨报/看板问题 | 看 `/opt/claw/node-services/*` 对应服务和 PM2 日志 |

## 苏丹特化功能

苏丹服务器当前没有 `/opt/claw` 这种 PM2 业务服务集合。苏丹专属内容主要部署在通用 agent-pool 的 `sudan-main` template workspace 中。

| 功能 | 位置/服务 | 作用 | 备注 |
| --- | --- | --- | --- |
| 苏丹客服入口 | `sudan-agent-pool-bridge` / `9070` | 承载外部 chat 请求，调度 `sudan-main-1..5` worker | 本次 health 显示 5 个 worker idle、队列 0 |
| 苏丹人格和回复规则 | `/root/openclaw-agent-templates/sudan-main` | 维护苏丹数字分身身份、微信私聊风格、回复边界 | 本地来源是 `D:\Study\codeXprojection\苏丹小龙虾\persona` 和生成 prompt |
| prompt-template 注入 | `/root/openclaw-agent-templates/sudan-main/prompt-template.md` | 把当前 message、history、retrieval_context 等注入 worker 请求 | 当前 `PROMPT_ADAPTER=template` |
| FAQ retrieval | `/root/openclaw-agent-templates/sudan-main/knowledge/faq.json` | 稳定业务 FAQ 检索，命中后进入 prompt 上下文 | 当前 `RETRIEVAL_ENABLED=true`，`topK=8` |
| Metast MCP skill | `/root/openclaw-agent-templates/sudan-main/skills/metast-mcp` | 查询商品、快递、订单、直播预告、会员、IM 群；也包含单人/群消息发送能力 | 涉及实时商品/订单/快递时优先用它；凭证不进文档 |
| colleagues/sudan skill | `/root/openclaw-agent-templates/sudan-main/skills/colleagues/sudan` | 苏丹客服的人设/工作方式结构化产物 | 作为人格和工作 skill 的补充来源 |
| 微信公众号 skill | `/root/openclaw-agent-templates/sudan-main/skills/wechat-official-account` | 苏丹大健康内容运营 profile 的公众号能力 | 服务器变更或真实发布需单独授权并记录 |
| 文章配图 skill | `/root/openclaw-agent-templates/sudan-main/skills/article-image-generator` | 文章/公众号内容的图片生成辅助 | 通用源为 `$BRIDGE_DIR/skills/article-image-generator`，服务器 pull 后用 `install-shared-skill.js` 同步 |
| 旧 Sudan agent bridge | systemd `openclaw-agent-bridge.service` | 旧的苏丹专属 HTTP bridge | 当前 `inactive dead`，不要把它当生产入口，除非明确决定恢复 |

苏丹维护判断：

| 问题类型 | 优先看哪里 |
| --- | --- |
| 客服回复没有按新 FAQ/prompt 生效 | 先看 source workspace -> template -> worker 是否同步，再看 `/health` 中 prompt/retrieval 状态 |
| FAQ 命中但回复没用 | 看 `PROMPT_ADAPTER` 是否为 `template`，以及模板是否包含 retrieval context |
| 实时商品/订单/快递答错 | 看 `metast-mcp` skill、凭证和接口返回，不要只改 FAQ |
| 同一用户连续消息被拆散 | 看 debounce 状态；当前苏丹 debounce 已开启 |
| 旧 bridge 被误启动 | 先确认是否真的要恢复 `openclaw-agent-bridge.service`；当前生产入口是 `sudan-agent-pool-bridge` |

## 运维命令速查

只读检查时优先用这些命令。涉及 `.env` 时只看 key，不打印值。

### 雪创

```bash
sudo systemctl status snowchuang-agent-pool-bridge openclaw-gateway --no-pager
sudo /root/.nvm/versions/node/v22.22.0/bin/pm2 status --no-color

curl -sS http://127.0.0.1:9070/health
curl -sS http://127.0.0.1:9071/health
curl -sS http://127.0.0.1:9030/health
curl -sS http://127.0.0.1:9040/health
curl -sS http://127.0.0.1:9050/health
curl -sS http://127.0.0.1:9060/health

sudo sed -n '1,160p' /opt/openclaw-agent-pool-bridge/agent-pool.config.json
sudo sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' /opt/openclaw-agent-pool-bridge/.env | sort
```

### 苏丹

```bash
sudo systemctl status sudan-agent-pool-bridge openclaw-gateway openclaw-agent-bridge --no-pager

curl -sS http://127.0.0.1:9070/health

sudo sed -n '1,160p' /opt/openclaw-agent-pool-bridge/agent-pool.config.json
sudo sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' /opt/openclaw-agent-pool-bridge/.env | sort

sudo find /root/openclaw-agent-templates/sudan-main/skills -maxdepth 2 -type d | sort
sudo find /root/.openclaw/workers/workspace -maxdepth 2 -type d -name 'sudan-main-*' | sort
```

## 维护边界

| 改动内容 | 应该改哪个本地项目 | 上线方式 |
| --- | --- | --- |
| agent-pool 并发、队列、prompt/retrieval adapter、`/admin/pool`、通用 skill | `D:\Study\codeXprojection\openclaw-agent-pool-bridge` | local code -> GitHub -> server pull -> systemd restart -> health/admin check |
| 雪创 CRM、企业微信、晨报、看板、雪创 `agent-bridge`、订货通 skill | `D:\Study\claw` | local code -> GitHub -> server pull `/opt/claw` -> PM2 restart -> health check |
| 苏丹人格、FAQ、Metast skill、苏丹专属客服规则 | `D:\Study\codeXprojection\苏丹小龙虾` | local code -> GitHub/server deploy -> 更新 `sudan-main` template -> 同步 worker -> health/admin check |
| 服务器 `.env`、systemd、nginx、crontab、真实外发开关 | 对应项目文档中记录变更 | 先拿明确授权，再改服务器；改完写本地 server change log |

安全提醒：

- SSH 密码已经出现在对话里，后续建议尽快改为 SSH key 登录，并轮换当前密码。
- 不要把真实 token、API key、手机号、订单号、地址写进 Git、Markdown、日志摘要或 issue。
- 不要直接改单个 worker workspace。worker 是运行副本，应该由 template 同步生成。
- 对外发送类能力默认保持 dry-run 或 disabled；雪创待付款提醒当前真实发送关闭，这是故意的安全默认。
