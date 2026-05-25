# Host adapters reference

**v1 source anchors:** `runbooks/issue-to-pr/issue-to-pr.md` L702-714
(pre-dispatch host-readiness check in Stage 4), L1039-1044 (pre-dispatch
repeat inside `## Inner loop` for `host-builder-tools-unavailable`), L1046-1054
(post-dispatch `builder-infrastructure-failure`); `runbooks/issue-to-pr/README.md`
L337-342 (glossary entries for Host Builder readiness failure and Builder
infrastructure failure — definitional cross-references that point back to the
canonical rules here).

**Read trigger:** open this reference before every Stage 4 implementation
attempt (Builder dispatch or bounded Orchestrator-inline) and after every
Builder dispatch that fails to return a well-formed envelope (post-dispatch
infrastructure failure classification). See also:
[stage-4-batch-loop.md](stage-4-batch-loop.md),
[builder-dispatch.md](builder-dispatch.md),
[findings-and-validators.md](findings-and-validators.md).

## Host-readiness vs infrastructure-failure boundary

The v2 hot router treats these two failure modes as distinct routing outcomes.
The boundary is the canonical rule body; the v1 README glossary keeps a
two-line pointer to this reference.

### Pre-implementation: host Builder readiness check (v1 L702-714, L1039-1044)

Before any batch status mutation or resumed Stage 4 implementation attempt,
verify host Builder readiness for the selected or in-progress batch. The host
must be able to:

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
- do not fall back to Orchestrator-inline implementation as a workaround for
  missing Builder capability.

The same check repeats before every Stage 4 implementation attempt inside the
inner loop, including Builder dispatch, bounded Orchestrator-inline work, and
resumed repair dispatches. When readiness is unavailable on a resumed inner-loop
attempt, the Orchestrator records the same `host-builder-tools-unavailable`
evidence above and additionally asks the user to retry or abandon (v1
L1042-1044).

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
| `host-builder-tools-unavailable` | Pre-implementation: host cannot create the Builder sub-agent or grant required capabilities for the Stage 4 attempt and any later repair | Not appended | Not incremented | Not dispatched |
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

## Install-artifact presence (U6)

The v2 helper at `lib/route.ts` exports `installedArtifactPresence()`,
which walks the v2 install root and returns a structured map of artifact
roots to boolean presence:

```ts
{
  references: boolean;   // references/ exists and contains at least one file
  templates: boolean;    // templates/ exists and contains at least one file
  cli_ts: boolean;       // cli.ts exists at the v2 root
  lib_dir: boolean;      // lib/ exists and contains at least one file
  all_present: boolean;  // true iff every root above is present
  missing: ("references" | "templates" | "cli_ts" | "lib_dir")[];
}
```

The walk follows symlinks (the install topology is symlink-only per the
`install.sh` contract; the v2 install lives at
`~/.claude/runbooks/issue-to-pr-v2/` and dereferences through
`~/.claude/runbooks → ${REPO}/runbooks`). A visited-realpath set bounds
the walk against symlink loops, and a depth cap is the belt-and-braces
guard.

The structured map is intentionally bounded. It does NOT enumerate
individual files (avoids leaking unrelated repo contents), does NOT
expose symlink targets, inode numbers, or mtimes (those are
non-determinism vectors), and does NOT report paths outside the v2
install root. `cli.ts state` and `cli.ts diagnose` surface this map
verbatim; the hot router (U7) treats `all_present: false` as a
stop-required signal alongside the runbook-version skew gate.

A genuinely missing root (deleted from disk, never installed, empty
subdirectory) reports `false`. The orchestrator is expected to
re-run `install.sh` and re-invoke the CLI rather than dispatch into a
broken install.

## See also

- [stage-4-batch-loop.md](stage-4-batch-loop.md) for the Stage 4 batch-loop
  step that performs the pre-implementation readiness check.
- [builder-dispatch.md](builder-dispatch.md) for the Builder authority
  boundary; the two blocked_reason values appear in the Builder dispatch
  contract.
- [findings-and-validators.md](findings-and-validators.md) for the glossary
  pointer this rule body anchors.
- [ledger-and-helper.md](ledger-and-helper.md) for the runbook-version skew
  classifier that pairs with install-artifact presence in the U7 stop-required
  routing, and for the canonical helper execution context rule.
- [`../README.md`](../README.md#helper-execution-context) for the maintainer
  summary of helper execution context.
