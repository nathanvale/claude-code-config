# Storage Routing

Use this reference when a skill, agent, helper, or human needs durable context
placement advice.

Keep `skills/context-advisor/SKILL.md` as the advisor front door.
Keep `skills/skill-author/references/skill-design-decision-runbook.md` as the skill design owner.

This map advises context placement. It does not own content, mutate stores, or manage runtime state.

## Decision Order

1. Name the owner.
2. Name the context kind.
3. Name the mutability.
4. Name the privacy boundary.
5. Name the query and recovery need.
6. Name the write authority.
7. Choose the smallest store that preserves source-of-truth ownership.

## Required Facts

- Owner: who can correct or delete this context.
- Kind: workflow, decision, research, project tracker, state, config, cache, runtime, domain term, user data, or credential.
- Mutability: immutable, append-only, replaceable, refreshable, derived, or temporary.
- Privacy: public, repo-private, user-local, secret, vendor-owned, or cross-repo.
- Query need: human read, `rg`, status, filtered query, retrieval, or generated projection.
- Recovery need: rebuildable, repairable, checkpointed, audited, backed up, or disposable.
- Write authority: human, skill driver, curator, accepted owner workflow, runtime, or vendor.

## Precedence

- Owner and privacy beat context kind.
- Canonical truth beats convenient query layers.
- Accepted repo decisions are terminal; route to `record-decision`.
- Deterministic contracts stay in code, help, generated docs, checks, or tests.
- Future durable recall and synthesis use `context/` owners, not `memory/` folders.
- Format choices happen after owner, privacy, canonicity, and write authority are fixed.

## Tie Breakers

- Prefer repo owners for repo truth.
- Prefer user XDG paths for user-owned local state.
- Prefer runtime state for restart, resume, cursor, and checkpoint mechanics.
- Prefer external context owners only for approved cross-repo recall or synthesis.
- If two stores fit, choose the one whose owner can repair stale or wrong data.

## Owner Test

- Repo-owned context belongs in the repo.
- User-owned durable recall and synthesis belongs under `context/` or XDG user paths.
- Skill-owned workflow belongs in the skill.
- Vendor-owned context belongs in the vendor surface.
- Runtime-owned state belongs in runtime state/data stores.
- Cross-repo synthesis belongs in the external context owner.

## Configured Super-Vault

When `~/.config/context/vault.md` exists, treat its declared vault root as the
external user-scope owner for:

- Plans, research, synthesis, and project memory.
- Project status, next actions, and handoffs.
- Personal decisions, reasoning, and durable lessons.
- Cross-repository context and links to implementation owners.

Code repositories remain the owner for:

- Repo-facing `README.md`, `AGENTS.md`, `CLAUDE.md`, and contributor guidance.
- Repo glossaries and shared domain language.
- Accepted ADRs and architecture that bind the implementation.
- API schemas, generated docs, deterministic contracts, code, tests, runtime
  state, and changelog.

Link between owners. Do not copy the same truth into both places. If the
configured path is absent or stale, report the broken route; never create a
second vault as a fallback.

## `docs/` Placement

- `docs/` means any `**/docs/`, not only repo-root `docs/`.
- A nested `docs/` co-located with its owner is valid: `skills/<name>/docs/`, `packages/<pkg>/docs/`, `apps/<app>/docs/`, `services/<svc>/docs/`.
- Subfolder taxonomy is the same at every level: `docs/plans/`, `docs/research/`, `docs/brainstorms/`, `docs/decisions/`, `docs/adr/`.
- Choose the level by the **scope of the document's subject**, not by where the session started.

### Root docs vs domain docs

- Place at the **nearest owning** `docs/` when the subject belongs to one module, package, app, service, or skill.
- Place at **repo-root** `docs/` when the subject spans the whole repo, crosses domains, or has no single owner.
- Default to repo-root only when ownership is genuinely unclear; do not default to it out of habit.
- Domain placement test: if the document would move with the code in a split or extraction, co-locate it.
- Single owner, single-domain subject, lives or dies with that domain -> domain `docs/`.
- Multiple owners, cross-cutting subject, or repo-wide policy -> root `docs/`.

### Monorepo / workspace context

- In a monorepo, prefer the workspace package's own `docs/` for package-scoped plans, research, and decisions.
- Keep cross-package architecture, shared conventions, and org-wide ADRs at repo-root `docs/`.
- A decision that binds multiple packages is root-level even when one package triggered it.
- A decision local to one package is package-level even when discussed repo-wide.
- When a domain `docs/` and root `docs/` both seem to fit, pick the one whose owner can correct stale content (Tie Breakers).
- When co-locating, leave the inbound links intact: move references with the doc, or the move breaks discovery.
- Numbered, cross-referenced records (ADRs indexed by sequence) resist relocation; keep them at the level their index lives unless the whole index moves.

## CONTEXT.md Definition

- Use CONTEXT.md for project-specific domain vocabulary.
- Include canonical terms, tight definitions, avoided aliases, explicit ambiguities, and obvious relationships.
- Include terms that help agents name modules, seams, and architecture candidates in domain language.
- Use the nearest scoped CONTEXT.md before root context.
- Use `CONTEXT-MAP.md` when multiple domain contexts need a map.
- Create or update CONTEXT.md when a conversation names a durable domain concept or sharpens a fuzzy domain term.
- Use `improve-codebase-architecture` when maintaining domain terms for architecture deepening, seam naming, module candidates, or architecture review output.
- Keep architecture vocabulary in the architecture skill owner.
- Add CONTEXT.md examples only after repeated routing drift; keep examples in a routing reference, not root CONTEXT.md.
- Keep accepted decisions in `docs/decisions/` or ADRs.
- Keep project tracker state in scoped TASKS.md or the relevant project tracker.
- Keep workflows in `SKILL.md`.
- Keep generic programming concepts, implementation details, temporary notes, research summaries, and setup facts out of CONTEXT.md.

## Routing

- If context is hot startup guidance:
  - Store in `AGENTS.md`, `CLAUDE.md`, or path-scoped rule files.
  - Keep it small.
  - Route to durable owners instead of copying their content.

- If context is reusable skill workflow:
  - Store in `SKILL.md`.
  - Move depth to `skills/<name>/references/*.md`.
  - Keep exact contracts in code, help, generated docs, checks, or tests.

- If context is learned mutable skill state:
  - Store outside skill directories; skill directories own source, not learned state.
  - Prefer user XDG state/data or repo-local ignored state.
  - If no stable runtime store exists, stop and name or create the runtime owner before recording state.
  - Provide a refresh/status verb when agents rely on it.

- If context is a durable domain term:
  - Store in the nearest CONTEXT.md.
  - Include only project-specific domain language.
  - Define what the term is, not implementation steps.
  - Include avoided aliases when naming drift would hurt review or implementation.
  - Add relationships when they clarify seams or ownership.
  - Use scoped CONTEXT.md files before root context.
  - Record a decision only when the term came from an accepted choice.

- If context is an accepted decision:
  - Store in `docs/decisions/` at the level the decision's scope owns (see `docs/` Placement).
  - Use `skills/record-decision/references/operating-manual.md`.
  - Use ADR shape only when the ADR threshold is met.

- If context is project tracker state, work queue, open question, progress state, audit queue, or next action:
  - Store in a scoped TASKS.md or project tracker owned by the relevant area.
  - Add tracker shape examples only after repeated drift across multiple trackers.
  - Keep accepted decisions in `docs/decisions/`.
  - Keep domain terms in the nearest CONTEXT.md.
  - Keep rules in the rulebook owner.
  - Update after task state changes.

- If context is research, option mapping, or community signal:
  - Store in `docs/research/` or `docs/brainstorms/` at the level the subject owns (see `docs/` Placement).
  - Promote only stable terms, accepted decisions, or reusable operating guidance.
  - Promote only with source evidence, owner review, and destination owner path.

- If context is skill setup context:
  - Store in the setup/config owner.
  - Use repo docs for generic setup instructions.
  - Use XDG config for reusable personal preferences.
  - Use repo-local ignored files for checkout-only local facts.
  - Do not store generic workflow there.
  - Do not commit personal paths, account selectors, machine facts, or secrets.

- If context is vendor-supported mutable memory:
  - Store in the vendor surface only when the vendor owns recall or personalization.
  - Do not store secrets, tokens, cookies, raw auth-bearing URLs, private repo facts, customer data, or sensitive personal data in vendor memory.
  - Name the vendor account, data class, retention/delete route, and minimum necessary fields before writing.
  - Treat vendor memory as useful context, not repo canonical truth.
  - Promote stable repo knowledge back to repo owners only through reviewed repo writes with source evidence.

- If context is mutable operational state:
  - Prefer `$XDG_STATE_HOME`, default `~/.local/state`.
  - Use for logs, checkpoints, cursors, and restartable state.
  - Add runtime checks when stale or missing state would confuse agents.

- If context is durable user data:
  - Prefer `$XDG_DATA_HOME`, default `~/.local/share`.
  - Use for portable user-owned data worth backing up.
  - Keep a human-readable projection when humans need inspection.

- If context is user config:
  - Prefer `$XDG_CONFIG_HOME`, default `~/.config`.
  - Use for preferences, local paths, account selectors, and non-secret setup.
  - Keep secrets in the credential owner.

- If context is a secret, credential, token, cookie, or auth-bearing URL:
  - Store in the OS keychain, credential manager, or vendor secret store.
  - Store only references, presence checks, or setup commands in docs/config.
  - Use plain dotenv only when it is the explicit credential owner and private permissions are set.
  - Never store secret values in repo docs, cache, logs, vendor memory, external recall, or event history.

- If context is temporary or derived:
  - Prefer `$XDG_CACHE_HOME`, default `~/.cache`.
  - Use for user-specific non-essential data.
  - Treat cache as rebuildable.
  - Never make cache the only source of durable truth.

- If context is runtime communication or synchronization:
  - Prefer `$XDG_RUNTIME_DIR`.
  - Use for sockets, named pipes, locks, and per-login runtime files.
  - Treat runtime files as logout/reboot scoped.
  - Do not rely on runtime files for durable recovery.
  - Keep large files out of runtime storage.
  - Fall back only to a replacement directory with similar capabilities and report the fallback.

- If context belongs to one checkout:
  - Use repo-local runtime state.
  - Decide committed, ignored, or generated before relying on it.
  - Prefer ignored state for local machine facts.

- After the owner store is chosen, if context is append-only event history:
  - Consider a JSON log inside the chosen owner.
  - Name data class, retention, and redaction owner first.
  - Use an allow-list schema; reject or redact unknown fields.
  - Add schema/check ownership when agents rely on fields.
  - Keep repair guidance for corrupt, partial, or privacy-invalid logs.

- After the owner store is chosen, if context is query-heavy:
  - Consider SQLite, graph, vector, or hybrid retrieval inside the chosen owner.
  - Name data class, access boundary, retention, and deletion behavior first.
  - Treat embeddings, indexes, backups, and projections as carrying the same sensitivity as source data.
  - Require migration, backup, inspection, deletion, and CLI/status owners.
  - Keep Markdown or generated projections when reviewability matters and projections are redacted or ignored as needed.

- If context is cross-repo recall or synthesis:
  - Use the configured external context owner.
  - Name the external context owner path/config before writing.
  - If no external context owner is configured, ask one ownership question.
  - Do not default to vendor memory.
  - Keep source-of-truth close to the owning repo.
  - Treat retrieval layers as recall, not canonical storage.
  - Do not write private repo facts, secrets, customer data, or local machine facts into cross-repo memory.

## Safety Defaults

- Classify sensitivity before choosing XDG state, data, config, JSON, SQLite, vendor memory, or external memory.
- For durable agent memory, name data class, isolation boundary, retention, deletion route, redaction stance, and write authority before writing.
- Do not create new `memory/` folders for durable context; use `context/` or the selected XDG owner.
- Ignore relative XDG environment paths; use defaults or fail with a repair hint.
- Create missing XDG destination directories with private permissions: `0700`.
- Create user-scoped stores with private permissions: directories `0700`, files `0600`.
- Validate and sanitize untrusted content before durable context writes.
- Bound durable context with expiration or size limits unless the owner explicitly accepts unbounded retention.
- Redact secrets, cookies, tokens, raw auth-bearing URLs, and private payload values before writing.
- Define retention and deletion behavior for logs, checkpoints, cursors, indexes, and projections.
- Keep secrets in the credential owner; store only references or secret presence metadata elsewhere.

## Research Anchors

- XDG Base Directory Specification: `https://specifications.freedesktop.org/basedir/latest/`
  - Checked: 2026-06-08 with Firecrawl.
  - Use for XDG config, data, state, cache, runtime, defaults, absolute-path handling, and directory creation.
- OWASP AI Agent Security Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html`
  - Checked: 2026-06-08 with Firecrawl.
  - Use for agent memory validation, sanitization, isolation, sensitive-data audit, expiration, and size-limit gates.

## Runtime Store Add-ons

- If agents rely on mutable state, name the status owner.
- If state can go stale, name the refresh owner.
- If writes can partially fail, name the repair owner.
- If data is query-heavy, name inspect, backup, migration, deletion, and status owners.
- Add schema/check ownership only when agents rely on fields or repeated privacy-invalid writes show manual gates are failing.

## Write Gates

- Gate durable writes by owner path and allow-listed writer.
- A foreground agent may apply a scoped durable write when the user explicitly
  requested it and the selected owner permits it.
- Delegated, background, or ambiguous agents propose durable context changes
  unless their handoff explicitly grants owner-scoped write authority.
- Require data class, owner, target path, diff or preview, and write reason before mutation.
- Route durable writes through a curator, skill driver, or accepted owner workflow.
- Record mutation evidence: writer, path, timestamp, data class, source evidence, and content hash when practical.
- Expose no-mutation evidence for blocked writes.

## Next Safe Action

- If owner is unclear, ask one ownership question.
- If privacy, durability, write authority, or side-effect stance is unclear, ask one question.
- If the storage choice is unresolved and affects ownership, privacy, durability, or side effects, use `decision-mode` or `grill-with-docs`.
- If the context is an accepted repo decision, use `record-decision`.
- If the context is project tracker state or unresolved work state, patch the scoped TASKS.md or project tracker.
- If accepted storage choice requires a runtime-backed skill capability, use `skill-author`.
- If storage requires a new or changed agent-facing CLI surface, use `cli-author` inside the `skill-author` runtime-backed path.
- If the context is only hot startup guidance, patch hot startup guidance and point to the durable owner.
