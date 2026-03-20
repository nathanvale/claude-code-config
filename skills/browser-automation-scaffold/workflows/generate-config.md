# Workflow: Generate Config

## Step 1: Check for existing config

If scope is **project**, check for `.claude/skills/{domain-key}/config.yaml`.
If scope is **user**, check for `~/.claude/skills/{domain-key}/config.yaml`.

If a config already exists at the target path, ask whether to add a service entry to the existing config or create a new one.

## Step 2: Determine config strategy

**If adding a service to an existing config:**

Append under the `services:` section:

```yaml
  {domain-key}:
    url: {url}
    auth: {auth_type}
    op_item: "{op_item}"
    selector_registry: {skill-dir}/selectors.yaml
    playbook_dir: {skill-dir}/playbooks
```

**If creating a new config:**

Use the template at `~/.claude/skills/browser-automation/config.template.yaml` as a base. Fill in:

- `credentials.provider: op`
- `credentials.default_vault` -- ask which vault, or use existing vault from user config
- `identity.email` and `identity.provider` -- from the gathered identity
- `chrome.user_data_dir` -- suggest `~/.cache/chrome-agent-{domain-key}`
- `chrome.debug_port` -- next available from registry.yaml
- Service entry with `selector_registry` and `playbook_dir` paths

## Step 3: Verify 1Password item (if auth != none)

```bash
op item get "{op_item}" --vault "{vault}" --format=json 2>/dev/null | head -5
```

Warn if not found, but continue.

## Step 4: Write the config

Write to the appropriate path. Show the user what was written.
