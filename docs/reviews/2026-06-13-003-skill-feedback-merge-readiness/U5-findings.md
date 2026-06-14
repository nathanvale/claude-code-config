# U5 review - Stabilize review actions and renderer claims

- Run: `20260613-982f71e0` · base `38ab9f7` · verdict **met**
- Owner files: command-contract.ts(+test), skill-feedback-runner.ts, skill-feedback.test.ts, review-ledger-reducer.ts(+test), redaction.ts, references/report-shape.md
- Requirements: R11-R16, R24

## Verdict: met

- `open_actions.action_key` is a deterministic SHA256 over `{open_reason, sorted evidence_refs, target}` (runner:1149) - **reorder-stable** across inbox file ordering. Stability test covers it mechanically.
- `evidence_refs` carry structured `report:<id>` refs, not prose copied from plain output - **KTD6 satisfied** (agents act on refs, not display text).
- `resolution_state` derived from review facts (not hard-coded `open`).
- Every untrusted string rendered in plain output passes through `plainSafe`; `capture_runtime_mix` shown as `runtimes=` in plain ledger lines.
- JSON-side control-character fixtures parse intact and cannot create extra structural keys.

## Findings touching U5 owners

- **#6 (P2 advisory, shared U1/U3)** - `evidence_refs` added as a required field on `ReviewOpenItem` without a schema_version bump (command-contract.ts:540). No in-repo break (suite green). Latent for external consumers. Same disposition as the `inbox_health` required-field note.
- **Behavioral note (api-contract)** - `evidence_refs` content changed from prose to `report:<id>` refs. Type unchanged (`string[]`), so no type break, but any consumer rendering these as user-facing text now shows opaque IDs. This is the **intended** KTD6 change - announce it: refs resolve via the review_units index, not raw render.

## Agent-native gap

`evidence_refs` carry `report:<id>` but there is **no `resolve-ref` / `show` command** - an agent holding `report:report-old-primary` must scan every `.json` by `report_id` field (the filename is a content hash, not the report_id). Document the resolution path in SKILL.md or add a `show <report_id>` subcommand. This is the one place where "agents act on stable refs" (KTD6) is asserted but the resolution primitive is missing.
