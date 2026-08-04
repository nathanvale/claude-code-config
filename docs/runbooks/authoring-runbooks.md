# Author Browser Runbooks

Use the setup-owned source-checkout `browser-use` front door. Never edit the
Private Runbook Catalog or Reviewed Action source directly.

Production promotion is unavailable. A separate reviewed plan owns signed-product
installation, admission, presence-backed acceptance, and repair. This runbook
makes no production Touch ID or Developer ID acceptance claim.

## Discover the contracts

- Run `browser-use action --help`, `browser-use runbook --help`, and
  `browser-use auth --help`.
- Run each selected leaf command with `--help` before mutation.
- Generate candidate documents from `action schema --json` or
  `runbook schema --json`. Do not copy fields from this guide.
- Use the [Browser Use glossary](../../skills/browser-use/CONTEXT.md) for
  lifecycle terms.
- Treat the [CLI contract](../../skills/browser-use/src/command-contract.ts)
  and generated schemas as authoritative.

Command blocks below are templates. Replace angle-bracket values. Confirm the
resolved command with leaf help.

## Inspect source and active state

```bash
browser-use runbook list --json
browser-use runbook show --service <service-id> --flow <flow-id> --json
```

Use the returned source-catalog digest, active-generation digest and epoch, and
record digest as observed concurrency facts. Never reconstruct them.

Synchronization is reported at two levels: a catalog-level status and a
per-record status. Read the exact status vocabulary and its meaning from the
`runbook list --json` / `runbook show --json` output and its owner type below;
this doc does not restate the state machine.

Keep invalid or unreadable source entries visible. Resolve their typed
activation blockers; never treat omission as deletion.

Projection owner:
[generation synchronization](../../skills/browser-use/src/browser-use-runbook-generation.ts)
and [list/show delivery](../../skills/browser-use/src/browser-use.ts).

## Author Reviewed Actions

Author an action before any Runbook Draft references its digest.

```bash
browser-use action schema --json
browser-use action validate --file <candidate.json> --json
browser-use action apply --file <candidate.json> --json
browser-use action status --id <action-id> --json
```

- Supply one complete candidate to validate and apply.
- Review the derived digest, origin, effect, capabilities, schemas, and
  postcondition through the CLI result.
- Apply only unpromoted source. Agent invocation never grants promotion.
- For replacement, observe the current record digest with `action status`,
  review the complete changed candidate, then pass that observed digest to
  `action apply` as directed by its help.
- On a stale-digest refusal, inspect again. Never retry with the refusal's
  digest without reviewing current source.

Keep the exact reviewed commit and mechanically derived approval facts ready for
the future external human promotion process. Do not attempt production promotion:
the separately reviewed signed-product installation, admission, presence-backed
acceptance, and repair lifecycle does not exist yet. Never fabricate, edit, or
replay a receipt. Treat `promotion-claim-present` as a source claim; activation
independently verifies the exact digest and receipt.

Owners:
[candidate authoring](../../skills/browser-use/src/browser-use-reviewed-action-authoring.ts)
and [promotion verification](../../skills/browser-use/src/browser-use-reviewed-action-approval.ts).

## Author Runbook Drafts

```bash
browser-use runbook schema --json
browser-use runbook validate --file <draft.json> --json
browser-use runbook apply --file <draft.json> --json
```

- Supply one complete Runbook Draft. Never patch individual fields through
  prose or direct catalog edits.
- Reference only promoted Reviewed Action ids and their exact digests.
- Declare non-secret auth context and binding references. Keep login steps,
  inline JavaScript, secret values, and 1Password item details out.
- Validate the complete Reviewed Action closure before apply.
- For replacement, observe the current record digest with `runbook show`,
  review the complete changed draft, then pass that digest to `runbook apply`
  as directed by its help.
- On a stale-digest refusal, inspect again before rebuilding the replacement.
- Treat identical apply as a no-op.

Delete through the front door:

```bash
browser-use runbook delete --service <service-id> --flow <flow-id> \
  --expected-record-digest <observed-record-digest> --json
```

Observe the digest immediately before deletion. An absent record is a no-op.
Deletion changes source only; runtime retains the selected generation until
activation.

Owner: [whole-document authoring](../../skills/browser-use/src/browser-use-runbook-authoring.ts).

## Activate the complete catalog

Review and commit the complete Runbook catalog plus referenced promoted-action
closure. Keep those bytes in one Git commit. Ignore unrelated working-tree
changes; resolve drift in the catalog closure before activation.

Re-run `runbook list --json`. Use its observed whole-catalog digest and active
epoch:

```bash
browser-use runbook activate --catalog-digest <observed-catalog-digest> \
  --expected-epoch <observed-active-epoch> --json
```

Activation validates the commit closure, stages an immutable XDG Runbook
Generation, and atomically selects it. It covers the complete catalog, never
one service or flow. It refuses catalog drift, epoch drift, invalid promotion,
and a nonterminal mutation-capable run bound to the prior generation. Follow
the returned continuation; never weaken the check.

Re-run list/show after activation. Expect catalog and retained records to become
`in-sync`. Repeating activation for the already selected digest is a no-op.

Synchronize the private Git catalog through the operator-owned Git workflow.
Activation never syncs Git or another host's XDG store. Inspect and activate
the reviewed commit separately on each runtime host.

Owners:
[private catalog closure](../../skills/browser-use/src/browser-use-private-runbook-catalog.ts)
and [generation activation](../../skills/browser-use/src/browser-use-runbook-generation.ts).

## Respect packaged-runtime custody

- Use packaged invocation for active-generation reads and execution.
- Read its active-generation provenance as runtime truth.
- Treat its source view as unavailable. Never infer current catalog bytes from
  the selected generation.
- Expect source apply/delete, Reviewed Action apply/status, and activation to
  refuse with a typed source-checkout repair path.
- Return to the setup-owned source-checkout front door for source work.
- Never make package files, mutable XDG files, or the current working directory
  an authoring source.

Execution resolves only the selected immutable generation. A missing or corrupt
selection returns typed activation repair; never fall back to source bytes.

## Preserve Item Binding custody

Keep authentication outside Browser Runbooks and Reviewed Actions:

1. Declare a non-secret auth-context reference in the Runbook Draft.
2. Enter the Browser Authentication Transaction before business execution.
3. Dispatch the exact auth continuation returned by the shared run.
4. Prove token readiness and exactly-one-vault scope without printing values.
5. Re-prove an existing Item Binding by targeted read. Never rescan silently
   after move, revocation, expiry, or scope loss.
6. For a missing binding, use live redacted Login metadata. Bind one
   deterministic match only.
7. For ambiguity, project the redacted selection set. Require the human's
   signed one-use selection grant from the Approval Broker. Never guess or sign
   on the human's behalf.
8. Prove session identity and exact target origin before confidential delivery.
   Human Identity Attestation is one-run authority; it never overrides a proven
   mismatch.
9. Let only the disposable retrieval and delivery helpers handle raw values.
   Keep values out of the agent, Browser Adapter, arguments, environment,
   output, browser evidence, and durable files.
10. Resume the same Shared Browser Use Run and selected lane after delivery.
    Stop for passkey, CAPTCHA, consent, recovery, or ambiguous identity.

Use `browser-use auth --help` and the run's typed continuation for the next
command. Report secret checks by shape only.

Owners:
[Item Binding policy](../../skills/browser-use/src/browser-use-auth-bindings.ts),
[custody preparation](../../skills/browser-use/src/browser-use-auth-provider.ts),
[transaction state](../../skills/browser-use/src/browser-use-auth-transaction.ts),
[confidential delivery](../../skills/browser-use/src/browser-use-confidential-field-delivery.ts),
and [native custody boundary](../../runtime/browser-use-security/README.md).
