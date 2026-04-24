# Architecture

This bridge keeps the public chat API simple while moving concurrency control into a small set of internal components.

![OpenClaw Agent Pool Bridge architecture](assets/openclaw-agent-pool-bridge-architecture.png)

## Request Flow

```mermaid
flowchart LR
  C["WeCom / personal WeChat / app caller"]
  B["Existing business bridge"]
  H["HTTP API<br/>/api/agents/chat<br/>/api/agents/:agentId/chat"]
  Q["ConversationQueue<br/>key = logicalAgent + conversationId"]
  P["AgentPool<br/>worker lease + wait queue"]
  S["SessionStore<br/>bridge-owned recent history"]
  R["OpenClawRunner<br/>openclaw agent --agent workerId"]
  W1["worker agent<br/>main-1"]
  W2["worker agent<br/>main-2"]
  W3["worker agent<br/>main-3"]
  W5["worker agent<br/>main-5"]

  C --> B
  B -->|"POST with conversationId + content"| H
  H -->|"normalize request"| Q
  Q -->|"same conversation stays sequential"| P
  P -->|"lease one free worker"| S
  S -->|"history + new user message"| R
  R --> W1
  R --> W2
  R --> W3
  R --> W5
  W1 -->|"reply"| R
  W2 -->|"reply"| R
  W3 -->|"reply"| R
  W5 -->|"reply"| R
  R -->|"append assistant reply"| S
  S -->|"compatible response schema"| H
  H --> B
  B --> C
```

## Pool And Queue Behavior

```mermaid
flowchart TB
  L["logical agent: main"]
  T["soft sticky map<br/>main + customerA -> main-2<br/>expires after STICKY_TTL_SECONDS"]
  A["customerA message 1"]
  A2["customerA message 2"]
  B["customerB message"]
  C["customerC message"]
  CQ1["ConversationQueue<br/>customerA lane"]
  CQ2["ConversationQueue<br/>customerB lane"]
  CQ3["ConversationQueue<br/>customerC lane"]
  Pool["AgentPool<br/>max active = worker count"]
  Busy["busy worker<br/>one OpenClaw child process"]
  Free["free worker"]
  Wait["pool wait queue"]
  Timeout["HTTP 429<br/>queue_timeout"]

  L --> T
  A --> CQ1
  A2 --> CQ1
  B --> CQ2
  C --> CQ3
  CQ1 -->|"strict order"| Pool
  CQ2 -->|"parallel with other customers"| Pool
  CQ3 -->|"parallel with other customers"| Pool
  Pool -->|"sticky worker is available"| Busy
  Pool -->|"sticky worker busy, another worker free"| Free
  Pool -->|"all workers busy"| Wait
  Wait -->|"released before QUEUE_TIMEOUT_SECONDS"| Pool
  Wait -->|"waits too long"| Timeout
```

## Template Workspace Sync

```mermaid
flowchart LR
  Template["template workspace<br/>/root/openclaw-agent-templates/main"]
  Sync["sync-worker-workspaces.js<br/>manual deploy step"]
  W1["worker workspace<br/>/root/.openclaw/workers/workspace/main-1"]
  W2["worker workspace<br/>/root/.openclaw/workers/workspace/main-2"]
  W3["worker workspace<br/>/root/.openclaw/workers/workspace/main-3"]
  W5["worker workspace<br/>/root/.openclaw/workers/workspace/main-5"]
  State["runtime state is preserved<br/>.env, .sessions, logs, tmp, node_modules"]

  Template -->|"edit persona, skills, knowledge once"| Sync
  Sync --> W1
  Sync --> W2
  Sync --> W3
  Sync --> W5
  Sync -. "skip runtime files" .-> State
```

## Component Responsibilities

| Component | Responsibility |
| --- | --- |
| `HttpServer` | Preserves the existing synchronous request and response protocol. |
| `ConversationQueue` | Serializes messages for the same `logicalAgent + conversationId`. |
| `AgentPool` | Leases one worker per request, tracks busy workers, and returns 429 after queue timeout. |
| `SessionStore` | Stores recent bridge-owned history so a conversation can move between workers safely. |
| `OpenClawRunner` | Starts exactly one `openclaw agent` child process for one worker run. |
| Template sync script | Copies one canonical logical-agent workspace into every worker workspace before serving traffic. |
