# Workflow: Edit Config

<process>
## Step 1: Find Config

```bash
if [ -f ".browser-agent.yaml" ]; then
  CONFIG=".browser-agent.yaml"
elif [ -f "$HOME/.claude/skills/browser-automation/config.yaml" ]; then
  CONFIG="$HOME/.claude/skills/browser-automation/config.yaml"
else
  echo "NO_CONFIG"
fi
```

If no config found, tell the user and suggest running `/browser-automation-setup create` instead.

## Step 2: Display Current Config

Read and display the current config with section annotations.

## Step 3: Choose What to Edit

Ask the user:

Which section would you like to edit?
1. Credential provider (vault name)
2. Identity (SSO email/provider)
3. Chrome settings (user_data_dir, debug_port, flags)
4. Services (add, remove, or modify registered services)

Wait for response.

## Step 4: Apply Changes

Based on selection:

**1 - Credentials:** Ask for new vault name. Update `credentials.default_vault`.

**2 - Identity:** Ask for new email and provider. Update `identity` section. If removing SSO, delete the section.

**3 - Chrome:** Ask which setting to change. For `user_data_dir`, remind about session isolation. Update the relevant field.

**4 - Services:**
Ask:
1. Add a new service (route to `workflows/add-service.md`)
2. Remove a service
3. Modify an existing service

For remove: list current services, ask which to remove.
For modify: list current services, ask which to modify, then ask what to change (URL, auth type, op_item).

## Step 5: Save and Show Diff

Write the updated config. Show what changed (before → after for modified fields).

Confirm with the user.
</process>

<success_criteria>
This workflow is complete when:
- [ ] Current config displayed
- [ ] User selected section to edit
- [ ] Changes applied and saved
- [ ] Diff shown to user
</success_criteria>
