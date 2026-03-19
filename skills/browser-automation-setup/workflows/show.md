# Workflow: Show Config

<process>
## Step 1: Find Config

```bash
if [ -f ".browser-agent.yaml" ]; then
  CONFIG=".browser-agent.yaml"
  echo "Source: project-level (.browser-agent.yaml)"
elif [ -f "$HOME/.claude/skills/browser-automation/config.yaml" ]; then
  CONFIG="$HOME/.claude/skills/browser-automation/config.yaml"
  echo "Source: user-level (~/.claude/skills/browser-automation/config.yaml)"
else
  echo "NO_CONFIG"
fi
```

If no config found, tell the user:
- No config exists
- Run `/browser-automation-setup create` to create one
- Or copy the template: `cp ~/.claude/skills/browser-automation/config.template.yaml ~/.claude/skills/browser-automation/config.yaml`

## Step 2: Display Config

Read the config and display it with annotations:

```
## Browser Automation Config
**Source:** {path}

### Credentials
- Provider: {provider}
- Vault: {vault}

### Identity
- Email: {email}
- Provider: {sso_provider}

### Chrome
- Profile: {user_data_dir}
- Debug port: {debug_port}
- Flags: {flags}

### Registered Services
| Key | URL | Auth | 1Password Item |
|-----|-----|------|---------------|
| {key} | {url} | {auth} | {op_item} |
```

## Step 3: Verify Prerequisites

```bash
op --version 2>/dev/null && echo "op: OK" || echo "op: MISSING"
agent-browser --version 2>/dev/null && echo "agent-browser: OK" || echo "agent-browser: MISSING"
ls /Applications/Google\ Chrome.app 2>/dev/null && echo "Chrome: OK" || echo "Chrome: MISSING"
```

Report status of each prerequisite.
</process>

<success_criteria>
This workflow is complete when:
- [ ] Config source identified
- [ ] Config displayed with annotations
- [ ] Prerequisites checked and reported
</success_criteria>
