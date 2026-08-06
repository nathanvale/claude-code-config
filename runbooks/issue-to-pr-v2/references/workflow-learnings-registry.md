# Workflow Learnings registry

This file is the canonical, cross-run home for **Issue-to-PR Workflow
Learnings**: durable observations about the workflow itself (its skills,
references, CLI/observability surface, contracts, and gotchas) that survive
across individual issue runs. It exists per PRD #88 and is scaffolded by issue
#90.

The registry is deliberately distinct from each per-issue ledger. The ledger's
required `## Workflow Learnings` section holds **what this run observed** —
per-run evidence references with
a `signature` cross-reference that points at the canonical registry row. The
registry holds the **cross-run lifecycle and dedupe layer**: each learning is
recorded once, deduped by stable `signature`, carries a disposition and status
through its life, and accumulates one append-only evidence record per run that
re-observed it. A learning first noticed during `issue-90` and seen again
during a later run is the *same* registry entry with two evidence records,
not two entries.

The ledger **never** duplicates the registry's canonical fields (`summary`,
`owner`, `retirement_condition`) or lifecycle fields (`disposition`, `status`,
`confidence`, `follow_up`). Those live exclusively here. A ledger
`## Workflow Learnings` entry carries only the `signature` cross-reference
plus run-scoped evidence keys (`affected_surface`, `what_was_wrong`,
`discovery_method`, `root_cause`, `scope`, `proposed_fix`,
`verification_idea`) — the same keys the registry's `evidence` records use,
minus the implicit `run` (the ledger IS the run). The ledger-side validator
(`decompose.ts --validate-workflow-learnings`) rejects any canonical or
lifecycle field that leaks into a ledger entry.

**Read trigger:** open this reference when a run surfaces a workflow-level
learning (something wrong with or worth improving about the Issue-to-PR workflow
itself, not the target deliverable), when checking whether an observed learning
already exists before filing a new one, or when updating a learning's lifecycle
fields (disposition, status, confidence, follow-up) as it moves from observed to
filed to resolved or retired.

The registry is human-readable Markdown with a single fenced YAML block. Prose
explains the schema, and exactly one fenced `yaml` block holds the
authoritative data. The
registry helper extracts that single block with a stricter fenced-yaml scan
than the ledger helper: the closing fence must be line-anchored (the closing
backticks must start at column 0 on their own line), so an inline backtick
sequence inside a YAML scalar value will not prematurely close the captured
block. This file MUST contain exactly one fenced yaml block. All schema
examples in this document are kept inline (in prose or non-yaml fences) so
they are never mistaken for the data block.

## Entry schema

Each entry in the `learnings` list is a record with the fields below. Fields are
grouped by how they behave on upsert: canonical fields are overwrite-protected, a
single dedupe key identifies the entry, lifecycle fields update freely, and the
evidence list is append-only.

### Canonical fields (overwrite-protected)

These describe what the learning *is*. On upsert they are NOT overwritten unless
the incoming candidate explicitly sets `canonical_update: true` (see
[Canonical-overwrite rule](#canonical-overwrite-rule)).

- `summary` (string) — a one-line statement of the learning.
- `owner` (string) — the workflow surface that owns the fix. Exactly one of:
  `skill-link`, `runbook-reference`, `cli-observability`, `workflow-contract`,
  `gotchas-guide`.
- `retirement_condition` (string) — the condition under which this learning is
  considered retired (for example, "retired once the CLI emits the missing
  field" or "retired when the reference documents the gate").

### Dedupe key

- `signature` (string) — the stable dedupe key for the entry. Format is either
  `sha256:<hex>` or a stable slug. Two observations sharing a signature are the
  same learning; upsert merges them rather than creating a second entry.

### Lifecycle fields (updatable on upsert)

These track where the learning sits in its life and may change on every upsert.

- `disposition` (string) — what we decided to do about it. One of: `small-fix`,
  `file-follow-up`, `ignore`, `already-covered`, `needs-evidence`.
- `status` (string) — current state. One of: `open`, `filed`, `resolved`,
  `retired`.
- `confidence` (string) — how sure we are the learning is real and actionable.
  One of: `low`, `medium`, `high`.
- `follow_up` (string or null) — the tracker link or issue reference once the
  learning has been filed; `null` until then.

### Append-only evidence

- `evidence` (list) — one record per run that observed the learning, appended
  in run order and never rewritten. Each evidence record captures the run-scoped
  facts that justify the learning. The fields of each record are:
  `run` (the run identifier, for example `issue-90`), `affected_surface`,
  `what_was_wrong`, `discovery_method`, `root_cause`, `scope`, `proposed_fix`,
  and `verification_idea`.

### Example entry shape (illustrative, not data)

The block below is an illustrative `text` fence, not a `yaml` data block. It
shows the full shape of one populated entry; the authoritative, currently-empty
data lives in the single `yaml` block under [Registry data](#registry-data).

```text
learnings:
  - summary: "<one-line learning statement>"
    owner: runbook-reference          # skill-link | runbook-reference | cli-observability | workflow-contract | gotchas-guide
    retirement_condition: "<when this learning retires>"
    signature: "sha256:<hex>"         # or a stable slug
    disposition: needs-evidence       # small-fix | file-follow-up | ignore | already-covered | needs-evidence
    status: open                      # open | filed | resolved | retired
    confidence: medium                # low | medium | high
    follow_up: null                   # tracker link/issue ref once filed
    evidence:
      - run: issue-90
        affected_surface: "<surface>"
        what_was_wrong: "<observation>"
        discovery_method: "<how it was found>"
        root_cause: "<why>"
        scope: "<blast radius>"
        proposed_fix: "<suggested change>"
        verification_idea: "<how to confirm the fix>"
```

## Canonical-overwrite rule

Canonical fields (`summary`, `owner`, `retirement_condition`) are
overwrite-protected. When an upsert matches an existing entry by `signature`:

- Lifecycle fields (`disposition`, `status`, `confidence`, `follow_up`) update
  from the candidate.
- A new evidence record is appended to `evidence`.
- Canonical fields are left unchanged **unless** the candidate explicitly sets
  `canonical_update: true`, in which case the candidate's canonical fields
  overwrite the stored ones. `canonical_update` is a per-candidate upsert
  directive, not a stored field on the entry.

## Registry data

This is the single authoritative fenced `yaml` block for the registry. It is
seeded empty. The future registry helper reads this block and nothing else; do
not add a second fenced `yaml` block anywhere in this file.

```yaml
learnings: []
```
