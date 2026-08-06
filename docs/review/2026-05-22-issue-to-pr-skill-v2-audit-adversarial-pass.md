---
title: "Issue-to-PR Skill V2 Audit — Adversarial Pass"
type: review
status: draft
date: 2026-05-22
reviews: "docs/review/2026-05-22-issue-to-pr-skill-v2-audit.md"
---

# Issue-to-PR Skill V2 Audit — Adversarial Pass

## Framing

This is an adversarial second pass, not a quality assessment. The primary audit (`docs/review/2026-05-22-issue-to-pr-skill-v2-audit.md`) is well-organized and largely directionally right; this review's job is to stress-test the premises it leaves implicit, attack the load-bearing design choices (the 250-350 line hot path, the 16-reference fan-out, the XML packet strategy), surface failure modes the audit does not consider, and challenge specific claims that look weaker on a second read than the audit assumes. Where the audit holds up, it gets a short note at the end. Where it does not, it gets argued against in detail.

---

## Premise attacks

### P1. The 250-350 line hot-path budget is not derived; it is asserted

The audit's central proposal lives in lines 127-129 and 380-389: rewrite `issue-to-pr.md` as a state router under 250-350 lines, with each stage reference at 80-180 lines and Builder/Validator references at 150-220. That number is presented as if `write-a-skill` mandated it. It does not. `write-a-skill` recommends under 100 lines for a formal `SKILL.md`, which is a different artifact, and the audit explicitly says (lines 38, 375) that issue-to-pr.md is a runbook, not a formal Codex skill. The 250-350 figure is therefore a budget chosen to feel "small enough to read fast," not a budget derived from what this workflow actually has to encode.

Look at what the current file actually carries as non-negotiable invariants. Just the rules that *must* be true on every turn before any action:

1. Clean working tree precondition between stages (`issue-to-pr.md:257-272`).
2. Resumed-turn helper invocation and the four state values it can return (`:282-294`).
3. Digest recomputation rules and their exact field scope (`:296-311`).
4. Target-repo-root cwd contract for the helper (`:313-317`).
5. Branch preflight gates and the "no ledger mutation on default branch" rule (`:325-368`).
6. Six escape hatches with trigger conditions (`:1180-1188`).
7. Inner-loop iteration cap and Builder readiness re-verification (`:1016-1024`).
8. The host-readiness vs. infrastructure-failure distinction with two `blocked_reason` codes (`:687-694`, `:1027-1034`).
9. Six-stage stage-transition contract (one stage or one ledger checkpoint per turn).
10. Builder authority boundary including `batch.files` discipline and one-finding-per-fix.

Even compressed to a sentence each, with no examples, no helper command lines, no failure-mode tables, no router diagram, no reference-loading table, that core invariant set is already 60-80 lines of dense prose. Add the resumed-turn algorithm, the state router table, the reference-loading map, the six-stage shell with inputs/exit conditions/load triggers, plus the proposed Mermaid router diagram, and the floor is more like 350-450 lines, not 250-350. The audit's example skeleton (`:485-519`) is 35 lines, but it elides exactly the safety-critical material that the current file's bulk exists to enforce. It is a vibes-budget, not a budget. The audit should either show a worked example of a 300-line file that preserves all ten invariants, or revise the target up to "under 500 lines."

### P2. "One-level references" will not survive contact with reality

The audit insists on this rule three times (`:316, :846, :886`): every reference must be one level deep from the hot file. But the audit's own proposed file layout contradicts that constraint within itself.

- `references/stage-4-batch-loop.md` describes the outer loop. The outer loop dispatches Builder. Builder dispatch lives in `references/builder-dispatch.md`. Builder commits trigger persona dispatch. Persona dispatch lives in `references/validator-loop.md`. The validator-loop persists findings whose lifecycle lives in `references/finding-lifecycle.md`. That is four references chained, all reachable only through Stage 4.
- `references/stage-5-final-review.md` routes open P0/P1 to `references/final-review-patch-batches.md`, which in turn requires reading `references/builder-dispatch.md` (because the patch-proposal dispatch is a proposal-only Builder), `references/helper-contract.md` (for the `--patch-proposal` validation), and then routes back to Stage 4. That is also four-deep, with a backward edge.
- The replacement-batch flow at `issue-to-pr.md:213-247` is in scope for Stage 4 but also mutates Stage 3-confirmed batch contracts. Under the audit's split, the agent has to hold `builder-dispatch.md` + `helper-contract.md` + `ledger-contract.md` + `stage-3-decompose.md` open simultaneously to action one replacement batch.

The audit's mitigation is "make reference loading explicit in each stage step" (`:855-859`). That does not solve depth; it solves discoverability. A workflow whose hot path links to four references that each link to two more is not progressive disclosure, it is a graph with a thin entry node. The "one level" framing makes the reference layer feel disciplined, but the *workflow* has natural chains: stage routes to role, role routes to schema, schema routes to helper. The audit needs to either (a) accept multi-hop references explicitly and design for the chain, or (b) collapse some references back into the hot path because the chain is unavoidable.

The honest version of the recommendation is: "one level for *static lookup* references (persona-selector, finding-lifecycle, helper-contract index, host-adapters); chained references are expected for *active orchestration* references (Stage 4, Stage 5, Builder, Validator)." The audit pretending the chain is avoidable produces a false promise.

### P3. 16 references plus 5 templates is itself a new form of bloat

Counting from the proposed layout (`:336-358`): 16 reference files plus 5 templates plus the README plus the hot file plus the helper plus the test plus the ledger template. That is 26 artifacts before any actual work happens. The audit treats this as a clear win because *each* file is small. But cognitive load is not "lines per file"; it is "files I have to know exist and remember when to load."

Consider the operator's day-30 mental model under v2:

- Six stage references (`stage-router`, `stage-1` ... `stage-6`).
- Two role references (`builder-dispatch`, `validator-loop`).
- One sub-playbook (`final-review-patch-batches`).
- Three contract references (`helper-contract`, `ledger-contract`, `host-adapters`).
- Three lookup references (`persona-selector`, `finding-lifecycle`, `issue-shape`).
- Five templates (`ce-plan-addendum`, `builder-work-packet`, `builder-return-envelope`, `validator-envelope`, `patch-proposal`).

That is 20 distinct documents whose load triggers an agent has to disambiguate. The audit's reference-loading table (`:502-509`) shows five rows. The actual mapping from durable state to "which file do I read now" has at least twelve distinct branches once you enumerate (no-ledger / AC-pending / AC-stale / plan-missing / batch-pending / batch-stale / Stage-3-blocked / batch-eligible / batch-in-progress / final-review / patch-batch / final-shipped / Stage-6-local-check-failure). The proposed five-row table elides eight of those.

The audit should explicitly answer: does v2 reduce the *total* cognitive load, or just spread it over more files? A useful heuristic test: if the operator had to staff a teammate to take over an in-flight issue on day-30, would they hand them v1 prose or v2's 20-file map? It is not obvious v2 wins that test. The audit assumes it does and does not show its working.

### P4. The "agents will follow 'read X before doing Y' pointers" assumption is unvalidated

The audit's whole premise rests on this assumption. It surfaces explicitly at `:240` ("In hot path, say: 'Before Builder dispatch, read references/builder-dispatch.md and fill templates/builder-work-packet.md.'") and again at `:856-859` ("Make reference loading explicit in each stage step. Use templates for dispatch payloads so the agent has to load the right asset.").

What evidence does the audit cite that agents reliably do this? None. The progressive disclosure pattern in `write-a-skill` is a *recommendation*; the audit does not point to a prior runbook v2 in this repo, or another skill where one-level references were demonstrated to reduce error rates or improve resume behavior. The closest the audit gets is R3 ("Agents Might Skip References", `:854-860`), which acknowledges the risk and mitigates it with... more pointers.

The current `issue-to-pr.md` itself shows agents do not reliably follow pointers. It links to `docs/brainstorms/2026-05-21-issue-to-pr-builder-sub-agent-requirements.md` at least four times (`:65, :96, :214, :500`) for "sourced from" content. The audit correctly notes (F8, `:307-311`) that this is provenance, not operational reference, and that "agents will either read too much or miss the relevant details." But it then proposes 16 references and waves away the same failure mode with "make load triggers explicit."

If pointer-following is unreliable, v2 makes the failure mode worse, not better, because the hot file no longer contains the safety rules that the agent might still execute correctly even if they ignored the pointer. Today, an agent that skims the runbook still encounters the iteration cap, the Builder authority boundary, the digest re-check rules, and the escape hatches, inline. Under v2, an agent that skims `issue-to-pr.md` and skips `references/builder-dispatch.md` will dispatch Builder without the authority contract. The audit's failure mode under "agents skip references" is silently weaker correctness, not louder failure.

The audit needs either (a) a validation plan that proves pointer-following works at acceptable error rates for this workflow's safety load before recommending extraction, or (b) a stricter design constraint: any rule whose violation produces silent incorrectness must stay inline, even if it costs hot-path lines. Right now the audit assumes (a) and recommends extraction of rules in category (b).

---

## XML strategy attacks

The XML section (`:391-454`) is the audit's most consequential design choice because it directly shapes Builder and Validator dispatch. Three problems.

### X1. The XML/no-XML boundary is arbitrary, not principled

The audit's table (`:405-411`) draws the boundary as: tags for Builder Work Packet, Validator prompt, patch proposal; partial tags for ce-plan addendum; no tags for the hot path or for helper-validated YAML/JSON. The stated reason is "tags add noise where the model does not need boundary clarity."

But look at the actual artifacts the audit calls "tagged":

- Builder Work Packet content (`:413-452`) includes `<role>`, `<authority>`, `<batch_contract>`, `<allowed_files>`, `<target_finding>`, `<required_reads>`, `<stop_conditions>`, `<output_contract>`. Eight tags.
- The `<batch_contract>` payload (`:425-428`) is YAML inside XML. So is presumably the ledger context, the prior `builder_attempts` summary, the findings rows for the batch. The XML is wrapping content that already has structure (YAML keys, JSON envelope).

Either XML is being used as a section delimiter (in which case Markdown headings work equally well, and the YAML payload is already self-delimited), or XML is being used as a parseable structure (in which case the helper, not the agent, should be producing and consuming it). The audit picks neither and instead leaves Builder to *interpret* the XML semantically. That is exactly the case where Anthropic's prompt-engineering guidance says XML *might* help with boundary clarity, but it is also the case where there is no falsifiable test for whether XML beats Markdown headings beats `---` separators beats `## Authority` sections.

The audit does not show a Builder run that misbehaved under Markdown sections and behaved better under XML. It does not cite the prompt-engineering guidance it is leaning on. A staff-engineer review of this choice should at minimum (a) define the failure mode XML is supposed to prevent (Builder reading the `<batch_contract>` block as authority instead of evidence? Builder treating `<required_reads>` as optional?), and (b) show that the failure mode exists under the no-XML version. Without that, XML in the Work Packet is cargo-culted from public Anthropic guidance about long-context reasoning, applied to a short-context dispatch payload where the benefit is unproven.

### X2. The proposed tag granularity is wrong in at least two places

Even granting the XML premise, the proposed tags do not survive scrutiny:

- `<role>` and `<authority>` should be one tag, not two. The audit's example puts the role string ("You are Builder for exactly one Issue-to-PR batch attempt.") in `<role>`, and the authority string ("You may edit only files listed in `<allowed_files>`. If the contract is stale or unsafe, return a fail-stop envelope before editing.") in `<authority>`. But the authority statement is the role definition. Splitting them risks the model treating `<role>` as identity-flavor text and skimming `<authority>` because it looks like one of N constraints. A `<contract>` block that says "you are Builder; you may edit only `<allowed_files>`; you must fail-stop if ..." is one unambiguous instruction, not two.

- `<required_reads>` is the wrong tag name for what it contains. The audit's example (`:439-443`) lists "target repo root AGENTS.md when present", "nearest package AGENTS.md when present", "every file in `<allowed_files>`". That is the Local Law Read Order. The current runbook calls it `Local Law Read Order` (`:115`). Renaming it to `<required_reads>` in the XML packet detaches it from the runbook's vocabulary, which makes the contract harder to audit. The tag should be `<local_law_read_order>` or `<read_order>`, with the same name the documentation already uses. Vocabulary drift across role packet, reference, and runbook is exactly what F7 (`:271-296`) warns against, but the XML proposal is committing the same sin.

- `<stop_conditions>` overlaps `<output_contract>`. The audit's example puts "Return fail-stop if preflight cannot prove the batch is safe..." in `<stop_conditions>` and "Return exactly one Builder envelope with status..." in `<output_contract>`. But fail-stop is a status value inside the output envelope (`fail-stop-preflight`, `fail-stop-out-of-scope`, etc., per `:184-186`). The "stop conditions" are how the Builder gets to a particular `status` value, which is part of the output contract. Splitting them invites the model to satisfy the output contract (return an envelope) without actually evaluating the stop conditions. Either both belong inside one `<envelope_contract>` tag, or `<stop_conditions>` should be folded into authority.

These are not nits. They are exactly the kind of tag-design choices that determine whether XML reduces or increases ambiguity. The audit shipped them as an example without working through whether they reduce ambiguity for the *Builder* agent reading the packet. They probably do not.

### X3. XML probably does not survive cross-host transport without escaping issues

The audit (`:719-727`) calls out host adapters for Claude Code vs. Codex but does not address XML compatibility specifically. Two concrete risks:

- Codex's dispatch primitives are not the same as Claude's Skill tool. A Builder packet that contains literal `<` and `>` characters as boundary tags, dispatched through a transport that interprets angle brackets (anything that does YAML or JSON serialization en route, e.g., a JSON-encoded skill payload, a YAML config that quotes strings), will get the tags escaped to `&lt;` and `&gt;` or rejected as malformed depending on the parser. The audit's example assumes verbatim transport.
- The Work Packet's content includes file paths and signatures that may contain `<` or `>` characters (e.g., `<finding-id>` is literal in some signatures, generic placeholders use angle brackets in this runbook's own docstrings). If the Work Packet template uses XML and one field's content includes a `<` for unrelated reasons, the XML parser sees a malformed nested tag. The audit's example at `:435-437` uses literal angle-bracket prose ("null for implementation attempts...") inside `<target_finding>`. That works only if the model is reading XML-as-prose, not parsing it.

The audit needs to specify whether tagged packets are (a) for the model to read as visual structure, or (b) for an upstream layer to parse before dispatch. If (a), Markdown headings achieve the same readability without escape problems. If (b), the audit should say which parser owns interpretation and how cross-host transport preserves it. It says neither.

### X4. The audit's "no XML for ledger YAML, JSON envelopes, Markdown references" line is defensible but understated

The audit briefly notes (`:395-401`) that XML should not replace ledger YAML, helper-validated batch YAML, JSON validator envelopes, Markdown reference docs, or human-readable stage instructions. That is the right call, but it is not justified in proportion to the rest of the section. The reason is load-bearing: those formats are already validated by `decompose.ts` (YAML schema, JSON envelope shape via the normalization rule at `:1103-1117`) or by visual review (Markdown). XML would force a second validation layer for content that already has a contract.

This argument should be the lead, not a footnote. The framing should be: *XML is fine when the content has no other contract; XML is harmful when it shadows an existing contract.* On that framing, the Work Packet (which contains the batch contract YAML, the findings rows, the prior `builder_attempts` records — all already contracted by `decompose.ts`) is mostly *not* a good XML candidate. The natural-language framing around it (role, authority, read order, output contract) is fine as XML or Markdown; the structured payload inside is already contracted and adding XML to it doubles the contract surface. The audit's recommendation to wrap the whole packet in XML therefore mixes two different decisions: framing prose (XML maybe helps) and structured payload (XML actively hurts by competing with the existing contract).

---

## Missing failure modes

The audit's Risks section (`:835-877`) enumerates five risks: over-splitting hides safety rules, behavior drift during extraction, agents skip references, README-runbook competition, host abstraction. It misses several concrete failure modes that v2 introduces.

### M1. Partial migration state

If v2 lands incrementally (Phase 1 extracts some references but not all, per `:747-759`), the hot file is in a half-extracted state where some sections are pointers to references and some are inline. An agent loaded mid-migration sees a hot file that *looks* like a v2 router but is actually missing rules. Until every reference exists *and* every inline duplicate has been pruned, the file is strictly worse than v1: it has pointers (low signal in isolation) plus residual inline rules (full signal) plus drift risk between the two.

The audit's Phase 1 deliverable (`:758`) is "drops below 600 lines with no intended behavior change." That is a midway state by definition: at 600 lines, some content has been pulled out but not all. The audit should specify whether v2 is a single atomic landing or a series of feature-flagged states, and what the resume contract is for an agent that picks up an in-flight issue during the transition. Right now there is no answer.

### M2. Installed copy vs. repo source

The installed runbook at `~/.claude/runbooks/issue-to-pr/` is referenced as the operational source throughout `issue-to-pr.md` (`:285, :309, :310, :311, :414, :432, :510, :540, :555, :580, :582, :632, :635, :778, :869, :1149, :1162, :1287`). The repo source at `runbooks/issue-to-pr/` is what gets edited. The audit's file layout section (`:329-358`) is silent on which copy the references live in.

The current state on disk (per `ls ~/.claude/runbooks/issue-to-pr/`) shows the installed copy has its own `decompose.ts`, `decompose.test.ts`, `issue-to-pr.md`, `README.md`, and `issue-N-ledger.template.md`. There is no `references/` directory installed yet. Under v2, the installed copy needs to either (a) ship the full reference tree, with all 16 references and 5 templates kept in sync, or (b) keep loading from a different path. If (a), the install topology now requires syncing 21+ files instead of 5. If (b), the operational `issue-to-pr.md` at `~/.claude/runbooks/issue-to-pr/issue-to-pr.md` has to use absolute references to a different location.

Concrete failure: if the install script syncs `runbooks/issue-to-pr/issue-to-pr.md` and `runbooks/issue-to-pr/decompose.ts` but not the new `references/` and `templates/` subdirectories, every Builder dispatch attempt under v2 reads "Before Builder dispatch, read references/builder-dispatch.md", goes to load it, and finds nothing. The agent then either skips the read (silently incorrect) or fails to dispatch (visible blocker). Either way the workflow is broken until the install is updated.

The audit needs an install-topology section that says: (a) which files are installed, (b) what the install script changes look like, (c) how to detect a version-skewed install. None of that is in the audit.

### M3. Test coverage during extraction

`decompose.test.ts` is 5,174 lines with 77 individual tests covering one `describe` block. Those tests cover prose-encoded invariants currently in `issue-to-pr.md`: AC coverage validation, batch contract digests, replacement batch invariants, finding lifecycle, patch proposal validation. The audit's Phase 1 plan (`:747-759`) is "extract references without rewriting semantics." But the tests test the *helper*, not the runbook prose. If extraction moves a prose rule into a reference without changing the helper, the test still passes — but the agent's behavior may not, because the agent reads the prose, not the helper code.

Worse: some invariants exist in prose *only* because they are agent-facing, not helper-checkable. Examples:

- The order in which Local Law is read (`:115-128`) cannot be helper-validated.
- The "smallest coherent diff" mechanic discipline rule (`:130-134`) cannot be helper-validated.
- The "domain language" rule (`:142-145`) cannot be helper-validated.
- The decision between `change_first-exception` and `high-risk-change_first-exception` rationales (`:535-541, :1077-1080`) is partially helper-validated (the prefix is checked) but the semantic correctness (is this actually a high-risk path?) is not.

The audit has no plan for testing whether v2 preserves these prose-encoded invariants. Phase 5 ("Forward-Test V2", `:808-821`) proposes "Run one happy-path smoke issue in a disposable repo. Run one stale-contract or replacement-batch scenario. Run one final-review patch-batch scenario." That is three integration runs against a workflow with at least twelve distinct durable states. It is not a coverage plan; it is a smoke test. A staff-engineer review should require a regression matrix that exercises each prose-only invariant under v1 and v2 to prove no behavior drift.

### M4. Concurrent in-flight issues

The current workflow assumes one issue per checkout (`README.md:425-429`). Across worktrees, multiple issues can be live simultaneously. If two operators are mid-flow on different issues and v2 lands, two things break:

- Each running agent has the v1 `issue-to-pr.md` loaded in its transcript memory. When it re-reads at the start of the next turn (per `README.md:236-247`), it now sees v2 prose and pointer-driven references. Its prior reasoning was based on inline rules; its next turn is based on the same file's pointer to a reference it has not loaded.
- The ledgers themselves are unaffected (frontmatter shape unchanged), but the routing logic the agent uses to interpret them changes mid-run.

The audit's Phase 0 ("Freeze Before Cutting", `:734-744`) does not address concurrency. It says "Capture current helper tests and runbook search checks. Record a line-map from old sections to new references. Treat v2 extraction as a behavior-preserving refactor first." That protects test coverage, not in-flight runs. The audit should either (a) require that all in-flight ledgers be drained to `shipped` or `blocked` before v2 lands, or (b) specify a compatibility window during which both v1 and v2 prose are valid for the same ledger schema.

### M5. Version skew within a conversation

Related to M4 but more subtle: a single agent's conversation may span the v2 cutover. The transcript includes the v1 prose from earlier turns. The agent re-reads at turn start (per the turn protocol). After the cutover, the re-read returns v2. The agent's working memory is now a mix: v1 detailed prose for Stage 1-3 (because it has already executed those stages) plus v2 router prose for Stage 4-6 (because it has not loaded those yet). The audit does not consider this.

This matters because the ce-plan addendum is loaded only at Stage 2 (`:551`). If Stage 2 ran under v1 with the addendum inline, and the agent is now at Stage 4 under v2 where the addendum lives in a template, the agent has a stale addendum in memory and a new template on disk. If it ever needs to re-invoke ce-plan (e.g., for replacement batches that mutate AC coverage), it will use the memory-resident v1 addendum, not the template. Whether the two are identical is left as an exercise for the operator.

The audit needs to specify: (a) is mid-conversation version skew tolerated, and if so, what is the contract, or (b) is there a versioning mechanism in the runbook (e.g., `runbook_version` in ledger frontmatter) that lets the agent detect skew?

### M6. The helper output format is a hidden contract

The audit treats `decompose.ts` as the executable contract boundary (`:59`). But `decompose.ts` outputs human-readable stdout strings, not structured data. Example: `--confirmation-state` (per `:282-294`) outputs prose like `acceptance_criteria: confirmed`, `batch_contract: pending`, `digests: pending`. The agent parses that stdout to decide routing. The audit's v2 plan strengthens helper ownership (`:794-806`) by proposing more modes (render findings table, validate Builder envelope, generate Work Packet, route current stage). Each new mode adds another prose-encoded helper-to-agent contract.

This is a failure mode the audit does not name: as helper modes multiply, the *implicit* contract between helper stdout and agent parsing becomes load-bearing. Today there are nine modes (per `decompose.ts:2096-2133`). The audit proposes adding at least four more. Without a structured-output flag (e.g., `--json`), the agent's stdout-parsing logic becomes a hidden interface that the runbook prose has to describe. The audit recommends "Keep only the helper command and expected routing result in the hot path" (`:186`), which makes the *expected output* a prose contract — and that contract is in the hot file, not the helper.

The right move (which the audit does not recommend) is to require all new helper modes ship with structured JSON output and a fixed schema. That makes the agent-helper contract testable in `decompose.test.ts` instead of in prose.

---

## Unstated assumptions

### A1. That progressive disclosure is the right pattern at all for orchestration skills

The audit assumes the answer is yes without examining alternatives. But orchestration is a state machine. A state machine printed as static prose is a different problem from a knowledge base. For knowledge bases, progressive disclosure is good: load the page you need. For state machines, progressive disclosure has a tax: the agent has to recompute "what page do I need" on every turn, from durable state, and then load it.

An alternative the audit does not consider: a runtime state machine where `decompose.ts --next-action <ledger-path>` returns the next instruction as a single short block, and the hot file is *just* the invariants plus a call to that helper. The agent never reads stage references because the helper prints the relevant fragment of stage prose tailored to current durable state. The references still exist for human authoring, but the agent does not navigate them. This trades file-layout complexity for helper complexity, but it eliminates the "agent picks the wrong reference" failure mode entirely.

The audit waves at this in Phase 4 ("Strengthen Helper Ownership", `:794-806`) but only as far as "add a helper mode to route the current stage." That mode would emit *which* reference to read, not the prose itself. That is the worst of both worlds: the agent still navigates references, and the helper still has to know which reference is current. A staff-engineer review should at least argue why the state-machine-in-helper alternative was rejected, not skip the comparison.

### A2. That `decompose.ts` should remain a TypeScript file at this size

`decompose.ts` is 87,112 bytes, 2,164 lines, with one `describe` block and 77 tests. The audit's recommendation (F3, `:163-189` and Phase 4 `:794-806`) is to push *more* into this file: render findings, validate Builder envelope, generate Work Packet, route stage. Best estimate, that adds 600-1,200 lines. The audit treats this as straightforward extension.

But `decompose.ts` is already a multi-purpose validation engine with a CLI dispatch table at `:2096-2133`. Adding four more modes turns it into a Swiss-army knife with a thin CLI. Concrete consequences:

- Test count grows from 77 to ~120, all under one `describe`. The test file is already 5,174 lines.
- Each new mode requires its own argument parsing, its own error path, its own stdout format, its own integration test, and its own prose description in the runbook.
- The single-file design makes it hard to import a subset of validators from elsewhere (e.g., if a separate Stage 3 Contract Review tool ever ships, it would want `validateLedgerBatches` without dragging in render-findings).

The audit's recommendation in F3 is structurally right (push more truth into code) but does not consider whether `decompose.ts` is still the right *shape* for that code. A staff-engineer review should at least flag: "if Phase 4 lands as proposed, `decompose.ts` will be 3,200+ lines doing nine different jobs; split it into a small package with one module per command, or accept that the helper itself needs v2."

### A3. That the README should be a "human index" rather than merged into the skill or deleted

The audit's F7 (`:271-296`) says the README is competing with the runbook and recommends making it "a human index: purpose, invocation, install path, file map, compatibility notes." But the README's most valuable content right now is precisely the material the audit wants extracted from the runbook: glossary (`README.md:299-343`), risk classification (`:278-297`), Builder dispatch overview (`:83-135`), ledger format reference (`:345-410`), turn protocol (`:236-254`), fix protocol (`:257-276`).

If those move from README into `references/`, the README has very little left. The audit's recommendation would leave README at maybe 80-120 lines of pure "what this is and how to invoke it." That is fine, but the audit does not consider an alternative: delete the README and let `issue-to-pr.md` be the single human entry point, with a tiny "this is what you are looking at" preamble. The README exists today because it predates `issue-to-pr.md` having a clean structure. Once v2 makes `issue-to-pr.md` clean, the README's reason to exist evaporates.

The audit assumes README has a permanent home. That assumption deserves an argument.

### A4. That persona-selector, finding-lifecycle, helper-contract, and ledger-contract should be four separate references

The audit (`:336-352`) splits these into four files. But they are tightly coupled:

- Persona selector triggers determine which validator fires, which determines which finding rows get produced, which lifecycle (open/fixed/superseded/deferred-P2/...) those rows pass through, which the helper validates.
- Finding lifecycle rules cite specific helper modes (`--validate-findings`, `--assert-no-open-p0p1`).
- Helper contract names the ledger schema (which the ledger-contract reference defines).

Splitting them creates a four-way fan-out where any non-trivial finding-handling question requires reading three of the four files. The audit could equally well recommend a single `references/findings-and-validators.md` that has all four sub-sections, with the helper-contract and ledger-contract being independent because they cover broader surfaces.

The audit asserts the four-way split as if it were obvious. It is not.

### A5. That XML tags survive copy-paste across tools without escaping issues

Covered under X3 above; flagging here because it is also an unstated assumption.

### A6. That a "fresh agent" exists in any meaningful sense

The audit's acceptance criterion (`:899`) is "A fresh agent can resume from a ledger and select the next action in under one screen of reading." This pre-supposes a clean test environment where the agent starts with no prior context other than the runbook and ledger. In practice every real run carries CLAUDE.md context, repo-specific instructions, user message history, tool-call history, and the cumulative effect of the operator's prior corrections. "Fresh agent" is a thought experiment, not a measurable state.

The acceptance criterion as written is unfalsifiable. The audit needs to either (a) define "fresh agent" operationally (e.g., new session, no prior conversation, no user messages other than `/goal ...`), or (b) replace this criterion with one that can be measured in real conditions ("median tokens read before first ledger write is under X" or similar).

---

## Realism of the action plan

### R1. Phase 1's "drop below 600 lines with no intended behavior change" is the hardest phase, not the easiest

The audit (`:747-759`) frames Phase 1 as a behavior-preserving refactor: move sections to references, leave pointers. But "behavior-preserving" implies the agent's behavior depends only on the canonical content, regardless of location. Two reasons that is wrong:

- Lots of rules in `issue-to-pr.md` cross-reference each other by location. Example: the Stage 4 outer loop at `:705-708` references "the inner loop (see `## Inner loop` below)." If Inner Loop moves to `references/validator-loop.md`, that cross-reference becomes "see `references/validator-loop.md`." That is a content change, not just a move, because the agent's read of "below" vs. "elsewhere" is different.
- The hot file's prose density today is uniform: each section assumes the agent just read the prior section. After extraction, the hot file becomes a router that assumes the agent loaded the right reference. That changes the *reading order* of the document for the same agent, which can change behavior.

The audit says "Keep old wording mostly intact during extraction" (`:756`), but that does not address the cross-reference shift. A staff-engineer review should require that Phase 1 ship with a regression test (per M3) before claiming behavior preservation.

### R2. Phase 4 "strengthen helper ownership" adds modes to a file that should arguably be split

Already covered under A2. Phase 4 lands four new helper modes onto an 87k file with 77 tests. The audit treats this as a small slice. It is the largest code change in the v2 plan and the one most likely to introduce regressions.

### R3. Acceptance criterion "fresh agent can resume in under one screen of reading" is not testable

Covered under A6. The audit's other acceptance criteria are mostly measurable: line count under 350, helper modes named in one place, no behavior weakening relative to ADR 0001. The "fresh agent under one screen" criterion is qualitative. Drop it or operationalize it.

### R4. The "priority cut list" (`:823-833`) is entangled, not standalone

The audit says: if only three cuts are made, extract ce-plan addendum, extract Builder dispatch + Work Packet template, extract final-review patch-batches. The framing is "these are the biggest context blocks."

But the cuts depend on each other:

- Builder dispatch extraction creates a `references/builder-dispatch.md` that the patch-batch playbook also has to point to (because patch-batch dispatch is a proposal-only Builder per `:790-865`). Extracting Builder without extracting patch-batches leaves the patch-batch section inline, but the patch-batch section is itself ~150 lines (`:790-865`) and points at Builder material.
- Extracting Builder requires the Work Packet template. The Work Packet template needs the ledger-contract reference (`:336`) for the schema of the batch contract it passes. If ledger-contract is not extracted, the template has to inline that schema, which duplicates content the audit also wants to extract eventually.
- Extracting ce-plan addendum to a template is the cleanest of the three because it is mostly self-contained, but it requires the runbook's Stage 2 step (`:451-465`) to know how to find and pass the template to ce-plan, which is a minor but real change to Stage 2 prose.

The audit's "if you can only do three, do these three" framing implies they are independent quick wins. They are not independent. They are a coherent slice that has to land together, or they introduce inconsistency.

### R5. Phase 5's smoke-test list is not coverage

Already covered under M3. Three integration runs do not exercise the twelve-state durable transition space. The audit should require either (a) a regression matrix or (b) a much larger smoke suite.

### R6. The audit underestimates the cost of running v2 in two harnesses

`references/host-adapters.md` is the only nod to Codex/Claude differences (`:716-728`). It is treated as a small reference file. But the actual gap between hosts shows up across the runbook:

- Skill name resolution (`README.md:144-156` and `issue-to-pr.md:1091`) differs between slash-command hosts (Claude) and Codex.
- "Fresh Builder sub-agent" semantics (`:55-57`) maps to different primitives.
- Top-level invocation of `/ce-plan` (`:453-465`) and `/ce-code-review` (`:748-762`) is host-specific.
- Tool-call serialization (which the audit nods at in builder-infrastructure-failure handling, `:1027-1034`) is host-specific.

If `host-adapters.md` ends up small (the audit's implied target is "80-180 lines" per the reference budget), it will not actually cover all those gaps. The honest scope is closer to 250-400 lines, plus host-specific worked examples. The audit should size this reference appropriately.

---

## Where the audit may be wrong

### W1. `decompose.ts` is not the right "executable contract boundary"; it is doing too much already

The audit (`:59, :163-189, :565-576`) treats `decompose.ts` as the right place to push more truth. But `decompose.ts` already mixes:

- AST-style validation (DAG, AC coverage, batch contract shape).
- Persistence checks (ledger frontmatter, fenced YAML extraction).
- Digest computation (plan, AC, batch contract).
- Cross-document invariants (finding-to-batch references, supersedes referential integrity).
- Git reachability checks (`builder_commits` must be reachable from HEAD).
- Workflow routing (`--confirmation-state` is a routing decision, not a validation).

The first three are validation. The last three are different concerns: persistence, integrity, and routing. The audit's recommendation to add render-findings-table, normalize-Validator-envelope, validate-raw-Builder-envelope, and route-current-stage to `decompose.ts` extends this mixed responsibility further. A staff-engineer counter-recommendation:

- Split `decompose.ts` into `validate.ts` (schema validators), `digest.ts` (content hashing), `ledger.ts` (persistence and integrity), and `route.ts` (workflow routing).
- Each module has its own test file under 1,500 lines.
- The CLI dispatch becomes a thin shim that picks the right module per flag.

The audit's "executable contract boundary" framing was right at v1's scale. At the proposed v2 scale, the helper itself needs its own v2.

### W2. Splitting Stage 5 into its own playbook is the wrong move; Stage 5 should be smaller, not isolated

The audit (`:191-215`) flags Stage 5 as a nested workflow and recommends extracting its patch-batch protocol into `references/final-review-patch-batches.md`. Severity P1.

Counter-argument: Stage 5's complexity comes from doing two distinct jobs in one stage. The `/ce-code-review` invocation plus mechanical-diff fallback plus persona dispatch (`:740-773`) is one job, equivalent to the inner loop's Validator dispatch. The patch-batch proposal-only Builder dispatch plus user confirmation plus return-to-Stage-4 (`:790-865`) is a second job, equivalent to Stage 3's plan-confirmation gate plus a constrained Stage 4 batch.

The right move is not to extract the patch-batch protocol. The right move is to *eliminate* it as a Stage 5 concern. A final-review finding that needs a fix is a Stage 4 problem, not a Stage 5 problem. Stage 5 should just say "if open P0/P1 final findings, create one or more patch batches and return to Stage 4." The patch-batch proposal mechanics are then a Stage 4 sub-flow (or a generalization of the replacement-batch flow from Stage 4 already). Stage 5 becomes 30 lines, not 150.

This is a deeper restructuring than the audit proposes. It is also strictly better because it (a) reduces Stage 5 prose without hiding it in a playbook, (b) reuses the existing Stage 4 patch-batch convergence mechanics, and (c) treats final-review findings as just another batch in the DAG. The audit's "extract into a playbook" move preserves Stage 5's mixed responsibility; the better move dissolves it.

### W3. Builder/Validator separation is *not* "sound"; it leaks under proposal-only dispatch

The audit (`:216-239`) describes Builder dispatch as architecturally correct and recommends preserving the boundary. Counter: the proposal-only Builder dispatch (`:790-865`) is the case where the boundary leaks.

A proposal-only Builder is read-only. It does not commit, does not edit, does not append `builder_attempts`. It exists solely to produce a patch-batch YAML for human confirmation. That is not a Builder role; it is a "planner" role with Builder's read authority. The current runbook calls it "Builder" because it shares the Builder's deterministic-probe catalog and Local Law Read Order, but it does not share the Builder's authority to commit.

Two evidences this is a role boundary leak:

- The proposal Work Packet (`:802-806`) explicitly excludes the full plan, full ledger, and unrelated raw Validator envelopes. That is a Work Packet shape, but the *output* is a candidate batch contract, not a commit. The Work Packet shape is being reused for an output type it was not designed for.
- The Builder envelope at `:181-211` defines six possible statuses. None of them match "produced a candidate proposal." The runbook works around this by treating the proposal as evidence-only data passed back through the existing envelope shape with status... what, exactly? The runbook does not say. It implies (`:816-820`) the Orchestrator reads the proposal output and validates it via `--patch-proposal`, but the actual envelope status for a successful proposal-only dispatch is unspecified.

If the audit is going to call Builder dispatch architecturally sound, it should address this leak. The honest framing is "Builder dispatch is sound for *implementation* attempts; proposal-only dispatch is a different role that has been folded into Builder for convenience." V2 should either (a) introduce a distinct `Proposer` role with its own envelope, or (b) accept the leak and document it explicitly. The audit does neither.

### W4. The 1,293-line file is mostly the right size; the problem is internal structure, not total length

The audit's opening framing (`:36-38`) is that 1,293 lines is "far beyond the size where agents can reliably hold the live route, current ledger state, target repo context, plan, issue body, and review output together." That is presented as obvious. It is not.

Counter-evidence: the existing runbook *works*. There are no incident reports cited in the audit of agents over-reading or under-reading or misrouting because of the file's length. The audit's evidence (`:107-129`) is structural ("the stage router starts around line 276, but the first 247 lines are scope, reviewer lists, ADR guardrails, role boundaries"), not behavioral.

Two non-trivial counter-positions:

- The right intervention may be reordering, not extraction. If the resumed-turn algorithm moves to the top of the file (immediately after a one-paragraph purpose), the stage router becomes the first executable section, and the Builder/Validator contracts move down to "loaded when needed" position within the *same file*, the perceived hot path shrinks without any reference extraction. The audit briefly nods at this (`:833`) but treats it as a fallback if "only one structural improvement is made."
- The right total length budget for this workflow's safety load may genuinely be 1,000-1,200 lines. The audit's 350-line target is asserted from `write-a-skill` guidance for a different artifact type. A staff-engineer review should at least entertain "the file is the right length; the structure is wrong" as a hypothesis.

The audit jumps from "structure is wrong" to "extract heavily" without examining "reorder and accept the length."

---

## What the audit missed entirely

### O1. Observability and debugging

How does an operator diagnose a stuck workflow under v2? Under v1, the operator opens `issue-to-pr.md`, finds the section that matches the stuck stage, and reads inline. Under v2, the operator has to figure out which reference is relevant from the hot path's pointer, load that reference, possibly chase a second reference, then reason from durable ledger state.

If the agent is stuck in a way the durable state cannot express (e.g., the agent is repeatedly skipping a `## Builder rules` step), debugging requires the operator to know what the rule *was*, which the v2 hot file does not contain. The audit does not propose any observability surface.

Concrete recommendations the audit should make:

- Every Builder dispatch should append a `dispatch_evidence` row to ledger Notes including which references were loaded.
- Every escape-hatch fire should record which reference (if any) was loaded immediately before.
- The helper should gain a `--diagnose <ledger-path>` mode that prints the inferred current state, the expected reference for the current state, and any drift (e.g., digest mismatch, finding-table drift).

None of this is in the audit. It is essential operator infrastructure for a v2 that pushes content into references.

### O2. Backwards compatibility for in-flight ledgers

Covered under M4/M5 above, but worth restating as a missing topic: the audit does not have a section on what happens to ledger files written under v1 prose after v2 ships. The ledger schema is unchanged (frontmatter shape, `## Batches` YAML, `## Findings data` YAML), so the *ledger* is portable. But the agent's interpretation of "what does `batch_contract_confirmation_status: stale` mean for the next action" depends on routing prose that v2 changes.

The audit should specify: are v1 ledgers fully forward-compatible with v2, and if so, what is the test that proves it?

### O3. Skill discoverability and naming

The runbook is invoked via `/goal Follow ~/.claude/runbooks/issue-to-pr/issue-to-pr.md ...` (per `README.md:191-227`). The audit (`:373-375`) defers the decision on whether to promote this to a formal Codex skill. But it does not address: is `issue-to-pr` the right name?

The runbook does not just take an issue to a PR. It runs a six-stage Builder/Validator orchestration with audit ledgers, contract reviews, replacement batches, mechanical-diff fallbacks, and final-review patch-batches. "Issue to PR" undersells the scope. A skilled operator looking at the skill catalog has to know what is inside before deciding to invoke. Names matter for discoverability.

Alternatives the audit should at least consider:

- `audited-issue-to-pr` (emphasizes the ledger and the audit trail).
- `builder-validator-issue` (emphasizes the role separation).
- `governed-issue-pipeline` (emphasizes the gates and confirmation).

The audit treats the name as out of scope. For a v2 that may also be a Codex skill promotion, the name should be on the table.

### O4. Day-1 vs. day-30 operator ergonomics

The audit's design optimizes for fresh-agent resume. But a real operator hits this workflow on day 1, day 7, day 30, day 90. The ergonomics differ:

- Day 1: operator needs to understand the whole shape. V2's reference fan-out hurts here; the operator has to read 16+ files to learn the workflow.
- Day 7: operator is debugging a specific failure mode. V2 helps here if the failure mode maps cleanly to a reference, hurts if it spans multiple references.
- Day 30: operator is fluent. V2 helps here because the operator already knows which reference to load.
- Day 90: operator is teaching someone else. V2 hurts here because the explanation is "read these 16 files in this order."

The audit's acceptance criteria (`:889-900`) are all day-30 criteria. Nothing in the criteria measures day-1 onboarding or day-90 explainability. A staff-engineer review should require a balanced set: pick at least one criterion per operator-tenure stage.

### O5. Alternative architectures not considered

The audit only considers "runbook" and "formal Codex skill" as artifact shapes (`:361-374`). Two unexplored alternatives:

**Alternative A: CLI tool that emits instructions.** Instead of a runbook that an agent follows, ship a CLI that the agent calls and that returns the next instruction. `issue-to-pr run <issue> --next-turn` returns the next action as text. The runbook becomes a thin spec; the CLI owns the state machine. This eliminates the entire "agent reads N markdown files" problem because the agent only ever calls one command. The trade-off is that the CLI now owns logic that lived in prose.

**Alternative B: Merge Orchestrator and Validator role boundaries.** The audit assumes Builder, Validator, and Orchestrator are three roles. But Validator dispatch is currently triggered, parsed, and persisted by the Orchestrator. The Validator persona is just a sub-agent invoked with a fixed envelope contract. If the Validator role is reframed as "Orchestrator runs `decompose.ts --dispatch-validator` and persists the result," the Validator stops being a role and becomes a tool. That collapses one role boundary, shrinks the runbook, and reduces the surface that v2 has to design references for.

Neither alternative is obviously right. Both deserve at least a paragraph in the audit explaining why they were rejected. The audit does not mention either.

### O6. The interaction between `force-run`, `accepted-risk`, and the audit trail

A staff engineer reviewing the workflow would notice: the workflow has at least four "override" mechanisms (force-run label, accepted-risk batch status, change_first-exception rationale, smoke-direct ship mode). Each is documented in a different place. Each has different gates. The audit's reference layout (`:336-358`) does not assign an owner for "overrides as a concept." They scatter across `stage-1`, `validator-loop`, `stage-3`, and `stage-6` references.

A reviewer would want one reference (`references/overrides.md`) that lists every override, what it bypasses, what audit trail it leaves, and who can authorize it. The audit's split inherits the current scattered placement.

---

## Synthesis: what should the v2 designer actually do differently

Based on the attacks above, concrete changes the v2 designer should make to the audit's plan:

1. **Revise the hot-file budget upward.** Target 500-700 lines, not 250-350. Show your work: list every non-negotiable invariant and verify it can fit. If 350 is achievable, prove it with a worked example.

2. **Drop the "one-level references" constraint.** Replace with: "Static lookup references are one-level. Active orchestration references (Stage 4, Stage 5, Builder, Validator, patch-batches) may chain one additional hop, but no further." Acknowledge the chain explicitly.

3. **Cut the reference count from 16 to ~10.** Specific merges to consider:
   - Combine `persona-selector` + `finding-lifecycle` + `validator-loop` into one `findings-and-validators.md`.
   - Combine `ledger-contract` + `helper-contract` into one `ledger-and-helper.md`.
   - Combine `stage-5-final-review` + `final-review-patch-batches` into one `stage-5-final-review.md` (or, per W2, dissolve the patch-batch part into Stage 4 entirely).
   - Drop `stage-router` as a separate reference; the router lives in the hot file.

4. **Reframe the XML strategy.** Use Markdown headings inside Work Packets and Validator prompts; reserve XML for the rare case where the model needs to disambiguate quoted content from instructions, which is not Builder dispatch. If XML is retained, fix the tag granularity (collapse `<role>` + `<authority>` into `<contract>`, rename `<required_reads>` to `<local_law_read_order>`, fold `<stop_conditions>` into `<output_contract>`).

5. **Specify install topology.** Add a section that names every artifact in the installed copy, the install script changes, and the version-skew detection mechanism. Add a `runbook_version` field to ledger frontmatter so agents can detect skew.

6. **Specify migration semantics.** Either (a) require all in-flight ledgers be drained before v2 lands, or (b) ship v1 prose in parallel for a deprecation window. Pick one.

7. **Require structured helper output.** Every new helper mode added in Phase 4 ships with `--json` output and a fixed schema. The agent never parses prose stdout for routing decisions.

8. **Plan to split `decompose.ts`.** Phase 4's helper additions land in new modules under `runbooks/issue-to-pr/lib/`, not by extending `decompose.ts`. The CLI dispatch becomes a thin shim. Set a per-module test file size cap of 1,500 lines.

9. **Address the Builder role leak.** Either introduce a distinct `Proposer` role with its own envelope contract for proposal-only dispatch, or document the role overlap explicitly.

10. **Dissolve Stage 5's nested workflow into Stage 4.** Final-review findings that need fixes become Stage 4 batches in the DAG. Stage 5 becomes a read-only gate.

11. **Add an observability section.** Helper `--diagnose` mode, ledger Notes evidence for dispatch decisions, escape-hatch reference tracking.

12. **Add a regression matrix.** Phase 5's three smoke runs are not coverage. Map every prose-only invariant (Local Law Read Order, mechanic discipline, domain language rule, change_first exception semantics) to a verification step that runs under both v1 and v2 prose.

13. **Operationalize the "fresh agent" acceptance criterion.** Replace with a measurable metric: e.g., "in a new Claude Code session with the runbook and ledger loaded, the agent's first tool call after `/goal ...` is reading `--confirmation-state`, with no intermediate file reads other than the ledger and the runbook."

14. **Consider the CLI-emits-instructions alternative explicitly.** Even if rejected, document why.

15. **Rename consideration.** Add a "naming" sub-section that argues for or against keeping `issue-to-pr` as the skill name if promoted to a Codex skill.

---

## Where the audit is right

This review is adversarial, not uniformly hostile. The audit gets several things right that should not be lost in the noise:

- **F3 (helper-owned truth vs. prose drift) is correctly identified.** The principle "prose and executable validation will drift unless one owns each rule" (`:181`) is correct and load-bearing. The specific recommendation (push more into helper) is structurally right even if the audit underestimates the work to do it cleanly.

- **F7 (README is competing with runbook) is correctly identified.** The README does have duplicate Builder dispatch overview, turn protocol, fix protocol, and ledger format material. Even if the resolution should be more aggressive (delete README) than the audit proposes (make it a human index), the diagnosis is right.

- **F8 (no explicit "do not load yet" map) is correctly identified.** The current file's references to `docs/brainstorms/...` are provenance, not operational. That diagnosis is sharp and the recommendation (a reference-loading table with load triggers) is the right kind of intervention.

- **The Contract Ownership Model (`:564-577`) is the strongest part of the audit.** Assigning each rule to exactly one owner (README for human invocation, hot file for live routing, `decompose.ts` for checkable schema, templates for role packets, references for role policy, ledger for durable state, ADRs for rationale) is a clean framing. Even if v2 deviates in details, this ownership table should survive.

- **The recommendation to "build v2 as a small orchestration shell plus one-level references" is directionally right at the framing level**, even if the specific budgets, reference counts, and chain rules need work.

- **Non-Goals (`:879-887`) are well-chosen.** "Do not remove the ledger. Do not weaken user confirmation gates. Do not collapse Builder and Orchestrator roles. Do not let Validators fix code." These are the right preservation commitments and they should be acceptance gates for v2.

- **Phase 0 ("Freeze Before Cutting") is the right first step.** A line-map checklist before any extraction is exactly the right discipline. The audit's emphasis on behavior preservation as a first commitment is correct, even if the verification plan is thin.

The audit's structural critique is sound. Its specific design choices need work. That is a normal outcome for a first-pass audit; an adversarial second pass exists to surface the choices that look reasonable on first read and break on second read. Most of the audit's framing survives this review; most of its detailed prescriptions need revision.

---

## Appendix: detailed evidence the main argument compresses

### E1. Worked enumeration of what fits in 350 lines

The main argument (P1) claims the 350-line target is unachievable. This appendix enumerates the math.

Required inline content under the audit's own constraints (`:466-470`, "Keep:"):

| Item | Estimated lines | Source |
| --- | ---: | --- |
| One-paragraph purpose | 4 | new |
| Ledger location and target repo assumption | 6 | `issue-to-pr.md:3-11` |
| Non-negotiable invariants (10 items, one sentence each) | 14 | derived from `:257-272, :276-294, :296-318, :1016-1024` |
| Reference loading table (12-row authoritative routing) | 18 | new |
| Resumed-turn state router (algorithm) | 18 | derived from `:276-318` |
| State router diagram (Mermaid) | 16 | `:522-536` |
| Six-stage shell (~30 lines per stage: inputs, load reference, action summary, exit condition, stop conditions, transition) | 180 | derived |
| Stop-and-ask conditions (consolidated list) | 22 | derived from `:716-728, :1180-1192, :1024-1034, README.md:213-222` |
| Helper command index (10 commands, one line each plus header) | 14 | `decompose.ts:2096-2133` |
| Exit criteria for the workflow | 8 | derived from `:957-958` |
| Cross-reference fence (links to README, ledger template, ADR 0001) | 6 | new |
| Blank lines, headings, fence boundaries | 30 | unavoidable |
| **Total** | **336** | |

That fits under 350, but only if every stage shell is held to 30 lines flat *and* every invariant is one sentence *and* the helper command index is one line per command. In practice, Stage 4 alone needs more than 30 lines because the outer loop, in-progress resume rule, host readiness check, the link out to inner loop, the convergence-vs-blocked branch, and the patch-batch return path all have to fit. A realistic Stage 4 shell is 50-60 lines, which pushes the total to 380-400. Stage 5 is similar even if the patch-batch detail moves to a reference. So the audit's target is *barely* achievable on paper and unachievable in practice unless several constraints flex. The honest budget is 400-500 lines.

### E2. The cross-reference graph the audit does not draw

Under the audit's proposed split, the reference-to-reference reachability graph looks like:

```
issue-to-pr.md (hot)
  -> stage-1-pick-issue.md
       -> issue-shape.md
  -> stage-2-plan.md
       -> ce-plan-addendum.md (template)
  -> stage-3-decompose.md
       -> helper-contract.md
       -> ledger-contract.md
       -> validator-loop.md  (because Contract Review reuses Validator envelope)
       -> finding-lifecycle.md  (because Stage 3 findings use the lifecycle)
  -> stage-4-batch-loop.md
       -> builder-dispatch.md
            -> builder-work-packet.md (template)
            -> builder-return-envelope.md (template)
            -> helper-contract.md
            -> ledger-contract.md
       -> validator-loop.md
            -> persona-selector.md
            -> validator-envelope.md (template)
            -> finding-lifecycle.md
            -> helper-contract.md
       -> host-adapters.md
  -> stage-5-final-review.md
       -> validator-loop.md
       -> final-review-patch-batches.md
            -> builder-dispatch.md
            -> patch-proposal.md (template)
            -> helper-contract.md
  -> stage-6-ship.md
       -> host-adapters.md
       -> helper-contract.md
```

That is 21 nodes with at least 28 directed edges, several of them four hops from the hot file. The audit's claim that this is "one-level" depends on counting only the *first* link in the chain, not the chain's reachability. Any operator debugging a Stage 4 patch-batch dispatch under v2 has to load the hot file, `stage-4-batch-loop.md`, `final-review-patch-batches.md`, `builder-dispatch.md`, `helper-contract.md`, and the patch-proposal template. That is six files for one branch. Under v1 it is one file. The audit needs to defend that trade explicitly.

### E3. The Builder Work Packet contents enumerated against the audit's XML proposal

The current Work Packet definition (`issue-to-pr.md:74-101`) names ten distinct content slots:

1. issue number and target repo.
2. `attempt_type: implementation | repair`.
3. exactly one open P0/P1 target finding signature (for repair).
4. confirmed batch contract verbatim (10 sub-fields).
5. current iteration number.
6. existing `builder_commits`.
7. compact prior `builder_attempts` for this batch.
8. `## Findings data` rows for this batch only.
9. non-authoritative Notes summaries for this batch only.
10. Local Law Read Order, authority boundary, Mechanic Discipline, Preflight Checklist, return envelope contract.

The audit's XML proposal (`:413-452`) covers six tags: `<role>`, `<authority>`, `<batch_contract>`, `<allowed_files>`, `<target_finding>`, `<required_reads>`, `<stop_conditions>`, `<output_contract>`. Mapping content to tags:

- `<role>` and `<authority>` cover slot 10's authority boundary, but not Mechanic Discipline, not Preflight Checklist.
- `<batch_contract>` covers slot 4 (with 10 sub-fields collapsed into YAML inside the tag).
- `<allowed_files>` is a sub-field of slot 4 (`batch.files`) hoisted to top-level. Redundant.
- `<target_finding>` covers slot 3.
- `<required_reads>` partially covers slot 10's Local Law Read Order.
- `<stop_conditions>` partially covers slot 10's Preflight Checklist (but only the readiness conditions, not the probe catalog).
- `<output_contract>` covers slot 10's return envelope contract.

Uncovered: slots 1 (issue + repo), 2 (`attempt_type`), 5-9 (iteration, prior commits, prior attempts, findings, notes), and slot 10's Mechanic Discipline + probe catalog. That is the majority of the Work Packet's actual content. The audit's tag set covers maybe 30% of the payload.

This means the audit's XML example is illustrative, not complete. The full XML version of the Work Packet would need at least: `<issue_context>`, `<attempt_type>`, `<iteration>`, `<prior_commits>`, `<prior_attempts>`, `<batch_findings>`, `<batch_notes>`, `<mechanic_discipline>`, `<probe_catalog>` — bringing the tag count from 8 to 17. The packet becomes a deeply-tagged document. Whether that helps the Builder agent reason cleanly is exactly the question the audit needed to answer with evidence, and did not.

### E4. The `--confirmation-state` state space

The helper's `--confirmation-state` mode is the load-bearing routing primitive. Per the runbook (`:282-294`), it returns three orthogonal states: `acceptance_criteria`, `batch_contract`, `digests`. Each can be `pending`, `confirmed`, `stale`, or `blocked`. Naively that is 64 combinations; in practice many are unreachable (e.g., `batch_contract: confirmed` with `acceptance_criteria: pending` cannot happen because batch confirmation requires AC confirmation as a precondition).

The reachable state space is approximately:

| AC | batch_contract | digests | Routing |
| --- | --- | --- | --- |
| pending | pending | pending | Stage 1 (AC confirmation needed) |
| confirmed | pending | pending | Stage 2 or Stage 3 (plan or batch) |
| stale | pending | pending | Stage 1 re-confirm (AC drifted) |
| confirmed | pending | confirmed | Stage 3 ready to confirm (digests computed) |
| confirmed | confirmed | confirmed | Stage 4 or beyond |
| confirmed | confirmed | stale | Re-route to Stage 3 (digest drift) |
| confirmed | blocked | pending | Stage 3 Contract Review blocked |
| confirmed | stale | confirmed | Replacement-batch flow active |
| ... | ... | ... | (more cases) |

The audit's state router diagram (`:522-536`) shows nine routing branches (no ledger, AC pending/stale, plan missing, batch contract pending/stale, pending eligible batch, batch in-progress, no pending batches, final P0/P1 open, final reviewed, shipped, blocked). The mapping from helper output to router branch is not one-to-one. Specifically:

- `digests: stale` while `batch_contract: confirmed` triggers re-routing to Stage 3 (per `:296-306`), but the router diagram does not have an edge for this.
- `batch_contract: blocked` is a Stage 3 Contract Review state, but the router diagram does not show how it differs from `pending`.
- Replacement-batch flow has its own routing logic (`:213-247`) that the router diagram does not address.

The audit's state router is a simplification of the actual state space. That simplification will produce v2 routing prose that does not handle several real cases the current runbook handles inline. Specifically, the digest re-check rules at `:296-311` and the replacement-batch dependency rewrites at `:236-247` will need to appear in the hot file or a router reference, or v2 will silently lose them.

### E5. Test coverage of prose invariants — specific gaps

The current `decompose.test.ts` has 77 tests across nine helper modes. It validates:

- Helper input parsing and error paths.
- Batch contract schema (presence and types of all 10 sub-fields).
- DAG cycle detection.
- AC coverage validation.
- Digest computation for plan, AC, and batch contract.
- Ledger batch invariants (replacement rules, supersedes referential integrity).
- Patch proposal validation.
- Finding row validation (signature uniqueness, status/severity enums, resolution references).
- P0/P1 open assertion.

What it does *not* validate (i.e., prose-only invariants):

- Local Law Read Order (`:115-128`).
- Mechanic Discipline rules (`:130-134`).
- Public Contract Rule (`:136-140`).
- Domain Language Rule (`:142-145`).
- Preflight Checklist semantics (`:148-160`).
- Probe Catalog choices (`:166-174`).
- The decision tree for "≤2 files vs. needs replan" (`:790-861`).
- The "smallest patch that adjusts contract rather than implementation" heuristic (`:852-859`).
- The mechanical-diff fallback's >80% line threshold (`:764-773`).
- The default-broad-reviewer-set fallback condition (`:976-981`).
- Selector signal precedence (e.g., what fires when paths match both `auth` and `migrations/`?).
- The host-readiness-vs-infrastructure-failure boundary (`:687-694, :1027-1034`).

Twelve prose-only invariants. The audit's Phase 5 plan (three smoke runs) exercises maybe three of these in any given run. The other nine are tested only by careful prose reading at v2 ship time, which is exactly the kind of testing the audit's "behavior-preserving refactor" framing makes hard to do (because the prose has moved into references and the regression check has to look in multiple places).

A v2 designer who takes the audit's Phase 1 as written will produce a v2 that passes the existing 77 tests, runs three smoke scenarios successfully, and ships with subtle drift in the twelve prose-only invariants. That drift will surface only on runs that exercise edge cases.

### E6. The "fresh agent" criterion against `bun --confirmation-state` output

The audit's acceptance criterion "A fresh agent can resume from a ledger and select the next action in under one screen of reading" (`:899`) implies the agent reads (a) the hot file, (b) the ledger, (c) the `--confirmation-state` output, and immediately selects the next action.

The current `--confirmation-state` output is prose: `acceptance_criteria: confirmed`, `batch_contract: pending`, `digests: pending`. An agent translating that to "load `references/stage-3-decompose.md`" requires:

- Knowing the routing table (which lives in the hot file under v2).
- Knowing which reference to load for `batch_contract: pending` (also in the hot file).
- Knowing whether `digests: pending` matters at this stage (a Stage 3 sub-rule, in the hot file).

That is doable in one screen if the routing table is *the* central artifact of the hot file. But the same hot file also has to carry the resumed-turn algorithm, the six-stage shell, the invariants, the stop conditions, and the helper command index. The "one screen of reading" budget is approximately 60-80 lines of dense prose. The routing table alone, expanded to cover the twelve reachable durable states (E4 above), is 14-18 lines. The non-negotiable invariants are 10-15 lines minimum. The resumed-turn algorithm is 7-10 lines. That is already 31-43 lines of dense prose to get to "select the next action," and the agent has not yet read the stage shell or the helper command index.

The criterion is conceivably meetable, but only if the hot file ruthlessly prioritizes routing over everything else. The audit's proposed hot path skeleton (`:485-519`) does prioritize routing — but it elides the invariants, the stop conditions, and the helper command index that the audit *also* says (`:466-470`) must stay inline. The skeleton and the "Keep" list cannot both be honored. The audit needs to pick one.

