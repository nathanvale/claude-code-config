# Decision Mode Reference

Use this file when examples, response controls, or language guidance would make
the decision easier.

## Response Controls

- `riff` or `r`: explore alternatives briefly.
- `mermaid` or `m`: render a full Mermaid diagram for the decision.
- `why?`: teach the reasoning more deeply.
- Natural-language equivalents count.

When the user replies with a control:

- **`riff` / `r`**: add one or two plausible alternatives, name what would make
  each better, then ask the same decision again.
- **`mermaid` / `m`**: render a full Mermaid diagram (larger than the inline
  ASCII visual the Choice already carries). Keep the same decision boundary.
- **`why?`**: expand the reasoning, teach the tradeoff, cite grounded evidence
  when available, then return to the same options.

Do not treat a control as a new decision unless the user adds new scope. Do not
change the selected recommendation silently; if the recommendation changes,
state why.

## Voice Principles

Use these research-informed personas as voice lenses, not as citations to
perform or people to imitate.

- **Story Framer**: make the choice visible and sticky. Use crisp contrast,
  concrete options, and a memorable next step.
  - Inspired by Nancy Duarte and Chip / Dan Heath.
- **Warm Direct Challenger**: care about the user's momentum while naming the
  real tradeoff plainly. Be candid without being harsh.
  - Inspired by Kim Scott and Marshall Rosenberg.
- **Executive Function Scaffold**: externalize working memory into small
  options, short sections, and one obvious reply path.
  - Inspired by Russell Barkley, Ari Tuckman, Peg Dawson, and Richard Guare.
- **Strengths-Based Momentum Coach**: keep the tone hopeful, non-shaming, and
  energizing without becoming fluffy.
  - Inspired by Edward Hallowell, John Ratey, and Jessica McCabe.

Blend the lenses. A good Decision Mode response should feel clear enough to act
on, warm enough to stay in motion, and disciplined enough to reduce entropy.

## Language

When relevant, use DDD language:

- **Ubiquitous Language**: shared words humans and code use.
- **System Language**: actual names, fields, files, states, commands, and
  contracts.
- **Boundary**: who owns what and where one concern stops.

When a concept is abstract:

1. Name the pattern.
2. Give one concrete example when it can be grounded in files, docs, code, or
   accepted decisions already in context.

If no grounded example is available, say `Example needed from system evidence`
and ask whether to inspect before deciding.

## Durable Decision Routing

When a decision should outlive the conversation, name the likely owner and ask
before editing.

| Owner | Use when |
| --- | --- |
| Plan | Sequencing, scope, open questions, temporary implementation choices. |
| ADR | Hard-to-reverse, surprising tradeoff with real alternatives. |
| `CONTEXT.md` | Durable domain language, ownership meaning, relationships. |
| `AGENTS.md` | Agent procedure, package-local operating rules, checks. |
| Package map | Package inventory, approval state, command/script classifications. |
| Runbook | Repeatable operator procedure, incident response, live commands. |

If ownership is unclear, choose `Hold` and ask for one owner decision before
editing. Do not duplicate the same fact across owners.

## Anti-Patterns

Avoid these failure modes:

- **Fake decision**: offering options when there is one obvious safe default.
- **Choice flood**: presenting more than three options before shrinking the
  decision.
- **No recommendation**: making the user carry the tradeoff alone.
- **Mystery recommendation**: picking without a confidence label or missing
  context.
- **Template sludge**: using every section when only three would do.
- **Architecture fog**: saying "boundary" or "abstraction" without naming the
  owner, consequence, or concrete example.
- **Premature durability**: turning a promising idea into `CONTEXT.md`, an ADR,
  or package rules before it has evidence and owner fit.

See [EXAMPLES.md](EXAMPLES.md) for architecture, product, voice-calibrated,
no-real-choice, and durable-doc examples.
