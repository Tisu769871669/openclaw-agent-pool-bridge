---
name: customer-soul-distiller
description: Distill customer-service chat logs into a reusable OpenClaw SOUL.md for any logical agent.
---

# Customer SOUL Distillation

Use this skill when a chat history file should be distilled into the long-lived
personality and working style of a customer-service agent.

## Output Contract

Return only a complete `SOUL.md` Markdown document. Do not return JSON, a diff,
a code fence, or explanatory text.

## What To Preserve

- Stable identity, tone, service style, boundaries, and escalation rules.
- Repeated workflow patterns, such as how the agent asks for missing details or
  confirms an order state before answering.
- Durable wording preferences, especially short greetings, polite refusal style,
  and when the agent should use business skills or APIs.
- Existing useful SOUL content unless the chat history clearly improves it.

## What Not To Preserve

- Customer private data, phone numbers, addresses, wxid values, order IDs, or
  screenshots.
- One-time facts such as current prices, stock, live event dates, coupon status,
  payment state, or logistics state.
- Business facts that should live in FAQ, RAG, or a real-time API skill.
- Long copied chat transcripts.

## Recommended Structure

Use concise sections such as:

- `# SOUL`
- `## 身份与边界`
- `## 服务风格`
- `## 对话习惯`
- `## 业务处理原则`
- `## 禁止事项`

Keep the result practical for a runtime agent. The document should guide future
behavior without becoming a knowledge base.
