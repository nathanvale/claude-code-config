---
status: accepted
date: 2026-06-02
supersedes: 0007
---

# create-cli Uses Bounded Local Extension

ADR 0007 kept `create-cli` as a verbatim upstream core with a tiny side-quest
whitelist: one facade reference, one pointer line, and local scripts. That was
right when the local need was only "implement this spec with the contract
runtime."

The skill is now becoming a power-featured canonical capability: upstream
CLI-design methodology plus local design intelligence for agent-native CLIs,
with `@side-quest/cli-command-facade` as the contract runtime that validates
required shape, catches drift, and returns machine-readable diagnostics.

The old principle still holds. The old whitelist is too constricting.

## Decision

`create-cli` keeps its upstream core verbatim, but may grow a bounded local
extension.

The extension may include:

- Local reference docs that adapt the upstream CLI baseline to Nathan's
  workflows.
- Contract-runtime guidance for implementing the designed CLI.
- Agent-native CLI design layer for skill drivers: humans, plans, and agents.
- Local scripts that validate or exercise the contract runtime.
- Provenance notes explaining which files are upstream core and which are local
  extension.

The extension must not:

- Rewrite the upstream skill body to change its core methodology.
- Duplicate deterministic contract members owned by the contract runtime.
- Create a parallel agent-only CLI skill for the same workflow.
- Hide local behavior inside files described as verbatim upstream.

`SKILL.md` may keep one local pointer under "Do This First" that routes skill
drivers through the extension references. That pointer can name multiple local
references when their order matters.

## Consequences

- ADR 0007's strict whitelist is superseded by a bounded extension model.
- Upstream provenance and byte-diffability remain meaningful for the upstream
  core: `SKILL.md` body and `references/cli-guidelines.md`.
- Local extension references become first-class owned material, not contraband
  exceptions to the old whitelist.
- `agent-native-cli-design.md` is the Agent-native CLI design layer and should
  teach judgment for optional design choices and recovery affordances.
- `cli-command-facade.md` should stay focused on how the contract runtime
  implements and validates the designed contract.
- `PROVENANCE.md` must distinguish upstream core from local extension.

## Alternatives considered

- **Keep ADR 0007 strict.** Rejected: every useful local reference expansion
  would feel like a whitelist violation, even when it preserves the upstream
  core.
- **Fork `create-cli`.** Rejected: still unnecessary. The upstream core remains
  useful as the human-first CLI design baseline.
- **Create a separate agent-native CLI skill.** Rejected: same workflow, same
  skill drivers, same contract runtime. A separate skill would create parallel
  policy.
