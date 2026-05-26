# /ce-plan addendum template

**Role:** `/ce-plan` input addendum (Stage 2).

**Read trigger:** the Orchestrator appends this addendum verbatim after the
issue body and the ledger's `## Acceptance criteria` section when invoking
`/ce-plan` in Stage 2 with Issue-to-PR pipeline planning posture. The
hot router at `runbooks/issue-to-pr-v2/issue-to-pr.md` points Stage 2 at
this template via [`references/stage-2-plan.md`](../references/stage-2-plan.md);
the addendum body itself is rendered deterministically by the v2 packet
CLI rather than inlined into stage prose. See also:
[`references/stage-3-decompose.md`](../references/stage-3-decompose.md).

The addendum body below is the structured-output requirement `/ce-plan` must
satisfy so `decompose.ts` can parse the resulting plan into a candidate batch
DAG. The fenced YAML block inside the addendum is helper-validated; it must
appear as a fenced code block with a language hint, never wrapped in
XML-style tags.

## Addendum body (paste verbatim after the issue body and ledger AC list)

**Rendered by `lib/packets.ts` (U5).** Invoke
`bun runbooks/issue-to-pr-v2/cli.ts packet ce-plan --json` to return this
addendum body in the `data.packet_markdown` field of a U4 CLI envelope.
The packet **MUST NOT** include any issue-specific content, target_repo,
or Builder/Proposer/Validator packet slots — the addendum is reusable
across issues. U6 owns the ledger Notes write that records the dispatch
evidence; the CLI is read-only per ADR 0002.


````markdown
## Structured-output requirement (issue-to-pr workflow)

The ledger's `## Acceptance criteria` section contains N items (extracted
from the source issue and confirmed by the user at stage 1). Produce ONE
Implementation Unit per AC by default, in the same order. Each unit's
`goal` field should restate the AC. Each unit's `acceptance_tests` field
should encode "AC <i> holds: <verifiable behaviour>" - typically the AC
text plus a test scenario that would prove it.

Each unit MUST include `execution_mode`, choosing exactly one. This is a
candidate execution contract: stage 3 validates and asks the user to confirm
it before Builder may act on it.

- `tdd`: feature or bug-fix behaviour where the public interface is clear
  enough to write the next failing test before implementation.
- `proof_first`: migration, rename, scaffold, compatibility, or
  governance work where the right first move is a target-state proof or
  characterization check before the change.
- `change_first`: docs-only work where a red test or proof would be
  artificial. Still include acceptance checks. For any non-doc path, include
  `rationale: "out-of-scope: investigation-required"` for investigation
  placeholders, or a non-empty rationale beginning with
  `change_first-exception:` so stage 3 can ask the user to accept it
  explicitly. For high-risk paths, use a non-empty rationale beginning with
  `high-risk-change_first-exception:` instead.

You MAY split an AC into 2+ units OR merge multiple ACs into 1 unit, but
ONLY when:

- Splitting: the AC requires changes in unrelated files that would
  otherwise fail the one-finding-one-commit rule (e.g. "must fail closed
  on missing config" needs the closed-fail path AND the test in different
  files).
- Merging: two ACs live in the same single file with inseparable tests
  (e.g. AC1 "reads X" and AC2 "writes X" both inside one module).

For any split, merge, investigation placeholder, or `change_first` exception,
add a one-line rationale to the unit's body explaining why. Split/merge
rationales do not authorize `change_first` on non-doc paths; non-doc
`change_first` still needs one of the explicit prefixes above, and high-risk
paths need the high-risk prefix. Stage 3 will surface these for user confirm.

Emit each unit's machine-readable shape as a fenced YAML code block
immediately after that unit's prose, using this exact schema:

```yaml
id: <stable-slug>
name: <Title from the Implementation Unit heading>
goal: <one-sentence outcome, ideally the AC verbatim>
files:
  - <repo-relative path>
  - <repo-relative path>
depends_on: []  # or list of ids; emit [] explicitly when none
execution_mode: tdd  # tdd | proof_first | change_first
acceptance_tests:
  - "AC <i> holds: <verifiable behaviour>"
ac_mapping:
  - <i>   # AC index (1-based) this batch satisfies; list multiple if merged
rationale: null  # string only for split/merge, placeholders, or change_first exceptions
```

The `ac_mapping` field is consumed by `decompose.ts --validate-ac-coverage`.
Every AC index must appear in at least one batch's `ac_mapping`. If an AC
has no implementation path, emit a unit with `goal: "AC <i>: investigation
required"`, `execution_mode: change_first`, `ac_mapping: [<i>]`, and
`rationale: "out-of-scope: investigation-required"` and surface as a
stage-3 user gate.
````

## See also

- [`references/stage-2-plan.md`](../references/stage-2-plan.md) — Stage 2
  invocation that appends this addendum to the `/ce-plan` input.
- [`references/stage-3-decompose.md`](../references/stage-3-decompose.md) —
  parses and validates the resulting plan and AC coverage.
