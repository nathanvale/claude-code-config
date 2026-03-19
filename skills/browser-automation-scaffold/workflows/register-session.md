# Workflow: Register Session

## Step 1: Read current registry

Read `~/.claude/skills/browser-automation/registry.yaml` to see existing sessions and port assignments.

## Step 2: Check for reuse

If this agent shares an identity/profile with an existing session (same `user_data_dir`), reuse that session entry. Just note the shared session in the agent's Browser Session section.

For example, the `timesheet` session shares `~/.cache/chrome-agent` with `personal` because they use the same cookies.

## Step 3: Assign port and profile (if new session needed)

- **Port:** next available after the highest used port in the registry
- **Profile:** `~/.cache/chrome-agent-{domain-key}` (unless sharing)

**Port collision check:** Before assigning, verify no existing session uses the same port with a different `user_data_dir`. Two sessions may share a port ONLY if they share the same `user_data_dir`. If a collision is detected, pick the next available port instead.

## Step 4: Add entry to registry.yaml

Append:

```yaml
  {session-name}:
    port: {port}
    config: {config-path}
    user_data_dir: {profile-path}
```

## Step 5: Show the user

Display the updated registry and confirm.
