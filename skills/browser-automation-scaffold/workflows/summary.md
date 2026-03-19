# Workflow: Summary

## Step 1: List all generated files

Show a table of every file created, with its path and purpose:

| File | Purpose |
|------|---------|
| `{config-path}` | Auth hints, credentials, service entry |
| `{registry-path}` | Selector registry (empty, ready for Discovery) |
| `{agent-path}` | Agent markdown with self-healing modes |
| `{registry.yaml update}` | Session port/profile registration |
| `{playbook-path}` (if created) | Task playbook skeleton |
| `{scripts}` (if created) | Fill + verify script stubs |

## Step 2: Explain the lifecycle

```
/browser-automation-scaffold {domain}
        |
        v
  [Empty registry + agent + config]
        |
        v
  First run: Discovery Mode
  - Agent explores the page, fills fields manually
  - Learns selectors, interaction patterns, gotchas
  - Writes candidates to registry
        |
        v
  Second run: Discovery Mode with script assist
  - Playbook scripts get filled in from discovery evidence
  - Agent verifies every field, saves, checks persistence
  - If all pass: promote playbook to "validated"
        |
        v
  Third+ runs: Fast Mode (Sonnet)
  - Bulk fill via playbook, verify, save
  - Under 10 browser commands
        |
        v
  After 2+ clean runs: Agent recommends Haiku promotion
  - Switch model in frontmatter
  - Haiku uses Fast Mode only
        |
        v
  If Haiku struggles: Agent recommends Sonnet demotion
  - Switch model back
  - Sonnet repairs via Recovery Mode
```

## Step 3: Next steps

Tell the user:

1. **Try it:** Dispatch the new agent with a task. It will run in Discovery Mode and start learning the page.
2. **Check gotchas:** After the first run, review `docs/gotchas/browser-agent/{domain-key}.md` for anything surprising.
3. **Promote playbooks:** After a successful fill + save + persistence check, change `status: candidate` to `status: validated` in the playbook YAML.
4. **Watch for model promotion:** The agent will tell you when it's ready for Haiku.
