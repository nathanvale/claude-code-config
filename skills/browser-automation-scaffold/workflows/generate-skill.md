# Workflow: Generate Orchestrator Skill

The orchestrator skill is the user-facing conversation layer. It parses intent, confirms with the user, dispatches the browser agent, and enforces human-in-the-loop boundaries.

## Step 1: Gather task details

From the intake answers, determine:

- **Skill name** -- short, kebab-case (e.g. `timesheet`, `cinema-bookings`, `expense-reports`)
- **Scope** -- same as the agent (project or user)
- **Actions** -- what can the user do? Each action becomes a route in the routing table.
- **Defaults** -- what are the standard parameters? (hours, days, values, etc.)
- **Safety boundaries** -- which actions need explicit human confirmation before executing?

Ask the user:

1. **What actions do you want to automate?** List 2-6 things (e.g. "submit timesheet", "check status", "export history")
2. **What are the defaults?** (e.g. "Mon-Fri, 08:30-17:30, Standard")
3. **Which actions are destructive?** (e.g. "submit", "delete") -- these get human confirmation gates

## Step 2: Build the routing table

Map each action to:
- A route number
- Trigger phrases (what the user might say)
- Which tab/page/section the agent navigates to
- What the agent does (list, fill, submit, export)

## Step 3: Determine path

- **Project scope:** `.claude/skills/{skill-name}/SKILL.md`
- **User scope:** `~/.claude/skills/{skill-name}/SKILL.md`

Create parent directories if needed.

## Step 4: Generate the skill

```markdown
---
name: {skill-name}
description: {What it does}. Use when Nathan says {trigger phrases joined by commas}.
argument-hint: "[action] [parameters]"
disable-model-invocation: true
---

# {Skill Title}

Manage {service description} using the `{domain-key}-browser-agent`.

## Routing Table

Match Nathan's intent to the right action:

| # | Intent | Action |
|---|--------|--------|
{for each action:}
| {N} | "{trigger phrases}" | {description} |

**Default:** If Nathan just says "{skill-name}" with no qualifier, route to **#1**.

## Defaults

{for each default parameter:}
- **{Parameter}:** {value}
- **Override:** Nathan can specify different values

---

{for each route:}
## Route {N}: {Action Name}

### Step 1: {Parse or gather context}
{what to parse from arguments}

### Step 2: {Dispatch agent}
Dispatch `{domain-key}-browser-agent` to {what the agent does}.

### Step 3: {Confirm or report}
{if destructive: "Show Nathan the result. **Only after explicit confirmation**, dispatch agent to {destructive action}."}
{if read-only: "Report the results to Nathan."}

---

## Important Rules

- **NEVER {destructive action} without explicit confirmation**
{for each safety boundary:}
- **{safety rule}**
```

## Step 5: Show the user

Display the generated skill and explain:

- The skill is the conversation layer -- it talks to Nathan and dispatches the agent
- The agent is the execution layer -- it drives the browser
- Destructive actions always have a human confirmation gate
- The routing table can be extended by adding more routes later

Confirm before writing.
