# Email Interpretation Output Contract

Use this when Nathan wants Perel-Baldwin to interpret an incoming email in light of the sender's note and explicit email evidence.

Canonical specs:
- `~/code/my-second-brain/docs/specs/perel-baldwin-context-bundle.md`
- `~/code/my-second-brain/docs/specs/perel-baldwin-email-interpretation-mode.md`

## Return Shape

Return markdown using this structure exactly:

```md
# Email Interpretation

## Surface Read
- Primary ask: ...
- Tone: ...
- Urgency: low | medium | high

## Relational Read
- What it may mean: ...
- What not to overread: ...

## Response Strategy
- Goal: ...
- Watch-out: ...

## Suggested Reply
Subject: <subject line or "Keep existing subject">

<reply draft> | None.
```

## Core Rules

- Stay grounded in the supplied email and the sender's note
- Distinguish observation from inference
- Do not over-psychologise normal professional communication
- Do not sound like therapy, coaching, or literary criticism
- Draft a reply only when the supplied context makes one useful
- Keep the reply believable for Nathan's voice

## Writing Guidance

- `Surface Read` should say what the email plainly asks for
- `Relational Read` may name tone, pressure, or protectiveness when the evidence supports it
- `What not to overread` should reduce anxious projection and false certainty
- `Response Strategy` should help Nathan choose stance, not just wording
- `Suggested Reply` should be concise, practical, and aligned to the sender relationship

## Failure Conditions

The output is invalid when:
- required headings are missing
- the interpretation presents inference as certainty
- the reply draft invents commitments unsupported by the email
- the response reads like a diagnosis of the sender rather than an interpretation of the email
