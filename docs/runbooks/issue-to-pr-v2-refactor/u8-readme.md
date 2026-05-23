# Runbook: V2 README as a human index (U8)

**Seam:** A new human-facing README at
`runbooks/issue-to-pr-v2/README.md` plus two tightly scoped pointer
updates in references that share text with what the README owns. U8's
README is a *finder*, not a policy manual: it points maintainers at the
v2 hot router, the per-stage references, the templates, the CLI surface,
and the ledger template — and it explicitly does NOT redefine any of
them. The v1 README at `runbooks/issue-to-pr/README.md` stays the
runnable reference until U9's public cutover.

**Central risk: competing source of truth.** The v1 README grew into
a 459-line workflow manual that duplicates Builder dispatch, turn
protocol, fix protocol, risk classification, glossary, and ledger
schema prose already owned by the hot router and references. U8's
README must NOT inherit that role. Every detail that already lives in
the v2 hot router (`issue-to-pr.md`), a reference (`references/*.md`),
a template (`templates/*.md`), `lib/contract.ts`, the U6 ledger
template, or the CLI HELP_DATA must be replaced with a pointer — not
restated. The seam succeeds when a maintainer can scan the v2 README,
find the right artifact in under a minute, and ALWAYS leave for that
artifact to learn how the system actually behaves.

**Ledger:** [u8-readme-ledger.md](u8-readme-ledger.md)

**Invocation:** see [README.md - Invocation](README.md#invocation).

**Turn protocol:** see [README.md - Turn protocol (shared)](README.md#turn-protocol-shared).

## Files in scope

**Writable (this seam's contract surface):**

- `runbooks/issue-to-pr-v2/README.md` (new; the v2 human index — purpose,
  installed path, invocation examples, driver compatibility, file map,
  helper execution context summary, compatibility notes, and an explicit
  "what this area deliberately does not do" pointer list)
- `runbooks/issue-to-pr-v2/references/ledger-and-helper.md` (modify:
  trim any prose that duplicates what the v2 README now owns — the
  installed path narration and helper invocation example specifically;
  keep the ledger schema overview, the route ids catalog, the
  runbook-version skew table, and the helper execution context section
  intact)
- `runbooks/issue-to-pr-v2/references/host-adapters.md` (modify:
  align the "Run helpers from the target repo root" narration with the
  v2 README's helper execution context summary; do NOT relocate or
  restate host-readiness policy — that stays the reference's domain)

**Read-only (U2/U3/U4/U5/U6/U7 surface — preserve verbatim):**

- `runbooks/issue-to-pr-v2/issue-to-pr.md` (U7 hot router — the README
  points at it; the README does not duplicate any of its prose)
- `runbooks/issue-to-pr-v2/cli.ts` and `runbooks/issue-to-pr-v2/decompose.ts`
- `runbooks/issue-to-pr-v2/lib/*` (every module + test)
- `runbooks/issue-to-pr-v2/references/stage-1-pick-issue.md` through
  `stage-6-ship.md`
- `runbooks/issue-to-pr-v2/references/builder-dispatch.md`,
  `findings-and-validators.md`, `regression-matrix.md`
- All `runbooks/issue-to-pr-v2/templates/*.md`
- `runbooks/issue-to-pr-v2/issue-N-ledger.template.md` (U6 template)

**Read-only (v1 sources — frozen until U9's public cutover):**

- `runbooks/issue-to-pr/README.md` (the human reference U8 supersedes
  IN SHADOW; the v1 README itself stays runnable and untouched in this
  seam — U9 owns any v1 pointer to v2)
- `runbooks/issue-to-pr/issue-to-pr.md`
- `runbooks/issue-to-pr/issue-N-ledger.template.md`
- `runbooks/issue-to-pr/decompose.ts`

**Read-only (anchors — this seam consumes them):**

- `docs/plans/2026-05-22-002-refactor-issue-to-pr-v2-runbook-plan.md`
  (U8 plan section)
- `runbooks/issue-to-pr-v2/references/regression-matrix.md` (U1 anchor)

## What U8 is NOT — explicit anti-list

These belong to other units and must not be implemented here:

- **Public cutover (U9 territory).** U8 lands the shadow v2 README; U9
  flips public install pointers from v1 to v2. U8 must NOT modify the
  v1 README and must NOT change any installation script or symlink.
- **Regression probes (U9).** U8 documents what exists; U9 exercises
  it.
- **New `lib/*` modules.** None. U8 is a prose seam.
- **CLI envelope shape or command additions.** Frozen.
- **Hot router prose edits.** The U7 hot file is read-only here. If
  U8 finds a gap in the hot router, file a finding against U7's
  follow-on backlog — do NOT amend the hot file in this seam.
- **Ledger write paths.** The CLI remains read-only per ADR 0002.
- **New routing semantics.** Every routing decision stays in
  `classifyRoute` (lib/route.ts) and the hot router's prose.
- **Duplicating policy content.** This is the seam's central
  anti-pattern. Any section in `runbooks/issue-to-pr-v2/README.md`
  that restates Builder dispatch policy, turn protocol, fix protocol,
  risk classification, finding lifecycle, ledger schema fields,
  glossary terms, persona selector logic, or escape-hatch semantics is
  a P0 finding. Pointers only.

## Suggested reviewer personas

Always-on (every sweep):

- `compound-engineering:ce-correctness-reviewer` — does the README's
  invocation example actually work? Does the file map list every
  user-visible artifact under `runbooks/issue-to-pr-v2/`? Do the
  ownership claims match where the content actually lives?
- `compound-engineering:ce-api-contract-reviewer` — does the README
  reference the v2 `cli.ts` command names and the documented envelope
  facts verbatim? Are there any leaks of decompose.ts flag names that
  the hot router and Stage 3 reference have already migrated off?
  Does it cite the U6 install topology (`references/`, `templates/`,
  `cli.ts`, `lib/`) using the same field names as the
  `installed_artifact_presence` envelope?
- `compound-engineering:ce-scope-guardian-reviewer` — does the diff
  respect the anti-list (no v1 README edits, no hot router edits, no
  policy restatement)?
- `compound-engineering:ce-testing-reviewer` — are the four
  plan-listed test scenarios (finds invocation, finds ledger
  location, README does not define Builder dispatch policy, README
  does not repeat ledger schema fields) covered by either a search
  probe in the README itself or a regression-matrix anchor?
- `compound-engineering:ce-maintainability-reviewer` — does the
  README make ownership obvious for orchestration (hot router),
  deterministic commands (CLI), runtime contracts (lib/contract.ts +
  packet templates), references (per-stage prose), install topology
  (U6 + install.sh), and compatibility behaviour? Does it avoid
  becoming a competing source of truth?

Conditional:

- `compound-engineering:ce-project-standards-reviewer` — added when
  the README diff touches conventions Nathan's CLAUDE.md / AGENTS.md
  encode (Mermaid-for-flows, no em-dash policy on human-comms
  surfaces, frontmatter rules).

## ADR guardrails

- **ADR 0001 (Orchestration / mechanic split).** The README is a
  finder, not a workflow runner. The hot router owns orchestration;
  the CLI owns mechanics; the references own policy. The README
  points at all three but defines none.
- **ADR 0002 (CLI emits facts, not orchestration).** Preserved. The
  README must describe the CLI's role as a fact emitter, never as an
  imperative command list.
- **R-no-orchestrator-CLI.** Preserved.
- **R4 (README is human-facing, not agent-facing).** The README is
  read by maintainers searching for the right file. Agents read the
  hot router, the references, and the templates — never the README.
- **R10 (preserve U3/U4/U5/U6/U7 split).** No new lib re-exports, no
  prose that lives in the hot router or references.
- **R11 (runbook_version contract).** When the README mentions
  `runbook_version: "2"`, it must point at the U6 template and the
  continuation-evidence shape in `references/ledger-and-helper.md` —
  not restate the four-state skew table.

## Per-snapshot contracts (MUST include / MUST NOT leak)

### File map (MUST include exactly these entries)

The README's file map must enumerate, in this order, every artifact a
maintainer needs to find without grepping:

1. `issue-to-pr.md` — the v2 hot router (U7). Points at it as the
   single orchestration entry for agents.
2. `cli.ts` — the v2 read-only fact emitter (U4/U5/U6). One sentence
   per command (state, next, contract, diagnose, packet) with the
   role each plays; defers to `cli.ts --help --json` for the full
   contract.
3. `decompose.ts` — the deterministic helper for plan parsing,
   digest computation, AC coverage, findings validation, and patch
   proposal validation. One sentence per command family.
4. `lib/` — implementation modules behind the CLI. Brief one-line
   role for each: `contract.ts`, `cli-envelope.ts`,
   `cli-diagnostics.ts`, `ledger.ts`, `digest.ts`, `validate.ts`,
   `route.ts`, `packets.ts`. The README does NOT restate the public
   API of any module.
5. `references/` — per-stage prose. List filenames only; the read
   trigger lives in each reference's own header.
6. `templates/` — packet templates rendered by `cli.ts packet`.
   List filenames only.
7. `issue-N-ledger.template.md` — the U6 ledger template (declares
   `runbook_version: "2"`). One sentence pointing at
   `references/ledger-and-helper.md` for the ledger schema.

### "What this area deliberately does not do" (MUST include)

A short bulleted list pointing maintainers AT the right artifact for
each topic the v1 README used to cover inline:

- "Builder dispatch policy lives in `references/builder-dispatch.md`."
- "Turn protocol lives in the v2 hot router at `issue-to-pr.md`."
- "Fix protocol lives in
  `references/findings-and-validators.md`."
- "Risk classification lives in
  `references/findings-and-validators.md`."
- "Ledger schema lives in `references/ledger-and-helper.md` and the
  ledger template."
- "Glossary terms live in each owning artifact (no central
  glossary)."
- "Persona selector and broad-reviewer fallback live in
  `references/findings-and-validators.md`."

### Invocation section (MUST include)

- Exact `bun` command invoking the installed v2 hot router file via
  the `~/.claude/runbooks/issue-to-pr-v2/issue-to-pr.md` path.
- One line on `/goal` driver compatibility and one line on `/loop`
  fallback — pointing at the seam README's "Driver: /goal vs /loop"
  section for the comparison rather than restating it.
- Installed path: `~/.claude/runbooks/issue-to-pr-v2/` resolves
  through the install symlink into this repo. Reference the U6
  install topology check (`cli.ts state --json` reports
  `installed_artifact_presence.all_present`).

### Helper execution context (MUST include)

- One paragraph: helpers are pure, read-only, and must run from the
  target repo root. Point at
  `references/ledger-and-helper.md#helper-execution-context` for the
  full rule.
- One bullet: "Use the MCP runners (`bun_runTests`, `tsc_check`,
  `biome_lintCheck`) where they fit; shell fallback is allowed when
  they don't" — pointing at Stage 6 for the resolution order.

### MUST NOT leak

- **No restated policy.** Any restatement of Builder authority,
  Validator persona logic, escape-hatch rules, finding lifecycle, AC
  extraction heuristics, batch contract schema, or stage transition
  rules. Every appearance must be a single-sentence pointer.
- **No ledger schema fields.** The README must NOT list frontmatter
  fields, batches YAML shape, or findings YAML shape. Those live in
  `references/ledger-and-helper.md` and the U6 template.
- **No CLI envelope shape.** The README must NOT enumerate
  `state_response_shape`, `diagnose_response_shape`,
  `packet_response_shape`, or the U4 envelope fields. Those live in
  `cli.ts --help --json` and HELP_DATA.
- **No decompose.ts flag matrix.** The README must NOT enumerate
  every helper flag. List command families (digest, validate,
  patch-proposal) with one sentence each.
- **No persona / hatch enumeration.** Those live in
  `references/findings-and-validators.md`.

### README size budget

**MUST hold:**

- `runbooks/issue-to-pr-v2/README.md` is within 150-250 lines OR
  carries a worked overflow enumeration explaining why a specific
  ownership claim required more lines. (For context: the v1 README
  is 459 lines and is precisely the anti-pattern this seam avoids.)

**MUST NOT happen:**

- Cutting ownership clarity to fit the budget.
- Inlining anything that belongs in a pointer.

## Scoped audit prompt

````
Review U8 v2 README at `runbooks/issue-to-pr-v2/README.md` plus the
two writable references (`references/ledger-and-helper.md`,
`references/host-adapters.md`). The README is a maintainer-facing
index, not a workflow manual.

Audit items:

1. Does the README enumerate every required file-map entry
   (issue-to-pr.md, cli.ts, decompose.ts, lib/, references/,
   templates/, issue-N-ledger.template.md) in the documented order?
2. Does the README restate any Builder dispatch policy, turn
   protocol, fix protocol, risk classification, finding lifecycle,
   ledger schema, glossary term, persona selector, or escape-hatch
   semantic? Every appearance must be a single-sentence pointer.
3. Does the "what this area deliberately does not do" section
   point at the correct owning artifact for each topic v1's README
   used to cover inline?
4. Does the invocation section show the correct
   `~/.claude/runbooks/issue-to-pr-v2/` path and reference the U6
   install topology check?
5. Does the helper execution context paragraph point at
   `references/ledger-and-helper.md` for the full rule rather than
   restating it?
6. Is the README within the 150-250 line budget OR does it carry a
   worked overflow enumeration?
7. Are there any leaks of decompose.ts flag names, CLI envelope
   shape fields, ledger frontmatter fields, persona names, or hatch
   names that should have stayed in the owning artifact?
8. Does the diff respect the anti-list (no v1 README edits, no hot
   router edits, no policy restatement, no new lib modules, no CLI
   envelope changes)?
9. Are the trims to `ledger-and-helper.md` and `host-adapters.md`
   scoped to the README ownership boundary (installed-path narration
   and helper invocation example specifically), without touching
   the ledger schema, route ids catalog, runbook-version skew
   table, helper execution context section, or host-readiness
   policy?

Severity:
- P0: restated policy content in the README; v1 README edit; hot
  router edit; ledger schema field enumeration; CLI envelope shape
  enumeration; new routing semantic introduced.
- P1: missing file-map entry; missing required "what this area does
  not do" pointer; invocation path wrong; helper execution context
  restated instead of linked.
- P2: budget overflow without worked enumeration; pointer to the
  wrong owning artifact; persona / hatch / flag name leaked.
- P3: minor formatting.

Return findings with stable kebab-case signatures (e.g.
`readme-restates-turn-protocol`, `file-map-missing-templates-dir`,
`invocation-wrong-installed-path`).

Do NOT propose edits to v1 `runbooks/issue-to-pr/` files. Do NOT
propose edits to the U7 hot router. Do NOT propose new CLI envelope
fields. Do NOT propose new lib modules.
````

## Closing a finding without fixing it

Seam-specific close reasons:

- `not-in-u8-scope` — finding belongs to U9 (public cutover) or to
  a U7 follow-on backlog (hot router gap).
- `deferred-to-u9-cutover` — finding is about flipping public
  invocation pointers from v1 to v2.
- `deferred-to-u9-probes` — finding is about exercising the
  documented surface with a regression probe.

## /loop fallback

```
/loop 5 Follow docs/runbooks/issue-to-pr-v2-refactor/u8-readme.md.
Re-read the runbook and u8-readme-ledger.md at the start of every
turn. Echo the full ledger status table inline at the end of every
turn.
```
