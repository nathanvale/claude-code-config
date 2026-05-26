# Builder Work Packet template

**Role:** Builder (writes).

**Read trigger:** the Orchestrator fills this template in immediately before
dispatching a fresh Builder sub-agent for one batch attempt. Builder reads it
on entry, before executing the Local Law Read Order in
[`references/builder-dispatch.md`](../references/builder-dispatch.md). See
also: [`references/stage-4-batch-loop.md`](../references/stage-4-batch-loop.md),
[`references/host-adapters.md`](../references/host-adapters.md).

The role boundary, authority list, Local Law Read Order, Mechanic Discipline,
Public Contract Rule, Domain Language Rule, Preflight Checklist, Probe
Catalog, and return-envelope schema are owned by
[`references/builder-dispatch.md`](../references/builder-dispatch.md). This
template does not restate them; it fills in the batch-specific slots and links
to the canonical text.

Builder is dispatched as a fresh sub-agent per attempt. Builder writes
(exactly one commit on a successful attempt) and reads. Builder is not
read-only and is not the Proposer.

## Packet slots

**Rendered by `lib/packets.ts` (U5).** The Orchestrator does not hand-fill
this template. The shape below is the contract for `renderBuilderPacket()`
in `runbooks/issue-to-pr-v2/lib/packets.ts`; invoke
`runbooks/issue-to-pr-v2/cli.ts packet builder --ledger <path> --batch <id>
--attempt-type <implementation|repair> --json` to render the packet body
plus the dispatch evidence shape.

The packet body uses fenced YAML for helper-validated fields plus selective
XML framing tags (`<local_law_read_order>`, `<authority_boundary>`,
`<preflight_checklist>`, `<allowed_probes>`, `<output_contract>`) for prose
framing only, per the U2 approach. The XML tags **never** wrap
helper-validated YAML or JSON; they only frame the prose payload the Builder
sub-agent reads on entry.

The rendered packet body is runtime-owned by `renderBuilderPacket()`.
Use `cli.ts packet builder --json` for the concrete packet fields.
The renderer must include target batch contract, iteration, compact prior
Builder attempts, batch-local findings, Notes summary, and prose framing
slots. It must not include the full plan file, raw Validator envelopes,
unrelated batch state, rich Builder evidence from prior envelopes,
`orchestrator_inline_attempts` as prior Builder attempts, ACs outside the
target batch's `ac_mapping`, or findings from other batches or stage-3
findings.

`prior_builder_attempts` is Builder-only. Orchestrator-inline attempt rows are
not Builder envelopes and must not appear there; they may only be summarized in
`notes_summary_for_this_batch` when relevant to the current repair route.

### `<local_law_read_order>` framing

Fill the tag with the six-step Local Law Read Order from
[`references/builder-dispatch.md`](../references/builder-dispatch.md#authority-and-local-law).
The tag exists so Builder runs the read order before any edit; the canonical
rule body still lives in the reference.

```text
<local_law_read_order>
1. target repo root agent instructions, when present;
2. nearest package AGENTS.md, when present;
3. nearest package CONTEXT.md, when present;
4. package maps, ADRs, runbooks, or governance docs only when referenced by
   local law or triggered by package-boundary/public-contract work;
5. every file in batch_contract.files;
6. nearby tests and implementation needed to understand the existing seam.
</local_law_read_order>
```

### `<authority_boundary>` framing

Fill the tag with the Builder-only authority summary from
[`references/builder-dispatch.md`](../references/builder-dispatch.md#authority-and-local-law).
The tag exists so Builder can see the edit boundary without reading unrelated
ledger or plan state.

```text
<authority_boundary>
Builder may edit only files in batch_contract.files.
Builder may create a missing path only when that path is already listed in batch_contract.files.
Builder may make exactly one commit when preflight passes.
Builder must not change acceptance criteria, dependencies, execution mode, durable domain language, public contracts, governance docs, or files outside batch_contract.files unless the confirmed batch contract explicitly authorizes that change.
Builder must not append or edit prior builder_attempts rows, edit findings, record Orchestrator-inline evidence, or perform Validator work.
Repair attempts target exactly one open P0/P1 finding by signature; Builder fixes only that target signature.
</authority_boundary>
```

### `<preflight_checklist>` framing

Fill the tag with the nine-item checklist from
[`references/builder-dispatch.md`](../references/builder-dispatch.md#builder-preflight-checklist).
Builder verifies every item before any edit; missing readiness routes to a
`fail-stop-preflight` envelope.

```text
<preflight_checklist>
- task and attempt type are understood;
- acceptance criteria are present;
- package ownership is clear enough for this batch;
- an existing seam is found, or a missing listed path can be created without
  stale-path, typo, wrong-package, or semantic-authorization risk;
- test/proof strategy is clear enough for the confirmed execution_mode;
- public API impact is none or explicitly authorized;
- domain language is existing or safely provisional;
- required fixtures, types, and environment are available or not needed;
- targeted checks can be run, or the inability to run them is explainable.
</preflight_checklist>
```

### `<allowed_probes>` framing

Fill the tag with the Probe Catalog from
[`references/builder-dispatch.md`](../references/builder-dispatch.md#probe-catalog).
Builder may run only these five probe shapes plus equivalent literal probes
named by the batch goal, rationale, or acceptance tests. Probe matches outside
`batch_contract.files` route to `fail-stop-preflight` rather than expanding
scope.

```text
<allowed_probes>
- rename path probe: old path literal to new path literal;
- identity flip probe: old package/plugin identity literal to new identity
  literal;
- command/path reference probe: command or path literal named in the batch;
- public API probe: exported symbol or manifest surface named in the batch;
- package governance probe: package map, AGENTS.md, CONTEXT.md, and
  package-knowledge references for package-boundary work.
</allowed_probes>
```

### `<output_contract>` framing

Fill the tag with a pointer to the return envelope schema below; the
canonical schema and required `suggested_validator_focus` field rule live in
[`references/builder-dispatch.md`](../references/builder-dispatch.md#return-envelope).
The tag's job is to remind the Builder sub-agent that only the envelope below
constitutes valid output.

## Required reading on entry

Open these references before any edit. Read order:

1. [`references/builder-dispatch.md`](../references/builder-dispatch.md) —
   role boundary, authority and Local Law (six-step Read Order), Mechanic
   Discipline, Public Contract Rule, Domain Language Rule, Preflight Checklist,
   Probe Catalog, return envelope schema, replacement-batch mechanics, Builder
   execution rules (every iteration).
2. [`references/host-adapters.md`](../references/host-adapters.md) —
   `host-readiness-vs-infra-failure` boundary (the pre-implementation host
   readiness gate already passed before this packet arrived).
3. [`references/stage-4-batch-loop.md`](../references/stage-4-batch-loop.md) —
   inner-loop iteration cap (5), escape hatches, and lifecycle checkpoints
   the Orchestrator owns around this dispatch.

## Authority boundary

The authority boundary is rendered into the `<authority_boundary>` framing tag
above (filled from `BUILDER_AUTHORITY_BOUNDARY_TEXT` in
[`../lib/packets.ts`](../lib/packets.ts)). The canonical rule body it mirrors
lives in
[`references/builder-dispatch.md`](../references/builder-dispatch.md#authority-and-local-law).
This template does not restate the MUST-NOT list a third time; read the framing
tag above or the canonical reference.

## Preflight on entry

Run the nine-item Preflight Checklist in
[`references/builder-dispatch.md`](../references/builder-dispatch.md#builder-preflight-checklist)
before any edit. No readiness, no build. If preflight fails, return a
`fail-stop-preflight` envelope (see Return envelope below).

## Return envelope

Builder returns exactly one structured envelope at the end of the attempt.
See
[`references/builder-dispatch.md`](../references/builder-dispatch.md#return-envelope)
for transition semantics and the rule that `suggested_validator_focus` is
required. Concrete shape is generated from
`cli.ts scaffold builder-return-envelope --json`.

(The sibling [`builder-return-envelope.md`](builder-return-envelope.md) points
at the same runtime-owned scaffold for readers who arrive at the return
contract directly.)

## See also

- [proposer-envelope.md](proposer-envelope.md) — separate template for the
  read-only Proposer role. Builder is **not** the Proposer; Proposer **never**
  edits Builder attempts.
- [validator-envelope.md](validator-envelope.md) — read-only Validator
  envelope shape that consumes Builder commits.
- [patch-proposal.md](patch-proposal.md) — Proposer scratch-file shape used by
  the Stage 5 final-review patch-batch flow.
- [`references/builder-dispatch.md`](../references/builder-dispatch.md) —
  authoritative source for every rule and verb referenced above.
