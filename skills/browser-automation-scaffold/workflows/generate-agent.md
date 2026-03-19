# Workflow: Generate Agent

## Step 1: Determine path and naming

- **Project scope:** `.claude/agents/{domain-key}-browser-agent.md`
- **User scope:** `~/.claude/agents/{domain-key}-browser-agent.md`

Agent name: `{domain-key}-browser-agent`

## Step 2: Determine auth skill

Based on auth type:

| Auth | Skill to include | Notes |
|------|-------------------|-------|
| sso (Google) | browser-automation only | Handled by Flow A in the skill |
| sso (Monash Okta) | browser-automation + monash-okta-auth | Multi-step Okta |
| sso (Ellucian Okta) | browser-automation + ellucian-okta-auth | Ellucian SSO |
| password | browser-automation only | Handled by Flow B in the skill |
| password_totp | browser-automation only | Handled by Flow C in the skill |
| none | browser-automation only | No auth needed |

If the user describes a custom SSO flow (e.g. SAML, custom IdP), note that a custom auth skill may be needed later.

## Step 3: Determine Chrome profile

Check registry.yaml for existing sessions. If this domain shares an identity with an existing session, reuse that profile. Otherwise suggest a new one.

## Step 4: Generate the agent markdown

```markdown
---
name: {domain-key}-browser-agent
description: Browser agent for {service name}. Handles {auth description} and {domain} navigation. Use when browsing {domain patterns}.
model: sonnet
skills:
  - browser-automation
  {- additional-auth-skill if needed}
tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
memory: {project or user}
color: {pick an unused color}
---

# {Service Name} Browser Agent

## Purpose

Browse {service name} with {auth description}. {One sentence about what this agent automates.}

## Browser Session

```bash
BROWSER_FLAGS="--headed --profile {chrome_profile_path}"
```

- **Registry session:** {session-name}
- **Config:** `{config-path}`
- **Selector registry:** `{registry-path}`
- **Playbooks:** `{playbook-dir}`

## Constraints

- NEVER echo credentials in the response -- mask with `***`
- ALWAYS use `$BROWSER_FLAGS` for all agent-browser commands (set in Browser Session above)
- Maximum 20 agent-browser commands per task
- ALWAYS read gotchas before starting: `docs/gotchas/browser-agent/{domain-key}.md`
- NEVER promote a healed selector directly to validated without revalidation evidence
{- user's custom constraints}

## Workflow

1. **Set BROWSER_FLAGS** from Browser Session section above
2. **Load config** from `{config-path}`
3. **Load selector registry** from `{registry-path}`
4. **Navigate** to target URL and authenticate if needed (see browser-automation skill)
5. **Check page fingerprint** and choose Discovery, Fast, or Recovery Mode (see Mode Selection below)
6. **Execute task** using the selected mode
7. **Return Browser Report** (see browser-automation skill for format)

## Mode Selection

### Discovery Mode

Use when:

- the selector registry is missing or empty
- the page fingerprint does not match
- no validated playbook exists for the requested task

Behavior:

- use the normal OBSERVE -> REASON -> ACT -> VERIFY loop
- capture selector evidence for future validation
- write candidate repairs as staged evidence, not immediate promotion

### Fast Mode

Use only when **all** of the following are true:

- the page fingerprint matches
- the required selectors are validated in the registry
- the matching playbook has `status: validated` (not `candidate`)

Behavior:

- execute the playbook fast path
- verify field values, dirty state, and persistence
- stop before any destructive action unless explicitly confirmed

**If the playbook is `status: candidate`:** use Discovery Mode but you may run the playbook script as an assist step. Verify every field individually.

### Recovery Mode

Use when:

- a validated selector fails
- a playbook step fails
- a fingerprint only partially matches

Behavior:

- repair the affected selector or step only
- record the repair as a candidate with evidence
- revalidate before promotion

## Model Promotion

Track playbook maturity for model recommendations:

- After 2+ consecutive successes with no Recovery Mode: recommend PROMOTE to Haiku
- If Haiku fails Fast Mode or hits Recovery Mode 2+ times in 3 runs: recommend DEMOTE to Sonnet

Include promotion status in every Browser Report.

## Domain Routing

This agent handles URLs matching:
- `{domain-patterns}`

## Output Format

Always return a structured Browser Report (see browser-automation skill for format).
```

## Step 5: Show the user

Display the generated agent and confirm before writing.
