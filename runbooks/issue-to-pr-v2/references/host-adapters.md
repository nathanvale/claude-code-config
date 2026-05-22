# Host adapters reference

**v1 source anchors:** `runbooks/issue-to-pr/issue-to-pr.md` L702-714
(pre-dispatch host-readiness check in Stage 4), L1039-1044 (pre-dispatch
repeat inside `## Inner loop` for `host-builder-tools-unavailable`), L1046-1054
(post-dispatch `builder-infrastructure-failure`); `runbooks/issue-to-pr/README.md`
L337-342 (glossary entries for Host Builder readiness failure and Builder
infrastructure failure — definitional cross-references that point back to the
canonical rules here).

**Read trigger:** open this reference before every Builder dispatch
(pre-dispatch readiness check) and after every Builder dispatch that fails to
return a well-formed envelope (post-dispatch infrastructure failure
classification). See also: [stage-4-batch-loop.md](stage-4-batch-loop.md),
[builder-dispatch.md](builder-dispatch.md),
[findings-and-validators.md](findings-and-validators.md).

## Host-readiness vs infrastructure-failure boundary

The v2 hot router treats these two failure modes as distinct routing outcomes.
The boundary is the canonical rule body; the v1 README glossary keeps a
two-line pointer to this reference.

### Pre-dispatch: host Builder readiness check (v1 L702-714, L1039-1044)

Before any batch status mutation, verify host Builder readiness for the
selected eligible batch. The host must be able to:

- create a fresh isolated Builder dispatch with the required Builder tool set
  and authority boundary;
- read/search target-repo files;
- edit only `batch.files`;
- run deterministic repo-local checks/probes;
- inspect git status and diffs;
- create exactly one commit for a successful attempt;
- return the structured envelope;
- deliver the Work Packet;
- expose git status and commit refs;
- capture the Builder envelope;
- classify timeout/failure.

If any capability is unavailable:

- record frontmatter `status: blocked` and
  `blocked_reason: host-builder-tools-unavailable`;
- append Notes evidence;
- leave every batch status unchanged;
- do not append `builder_attempts`;
- do not increment `iterations`;
- do not dispatch Validators;
- do not fall back to Orchestrator-direct implementation.

The same check repeats before every Builder dispatch inside the inner loop,
including resumed implementation and repair dispatches. When readiness is
unavailable on a resumed inner-loop dispatch, the Orchestrator records the
same `host-builder-tools-unavailable` evidence above and additionally asks
the user to retry or abandon (v1 L1042-1044).

### Post-dispatch: builder-infrastructure-failure (v1 L1046-1054)

If Builder dispatch begins but timeout, permission, tool, serialization,
schema, or malformed-envelope failure prevents a well-formed Builder envelope:

- record frontmatter `status: blocked` and
  `blocked_reason: builder-infrastructure-failure`;
- append host/schema evidence to Notes;
- leave the batch `in-progress` (status unchanged);
- do not append `builder_attempts`;
- do not increment `iterations`;
- do not dispatch Validators.

Surface any reachable Builder commit refs plus dirty/staged path summaries
from `git status`. Do not clean up, import, discard, or auto-revert side
effects before the user chooses retry, import, or abandon.

## Two blocked_reason values, two distinct paths

| `blocked_reason` | When | Builder attempts row | iterations | Validators |
| --- | --- | --- | --- | --- |
| `host-builder-tools-unavailable` | Pre-dispatch: host cannot create the Builder sub-agent or grant required capabilities | Not appended | Not incremented | Not dispatched |
| `builder-infrastructure-failure` | Post-dispatch: host began dispatch but timeout/permission/tool/serialization/schema/envelope failure prevented a well-formed Builder envelope | Not appended | Not incremented | Not dispatched |

Both values are accepted by helper validation of frontmatter; both keep the
batch out of the `builder_attempts` audit trail until the next well-formed
Builder envelope arrives. The v2 Builder dispatch contract enumerates the two
strings (see [builder-dispatch.md](builder-dispatch.md)).

## Glossary cross-reference (v1 README L337-342)

The v1 README glossary keeps a two-line entry for each blocked_reason value
that points back to the rule body above. The v2
[findings-and-validators.md](findings-and-validators.md) glossary keeps the
same pointer.

## See also

- [stage-4-batch-loop.md](stage-4-batch-loop.md) for the Stage 4 batch-loop
  step that performs the pre-dispatch readiness check.
- [builder-dispatch.md](builder-dispatch.md) for the Builder authority
  boundary; the two blocked_reason values appear in the Builder dispatch
  contract.
- [findings-and-validators.md](findings-and-validators.md) for the glossary
  pointer this rule body anchors.
