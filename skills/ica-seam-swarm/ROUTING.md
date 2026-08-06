# ICA Seam Swarm Routing Rails

Use this file before file listing or context gathering when the request is
terse, ambiguous, typo-heavy, or leaves dispatch-vs-prompt-pack unclear.

## Table of Contents

- [Request Intake](#request-intake)
- [Target Resolution](#target-resolution)
- [Router Output](#router-output)
- [Dispatch Authorization](#dispatch-authorization)
- [Prompt Pack Compactness](#prompt-pack-compactness)
- [Mode Disambiguation](#mode-disambiguation)

## Request Intake

Fill this XML-shaped intake rail mentally. Print it only when the user asks for
debug detail.

```xml
<request_intake>
  <user_phrase>the user's exact phrase</user_phrase>
  <inferred_seam>best-effort seam path or concept</inferred_seam>
  <target_confidence>clear | ambiguous</target_confidence>
  <target_alternatives>other plausible seams, if any</target_alternatives>
  <mode_confidence>clear | ambiguous</mode_confidence>
  <requires_router>true | false</requires_router>
  <reason>why routing is or is not needed</reason>
</request_intake>
```

Set `<requires_router>true</requires_router>` when the prompt is shorthand,
typo-heavy, names a broad plugin/workspace without a mode, leaves the target
uncertain, or leaves dispatch-vs-prompt-pack unclear.

## Target Resolution

Before router output, do a cheap target-resolution pass:

- If the user supplied an exact path, check that it exists.
- If the user supplied shorthand or an alias, map it through verified local
  package names, skill names, package maps, or nearby file paths.
- Set `<target_confidence>clear</target_confidence>` only when one path or
  concept is verified or maps unambiguously. You must be able to name the
  evidence source, such as an exact path match, package-map entry, skill name,
  or unique nearby path.
- Otherwise set `<target_confidence>ambiguous</target_confidence>` and list the
  plausible alternatives in the router.

Do not gather a full file list or read broad context during target resolution.

## Router Output

Render this as normal numbered prose, not literal XML. Every option that acts on
a clear seam must name the exact inferred seam path or concept. If target
confidence is ambiguous, include the plausible alternatives and avoid wording
that treats any one target as already selected.

```xml
<router_output>
  <question>Which seam-swarm mode should I use?</question>
  <inferred_seam>the exact path or concept the action options will use</inferred_seam>
  <target_alternatives>optional list when target confidence is ambiguous</target_alternatives>
  <options>
    <option number="1" recommended="true">Run a solo Standard Seam Swarm pass for <inferred_seam>.</option>
    <option number="2">Dispatch 3 read-only subagents for a Standard Seam Swarm pass on <inferred_seam>.</option>
    <option number="3">Run ICA Candidate Factory for architecture opportunities or entropy lanes.</option>
    <option number="4">Run Adversary Review on an existing report, plan, ADR, or candidate list.</option>
    <option number="5">Resume / Compress an existing swarm handoff.</option>
    <option number="6">Build a prompt pack only.</option>
    <option number="7">Narrow or change the seam scope.</option>
  </options>
  <next_step>Reply with an option number. If the target is ambiguous, include the target choice too.</next_step>
</router_output>
```

When only budget is ambiguous, you may show the smaller solo / dispatch /
prompt-pack / narrow-scope subset. When mode is ambiguous, include all five
mode choices so Candidate Factory, Adversary Review, and Resume / Compress do
not collapse into Standard Seam Swarm.

Do not print a context packet, file inventory, worker prompt, synthesis prompt,
or preflight summary in a router turn.

## Dispatch Authorization

Only dispatch subagents when one of these is true:

- The user explicitly asks to run a multi-agent swarm, spawn agents, dispatch
  agents, use architecture agents, or run review agents.
- The user chooses a router option that explicitly says it will dispatch
  read-only subagents.
- The user is resuming an already-dispatched swarm and asks to continue it.

Bare mentions of this skill, `seam swarm`, or `swarm` without an action verb are
routing ambiguity, not dispatch authorization.

If the user asks whether a folder is a tight seam but does not ask for agents,
use a solo read-only pass by default, or present the router when budget or scope
is a real choice.

## Prompt Pack Compactness

Prompt Pack Only is compact by default:

- Print the shared context packet once.
- For ready-to-dispatch prompt packs, include the complete file list once in
  the shared context packet. Also print the file-list command, count, and
  exclusions.
- Print scoped file groups per shard; do not repeat the complete file list per
  shard.
- Print per-shard deltas instead of fully expanded duplicate worker prompts.
- In worker prompt templates, reference the shared context packet and scoped
  file groups instead of embedding the complete inventory in each shard.
- Print full expanded worker prompts only when the user asks for full prompts;
  even then, include the complete file list once and point each shard back to
  that shared list.

## Mode Disambiguation

When "prompt pack" and "candidate" language appear together, choose by intent:

- Existing candidates or manual dispatch material: Prompt Pack Only.
- Discovering architecture opportunities or entropy lanes: ICA Candidate
  Factory.
- Unclear intent: ask the router before gathering files.
