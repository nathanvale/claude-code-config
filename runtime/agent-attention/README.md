# Agent Attention approval gates

Minimal Apple Reminders approval loop for Codex tasks.

## Contract

- `remindctl` owns Apple Reminders access through EventKit.
- One configured `Agent Attention` list.
- One approval meaning per reminder.
- Preview is the default for reminder creation.
- A completed reminder can authorize one task delivery.
- Atomic claim suppresses duplicate delivery.
- Completed reminders remain in Apple Reminders.
- Private mappings, claims, and receipts live under
  `~/.local/state/agent-attention/` by default.
- A crash after claim and before delivery needs human inspection. Never release
  that claim automatically.

## Commands

```sh
bun run agent-attention --help
bun run agent-attention doctor
bun run agent-attention configure \
  --list-id LIST_ID \
  --list-name "Agent Attention"
bun run agent-attention create \
  --thread-id THREAD_UUID \
  --title "Approve rollout" \
  --recommendation "Approve" \
  --approval-meaning "Approve the bounded rollout" \
  --execute
bun run agent-attention poll
bun run agent-attention record-delivery \
  --event-id EVENT_ID \
  --tool-result '{"delivered":true}'
```

`poll` never sends a task message. A Codex automation owns the supported task
messaging call, then runs `record-delivery` only after success.

## Link handler

```sh
runtime/agent-attention/install-link-handler.sh
```

This installs `Agent Attention Link.app` into `~/Applications` and registers
`agent-attention://threads/<UUID>`. The handler validates the UUID, opens the
matching Codex route, then reasserts it after foreground activation.
