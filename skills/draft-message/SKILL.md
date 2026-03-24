---
name: draft-message
description: Draft professional work messages for Slack, Teams, or email. Follows a structured tone checklist — audience, intent, traits, clear writing, specifics, sense-check. Copies to clipboard. Use when the user says "draft a message", "message X about Y", "write an email to", "slack X about", "teams message for", "help me word this", "how should I say", or any request to compose a work communication. Also trigger when conversation naturally produces something to send — e.g. after discussing what to tell someone, following up on a task, or preparing a response.
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
- **recipient** — person name (check `memory/people/` for context)
- **about** — the topic or intent
- **channel** — slack (default), teams, or email
- **tone** — casual (default for slack/teams), formal (default for email), urgent

Then dispatch:

```
Agent(
  subagent_type: "work-message-drafter",
  description: "Draft message for {recipient}",
  prompt: "Draft a {channel} message for {recipient} about {topic}. Tone: {tone}.

Context from the conversation: {paste any relevant context from the current conversation that informs the message — e.g. what was discussed, what needs to be communicated, specific details to include}.

The project root is {cwd}.
Check memory/people/ for recipient context.
Check memory/context/ for any brand or tone guidelines."
)
```

After the agent returns the draft, present it to the user and offer clipboard copy.

## Rules

- Always dispatch to `work-message-drafter` — don't draft inline
- Pass conversation context to the agent so it has the full picture
- If the user just says "/draft-message" with no args, ask: "Who's the message for, and what's it about?"
- If the agent's draft needs adjustment, relay the feedback back to the agent via SendMessage
