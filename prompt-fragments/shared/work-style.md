<!-- GENERATED — do not edit directly. Edit fragments in $HOME/code/claude-code-config/prompt-fragments/ and run: $HOME/code/claude-code-config/scripts/render-user-prompts.sh --write -->

# Work Style

Applies when editing AGENTS.md, CLAUDE.md, `prompt-fragments/`, `rules/`, `context/`, SKILL.md, skill references.

- Telegraph; noun-phrases ok; drop grammar; min tokens.
- Codex CLI: avoid tables; render poorly. Use bullets or `key: value`. Tables only on request.
- One idea per bullet. No sub-bullets unless meaning fragments.
- Imperative voice. Active. Contractions fine. Drop articles when meaning survives.
- Don't restate the heading in the first line.
- No trailing summaries.
- Bullets > prose for any list.
- Skills canonical for tool workflows. Keep AGENTS.md / CLAUDE.md to hard rules only.

## XML tags

- Default: plain markdown in rule/fragment/skill/policy bodies. No XML.
- Use XML only when it earns parsing payoff: few-shot `<example>` / `<examples>`, long docs `<document>` / `<document_content>` / `<source>`, output routing `<thinking>` / `<answer>` / `<quotes>`.
- Use Anthropic's conventional tag names; lowercase_with_underscores; nest only on real hierarchy.
- No decorative wrapping (`<rule>`, `<note>`) when markdown headings or bullets work.

## Deterministic contracts

- No hand-maintained prose duplicating deterministic contracts.
- If rule can be checked, linted, generated, or tested, prefer that over prose.
- Move state machines, routing tables, lookup maps, schema fields, allowed values, validation rules, and generated output shapes to code, CLI output, or generated docs.
- Prose may name the contract, link runtime source, show emitting command. Don't restate members.
- Keep prose for intent, judgment, role boundaries, user decisions, stop conditions.
- Generated files must name source. Edit source, never generated output.

## No parallel policy

- Must: new skill or doc needing an existing skill's mechanics is a thin wrapper that invokes it. Never copy its steps.
- Must: default to linking the owner. Restating is the exception; justify it in the commit.
- Compose, don't absorb. Reach for another skill's capability by calling it, not by reproducing it.
- One canonical owner per policy, workflow, or contract.
- Other docs link to owner. Don't restate.
- No parallel policy across AGENTS, README, skills, runbooks, and generated docs.
- Pick one active control plane; make every other surface map, adapter, or generated view.

## Rule quality

- Prefer small named rules over broad philosophy.
- Must: invariant.
- Should: strong default.
- May: allowed option.
- Avoid "important" without enforcement path.
- Tables, field lists, route lists, status lists, long examples in hand prose: suspect.
- Convert to code, generated docs, or delete.

## Banned filler

"in order to", "you should", "make sure to", "please", "please note", "note that", "it is important to", "importantly", "as mentioned above", "the following" before lists, "this is a X that Y".

## Line budgets

- Rule: soft 20, hard 30.
- Shared fragment: soft 25, hard 40.
- Harness fragment: soft 15, hard 25.
- AGENTS.md rendered: soft 200, hard 250.
- CLAUDE.md rendered: soft 30, hard 50.
- Skill `description`: soft 240ch, hard 320ch.
- Over soft fine. Over hard justify in commit.
- Past budget: extract to skill, generated doc, or code.
- Don't "just add one more section" forever.

## Skill descriptions

- Trigger phrase, not summary.
- No personal names. No long paths. No workflow narration.
- Quote the value. YAML-parse before commit.
- Bad: `description: Helps Nathan draft professional messages for Slack, Teams, or email by following a tone checklist...`
- Good: `description: "Draft Slack, Teams, or email messages. Triggers on 'draft a message', 'email X'."`

## When to break

Clarity beats terseness. If a rule fights the reader, flag it.
