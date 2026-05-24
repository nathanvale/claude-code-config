# Claude Code Config

This context defines the durable language for the agent configuration, prompt, skill, and runbook system in this repository.

## Language

**Helper command contract**:
The workflow promise for how an operator starts the Issue-to-PR helper. It covers runner shape and documented invocation, not helper semantics, command modes, or ledger validation behaviour. When contrasting runner families, say package-runner shape, not package-runner path.
_Avoid_: helper invocation contract, command contract, runner path, package-runner path

**CLI evidence recipe**:
A workflow-guide pattern that pairs a confusing operator state with the observable CLI facts that identify it and the recovery meaning of those facts. Use this for Issue-to-PR gotchas where the operator needs evidence from the CLI, not memory or inference.
_Avoid_: evidence proof, proof recipe, CLI proof

**Runtime contract drift check**:
A focused Issue-to-PR validation that keeps prose claims about CLI-owned facts aligned with the runtime contract the helper emits. It covers mechanically checkable facts and the control-plane links needed for operator recovery, not broad documentation quality.
_Avoid_: public docs drift check, general docs audit, markdown link crawler, gotchas-only safeguard

**Capability**:
A registry-managed skill or agent, together with the files owned by that skill or agent. In v1, runbooks, prompt fragments, rules, commands, MCP tools, and whole plugins are not capabilities.
_Avoid_: imported thing, tool, plugin, runbook capability

**Source**:
The provenance record for where a capability came from. A source is metadata for review and update decisions, not the unit installed into a harness.
_Avoid_: install unit, upstream capability, source capability

**Snapshot**:
The preserved upstream copy of a selected capability at a pinned source version. A snapshot is dependency input for review, not Nathan's adapted working copy.
_Avoid_: fork, canonical copy, installed copy

**Canonical capability**:
Nathan's adapted copy of a capability and the source used for installation. Canonical capabilities preserve upstream operating behaviour by default, with harness differences kept outside the canonical copy.
_Avoid_: snapshot, fork, installed output, local patch

**Overlay**:
The smallest harness-specific difference needed when installing a canonical capability. Use overlays for real harness edges such as metadata, paths, invocation wording, or blocking-question mechanics.
_Avoid_: fork, duplicate capability, harness copy

**Capability dependency**:
A manually declared skill or agent that a capability needs in order to work. Dependency inference may warn about likely omissions, but manual declarations remain the source of truth.
_Avoid_: auto dependency, inferred dependency, implicit dependency

**Capability risk flag**:
A composable review signal attached to a capability, such as whether it handles secrets, writes files, uses the network, or causes side effects. Risk flags shape review posture; they are not a lifecycle status.
_Avoid_: risk tier, risk level, lifecycle status

**Install target**:
A harness surface that may receive an installed capability. Install targets inherit registry defaults unless a capability explicitly opts in or out.
_Avoid_: source, snapshot destination, install unit

**Alias wrapper**:
A thin redirect from an alternate capability name to the canonical capability name. Alias wrappers route discovery and invocation; they do not duplicate full capability content.
_Avoid_: duplicate copy, second canonical capability, forked alias

**one-password**:
The canonical adapted skill for safe 1Password CLI (`op`) workflows. It owns the generic `op` safety contract, while exact vault, item, field, and service-account details belong in service-specific owning skills.
_Avoid_: 1password, onepassword, secrets

**Reference-only env file**:
An env-shaped file whose values are 1Password secret references such as `op://...`, not plaintext secret values. It is a safe mapping artifact that may be reviewed or regenerated when every secret-bearing value remains a reference.
_Avoid_: pointer env file, map file, `.env` with secrets

**Secret reference mapping**:
A capability-owned declaration that maps a tool-facing environment variable or config key to a 1Password secret reference. The capability that consumes the secret owns the mapping; `one-password` owns only the safety contract.
_Avoid_: central secret manifest, global env bucket, one-password mapping

**Scoped service-account access**:
The preferred non-interactive 1Password access path for agents. A service account token may act as the bootstrap secret only when its vault and item permissions are scoped to the capability's declared secret reference mappings.
_Avoid_: broad service account, ambient 1Password access, desktop-first auth

**Persistent shell session**:
A stable shell context reused for an interactive 1Password task so sign-in, verification, and follow-up commands share session state. Tmux is the usual CLI implementation; Codex desktop may use a persistent Codex PTY or start a dedicated tmux session.
_Avoid_: tmux-only rule, fresh shell per `op` command, scattered sign-in

**Direct service-account read**:
A narrow, non-interactive 1Password read that uses scoped service-account access without relying on desktop sign-in state. It may run outside a persistent shell session when the capability supplies the exact vault, item, field, and expected shape.
_Avoid_: ambient read, probing read, service-account enumeration

**Targeted metadata check**:
A 1Password metadata command against an exact account, vault, item, or field already declared by an owning capability. It may prove existence or shape, but must not discover candidates by listing broad accounts, vaults, or items.
_Avoid_: broad enumeration, vault discovery, item discovery

**Materialized secret adapter**:
A generated compatibility surface that contains plaintext secret values only because a target tool cannot consume `op run` or 1Password references directly. It is never the source of truth and should be scoped to the tool that needs it.
_Avoid_: secret source, canonical env file, synced secrets file

## Example Dialogue

Dev: "Does changing the helper command contract mean the helper validates different ledger fields?"
Domain expert: "No. The helper command contract is only about how the helper is started. Ledger validation behaviour belongs to the helper semantics."

Dev: "Should a runtime contract drift check scan every Issue-to-PR markdown link?"
Domain expert: "No. A runtime contract drift check compares prose claims with CLI-owned facts and only checks recovery links that affect the control plane."

Dev: "Should `one-password` include the exact npm token item name?"
Domain expert: "No. `one-password` defines the safe `op` workflow. The npm-owning skill supplies the exact item and field names."

Dev: "Can an agent regenerate the env file?"
Domain expert: "It can regenerate a reference-only env file. If a tool needs plaintext values, that output is a materialized secret adapter and must stay generated, scoped, and non-canonical."

Dev: "Where should the `OPENAI_API_KEY=op://...` mapping live?"
Domain expert: "With the capability that needs OpenAI. `one-password` defines safe access, not the global list of every secret."

Dev: "Should an agent unlock the desktop app first?"
Domain expert: "No. Prefer scoped service-account access for declared mappings. Desktop app integration is the fallback when scoped access is unavailable or insufficient."

Dev: "Does `one-password` literally require tmux in Codex desktop?"
Domain expert: "No. It requires a persistent shell session for interactive 1Password work. Tmux is the common CLI implementation, but a persistent Codex PTY can satisfy the same session-state boundary."

Dev: "Can a service-account read run outside tmux?"
Domain expert: "Yes, when it is a direct service-account read for a declared vault, item, field, and shape. Interactive fallback still needs a persistent shell session."

Dev: "Can an agent list vaults to find the right one?"
Domain expert: "No. It can run targeted metadata checks for declared names, but broad vault or item discovery is outside the `one-password` safety contract."

Dev: "Should we import an entire plugin as one capability?"
Domain expert: "No. Track the selected skill or agent as the capability. The plugin or repository is a source."

Dev: "Can we edit the upstream snapshot to make it more Nathan-shaped?"
Domain expert: "No. Adapt the canonical capability. The snapshot preserves the upstream copy for review."

Dev: "Should Claude Code and Codex each get separate canonical copies?"
Domain expert: "No. Keep one canonical capability and use overlays only for real harness differences."

Dev: "Does `retired` mean we can still install it by asking explicitly?"
Domain expert: "No. Retired capabilities are preserved for provenance, not installed."
