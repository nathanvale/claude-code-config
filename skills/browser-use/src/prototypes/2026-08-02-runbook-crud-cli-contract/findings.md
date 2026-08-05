# Runbook CRUD CLI contract findings

Lane: throwaway logic prototype. No production parser, validator, or filesystem
mutation was used.

Run command:

```text
cd skills/browser-use
bun run prototype:runbook-crud-contract
```

Driven sequence: plan variant `1 2 3 4 5 6`; resolved variant
`v 1 2 3 4 5 6 7`.

## Q1. Does the advertised create minimum produce a valid runbook?

**FAIL under the plan contract.** `--service` plus `--flow` passes the proposed
parser requirements, then the existing validator refuses missing origins and
steps. The command cannot both scaffold a schema-valid runbook and require only
those two flags.

**PASS under the resolved contract.** Require `--summary`, at least one
`--origin`, and `--steps-file` at parse time. Missing inputs fail as usage errors
before any write.

## Q2. Is the structured step input self-explanatory?

**FAIL under the plan contract.** `--from-json` does not say whether the value is
a path, inline JSON, a step array, or a complete runbook definition.

**PASS under the resolved contract.** `--steps-file <path>` means one JSON file
containing the complete step array. The CLI continues to construct and validate
the surrounding runbook record.

## Q3. Does edit define every patch transition?

**FAIL under the plan contract.** Omitted-field behavior, repeated-origin
behavior, and auth-context clearing have no contract.

**PASS under the resolved contract.** Omitted fields preserve existing values;
present repeated `--origin` flags replace the complete origin set;
`--steps-file` replaces the complete step array; `--clear-auth-context` clears
the optional field and conflicts with `--auth-context`.

## Q4. Can delete provide the promised preview?

**FAIL under the plan contract.** Parser rejection when `--force` is absent
prevents the handler from projecting the target preview promised by KTD4.

**PASS under the resolved contract.** The parser requires only service and flow.
Without `--force`, the handler returns a successful preview with
`changed:false` and a continuation naming the forced command. With `--force`,
it deletes the reviewed repo-catalog target. Keep one confirmation spelling:
`--force`.

## Verdict

Graduate the resolved contract into the plan. It fails early for missing create
inputs, names file semantics, makes edit a total patch operation, and keeps the
destructive preview reachable.
