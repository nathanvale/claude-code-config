# Workflow: Add Service

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

If no config found, tell the user and suggest running `/browser-automation-setup create` first.

## Step 2: Gather Service Details

Ask the user for each field:

**Service key** -- short name, lowercase, hyphens ok (e.g., `tailscale`, `router`, `my-app`)

**URL** -- the service's login or dashboard URL

**Auth type:**
1. `sso` -- Google SSO (cookie-based, uses identity.email from config)
2. `password` -- username/password from 1Password vault
3. `password_totp` -- username/password + TOTP from 1Password vault
4. None -- no auth needed (public page)

**1Password item name** (skip if auth type is "none") -- the item name in the configured vault that holds the credentials for this service.

Verify the item exists:

```bash
op item get "{op_item}" --vault "{vault}" --format=json 2>/dev/null | head -5
```

If not found, warn but continue (user may create it later).

## Step 3: Append to Config

Add the service entry under the `services:` section:

```yaml
  {service_key}:
    url: {url}
    auth: {auth_type}
    op_item: "{op_item}"
```

## Step 4: Confirm

Show the added entry and the full services section of the config.

Ask: "Add another service?"
- If yes, repeat from Step 2
- If no, done
</process>

<success_criteria>
This workflow is complete when:
- [ ] Service key, URL, auth type, and op_item collected
- [ ] Service entry appended to config
- [ ] Entry shown to user for confirmation
</success_criteria>
