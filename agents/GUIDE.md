# Browser Agent Architecture

## The Pattern

```
Agent  = WHO  (persona, constraints, workflow, decision-making)
Skill  = HOW  (recipes, commands, reference material)
Config = WHERE (URLs, vault items, credentials provider)
```

Agents are thin. Skills are reusable. One skill powers many agents.

## How It Works

```
┌──────────────────────┐
│  browser-agent       │  ← generic browser worker
│  skills:             │
│    - browser-automation  ← Chrome recipes, auth flows, scraping
│                      │
│  Constraints:        │
│    - max 20 commands │
│    - no destructive  │
│    - return report   │
└──────────────────────┘

┌──────────────────────┐
│  zoom-scraper        │  ← hypothetical: Zoom transcript downloader
│  skills:             │
│    - browser-automation  ← same Chrome/auth recipes
│    - zoom-transcript     ← Zoom-specific DOM patterns
│                      │
│  Constraints:        │
│    - download only   │
│    - never delete    │
└──────────────────────┘
```

The `browser-automation` skill gets injected into the agent's context at startup.
The agent never needs to discover or load it -- it's just there.

## Adding a New Browser Agent

### 1. Create the agent file

```
agents/my-new-agent.md
```

```yaml
---
name: my-new-agent
description: One line -- Claude uses this to decide when to dispatch.
model: sonnet
skills:
  - browser-automation        # always include this for browser work
  - my-domain-skill           # optional: domain-specific recipes
color: green
---
```

### 2. Write the body (persona + constraints + workflow)

The body becomes the agent's system prompt. Include:

- **Purpose** -- what this agent does (1-2 sentences)
- **Constraints** -- what it must/must not do
- **Workflow** -- numbered steps for how it operates
- **Output format** -- what it returns to the calling agent

```markdown
# My New Agent

## Purpose
Scrapes pricing data from competitor websites.

## Constraints
- NEVER submit forms or create accounts
- NEVER click through paywalls
- Maximum 15 agent-browser commands per task

## Workflow
1. Load config and check prerequisites (see skill)
2. Navigate to the target URL
3. Use OBSERVE → REASON → ACT → VERIFY loop (see skill)
4. Extract pricing data from snapshots
5. Return structured report

## Output Format
Return a Browser Report (see skill for format).
```

### 3. Add a domain skill (optional)

Only if your agent needs domain-specific recipes that don't belong in `browser-automation`.

```
skills/my-domain-skill/SKILL.md
```

```yaml
---
name: my-domain-skill
description: Domain-specific recipes for X.
user-invocable: false
---
```

Put domain-specific DOM patterns, navigation quirks, and data extraction templates here.

### 4. Add services to config (optional)

If your agent needs auth for specific sites, add entries to `skills/browser-automation/config.yaml`:

```yaml
services:
  my-service:
    url: https://example.com/admin
    auth: password              # sso | password | password_totp
    op_item: "Example Service"  # 1Password item name
```

## What Goes Where

| Content | Location | Why |
|---------|----------|-----|
| "Never delete anything" | Agent file | Constraint = agent's job |
| "Click @eN to interact" | `browser-automation` skill | Recipe = shared knowledge |
| "Zoom shows transcripts at /recording/detail" | `zoom-transcript` skill | Domain knowledge |
| Vault item names, URLs | `config.yaml` | Environment-specific |
| "Login failed on cloudflare.com" | `docs/gotchas/browser-agent/` | Self-healing memory |

## Tools Allowlist

Lock down the agent's tools to prevent it reaching for MCP tools (e.g. Chrome DevTools) instead of `agent-browser` via Bash:

```yaml
tools:
  - Bash
  - Read
  - Edit
  - Write
  - Glob
  - Grep
```

## Setup

Run `/browser-automation-setup` to create or edit the config interactively. Modes:
1. **create** -- full guided setup from scratch
2. **edit** -- modify an existing config
3. **add-service** -- quick-add a service entry
4. **show** -- display current config

Or copy the template manually:
```bash
cp ~/.claude/skills/browser-automation/config.template.yaml ~/.claude/skills/browser-automation/config.yaml
```

## Session Isolation

Chrome stores cookies in `chrome.user_data_dir`. Different projects using different accounts **MUST** use different paths:

```yaml
# Work project
user_data_dir: ~/.cache/chrome-agent-work

# Personal project
user_data_dir: ~/.cache/chrome-agent-personal
```

Same `user_data_dir` = shared cookies = wrong account login.

## NEEDS_HUMAN Flow

When the agent hits something it can't automate (CAPTCHA, hardware key):

1. Agent pre-fills what it can (e.g. credentials)
2. Agent returns `NEEDS_HUMAN` report immediately -- no polling
3. You do the manual step (e.g. click a CAPTCHA checkbox)
4. Re-dispatch the agent: "The human completed their part. Continue."
5. Agent clicks submit, handles remaining steps (TOTP, etc.), continues the task

Cookies persist in `user_data_dir` -- manual steps are typically needed only once every few weeks.

## Key Rules

- **Skills are `user-invocable: false`** -- they exist to be loaded by agents, not invoked directly
- **Skills have no constraints** -- constraints belong in the agent
- **Agents are thin** -- ~30-50 lines. Heavy knowledge lives in skills.
- **`skills:` frontmatter is static** -- you can't swap skills per dispatch. Different task = different agent (or different prompt).
- **Config has no secrets** -- only vault item names, URLs, and flags. Secrets stay in 1Password.
- **Safety flags are not configurable** -- `--no-first-run`, `--disable-sync`, `--disable-features` are always applied by the skill. `chrome.flags` in config is for additional non-safety flags only.

## File Tree

```
~/.claude/
├── agents/
│   ├── browser-agent.md                    ← generic browser worker
│   ├── confluence-scraper-agent.md         ← Confluence page extractor
│   ├── zoom-transcription-agent.md         ← Zoom transcript extractor (full)
│   ├── zoom-triage-agent.md                ← Zoom metadata scanner (fast)
│   └── GUIDE.md                            ← this file
└── skills/
    ├── browser-automation/
    │   ├── SKILL.md                        ← recipes (user-invocable: false)
    │   ├── config.yaml                     ← your config
    │   ├── config.template.yaml            ← template for new users
    │   └── registry.yaml                   ← session port/profile registry
    ├── browser-automation-setup/
    │   ├── SKILL.md                        ← /browser-automation-setup wizard
    │   └── workflows/
    │       ├── create.md
    │       ├── edit.md
    │       ├── add-service.md
    │       └── show.md
    └── browser-automation-scaffold/
        ├── SKILL.md                        ← /browser-automation-scaffold wizard
        └── workflows/
            ├── generate-agent.md           ← agent template generator
            ├── generate-config.md          ← config template generator
            ├── generate-playbook.md        ← playbook template generator
            ├── generate-registry.md        ← selector registry generator
            ├── register-session.md         ← session registration workflow
            └── summary.md                  ← scaffold summary
```
