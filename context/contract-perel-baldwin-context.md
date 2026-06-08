# Perel-Baldwin Input Contract

This contract defines the required input shape for all Perel-Baldwin invocations.

## Deterministic Section Order

Always assemble the context bundle in this order:

1. **TaskBrief** -- what the agent is being asked to produce and in which mode (`rewrite`, `review`, or `create`)
2. **NathanProfile** -- Nathan's canonical person note (`context/people/nathan-vale.md`)
3. **TargetPersonProfile** or **TargetPersonSummary** -- the subject's person note or a fallback summary
4. **Guidance** -- confidence mode and recommendations
5. **Evidence** -- any supporting material supplied by the caller
6. **OutputContract** -- reference to the output contract file (e.g., `@context/contract-people-note.md`)

## Required Inputs

### NathanProfile (always required)

- Canonical source: `~/code/my-second-brain/context/people/nathan-vale.md`
- Optional supplemental: `~/code/my-second-brain/context/personal.md`

### TargetPersonProfile (required when available)

- Source: `~/code/my-second-brain/context/people/<slug>.md`

### TargetPersonSummary (fallback when no profile exists)

Must be at least one useful paragraph -- specific enough to ground relational writing.

Good: "Richard is a close friend from work. We have a warm, direct friendship with a lot of practical support and candid conversation. He tends to show care through reliability rather than emotional verbosity."

Bad: "Richard is my friend from work."

## Confidence Modes

### Full

Use when Nathan canonical profile + target person profile both exist.

### Fallback

Use when no target profile exists but a useful summary paragraph is available. Output should:
- reflect lower confidence in relational interpretation
- recommend creating a proper person note before relying heavily on the output

### Soft-block

Do not invoke Perel-Baldwin when:
- Nathan canonical profile is missing, OR
- the target person has neither a profile nor a useful summary paragraph

Ask for the missing input first.

## Evidence

Attach only evidence explicitly supplied by the caller. Supported kinds:

- `enrichment-report` -- existing EnrichmentReport JSON
- `analyst-report` -- human-readable relational analysis produced upstream
- `note` -- person note content
- `text-message` -- incoming message
- `email` -- incoming email
- `thread-summary` -- conversation summary
- `psychometrics` -- Big Five, attachment, etc.
- `search-findings` -- search results already gathered upstream
- `argument-summary` -- conflict description

Rules:
- Include only evidence relevant to the task
- Prefer summarized evidence over raw transcripts
- In rewrite mode, do not attach evidence the agent would have to discover for itself
- In review or create mode, evidence may come from upstream analysis, but it still must be explicitly supplied
- Treat `analyst-report` as qualitative context, not as higher-precedence truth than direct note/report evidence
