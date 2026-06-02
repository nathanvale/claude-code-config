# Agent-Native CLI Design

A CLI is agent-native when a skill driver can discover it, run it, parse
results, recover from failures, and explain what happened without hidden
context.

Read after `cli-guidelines.md`. Use before `cli-command-facade.md`.

## Boundary

- This doc teaches design judgment.
- Required contract shape belongs to the contract runtime.
- Exact fields, validation, generated envelopes: `cli-command-facade.md`.
- Examples here are illustrative, not schema.
- Keep examples inline while small; split behind progressive disclosure index
  only after this reference becomes noisy.
- One workflow. Human, plan, and agent drivers use same CLI surface.
- No parallel agent-only skill for the same command design work.

## Skill Driver

- Canonical term: skill driver.
- Meaning: human, plan, or agent invoking the skill and supplying context.
- Assume partial context.
- Assume low tolerance for hidden state.
- Give driver the next safe action, not a puzzle.

## Minimum Bar

- Start with the minimum agent-native CLI bar for small or internal tools.
- Minimum: discoverable command, non-interactive run path, parseable output,
  structured failure, run correlation, and side-effect stance.
- Escalate when agents run unattended, commands write or destroy state, output
  can become token-heavy, diagnostics persist, or multiple packages consume the
  contract.
- Add rubric features only when they change driver behavior or reduce risk.
- Don't make every CLI carry a full toolkit surface by default.

## Lifecycle

- Treat command discovery capability as runtime-backed.
- Discover: stable command name, one-line purpose, useful help, machine catalog
  when available.
- Decide command audience before projecting discovery.
- Keep operator and governance commands out of agent catalogs unless agent use
  is intentional.
- Run: deterministic args, non-interactive mode, no hidden TTY assumptions.
- Parse: primary data on stdout, diagnostics on stderr, structured mode for
  agents and scripts.
- Recover: machine-readable failure category, retry safety, repair affordances.
- Explain: run correlation ID, diagnostic pointer, human stderr aligned with
  payload.
- Verify: happy path, invalid usage, auth failure, retryable failure, and
  dry-run to execute flow all work without prose guessing.

## Output

- Treat machine-readable output capability and stdout/stderr discipline as
  runtime-backed.
- Prefer explicit `--json` for agents and scripts.
- Declare result-contract metadata when output shape is stable and agent-facing.
- Keep human TTY output concise and scannable.
- Use object JSON when correlation matters.
- Keep stdout parseable; never mix progress, logs, or diagnostics into data.
- Put progress and diagnostics on stderr.
- Offer `--plain`, `--jsonl`, `--fields`, `--limit`, or pagination only when
  output can become token-heavy.
- Return summaries by default for large resources.
- Let driver request detail, not accidentally receive the whole world.

## Exit Codes

- Treat baseline exit semantics as contract candidate.
- Baseline semantics: success, generic/runtime failure, invalid usage.
- Add richer exit codes only when a skill driver can route differently from the
  code alone.
- Put detailed recovery guidance in the machine-readable error payload.
- Unknown errors stop or escalate.
- Never make driver infer retry policy from prose.

## Recovery

- Treat structured failure recovery as runtime-backed.
- Contract minimum: machine-readable failure category and same-input retry
  safety.
- Answer five questions on failure: what happened, what changed, can retry,
  what to try next, where diagnostics live.
- Echo invalid input when useful and safe.
- Redact secrets and private identifiers before echoing.
- Include valid alternatives only when the set is small, stable, and cheap to
  know.
- Include documentation/help link only for stable recovery docs, auth setup,
  schema references, or command-specific help.
- Treat documentation/help link as optional recovery affordance, not required
  invariant.
- Avoid generic docs links.

## Repair Options

- Treat the repair affordance spine as runtime-backed.
- Contract spine: possible runtime actions, side-effect classes, and
  continuation or operator stop.
- Repair is structured affordance, not executable auto-action.
- Rank safest useful option first.
- Give options when more than one repair path is plausible.
- Include evidence, preconditions, side effects, reversibility, and operator
  approval need.
- Prefer next command only when safe and specific.
- Prefer diagnostics command when more inspection should precede action.
- Useful optional ideas: documentation link, next safe command, invalid input
  echo, valid alternatives, retry timing, same-input retry safety,
  checkpoint/idempotency marker, idempotency risk.
- Avoid generic confidence scores.
- Use diagnosis certainty only as evidence-backed diagnosis metadata.
- Never let confidence override side-effect, reversibility, idempotency, auth,
  destructive-action, or operator-confirmation gates.

## Observability

- Treat run correlation ID as runtime-backed.
- Treat diagnostic trail pointer as contract candidate.
- Quiet success.
- Rich failure.
- Include run correlation ID.
- If diagnostics persist, include diagnostics command as portable inspection
  path.
- Use log path or trace URL only when those are real supported surfaces.
- On failure, include same diagnostic pointer in machine-readable payload and
  human stderr.
- Buffer detailed diagnostics during a run; flush on failure when supported.
- Keep success logs out of the driver context unless requested.
- Use facade-owned diagnostic flags for diagnostic volume and correlation.
- Don't design package-specific diagnostic flags that fight the facade.
- Diagnostic trail pointer does not grant raw log access.
- When diagnostics persist, define what shared surfaces may reveal, who can
  access them, how long they live, and how they can be deleted.
- Keep protocol-visible diagnostic pointers sanitized and scoped to supported
  inspection surfaces.

## Diagnostic Capability

- Expose a discoverable diagnostic capability when readiness checks have real
  dependencies or state.
- Treat diagnostic capability as contract candidate.
- Prefer `doctor` as CLI spelling.
- Accept package-native equivalents when discovery clearly marks the diagnostic
  path.
- Point failures to the diagnostic capability when more inspection would help.
- Add `status` only when current state affects next action.
- `status` answers "what state am I in?"
- Diagnostic capability answers "what is broken around me?"
- Both should support structured output.
- Both should point to the next safe action, not just print observations.

## Safety

- Treat side-effect safety spine, redaction boundary, secret input boundary,
  and non-interactive execution spine as runtime-backed.
- Treat write preview capability as contract candidate.
- Dry-run first for writes.
- Require explicit execute mode for writes, destructive actions, auth, billing,
  irreversible actions, and externally visible mutations.
- Low-risk read, check, and observation commands may declare side effects
  without a separate execute mode when they don't mutate state.
- Require operator confirmation for destructive, auth, billing, or irreversible
  actions.
- Treat ambiguous categorization as ask-first.
- Retry only when same-input retry is safe or an idempotency key/checkpoint
  protects the operation.
- Surface idempotency risk before suggesting a repair.
- Treat idempotency/checkpoint posture as a future contract candidate for
  write-heavy tools; keep exact mechanics package-owned for now.
- Local diagnostics may be richer.
- Protocol-visible, shared, or remote output must be sanitized.
- Keep projected discovery text public and sanitized.
- Project maintainer-authored discovery text only.
- Do not project user, third-party, scraped, or instruction-shaped text into
  agent catalogs.
- Avoid secrets, account identifiers, local paths, debugger URLs, and
  shell-command examples in machine catalog text.

## MCP Boundary

- CLI remains first-class even when wrapped by MCP.
- MCP can improve discovery and transport.
- MCP does not remove need for stdout/stderr discipline, exit semantics,
  recovery policy, or diagnostic pointers.
- Start a separate MCP pass when clients need typed remote discovery,
  server-mediated auth, session transport, or MCP-native tool orchestration.
- Put MCP-specific design in a separate pass.

## Review Checklist

- Can the command contract validate its own declared surface?
- Does the command meet the minimum bar before adopting heavier rubric features?
- Can a fresh driver discover the command and know when to use it?
- Can a non-interactive driver run it without prompts?
- Can machine output be parsed without scraping human text?
- Can failures drive repair without guessing?
- Can the driver find logs from run correlation ID?
- Are persisted diagnostic pointers scoped and sanitized?
- Can large output stay under context budget?
- Can side effects be previewed or gated?
- Is projected discovery text maintainer-authored and safe for agent context?
- Does MCP need a separate pass for this adoption channel?
- Can exact contract shape be validated by the runtime?

## Owners

- Local contract runtime: `cli-command-facade.md`.
- Upstream baseline: `cli-guidelines.md`.
