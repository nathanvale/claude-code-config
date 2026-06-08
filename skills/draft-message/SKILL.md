---
name: draft-message
description: "Draft professional work messages for Slack, Teams, or email. Use for composing, wording, replying, following up, or preparing a message to send."
role: tool-workflow
user-invocable: true
---

# /draft-message

Dispatch the `work-message-drafter` agent to compose a professional message.

## Usage

```
/draft-message <recipient> <about what> [--channel slack|teams|email] [--tone casual|formal|urgent]
```

All arguments are optional — the agent will infer from context or ask.

## Examples

```
/draft-message daniel about the broken zoom links
/draft-message pri checking in while she's in india
/draft-message alexander about banner access --channel email
/draft-message team update on SDK onboarding progress --channel slack
/draft-message --tone urgent eddie about coding agent platform access
```

## Dispatch

Parse the user's input for:
- **recipient** — person name (check `context/people/` for context)
- **about** — the topic or intent
- **channel** — slack (default), teams, or email
- **tone** — casual (default for slack/teams), formal (default for email), urgent

Then dispatch the `work-message-drafter` subagent via the Agent tool. Build its prompt from the parsed intent (recipient, topic, channel, tone) plus relevant conversation context, and point it at `context/people/` for recipient context and `context/comms-style.md` for tone guidelines.

After the agent returns the draft, present it to the user and offer clipboard copy.

## Rules

- Always dispatch to `work-message-drafter` — don't draft inline
- Pass conversation context to the agent so it has the full picture
- If the user just says "/draft-message" with no args, ask: "Who's the message for, and what's it about?"
- If the agent's draft needs adjustment, relay the feedback back to the agent via SendMessage
