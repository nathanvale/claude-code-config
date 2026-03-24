# Workflow: Create Config

<process>
## Step 1: Detect Existing Config

```bash
ls .browser-agent.yaml 2>/dev/null && echo "PROJECT_CONFIG_EXISTS"
ls "$HOME/.claude/skills/browser-automation/config.yaml" 2>/dev/null && echo "USER_CONFIG_EXISTS"
```

If a config already exists, warn the user and ask if they want to overwrite or switch to edit mode.

## Step 2: Choose Location

Ask the user:

Where should the config be saved?
1. Project-level (`.browser-agent.yaml`) -- specific to this project
2. User-level (`~/.claude/skills/browser-automation/config.yaml`) -- shared across all projects

Wait for response. Set `CONFIG_PATH` accordingly.

## Step 3: Credential Provider

Check if 1Password CLI is available:

```bash
op --version 2>/dev/null
```

If available, ask:

Which 1Password vault should browser agents use for credentials?

Provide a list of available vaults:

```bash
op vault list --format=json 2>/dev/null
```

Set `credentials.provider` to `op` and `credentials.default_vault` to the chosen vault name.

If `op` is not installed, inform the user that 1Password CLI is currently the only supported credential provider, and they'll need to install it for auth flows to work. Set `credentials.provider` to `op` and `credentials.default_vault` to a placeholder.

## Step 4: Identity (SSO)

Ask the user:

Do you use Google SSO to log into any services?
1. Yes -- I have a Google account for SSO
2. No -- I only use username/password logins

If yes, ask: What email address do you use for Google SSO?

Set `identity.email` and `identity.provider: google`.

If no, omit the `identity` section from the config.

## Step 5: Chrome Settings

Explain session isolation:

> The `user_data_dir` controls where Chrome stores cookies and auth state.
> Different projects using different accounts MUST use different paths.
> For example: `~/.cache/chrome-agent-work` vs `~/.cache/chrome-agent-personal`

Ask: What path should be used for Chrome's user data directory?

Suggest a default based on context:
- If project-level config: `~/.cache/chrome-agent-{project-name}`
- If user-level config: `~/.cache/chrome-agent`

Set `chrome.user_data_dir`, `chrome.debug_port: 9222`, and standard flags.

## Step 6: Services

Ask the user:

Do you want to register any services now? (You can always add more later with `/browser-automation-setup add-service`)
1. Yes -- let me add some services
2. No -- I'll add them later

If yes, loop through the add-service workflow (read `workflows/add-service.md` for each service). Ask "Add another?" after each.

## Step 7: Write Config

Write the YAML to `CONFIG_PATH` with comments explaining each section. Use the template structure from `config.template.yaml` as a guide.

## Step 8: Verify

```bash
# Check vault access
op vault list --format=json 2>/dev/null | grep -q "{vault_name}" && echo "VAULT_OK" || echo "VAULT_MISSING"

# Check Chrome
ls /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome 2>/dev/null && echo "CHROME_OK" || echo "CHROME_MISSING"

# Check agent-browser
agent-browser --version 2>/dev/null && echo "AGENT_BROWSER_OK" || echo "AGENT_BROWSER_MISSING"
```

Report results. If anything is missing, provide install instructions.

Show the written config file and confirm with the user.
</process>

<success_criteria>
This workflow is complete when:
- [ ] Config file written to chosen location
- [ ] Credential provider configured with vault name
- [ ] Identity configured (or explicitly skipped)
- [ ] Chrome user_data_dir set with isolation explained
- [ ] Services registered (or explicitly deferred)
- [ ] Prerequisites verified (op, Chrome, agent-browser)
</success_criteria>
