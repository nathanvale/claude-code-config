# Runbook document-authoring contract findings

Lane: `prototype` logic. No browser, no tests. A tiny in-memory reducer/state
machine plus a transcript driver; full state printed after every action. Every
verdict check derives from a real logged outcome (no hardcoded pass).

## Question

Does the complete-document authoring model (ADR 0032) stay legible and safe
across schema discovery, validation, apply, concurrent replacement, deletion,
and source/runtime drift?

## Exact call sequence

```text
cd skills/browser-use
bun run prototype:runbook-document-authoring
```

One command drives: `schema --json`, two `validate --file` cases, the full apply
lifecycle, the action-promotion gate, an activation boundary, the delete
lifecycle, and packaged-vs-source invocation.

## Results (verdict: PASS — 19/19)

| Scenario | Outcome |
| --- | --- |
| `schema --json` | One machine-readable contract (`browser-use.runbook-draft`) + minimal valid example |
| `validate --file` incomplete | Refused; names each missing field + repair |
| `validate --file` valid | ok |
| apply absent target | Creates; `changed:true`, record digest assigned |
| apply identical document | `changed:false` no-op |
| apply different, no expected digest | Refused; demands `--expect-digest <current>` |
| apply different, stale digest | Refused; names expected vs current (another author changed it) |
| apply different, matching digest | Replaces; `changed:true`, digest advances |
| apply runbook w/ promoted action | ok |
| apply runbook w/ unpromoted action | Refused; "not promoted" |
| apply runbook w/ stale action digest | Refused; names promoted vs referenced |
| delete wrong digest | Refused; demands matching digest |
| delete matching digest | ok; source removed, active generation unchanged |
| delete absent target | Idempotent no-op; `changed:false` |
| packaged apply | Refused; execute-active-only |
| packaged delete | Refused |

## Read-state statuses (all four demonstrated distinctly)

- `new-pending-activation` — record applied to source, never activated.
- `in-sync` — source record digest equals its active-generation digest.
- `activation-required` — catalog digest diverges from active (edit or delete
  pending); shown as `catalog_status`.
- `deletion-pending-activation` — record deleted from source but still present
  in the active generation until re-activation (surfaced with
  `record_digest:null`).

Read state always shows `catalog_digest`, `active_digest`, and per-record
`status`; it never silently picks one view.

## What this proves

- The complete-document model needs no field-level edit/clear semantics: apply of
  a whole Runbook Draft covers create, no-op, and guarded replace.
- Optimistic-concurrency via observed record digest prevents one agent silently
  overwriting another's change (stale digest refuses).
- Source is the sole mutation authority; a packaged runtime refuses authoring and
  only executes the active generation.
- Referenced Reviewed Actions gate apply: missing, unpromoted, or stale-digest
  action closure refuses before any write (ADR 0033).
- Read state exposes catalog vs active truth plus the four sync statuses, so drift
  is legible rather than silently resolved.

## Limits

- In-memory only; no filesystem, no real Git catalog, no real XDG generation.
  Digest is a deterministic non-crypto hash for reproducibility, not the real
  content-addressing scheme.
- Activation is stubbed to a snapshot swap; the real staging/atomic-select and
  bootstrap cutover are Prototype 3's question.
- Action promotion registry is a fixed map; real promotion authority is
  Prototype 4's question.

## Plan effect

- Confirmed: the document-authoring surface (`schema`, `validate`, document
  `apply`, digest-guarded `delete`, `list/show` state) is coherent and safe.
  Acceptance criteria: identical→no-op, different-without-digest→refuse,
  stale-digest→refuse, matching→replace; delete needs digest; absent delete is a
  no-op; packaged refuses mutation; unresolved action closure refuses apply.
- Confirmed: read state must always expose catalog digest, active digest, and the
  four sync statuses.
- Open (named): the real content-addressing scheme and the source→generation
  activation mechanics (Prototype 3) and action promotion authority (Prototype 4).
