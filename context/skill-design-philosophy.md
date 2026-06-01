# Skill Design Philosophy — prose-trust, steipete weight

Default model for authoring skills in this repo. Inspired by
[steipete/agent-scripts](https://github.com/steipete/agent-scripts) (Peter Steinberger's 48-skill
corpus). Load when authoring or reviewing a `SKILL.md`.

## The rule, stated plainly

**Contracts where a machine parses. Prose where a model reasons.**

A skill is a routing layer that puts the right knowledge in front of a reasoning model, then gets
out of the way. The model is the runtime. Write for the runtime you have.

- Skill **bodies** are read by a reasoning model → write prose. Trust it to follow a clear sentence.
- The **frontmatter** and **infra** (renderers, extractors, runbooks, drift checks) are parsed by
  scripts → keep deterministic contracts there. A script is a dumb executor and needs them.

This is not "prose vs. contracts." It is one line drawn at machine-parsed vs. model-read. steipete
keeps exactly one contract — `validate-skills` checks frontmatter shape — because that is the one
boundary a machine depends on. Everything a model reads is prose.

## Why it works

The consumer is an LLM. An LLM follows a well-written sentence better than a rigid schema it must
reverse-engineer. Machinery is how you constrain a *dumb* executor; the model is not dumb, so
machinery is wasted — worse, it is a second source of truth that can disagree with the prose.

| | Heavy (contract) skill | Prose-trust skill |
|---|---|---|
| Source of truth | code + prose (can disagree) | prose only (can't disagree with itself) |
| Drift | constant | near-zero — nothing to drift |
| Fits in your head | no | yes, by design |
| Maintenance | a system | edit a sentence |
| Failure mode | silent wrong behavior | model reads the rule, follows it |
| Right when | the executor is a script | the executor reasons |

The cautionary tale is the side-quest browser-automation (BA) plugin: surface-manager,
managed-domain contracts, preflight, BSS, authority locks, 8-round adversarial review chains —
machinery defending against failure modes that did not matter, treating a reasoning model like a
dumb executor. Prose-trust is the antidote.

## The shape (steipete weight)

```
skills/<name>/
  SKILL.md          ← only required file. ~50-115 lines typical (avg ~3.7KB; cap ~14KB).
                       frontmatter = name + double-quoted keyword-phrase description. that's it.
                       body = terse imperative bullets + copy-paste command blocks.
  scripts/*         ← optional. repeatable commands a workflow runs. dependency-light. ranges from
                       a thin shell helper to a proper CLI tool built with the `create-cli` skill.
  references/*.md   ← optional. only for long docs pulled out of SKILL.md.
```

Most skills are a single file. Second most common is `SKILL.md` + one thin script. Never
`scripts/` + `references/` + machinery all at once except the largest skills.

**`scripts/` is the machine-parsed side of the line, not a contradiction of prose-trust.** A script —
including a full CLI built with the `create-cli` skill (typed args, flags, exit codes, dry-run) — is a
deterministic contract a machine executes. The SKILL.md prose says *when* and *why* to invoke it; the
CLI enforces *how*. This is the create-cli ↔ cli-command-facade pattern: the skill body is the prose
spec, the CLI under `scripts/` is the enforced contract. Determinism belongs there, not in the body.

## SKILL.md conventions

- **Frontmatter:** `name` + `description` only required. `description` is double-quoted, a generic
  **keyword trigger phrase** optimized for routing, never a summary or workflow narration. No
  personal names. YAML-parse before commit.
- **Body:** terse, imperative, telegraphic. Mostly fenced command blocks with one-line intent
  lead-ins. Prose reserved for judgment, mode selection, and stop conditions — not for restating
  commands.
- **Common headings:** `## Workflow` / `## Source(s)` / `## Safety` / `## Secret Handling` /
  `## Common Commands` / `## Known Pitfalls` / `## Contract`.

## Rules as prose, not machinery

Express safety and guardrails as **prose bullets the model follows**, fail-closed, not as enforcement
code. steipete's strongest examples:

- **Shape-not-value secrets** (`one-password`): "Print presence/shape only, never token or secret
  values." Verify length/prefix/newline-count, never the value.
- **Fail-closed redaction** (`agent-transcript`): allow-list what to keep, deny-list
  secrets/cookies/auth-URLs, sanitize before write, "fail closed on unresolved secrets."
- **No-noise memory** (`github-author-context`): "Do not record ordinary noise" — append only if it
  creates future value. One sentence does what a promotion lifecycle would.
- **Freshness** (`beeper`, `notcrawl`): name the on-disk source + a `doctor`/`status`/`sync` refresh
  verb; "verify freshness for current questions."

For state/memory skills: name the store in a `## Source` block (`DB:` / `Pages:` / `CLI:`), provide a
refresh verb, do not invent a bespoke persistence format inside the skill.

## Skill composability — explicit handoff, not auto-firing

Lean skills compose by a thin **driver** handing off explicitly — not by skills auto-firing off each
other's descriptions. Research finding: no documented case of one skill auto-triggering another via
description matching; single-skill auto-activation is ~20-50% reliable from a description alone, and
only 84-100% with a lifecycle hook. So emergent peer-to-peer routing is a phantom — design for
explicit handoff. See `docs/research/2026-05-30-skill-composability-handoff-observability.md`.

- **One lean driver holds the flow and hands off with an explicit `Skill(name)` call.** The driver is
  a thin skill making a couple of calls — not a framework. It holds no domain knowledge.
- **Use a lifecycle hook for situational firing** (e.g. a Stop hook fires a capture skill at
  end-of-run). A hook reliably knows "a run finished"; a description-trigger does not.
- A `description` is a **trigger phrase for discovery** — it helps the model and the human find the
  skill. Treat it as discovery, not guaranteed routing.
- A handed-to skill does ONE job, then **hands back to the driver** (strong default). Whether it may
  call a third skill is unresolved — leave fan-out to the driver until a brainstorm settles it.
- Skill = discoverable front-door + handback; the read/write underneath is a script or ledger op
  (the create-cli ↔ cli-command-facade seam). Mechanical lookups go to code, not re-reasoned prose.

The system behaviour emerges from composition, but no single skill is complex — the antidote to the
one-mega-skill BA-plugin failure.

## Refuse-in-prose, do not engineer-around

When review surfaces a hole (an edge case, a failure mode), the default fix is **refuse it in prose**
("out of scope — stop and tell the human") or scope it out — NOT new machinery. A pile of
individually-defensible "but what about—" handlers IS the complexity trap. A dumb thing that JAMS
(stops, asks the human) on the hard case is the feature, not a gap to engineer around. A thorough
adversarial pass surfaces every place you *could* add machinery — treat that as a "do not build"
list, not a backlog.

## The line, restated

- **Model reads it** (skill bodies, rules, guardrails) → prose, trusted, fail-closed.
- **Machine parses or executes it** (frontmatter shape, render checks, contract-drift extractors,
  runbook contracts, a CLI under `scripts/` built with `create-cli`) → deterministic contract, kept.

Follow steipete's rule fully by drawing this line — not by removing the one contract he keeps.
