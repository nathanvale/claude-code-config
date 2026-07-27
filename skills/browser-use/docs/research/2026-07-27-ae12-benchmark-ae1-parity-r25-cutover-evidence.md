# Release evidence trio: AE12 benchmark, AE1 caller parity, R25/L193 cutover audit

- Date: 2026-07-27
- Contract: `docs/plans/2026-07-27-001-feat-browser-use-all-lane-daily-use-closeout-plan.md` (AE1, AE12, R25/R26).
- Harness owner: `skills/browser-use/src/browser-use-benchmark.ts` (+ `browser-use-benchmark.test.ts`).
- Environment: this machine, live CLI via `bun skills/browser-use/src/browser-use.ts`.

Scope: AE12 token-efficiency benchmark, AE1 Codex/Claude Code caller parity, and the R25/L193 legacy-corpus cutover audit. Read-only against the repo and the legacy corpus; no legacy roots mutated.

---

## Live-environment gate (read this first)

The AE12 benchmark's live numbers depend on a proof-passing Warm Chrome so a Verified Handoff Envelope can be minted for `task run`. **This session had none.** Live probes:

- Port 9222 has a listener (Google Chrome, PID 37634) but `/json/version` returns HTTP 404.
- `browser-connect check --json` -> `invalid_cdp` then `foreign_listener` (exit 20), continuation `requires_operator: true`, `inspect_listener`.
- `browser-connect connect chrome-devtools-mcp --json` -> `status: error`, `code: foreign_listener`, `outcome: failed`. No handoff minted; no browser launched (no-launch gate honored).

The 9222 listener is the everyday Chrome profile, not Warm Chrome. Per contract (F1, AE3) `browser-use` fails closed rather than attaching to an unverified listener, so no live routed `task run` was possible this session. Chrome was **not** relaunched (operator browser state is not ours to mutate).

Prior confirmed reality: the shared-run store already holds 12 runs, including `confirmed` `debug` (chrome-devtools-mcp) and `confirmed` `routine-automation` (agent-browser) runs against `agent-chrome`/`default` (e.g. run `12501fd3-…`, `721f6a59-…`). Live routed tasks HAVE executed before; only this session's Warm Chrome is not proof-passing.

Consequence: the AE12 deliverable here is the **repeatable harness** (R26's durable requirement) plus this gate record. The harness runs the moment an operator mints a handoff against a proof-passing Warm Chrome:

```
bun skills/browser-use/src/browser-use-benchmark.ts --handoff <verified-handoff.json>
```

---

## AE12 — token-efficiency benchmark (R26)

### Task under test

One bounded read-only task run through each eligible lane against Warm Chrome:

- `agent-browser` via intent `scrape` (snapshot/refs read of a localhost page).
- `chrome-devtools-mcp` via intent `debug` (console read of a localhost page).
- `playwright-cdp`: **excluded** — registered-but-not-installed on this host (`lanes list` shows `native_implementation.implemented: false`, `unavailable_reason` "No lane-specific execution Interface is registered"). Operator gate; the harness records it as skipped and never fabricates a sample.

### Four measured axes (harness contract)

| axis | definition |
| --- | --- |
| model-visible tokens | UTF-8 byte length of the caller-visible JSON result envelope (the only thing a caller reads; raw traces never reach the model). Token count approximated as bytes/4, labelled a proxy. |
| wall time | milliseconds of the full `browser-use task run` invocation. |
| command count | CLI invocations the caller issued to finish the task (1 for a single `task run`). |
| artifact volume | count + summed byte size from the shared-run receipt `artifacts[]`. |

### Neutrality invariant

The harness makes **no** assumption that Agent Browser is cheaper. `compareBenchmark` derives the cheapest lane **per axis** from measured numbers only; a tie yields `null` (no claim); a single lane sets `comparison_licensed: false` (no cheaper/costlier claim licensed). Proven by `browser-use-benchmark.test.ts` ("cheapest-by-axis is derived only from measured numbers" — winner flips per axis; ties -> null).

### Live table (pending handoff)

Not produced this session (gate above). When run, the harness emits both the JSON `browser-use.ae12-benchmark` comparison and this Markdown shape (one row per measured lane):

```
| lane | intent | model-visible bytes | approx tokens | wall ms | commands | artifacts | artifact bytes | state |
```

Real receipt note (from the confirmed prior runs): read-only `debug`/`scrape` runs recorded `artifacts: []`. Zero artifact bytes is a **measured** result, not a missing measurement — the harness scores it as 0, and the caller-visible envelope for `run status` on such a run is small (the receipt is deliberately trace-free). This is itself the AE12 story: the model-visible cost is the envelope, not the trace.

### Fake-vs-real fidelity

The test fake (`fakeTaskRunEnvelope`) mirrors the live `browser-use.shared-run` receipt shape captured this session (`data.run.{state,task_intent,adapter_id,handoff_evidence_id,mutation_dispatched,artifacts,revision}`), so `receiptArtifactsOf`'s parse path is exercised against the real shape, not a compact stand-in.

---

## AE1 — caller parity (R1, R35)

Ran each read-only discovery command under three caller labels (default / `--caller codex` / `--caller claude-code`) and diffed the envelopes after normalizing the audit-only `caller` field plus volatile `run_id`/`duration_ms`.

Reproduce: for each command run `bun skills/browser-use/src/browser-use.ts <cmd> --json`, then `... --json --caller codex`, then `... --json --caller claude-code`; JSON-normalize the `caller`, `run_id`, and `duration_ms` fields and compare. Verdict:

| command | equiv(codex) | equiv(claude-code) | default bytes | codex bytes | claude-code bytes |
| --- | --- | --- | ---: | ---: | ---: |
| `lanes list` | yes | yes | 2772 | 2775 | 2781 |
| `task list` | yes | yes | 2424 | 2427 | 2433 |
| `migration status` | yes | yes | 563 | 566 | 572 |
| `run status` | yes | yes | 3775 | 3778 | 3784 |
| `runbook list` | yes | yes | 270 | 273 | 279 |

Every command is **schema-equivalent modulo the caller field**. The only byte delta is the caller label itself (`codex` +3, `claude-code` +9, identical delta across all five commands — the caller field is the sole difference). All exit code 0.

Caller field values observed: default `{"label": null}`, codex `{"label": "codex"}`, claude-code `{"label": "claude-code"}`.

Mutation path parity: `task run --intent scrape` (no handoff) returns the identical typed refusal `usage_error` / "task run requires --handoff <path>." under all three callers — caller never changes semantics, authority, or schema (R35).

Finding: **none.** Caller parity holds; nothing for wiring_spec.

---

## R25 / L193 — legacy corpus cutover audit

### Corpus existence

The legacy Browser Automation corpus is **real on this machine**:

- Config root `~/.config/side-quest/browser-automation`: 176 files (30 service domains, vendors, registry.yaml, config.yaml + backups, observe-runs).
- State root `~/.local/state/side-quest/browser-automation`: ~52,620 files (dominated by smoke/observe run evidence).

The platform plan (U7) names 166 artifacts / 71 current non-backup; the live config root inventoried at 176 files (the extra reflect accumulated backups/observe-runs since the plan was written). The count discrepancy is data, not a defect.

### Migration family run (inventory + plan; apply intentionally NOT run)

Ran against `~/.config/side-quest/browser-automation`:

- `migration inventory` -> `phase: inventoried`, `snapshot-bebe0235352a372e`, `source_entry_count: 176`, `activation_state: unchanged`.
- `migration plan` -> `phase: planned`, `disposition_count: 176`, `activation_state: unchanged`. Disposition tally:

| disposition | count |
| --- | ---: |
| stage | 116 |
| quarantine-executable | 52 |
| quarantine-unsupported | 8 |
| quarantine-secret | 0 |
| quarantine-obsolete | 0 |
| quarantine-backup | 0 |
| **total** | **176** |

Every one of the 176 frozen entries received exactly one disposition (AE11: every source artifact dispositioned; unreviewed executable code stays inactive — 52 quarantined). No secret-positive or malformed-YAML entry aborted the plan.

**`apply` and `verify` were NOT run.** Rationale (staged-generation side-effect safety review of `browser-use-migration.ts`): inventory/plan/apply/verify only READ the legacy source and write to the `browser-use` XDG store; `activation_state` stays `"unchanged"` (the Corpus Generation Manifest CAS is U7, outside the module) so legacy roots are never mutated and nothing activates. That satisfies the "safe outside the legacy corpus" bar. However `apply` stages ~116 real files into Nathan's **live** XDG state store as a persistent generation — a real side effect on his machine outside the audit's read-only intent. Per the task's "if unsure, stop at plan" instruction, I stopped at plan. `inventory` already wrote one snapshot ledger into the live store (unavoidable to freeze the snapshot); that is a benign migration-state record, not corpus data.

### Active-legacy-read audit (L193)

`rg` over `runtime/` and `skills/browser-use/src/` (excluding tests/fixtures/docs) for legacy roots (`side-quest/browser-automation`, `browser-domain-memory`, `surface-manager`):

- **No active runtime reads of the legacy roots.** Success criterion "The migrated corpus has no active reads from legacy runtime roots" holds for the runtime/skills source.
- `browser-use-migration.ts:338` — `lower.includes("browser-domain-memory")` is the quarantine classifier (defensive: quarantines legacy-named artifacts), not a read of a legacy root.
- `enroll-browser-automation-token` (auth-model, browser-use.ts, command-contract.ts, op.ts) — a 1Password vault-token enrollment continuation id; "browser-automation" there names the auth token, unrelated to the legacy corpus path.
- `runtime/cli-command-facade/src/testing.ts:76,80` — example strings inside a test-helper module (`"/Users/example/.config/side-quest/browser-automation/auth-state.json"`, `"bun run browser-automation debug open ..."`). Documented example values, not a live read. Cosmetic legacy-path reference in a test helper; noted, not fixed (out of unit scope).

Finding: **none blocking.** No active legacy reads. One cosmetic legacy-path example string in `runtime/cli-command-facade/src/testing.ts` (mentioned, not fixed).

---

## Summary of findings

- AE1 caller parity: PASS, no finding.
- AE12: harness built + unit-proven; live table gated on a proof-passing Warm Chrome (operator gate, recorded).
- R25/L193: corpus real; inventory+plan clean (176/176 dispositioned, 116 stage / 60 quarantine); no active legacy reads; apply/verify deferred (would mutate live XDG store); one cosmetic test-helper legacy path string noted.
