# Fallow Runner: Agent-Actionability Improvements

Status: draft. Owner: fallow skill. Source research: Context7 (`/fallow-rs/docs`, `/fallow-rs/fallow-skills`), web patterns (Knip+agent, Addy Osmani verify-loop, arxiv 2510.15955 LLM-JSON degradation), live recon on `fallow 2.88.2` + `fallow-mcp`.

## Why

Current runner wraps 7 commands and emits a normalized envelope, but under-uses Fallow's strongest agent surfaces. Today's audit on `browser-use/scripts` returned 178 findings; only 1 was introduced, and resolving the rest took a manual coverage-intersect. Two native surfaces would have collapsed that: per-finding repair `actions[]`, and `trace_export` ("why is this flagged?"). Research is consistent: new-only gating + machine-readable actions + flattened output are the affordances agents actually use.

Already shipped this branch (context, not scope):
- dupes location fan-out (`clone_groups[].instances[]` -> per-site references).
- audit attribution: `introduced` per reference + `mode_evidence.attribution` + plain `attribution …` line + `next_action=continue introduced=0`.

## Confirmed shapes (live recon, `fallow 2.88.2`)

- Findings are category-keyed, not a flat `findings[]`. `dead-code`: `unused_exports[]`, `unused_files[]`, `unused_types[]`, `unused_dependencies[]`, `circular_dependencies[]`. `audit` nests `audit.dead_code` / `audit.complexity` / `audit.duplication`.
- `actions[]` is per finding. Each action: `type`, `auto_fixable`, `description`; optional `comment` (suppress-*), `config_key`/`value`/`value_schema` (add-to-config), `note`, `placement`.
- `auto_fixable` is per-action only. Finding-level fixability = `any(actions[].auto_fixable)`.
- `introduced: bool` exists in `audit` mode only.
- Dupe findings carry no `path`/`line`; they use `instances[]` + `fingerprint`.
- `_meta` (rule catalog: `rule-id -> {name, description, docs}`) appears only under `--explain`. No per-rule severity/action.
- `fallow explain <type> --format json` = flat strings `id/name/summary/rationale/example/how_to_fix/docs`; runs no analysis.
- `fallow list --format json` = `entry_points[]`, `files[]`, `plugins[]`, `workspaces[]`; no `kind` field.
- Trace family is MCP-only. `fallow-mcp` ships with the binary (stdio JSON-RPC, protocol `2024-11-05`, 22 tools). `trace_export` args `{file, export_name, root?}` -> `{reason, is_used, file_reachable, is_entry_point, direct_references[], re_export_chains[]}`. Confirmed live.

## Ranked work items

Effort S/M/L, value low/med/high. Order = value-per-effort.

### 1. Propagate per-finding `actions[]` + derived `auto_fixable` — M / high
- Surface each finding's repair `actions[]` (type, auto_fixable, description, and the suppress `comment` / config keys) on its `issue_reference`.
- Add a derived finding-level `auto_fixable: any(actions[].auto_fixable)`.
- Lets the agent see mechanical-vs-judgment per finding instead of re-describing fixes. Today repair hints exist only for blocked runs.
- Gotcha: iterate the category-keyed map; treat all non-core action keys as optional; allow location-less (dupe) findings.

### 2. `why <file> <export>` resolver via `fallow-mcp` `trace_export` — M / high
- New runner subcommand that calls `trace_export {file, export_name}` and returns `reason` + reachability evidence + `direct_references[]`, mapped to a verdict (false-positive / likely-dead / entry-point).
- Strongest false-positive killer Fallow offers; deterministic, no grep guessing.
- **Transport: use `mcporter`, not a hand-rolled stdio client (decided by spike).** `mcporter call --stdio fallow-mcp --tool trace_export --cwd <root> --output json --args '<json>'` does the handshake, unwraps the two-layer content JSON, and separates tool-level (`{error:true}` = symbol not found) from transport-level (`{issue:{kind:"offline"}}` = server unreachable). Reuse the existing command-vector contract in `browser-use/scripts/mcporter-transport.ts` (`BROWSER_USE_MCPORTER_COMMAND_JSON`-style override; runs via `bunx mcporter`); do not invent a new transport.
- Spike: `skills/fallow/scripts/prototype-why-symbol/` — verdict logic (`deriveVerdict`/`explainVerdict`) + mcporter call shape (`trace-client-mcporter.ts`) confirmed live against 4 real flagged exports.
- Gotchas: needs file+export_name (resolve from the finding being explained, not a bare name); trust schema key names `file_reachable`/`is_entry_point` (sibling `is_reachable`/`entry_point` came back null live); map `SymbolNotFoundError`/`TraceTransportError` onto the runner failure taxonomy.

### 3. Baseline / regression mode for non-audit commands — M / high
- Add `--fail-on-regression --tolerance` (or `--save-baseline` / `--*-baseline`) passthrough for `dead-code`/`health`/`dupes`, which have no attribution.
- Gives "did my change make it worse" without the manual coverage-intersect for non-audit modes.
- Pairs with the `references/workflows.md` Coverage-Intersect section (scoped to non-audit after attribution shipped).

### 4. Machine-readable before/after delta — M / high
- When a rerun exists, emit `delta: {introduced_before, introduced_after, resolved, new}` as a field, not prose.
- Skill already asks for before/after summary; make it structured so the verify-loop can gate on it.

### 5. Verify-after-fix gate in the skill — S / med
- After `fix-apply`, rerun the same evidence command and require introduced-count non-increase before declaring done.
- Skill says "rerun" but does not gate. Matches Knip-verify and Addy Osmani validate-after-batch.

### 6. Budget summarizes instead of omitting — M / med
- `--max-output-bytes` over budget currently drops raw output. Emit a truncated top-N introduced-findings summary instead.
- arxiv 2510.15955: a condensed response beats no response; size/position bias means buried findings get missed.

### 7. Suppression hygiene in the skill — S / med
- Teach: prefer inline `// fallow-ignore-next-line <rule>` + JSDoc `@internal`/`@public` over deletion for contract/test-only exports; never broad ignore lists.
- Fallow ships the exact suppress `comment` string in the `suppress-line` action (item 1 surfaces it).

### 8. `--group-by owner|directory` passthrough — S / med
- Cluster large changed-code findings for triage instead of a flat wall.

### 9. Contract/schema header legibility — S / med
- Confirm `contract_id`/`schema_version` lead the emitted envelope (schema-in-output lifted LLM accuracy in the study).

### 10. Risk-ordered triage hint in the skill — S / low-med
- When multiple modes run, present files -> deps -> exports (lowest -> highest false-positive).

## Out of scope / decisions deferred

- `fallow coverage` runtime tools (license-gated).
- Full MCP-server routing for all trace/explain tools (item 2 covers the one high-value path; broader routing is L effort).
- `flags` command wrapping (low current signal; revisit if feature-flag inventory is needed).
- `security` command wrapping: separate decision; gated out of audit by design, real CWE candidates found in recon. Track separately.

## Suggested sequencing

1. Items 1 + 7 together (actions[] surfaces the suppress comment the hygiene guidance needs).
2. Item 2 (`why`) as the standalone false-positive resolver.
3. Items 3 + 4 + 5 as the "did my change improve things" loop.
4. Items 6, 8, 9, 10 as output-legibility polish.

## Prototype next

Items 1 and 2 are the structural wins with confirmed shapes. Use `/prototype` to spike the envelope shape (item 1) and the `fallow-mcp` handshake + `trace_export` call (item 2) before committing to the runner contract.
