---
name: browser-automation-setup
description: Interactive setup wizard for browser-automation config. Creates or edits config.yaml with credential provider, identity, Chrome settings, and service registry.
argument-hint: "[create|edit|add-service|show]"
---

<essential_principles>
## How This Skill Works

This skill manages the `browser-automation` config file -- the YAML that tells browser agents where to find credentials, which Chrome profile to use, and what services are registered.

### Config has no secrets
Only vault item names, URLs, and flags. Secrets stay in 1Password (or whatever credential provider is configured).

### Session isolation matters
Different projects using different accounts MUST use different `chrome.user_data_dir` paths. Otherwise cookies from one account bleed into another and the agent silently authenticates as the wrong user.

### Config Resolution Order

See the canonical resolution order in `browser-automation` skill → Config Resolution Order section. In short: agent explicit → project domain-specific → project generic (legacy) → user default.
</essential_principles>

<intake>
**Ask the user:**

What would you like to do?
1. Create a new config from scratch
2. Edit an existing config
3. Add a service to an existing config
4. Show current config

**Wait for response before proceeding.**
</intake>

<routing>
| Response | Workflow |
|----------|----------|
| 1, "create", "new", "setup" | `workflows/create.md` |
| 2, "edit", "change", "modify", "update" | `workflows/edit.md` |
| 3, "add", "service", "register" | `workflows/add-service.md` |
| 4, "show", "display", "view", "current" | `workflows/show.md` |

**After reading the workflow, follow it exactly.**
</routing>

<workflows_index>
| Workflow | Purpose |
|----------|---------|
| create.md | Full guided setup -- credential provider, identity, Chrome, services |
| edit.md | Modify sections of an existing config |
| add-service.md | Quick-add a single service entry |
| show.md | Display current config with annotations |
</workflows_index>
