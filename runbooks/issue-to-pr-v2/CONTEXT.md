# Issue to PR

Scoped vocabulary for the Issue-to-PR runbook: the helper contract, ledger lifecycle, workflow-learning scan, and scaffold pointers. Live runbook vocabulary relocated from the root context. Glossary only.

## Language

### Helper and evidence
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

### Workflow learning scan
**Workflow Learning Scan**:
A read-only Issue-to-PR reflection pass that captures workflow-level learnings from ship-time or fail-stop evidence. It records learning metadata through ledger and registry surfaces; it does not repair skills, runbooks, CLI code, docs, or deliverables.
_Avoid_: self-repair pass, learning audit, workflow repair scan, meta-work pass

**Final metadata checkpoint**:
The Stage 6 Issue-to-PR checkpoint that records shipped run metadata after a PR URL exists. It may contain the per-issue ledger and Workflow Learnings registry metadata only; it is not a deliverable commit or control-plane repair.
_Avoid_: final ledger commit, ship-tail cleanup commit, metadata dump

**Registry candidate**:
A proposed Workflow Learnings registry input prepared for validation or upsert by the registry helper. It is not a stored registry entry, ledger evidence row, or Issue-to-PR finding.
_Avoid_: learning record, learning finding, registry row, finding

**Workflow Learning attention item**:
A scan-selected Workflow Learning that deserves explicit final-summary visibility because it affects this delivery's closure or follow-up understanding. Attention-item selection is judgment over runtime facts, disposition, confidence, and delivery context; it is not a raw registry helper output.
_Avoid_: interesting learning, registry result, all follow-ups, warning

**Resume-blocking Workflow Learning**:
A Workflow Learning whose unresolved workflow defect prevents safe Issue-to-PR continuation or honest closure of the current delivery. It is narrower than `file-follow-up`; general cleanup, future DX work, and non-blocking workflow debt are not resume-blocking. Every Resume-blocking Workflow Learning is a Workflow Learning attention item.
_Avoid_: blocking follow-up, required follow-up, must-fix learning, resume-needed follow-up

**Workflow Learning metadata safety failure**:
A Workflow Learning Scan failure where the metadata lane cannot safely validate or write ledger/registry evidence because the helper command is missing, the helper contract is ambiguous, or the registry write target is unsafe. It is not the same as weak evidence, no learning found, or a non-blocking upsert inconvenience.
_Avoid_: scan capture failure, registry safety failure, metadata failure, final metadata checkpoint contamination

### Scaffold pointers
**Section-coordinate scaffold pointer**:
A visible scaffold command that satisfies drift only when it appears at its inventoried section or anchor, not merely somewhere in the same document.
_Avoid_: doc-level scaffold pointer, hidden scaffold-pointer comment, loose scaffold mention

**Runtime scaffold lookup**:
Agent-use boundary where an agent resolves a visible scaffold command through the CLI at the moment it needs the deterministic shape.
_Avoid_: embedded packet YAML, hand-maintained scaffold example, stale rendered scaffold body

### Ledger
**Ledger schema contract**:
Runtime-owned Issue-to-PR ledger field sets and allowed values emitted through CLI contract slices and enforced by helper validators. It defines allowed and required members, not authoring intent, operator judgment, or section purpose.
_Avoid_: ledger schema prose, docs-owned schema, ledger-and-helper schema

**Ledger authoring guidance**:
Prose-owned Issue-to-PR guidance for why ledger sections exist, who writes them, when confirmation is required, and how operators use helper facts. It may point at ledger schema contracts, but must not restate their members.
_Avoid_: ledger schema contract, runtime field list, schema owner

**Initial ledger render**:
Runtime-emitted complete starting ledger document created after acceptance criteria confirmation; read-only output, not a committed template or filesystem mutation.
_Avoid_: ledger template scaffold, generated schema doc, mutable ledger init

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

Dev: "Can the final metadata checkpoint include a tiny docs fix discovered during shipping?"
Domain expert: "No. The final metadata checkpoint may contain only shipped run metadata. Docs fixes are control-plane repairs and need their own workflow path."

Dev: "Should final metadata checkpoint contamination go back through final review?"
Domain expert: "No. It is a Stage 6 hygiene failure, not a product diff finding. Clean the ship-tail state and rerun Stage 6."

Dev: "Can the final learning summary count registry entries by reading the markdown?"
Domain expert: "No. It uses Workflow Learning upsert outcomes emitted by the registry helper: created, updated, or unchanged."

Dev: "Is every file-follow-up a Workflow Learning attention item?"
Domain expert: "No. The scan selects attention items by judging the runtime facts, confidence, disposition, and whether the item affects this delivery's closure or follow-up understanding."

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

