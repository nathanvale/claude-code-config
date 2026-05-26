# Claude Code Config

This context defines the durable language for the agent configuration, prompt, skill, and runbook system in this repository.

## Language

**Helper command contract**:
The workflow promise for how an operator starts the Issue-to-PR helper. It covers runner shape and documented invocation, not helper semantics, command modes, or ledger validation behaviour. When contrasting runner families, say package-runner shape, not package-runner path.
_Avoid_: helper invocation contract, command contract, runner path, package-runner path

**CLI evidence recipe**:
A workflow-guide pattern that pairs a confusing operator state with the observable CLI facts that identify it and the recovery meaning of those facts. Use this for Issue-to-PR gotchas where the operator needs evidence from the CLI, not memory or inference.
_Avoid_: evidence proof, proof recipe, CLI proof

**Git Evidence**:
Runtime-owned Issue-to-PR commit fact source. It emits normalized git facts; ledger validation and Stage 5 decide workflow policy.
_Avoid_: git proof, commit proof, git utility, ledger evidence row, CLI evidence recipe

**Runtime contract drift check**:
A focused Issue-to-PR validation that keeps prose claims about CLI-owned facts aligned with the runtime contract the helper emits. It covers mechanically checkable facts and the control-plane links needed for operator recovery, not broad documentation quality.
_Avoid_: public docs drift check, general docs audit, markdown link crawler, gotchas-only safeguard

**Section-coordinate scaffold pointer**:
A visible scaffold command that satisfies drift only when it appears at its inventoried section or anchor, not merely somewhere in the same document.
_Avoid_: doc-level scaffold pointer, hidden scaffold-pointer comment, loose scaffold mention

**Runtime scaffold lookup**:
Agent-use boundary where an agent resolves a visible scaffold command through the CLI at the moment it needs the deterministic shape.
_Avoid_: embedded packet YAML, hand-maintained scaffold example, stale rendered scaffold body

**Implementation slice**:
A thin, independently verifiable unit of issue work produced during planning before Stage 3 confirmation; represented at runtime as a candidate batch.
_Avoid_: task, phase, horizontal slice, generic plan step

**Ledger schema contract**:
Runtime-owned Issue-to-PR ledger field sets and allowed values emitted through CLI contract slices and enforced by helper validators. It defines allowed and required members, not authoring intent, operator judgment, or section purpose.
_Avoid_: ledger schema prose, docs-owned schema, ledger-and-helper schema

**Ledger authoring guidance**:
Prose-owned Issue-to-PR guidance for why ledger sections exist, who writes them, when confirmation is required, and how operators use helper facts. It may point at ledger schema contracts, but must not restate their members.
_Avoid_: ledger schema contract, runtime field list, schema owner

**Ledger template scaffold**:
Legacy committed template that showed the per-issue ledger starting shape before runtime rendering owned initial ledger creation.
_Avoid_: initial ledger render, generated schema doc, prose schema, contract owner

**Initial ledger render**:
Runtime-emitted complete starting ledger document created after acceptance criteria confirmation; read-only output, not a committed template or filesystem mutation.
_Avoid_: ledger template scaffold, generated schema doc, mutable ledger init

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

Dev: "Is Git Evidence the same thing as a ledger evidence row?"
Domain expert: "No. Git Evidence is the runtime commit fact source. Ledger rows and Stage 5 decide what those facts mean for workflow policy."

Dev: "Can any visible scaffold command in a document satisfy the pointer?"
Domain expert: "No. A section-coordinate scaffold pointer must appear inside the inventoried heading section; moving it to another section is drift."

Dev: "Should rendered packets embed scaffold YAML so agents have a fillable form?"
Domain expert: "No. Rendered packets stay pointer-only; agents use runtime scaffold lookup to fetch deterministic shapes before returning output."

Dev: "Where does the agent learn to resolve scaffold pointers?"
Domain expert: "Each rendered packet carries one shared lookup preamble so the rule appears at the moment of use without role-specific prose drift."

Dev: "Should scaffold pointers use top-of-file aliases like `$RETURN_ENVELOPE`?"
Domain expert: "No. Put the direct scaffold command in the owning section; avoid alias mini-languages unless repetition proves unavoidable."

Dev: "Is `/ce-plan` producing implementation tasks or candidate batches?"
Domain expert: "It produces implementation slices for human planning, represented as candidate batches once the runtime parses and validates them."

Dev: "Should the `/ce-plan` addendum become TypeScript strings once runtime owns scaffold YAML?"
Domain expert: "No. Keep it as the editable implementation-slice reference workflow seed; agents resolve its section-coordinate scaffold pointer through runtime scaffold lookup."

Dev: "Does `ledger-and-helper.md` own the ledger schema?"
Domain expert: "No. Runtime code owns the ledger schema contract. `ledger-and-helper.md` owns ledger authoring guidance and points to emitted contract slices."

Dev: "Can the ledger template still show concrete batch fields?"
Domain expert: "Only during migration. The initial ledger render owns the concrete starting document; runtime contract slices remain the source of truth for schema members."

Dev: "Should `issue-N-ledger.template.md` remain as a pointer-only compatibility file?"
Domain expert: "No. Once `ledger-init` renders and tests the initial ledger, retire the template and point Stage 1/docs at the CLI surface."

Dev: "After retiring the ledger template, where do policy checks prove initial ledger content?"
Domain expert: "They render `ledger-init` output and inspect the artifact agents actually use, not a compatibility template."

Dev: "Is initial ledger render a packet role?"
Domain expert: "No. It is a top-level read-only `ledger-init` CLI surface because it renders a starting ledger document, not an agent dispatch packet."

Dev: "Should `ledger-init` return only Markdown?"
Domain expert: "No. Return `ledger_markdown` plus small metadata for deterministic anchors, not a full parallel ledger schema."

Dev: "Should `ledger-init` return a destination path hint?"
Domain expert: "No. Stage 1 owns the ledger path convention; `ledger-init` renders content only."

Dev: "Can initial ledger render emit placeholder acceptance criteria?"
Domain expert: "No. It receives confirmed acceptance criteria as repeatable `--ac` flags and renders the matching checkbox list plus digest anchor."

Dev: "Does initial ledger render choose `started_at` from command time?"
Domain expert: "No. The caller supplies `--started-at`; same input flags must produce the same ledger body."

Dev: "Can initial ledger render set future-stage frontmatter fields?"
Domain expert: "No. It accepts only Stage 1 facts and defaults the ledger to the post-AC-confirmation state ready for planning."

Dev: "Does Stage 1 prose own the `ac_source` value list?"
Domain expert: "No. Once initial ledger render writes `ac_source`, runtime owns the finite source enum and Stage 1 prose explains only how values are chosen."

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
