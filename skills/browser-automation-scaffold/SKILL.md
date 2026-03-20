---
name: browser-automation-scaffold
description: Scaffold a new browser agent with self-healing selector registry, playbooks, config, and session registration. Use when creating a new browser automation workflow for any domain.
argument-hint: "[domain-name]"
---

# Browser Agent Scaffold

Interactive wizard that generates a complete browser agent stack from a domain name and a few questions.

## What Gets Generated

| File | Purpose |
|------|---------|
| Agent markdown | Persona, constraints, workflow, mode selection |
| Config YAML (or service entry) | Auth hints, credentials, identity |
| Selector registry | Empty declarative schema ready for Discovery Mode |
| Session registration | Port/profile assignment in registry.yaml |
| Gotcha file stub | Domain-specific gotcha starter |
| Orchestrator skill | Conversation layer with routing table, defaults, human-in-the-loop |
| First playbook (optional) | Task-specific playbook skeleton |

<intake>
Parse the argument for a domain name. If none provided, ask:

**What domain or service do you want to automate?**
Give me a short name (e.g. `fasttrack360`, `confluence`, `village-cinemas`)

Then gather:

1. **Full URL** -- the main URL for this service
2. **Scope** -- user-scope (`~/.claude/agents/`) or project-scope (`.claude/agents/`)?
3. **Auth type** -- sso | password | password_totp | none
4. **1Password item** -- vault item name (skip if auth = none)
5. **Identity** -- which email/account (skip if auth = none)
6. **Key constraints** -- any domain-specific safety rules? (e.g. "never delete", "never submit without confirmation")
7. **First task** -- what's the main thing you'll automate? (optional, for playbook scaffold)

**Wait for responses before proceeding.**
</intake>

<routing>
After gathering inputs, execute these workflows in order:

1. Read `workflows/generate-config.md` and follow it
2. Read `workflows/generate-registry.md` and follow it
3. Read `workflows/generate-agent.md` and follow it
4. Read `workflows/generate-skill.md` and follow it
5. Read `workflows/register-session.md` and follow it
6. If user wants a first playbook, read `workflows/generate-playbook.md` and follow it
7. Read `workflows/summary.md` and follow it
</routing>

## Model Promotion Lifecycle

Every browser agent starts on Sonnet. As playbooks harden, the agent tracks readiness for cheaper models.

```
candidate --> validated (Sonnet) --> promoted (Haiku) --> demoted (Sonnet, if Haiku fails)
```

### Promotion to Haiku

The generated agent includes a `## Model Promotion` section. When ALL of these are true for a playbook:

- playbook status is `validated`
- at least 2 consecutive successful runs with matching fingerprint
- no Recovery Mode activations in the last 3 runs
- all selectors used by the playbook are `validated`

The agent notes in its Browser Report:

```
### Model Promotion
- Playbook: {name}@v{n}
- Consecutive successes: N
- Recovery activations (last 3): 0
- Recommendation: PROMOTE to Haiku for this playbook
```

Nathan can then change `model: sonnet` to `model: haiku` in the agent frontmatter.

### Demotion back to Sonnet

If a Haiku-model agent:

- fails Fast Mode and cannot recover
- hits Recovery Mode more than once in 3 runs
- returns PARTIAL or FAILED status

It notes in its Browser Report:

```
### Model Promotion
- Playbook: {name}@v{n}
- Haiku failures (last 3): N
- Recommendation: DEMOTE to Sonnet -- selectors may have drifted
```

Demotion is always a recommendation, never automatic.
