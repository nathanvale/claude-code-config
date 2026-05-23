# V2 contract coverage - findings ledger

Format and protocol: see [README.md](README.md#ledger-format).

| id  | signature                                                              | status | risk | summary                                                                                                                                                                              | resolution                                            |
| --- | ---------------------------------------------------------------------- | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| 001 | local-law-read-order-no-v2-home                                        | fixed  | low  | Local Law Read Order has no v2 destination                                                                                                                                           | matrix-row-filled (v2 dest: references/builder-dispatch.md, owner U2) |
| 002 | mechanic-discipline-no-v2-home                                         | fixed  | low  | Mechanic Discipline has no v2 destination                                                                                                                                            | matrix-row-filled (v2 dest: references/builder-dispatch.md, owner U2) |
| 003 | public-contract-rule-no-v2-home                                        | fixed  | low  | Public Contract Rule has no v2 destination                                                                                                                                           | matrix-row-filled (v2 dest: references/builder-dispatch.md, owner U2) |
| 004 | domain-language-rule-no-v2-home                                        | fixed  | low  | Domain Language Rule has no v2 destination                                                                                                                                           | matrix-row-filled (v2 dest: references/builder-dispatch.md, owner U2) |
| 005 | preflight-checklist-no-v2-home                                         | fixed  | low  | Builder Preflight Checklist has no v2 destination                                                                                                                                    | matrix-row-filled (v2 dest: references/builder-dispatch.md, owner U2) |
| 006 | probe-catalog-no-v2-home                                               | fixed  | low  | Probe Catalog has no v2 destination                                                                                                                                                  | matrix-row-filled (v2 dest: references/builder-dispatch.md, owner U2) |
| 007 | final-review-patch-decision-tree-no-v2-home                            | fixed  | low  | Final-review patch decision tree has no v2 destination                                                                                                                               | matrix-row-filled (v2 dest: references/stage-4-batch-loop.md, owner U2) |
| 008 | smallest-contract-patch-heuristic-no-v2-home                           | fixed  | low  | Smallest contract patch heuristic has no v2 destination                                                                                                                              | matrix-row-filled (v2 dest: references/stage-4-batch-loop.md, owner U2) |
| 009 | mechanical-diff-fallback-no-v2-home                                    | fixed  | low  | Mechanical-diff fallback has no v2 destination                                                                                                                                       | matrix-row-filled (v2 dest: references/findings-and-validators.md, owner U2) |
| 010 | broad-reviewer-fallback-no-v2-home                                     | fixed  | low  | Broad-reviewer fallback has no v2 destination                                                                                                                                        | matrix-row-filled (v2 dest: references/findings-and-validators.md, owner U2) |
| 011 | selector-precedence-no-v2-home                                         | fixed  | low  | Selector precedence has no v2 destination                                                                                                                                            | matrix-row-filled (v2 dest: references/findings-and-validators.md, owner U2) |
| 012 | host-readiness-vs-infra-failure-no-v2-home                             | fixed  | low  | Host-readiness vs infrastructure-failure boundary has no v2 destination                                                                                                              | matrix-row-filled (v2 dest: references/host-adapters.md, owner U2) |
| 013 | probe-installed-reference-presence-no-v2-home                          | fixed  | low  | Installed reference/template presence probe has no v1 source / v2 destination / scenarios                                                                                            | matrix-row-filled (v1 has no equivalent; v2 dest: cli.ts diagnose --json, owner U4) |
| 014 | probe-runbook-version-mismatch-no-v2-home                              | fixed  | low  | runbook_version mismatch probe is forward-looking-only; needs explicit "no v1 analog" note                                                                                           | matrix-row-filled (v1 has no equivalent; v2 dest: cli.ts state --json, owner U6) |
| 015 | probe-cli-state-no-v2-home                                             | fixed  | low  | cli.ts state --json probe: v1 equivalent is decompose.ts --confirmation-state                                                                                                        | matrix-row-filled (v1: decompose.ts --confirmation-state; v2 dest: cli.ts state --json, owner U4) |
| 016 | probe-cli-diagnose-no-v2-home                                          | fixed  | low  | cli.ts diagnose --json probe is forward-looking-only                                                                                                                                 | matrix-row-filled (v1 has no equivalent; v2 dest: cli.ts diagnose --json, owner U4) |
| 017 | probe-startup-route-no-v2-home                                         | fixed  | low  | Startup route probe: v1 equivalent is README Turn protocol step 3                                                                                                                    | matrix-row-filled (v1: README Turn protocol steps 1-3; v2 dest: cli.ts state --json, owner U4) |
| 018 | source-plan-link-broken                                                | fixed  | low  | Matrix links docs/plans/2026-05-22-002-...md which only exists on codex branch eff9591                                                                                               | plan-file-extracted-from-eff9591 (git show eff9591:docs/plans/...md > docs/plans/...md) |
| 019 | confirmation-state-routing-invariant-not-in-matrix                     | closed | low  | Load-bearing v1 invariant (resumed agent routes from durable ledger state not transcript memory) is not in U1 scope and not in the matrix; needs a future seam                       | not-in-u1-scope (recorded in matrix "Out-of-scope rows"; future seam owns it — likely U7 hot-router cutover) |
| 020 | clean-tree-precondition-invariant-not-in-matrix                        | closed | low  | Load-bearing v1 invariant (clean working tree at stage transitions) is not in U1 scope and not in the matrix; needs a future seam                                                    | not-in-u1-scope (recorded in matrix "Out-of-scope rows"; future seam owns it — likely U2 + U7 stage shells) |
| 021 | probe-installed-reference-presence-owner-unit-contradicts-probe-column | fixed  | low  | Matrix row probe-installed-reference-presence had owner unit U6 but probe column cli.ts diagnose --json; header says cli.ts probes are owned by U9                                  | matrix-row-corrected (owner unit changed to U4; U4 owns the diagnose CLI surface per plan) |
| 022 | escape-hatches-missing-from-out-of-scope-tracking                      | closed | low  | Six inner-loop escape hatches (ADR-contradicts, public-API-change, execution-mode-mismatch, same-signature-twice, risk-high-finding, finding-count-rises) are load-bearing prose invariants at issue-to-pr.md L1196-1211 but not in U1's 12 listed invariants and not in the matrix's Out-of-scope rows | not-in-u1-scope (recorded in matrix "Out-of-scope rows" as `escape-hatches`; future seam owns it — stage-4-batch-loop.md, U2 + U7 work) |
| 023 | iteration-cap-missing-from-out-of-scope-tracking                       | closed | low  | Inner-loop iteration cap of 5 (issue-to-pr.md L1036-1037) is a load-bearing behavioral invariant not in U1's listed invariants and not in the matrix's Out-of-scope rows                                                                                                                              | not-in-u1-scope (recorded in matrix "Out-of-scope rows" as `iteration-cap`; future seam owns it — stage-4-batch-loop.md, U2 + U7 work) |
| 024 | u1-line-map-missing                                                   | fixed  | low  | U1 requires a line-map from issue-to-pr.md, README.md, issue-N-ledger.template.md, and decompose.ts command modes to v2 destinations; matrix only covered named invariants and probes | matrix-line-map-added (major sections and helper command groups now map to primary v2 destinations) |
| 025 | installed-reference-presence-v1-anchor-wrong                          | fixed  | low  | `probe-installed-reference-presence` cited issue-to-pr.md L304-306 for the ledger template copy, but the actual copy instruction is L433-434                                      | matrix-row-corrected (v1 source anchor changed to issue-to-pr.md L433-434) |
| 026 | fix-protocol-placeholder                                               | fixed  | low  | v2 refactor README told agents to apply a shared Fix protocol, but the protocol section was still a placeholder                                                                     | README-fix-protocol-filled (low/high risk flow, read-only source boundaries, ledger update, re-review loop) |
| 027 | runbook-version-row-unescaped-table-pipes                              | fixed  | low  | `probe-runbook-version-mismatch` used unescaped pipe characters inside a Markdown table cell, making the row render ambiguously                                                     | matrix-row-corrected (version skew values now listed without table-breaking pipes) |
| 028 | shadow-v2-folder-topology-not-reflected                                | fixed  | low  | Plan now builds v2 in `runbooks/issue-to-pr-v2/` while keeping v1 runnable, but the U1 matrix/runbook still pointed at in-place v2 destinations                                     | plan-and-matrix-updated (v2 destinations and writable matrix now live under `runbooks/issue-to-pr-v2/`) |
| 028 | scoped-audit-prompt-row-status-contradicts-destination                 | fixed  | low  | Line-map row `issue-to-pr-scoped-audit-prompt` had `status: removed` and a `removed-by-design:` destination, but the destination text actually preserved the responsibility (load review references; ce-code-review owns the prompt) — should be `mapped` | matrix-row-corrected (status flipped to `mapped`; destination names `references/stage-5-final-review.md` for the final-review reference list, with ce-code-review retaining audit-prompt ownership) |
| 029 | helper-line-map-rows-overlap-decompose-ts-ranges                       | fixed  | low  | Multiple helper line-map rows (`helper-digest-command-group`, `helper-confirmation-state-mode`, `helper-batch-and-ac-validation-group`, `helper-findings-gate-group`, `helper-patch-proposal-mode`, `helper-compat-entrypoint-and-usage`) claimed overlapping line ranges in `decompose.ts` L2109-2177, breaking the line-map's clean-partition property | matrix-rows-corrected (helper rows partitioned into non-overlapping spans: digest L2109-2118+L2129-2133+L2171-2172; confirmation-state L2119-2123; batch/AC validation L2124-2128+L2173-2174; findings gate L2134-2143; patch-proposal L2144+L2161-2163; compat entrypoint L2108+L2145-2160) |
| 030 | readme-line-map-rows-overlap-l161-l238                                 | fixed  | low  | `readme-invocation-driver-and-index` (L146-238) and `readme-helper-ledger-and-turn-protocol` (L161-260) overlapped on L161-238; `readme-helper-ledger-and-turn-protocol`'s L260 upper bound also collided with `readme-fix-risk-and-glossary`'s L260 lower bound | matrix-rows-corrected (invocation/driver row pinned to L1-29, L140-159, L191-238, L415-459; helper/ledger row pinned to L161-189, L239-258, L348-414; fix-risk row unchanged at L260-345 — no overlap) |
| 031 | readme-why-these-seams-section-not-in-line-map                         | fixed  | low  | README's `## Why these seams` section (L140-145) was unclaimed by any line-map row, leaving the seam table without a v2 destination | matrix-row-corrected (folded into `readme-invocation-driver-and-index`'s expanded range `L140-159`, primary v2 destination README human index, U8) |
| 032 | readme-exclusions-section-not-in-line-map                              | fixed  | low  | README's `## What this area deliberately does not do` section (L434-459) was unmapped despite `readme-invocation-driver-and-index`'s `current contract` cell naming "exclusions"; range previously stopped at L434 | matrix-row-corrected (`readme-invocation-driver-and-index` range extended from `L415-434` to `L415-459` to cover the exclusions content) |
| 033 | close-and-loop-fallback-range-truncated                                | fixed  | low  | `issue-to-pr-close-and-loop-fallback` claimed `L1288-1310` but the `/loop` fenced code block continues through L1313                                                                | matrix-row-corrected (range extended to `L1288-1313`; note added clarifying the closing fence is included) |
| 034 | helper-default-plan-emit-mode-not-in-line-map                          | fixed  | low  | `decompose.ts`'s default flag-less mode (`decompose.ts <plan-path>` → `parse(...)` + `emit(batches)` at L2157-2177) had no explicit line-map row; the plan U1 requires every helper command group to be mapped | matrix-row-added (`helper-decompose-default-mode`, v1 source `decompose.ts L2157-2159, L2164-2170, L2175-2177`, v2 destination `lib/validate.ts` for parse + `decompose.ts` compatibility shim for emit, owner U3) |
| 035 | personas-findings-and-hatches-mixed-destination                        | fixed  | low  | `issue-to-pr-personas-findings-and-hatches` (L982-1211) mapped Builder execution rules (L1056-1109), persona selector (L982-1016), Validator rules (L1110-1195), and escape hatches (L1196-1211) all to `findings-and-validators.md`; the v2 plan splits Builder rules into `builder-dispatch.md` | matrix-row-split (row replaced by `issue-to-pr-personas-and-findings` for L982-1016 + L1110-1211 → `findings-and-validators.md`, and `issue-to-pr-inner-loop-and-builder-rules` for L1017-1109 → `builder-dispatch.md` (Builder rules) plus `stage-4-batch-loop.md` (loop structure, iteration cap, post-dispatch readiness routing)) |
| 036 | line-range-convention-undocumented                                     | fixed  | low  | The matrix's line-range convention (inclusive trailing blank, non-overlapping partition, discrete spans for non-contiguous regions) was not stated in the line-map section, leaving room for off-by-one observations across future sweeps | matrix-convention-note-added (new paragraph under `## Current contract line-map (U1 scope)` names the trailing-blank-line rule, the non-overlapping partition requirement, and the discrete-span form) |
| 037 | helper-compat-entrypoint-and-decompose-default-mode-overlap-l2157-l2159 | fixed  | low  | After sweep-3, `helper-compat-entrypoint-and-usage` (L2108, L2145-2160) and `helper-decompose-default-mode` (L2157-2159, L2164-2170, L2175-2177) overlapped on the L2157-2159 arg-unwrap statements, directly contradicting the new partition convention added in row 036 | matrix-rows-corrected (the L2157-2159 arg unwrap is dispatcher wiring owned by `helper-compat-entrypoint-and-usage` and was dropped from `helper-decompose-default-mode`; default-mode row now spans only L2164-2170 + L2175-2177) |
| 038 | builder-dispatch-contract-range-cuts-sentence-at-l264                  | fixed  | low  | `issue-to-pr-builder-dispatch-contract` claimed `L67-264`, but the closing paragraph of the section runs through L265 (`helper validation rejects the duplicate dependency before / confirmation.`); L264 ended mid-sentence and L265 was unclaimed | matrix-row-corrected (range extended from `L67-264` to `L67-265`; current contract note clarifies the final sentence is included) |
| 039 | readme-fix-risk-glossary-range-cuts-route-hint-entry-at-l345           | fixed  | low  | `readme-fix-risk-and-glossary` claimed `L260-345`, but the final glossary item `- **Route hint**:` spans L345-346 (L346 is the second line `envelope. Status owns workflow transition; \`route_hint\` owns routing advice.`); L346 was unclaimed | matrix-row-corrected (range extended from `L260-345` to `L260-346`; current contract note clarifies the second line of the Route hint entry is included) |
| 040 | ledger-template-title-and-protocol-pointer-unmapped                    | fixed  | low  | The three ledger-template line-map rows partitioned L1-21, L28-61, and L63-93, leaving L22-27 (template title placeholder plus the format/protocol prose pointer back to issue-to-pr.md and the README) completely unmapped | matrix-row-added (new `ledger-template-title-and-pointer` row for `issue-N-ledger.template.md L22-27`, v2 destination `runbooks/issue-to-pr-v2/issue-N-ledger.template.md` with pointer text regenerated to reference v2 paths, owner U6) |
| 041 | helper-patch-proposal-mode-claims-dispatcher-line-l2144                 | fixed  | low  | `helper-patch-proposal-mode` claimed L2144 (the `patchProposalMode` mode-flag declaration consumed by the shared usage validation at L2147-2155), but L2144 is dispatcher wiring shared across all modes; the patch-proposal-specific code is only L2161-2163 (the `readLedgerBatchContext` wiring) | matrix-rows-corrected (L2144 moved to `helper-compat-entrypoint-and-usage`, whose range is now L2108 + L2144-2160; `helper-patch-proposal-mode` now spans only L2161-2163) |
| 042 | escape-hatches-line-range-collision-with-mapped-row                    | fixed  | low  | The line-map row `issue-to-pr-personas-and-findings` claimed L982-1016 + L1110-1211 (mapped) but the out-of-scope row `escape-hatches` also claimed L1196-1211 (not-in-u1-scope) — contradictory dispositions for the same source lines violating the non-overlapping partition rule | matrix-row-corrected (line-map row clipped to L982-1016 + L1110-1195; the L1196-1211 escape-hatches range now lives only in the Out-of-scope rows section, with the line-map row's note pointing readers to that section) |
| 043 | inner-loop-and-builder-rules-dual-destination-undocumented              | fixed  | low  | The new row `issue-to-pr-inner-loop-and-builder-rules` named two v2 destinations (`builder-dispatch.md` for Builder rules + `stage-4-batch-loop.md` for loop structure) without the convention authorizing multi-destination cells | matrix-convention-note-expanded (the line-range convention paragraph now explicitly authorizes multi-destination rows when a single coherent v1 unit splits cleanly across v2 destinations, requiring each named destination to be qualified by the v1 slice it owns) |
| 044 | helper-decompose-default-mode-dual-destination-undocumented            | fixed  | low  | The new row `helper-decompose-default-mode` named two destinations (`lib/validate.ts` for parse + `decompose.ts` compat shim for emit) without the convention authorizing it | matrix-convention-note-expanded (same fix as row 043; the convention now authorizes parse-vs-emit and Builder-rules-vs-loop-structure splits as documented patterns) |
| 045 | partition-claim-vs-blank-lines-undocumented                            | fixed  | low  | The convention note added in row 036 asserted "a line belongs to exactly one row," but section-boundary blank lines and `---` separators were unassigned across the matrix; the absolute claim was too strong | matrix-convention-note-softened (convention now reads "each substantive content line belongs to exactly one row" and explicitly states that structural blanks and `---` separators are unassigned by design) |
| 046 | shadow-v2-folder-id-collision-with-row-028                              | closed | low  | Ledger has two rows numbered `028`: the externally added `shadow-v2-folder-topology-not-reflected` (driving the matrix migration to `runbooks/issue-to-pr-v2/`) and the sweep-3 row `scoped-audit-prompt-row-status-contradicts-destination`. The duplicate id leaves the ledger ambiguous when readers cite "row 028." | id-collision-noted (both rows are status `fixed`; future ledger updates will treat the shadow row as `028a` in resolution prose if it must be cited individually. The seam runbook now points at the new matrix path, so the shadow row's effect is complete) |
| 047 | column-header-contradicts-multi-destination-authorization               | fixed  | low  | The line-map column header `primary v2 destination` (singular, implying hierarchy) contradicted the sweep-4 convention note that authorized multi-destination rows with co-equal qualified destinations. | matrix-header-renamed (column header changed from `primary v2 destination` to `v2 destination(s)`; the convention's "qualified by content slice" rule still applies) |
| 048 | intro-paragraph-one-primary-contradicts-convention                      | fixed  | low  | The line-map intro paragraph said "Every current major section and helper command group has one primary v2 destination or explicit removal reason" but the convention note authorized multi-destination rows. | matrix-intro-rewritten (intro now reads "one or more v2 destinations (or an explicit removal reason)", with a cross-reference to the convention note) |
| 049 | clean-tree-precondition-collides-with-stage-preconditions-row           | fixed  | low  | Out-of-scope row `clean-tree-precondition` claimed L277-283; mapped row `issue-to-pr-stage-preconditions-and-routing` claimed L276-337 (whose current-contract cell explicitly named "Clean-tree transition rule"). Same partition-violation pattern as row 042. | matrix-row-corrected (`issue-to-pr-stage-preconditions-and-routing` clipped to non-contiguous span `L276 + L284-306 + L314-337`; L277-283 now lives only in the Out-of-scope rows section, with a pointer note in the mapped row) |
| 050 | confirmation-state-routing-collides-with-stage-preconditions-row        | fixed  | low  | Out-of-scope row `confirmation-state-routing` claimed L307-313; mapped row `issue-to-pr-stage-preconditions-and-routing` covered the same lines and explicitly named "resumed confirmation-state routing" in its current-contract cell. | matrix-row-corrected (same fix as row 049 — `issue-to-pr-stage-preconditions-and-routing`'s clipped span carves out L307-313 alongside L277-283) |
| 051 | iteration-cap-collides-with-inner-loop-row                              | fixed  | low  | Out-of-scope row `iteration-cap` claimed L1036-1037; mapped row `issue-to-pr-inner-loop-and-builder-rules` covered L1017-1109 and explicitly named "iteration cap" in its current-contract cell. | matrix-row-corrected (`issue-to-pr-inner-loop-and-builder-rules` clipped to `L1017-1035, L1038-1109`; L1036-1037 lives only in the Out-of-scope rows section; current-contract cell updated to drop "iteration cap" and add a pointer note) |
| 052 | iteration-cap-out-of-scope-row-range-overshoot                          | fixed  | low  | Out-of-scope row `iteration-cap`'s v1 source was `L1036-1037, L1056-1057`, but L1056-1057 is `**Builder rules** (apply every iteration):` — the Builder rules header, owned by the mapped row's "seven Builder execution rules" coverage. L1056-1057 was an overshoot. | matrix-row-corrected (out-of-scope row's v1 source trimmed to `L1036-1037` only) |
| 053 | schema-row-v2-destination-not-renamed-to-plural                         | fixed  | low  | After sweep-5 renamed the line-map column to `v2 destination(s)` and the intro to "one or more v2 destinations," the `## How rows work` schema row still named the field `v2 destination` (singular) and described it as a single-value cell, leaving the schema inconsistent with the header it was supposed to document | schema-row-renamed (field renamed to `v2 destination(s)`; description extended to authorize multi-destination cells qualified by content slice, matching the convention note) |
| 054 | schema-row-does-not-describe-line-map-columns                           | fixed  | low  | The `## How rows work` schema listed `invariant`, `v1 scenario`, `v2 scenario`, and `probe` (columns from the prose-only invariants and probe-target tables) but omitted the line-map's unique `current contract` column added in row 024 | schema-row-extended (added a `Tables` column to indicate which sub-table each field applies to, added a `current contract` row scoped to the line-map, and clarified that `v1 source` accepts discrete spans) |
| 055 | clean-tree-section-body-split-across-mapped-and-out-of-scope            | fixed  | low  | The clean-tree precondition section's body spans L276-291 (heading + clean-tree rule at L277-283 + Stage 4 lifecycle clarification at L285-288 + fail-stop enforcement at L290-291), but the out-of-scope row only carved out L277-283, leaving L276 and L285-291 inside the mapped row's `L276, L284-306, L314-337` span | matrix-rows-corrected (out-of-scope `clean-tree-precondition` v1 source extended to `L276-291`; mapped `issue-to-pr-stage-preconditions-and-routing` clipped to `L295-305, L314-337` so the full clean-tree section sits in the out-of-scope table) |
| 056 | confirmation-state-routing-sentence-split-at-l306                       | fixed  | low  | The resumed-routing invariant's prose opens at L306 (`The command reports whether acceptance_criteria, batch_contract, and the / digest triple are pending, confirmed, stale, or blocked`) and continues at L307 (`A resumed agent must route from that state...`), but the out-of-scope row only claimed L307-313, leaving the sentence opener at L306 inside the mapped row | matrix-row-corrected (out-of-scope `confirmation-state-routing` v1 source extended to `L306-313` so the full sentence and four-state catalog sit in the out-of-scope table; mapped row's clip widened to start at L295) |
| 057 | stage-preconditions-routing-claims-l276-but-body-out-of-scope           | fixed  | low  | The mapped row kept L276 (the `## Inter-stage precondition: clean tree` heading) while the body was out-of-scope, separating heading from body across two rows | matrix-row-corrected (folded into the row 055 fix — L276 now lives with its body in the `clean-tree-precondition` out-of-scope row; mapped row no longer claims L276) |
| 058 | residual-pointer-note-convention-undocumented                           | closed | low  | Sweep-5's row 049/050/051 fixes introduced pointer-note text in the `current contract` cells (e.g., "...tracked in the Out-of-scope rows section as `clean-tree-precondition`...") without the convention authorizing or describing that pattern | not-in-u1-scope (the pattern is a one-line readability aid; documenting a formal "pointer-note convention" risks scope creep into a `current contract` cell schema that U2/U8 may want to own. Future seam can codify it if it persists into v2 reference extraction) |
| 059 | scoped-audit-prompt-one-destination-contradicts-matrix                  | fixed  | low  | The seam audit prompt still required "exactly one primary v2 destination" even though the matrix now permits qualified multi-destination rows. | seam-runbook-corrected (prompt now asks for one or more qualified destinations and requires each multi-destination cell to name the v1 slice it owns) |
| 060 | fix-protocol-writable-scope-contradicts-u1-seam                         | fixed  | low  | The shared fix protocol allowed "matrix or seam-runbook" edits and reference copy edits, contradicting the U1 seam rule that only the shadow v2 regression matrix is writable during the loop. | README-fix-protocol-tightened (low-risk edits are matrix-only; any change outside the matrix during U1 is high risk and requires Nathan) |
| 061 | startup-route-probe-cites-v1-router                                     | fixed  | low  | The startup-route probe destination said the U7 router citation would live in `runbooks/issue-to-pr/issue-to-pr.md`, which contradicts the shadow-folder plan. | matrix-row-corrected (router citation now points to `runbooks/issue-to-pr-v2/issue-to-pr.md`, leaving v1 frozen until public cutover) |
| 062 | plan-u1-language-lags-shadow-matrix                                     | fixed  | low  | The local U1 plan still said every section has exactly one destination and used an unqualified `references/regression-matrix.md` path. | plan-language-corrected (test and risk language now allow one or more qualified destinations and name `runbooks/issue-to-pr-v2/references/regression-matrix.md`) |
| 063 | prose-only-invariants-and-probe-target-headers-still-singular           | fixed  | low  | After sweep-5 renamed the line-map column to `v2 destination(s)` and the sweep-6 schema row scoped it to all destination-carrying tables, the prose-only invariants table header (L86) and the deterministic probe targets table header (L103) still used singular `v2 destination` | matrix-headers-renamed (both headers now read `v2 destination(s)`, matching the line-map header and the schema row) |
| 064 | out-of-scope-table-missing-status-column                                | fixed  | low  | The schema row claimed `status` applied to `all` tables, but the Out-of-scope rows table uses `id / invariant / v1 source / out-of-scope reason / future seam` (no `status` column) — schema overclaimed scope | schema-row-corrected (status field now scoped to `line-map; prose-only invariants; probe targets`; description explains that Out-of-scope rows are implicitly `closed-not-in-u1-scope` and use `out-of-scope reason + future seam` instead, and Removed-by-design rows have their own structure) |
| 065 | removed-by-design-table-structure-undefined                             | fixed  | low  | The Removed-by-design rows section described its intent but did not declare the table schema, leaving future rows unclear about whether they'd carry `status`/`v2 destination(s)`/`owner unit` | matrix-section-corrected (Removed-by-design section now declares the explicit column schema `id / invariant / v1 source / removal reason / rationale location`, with `status` implicitly `removed` and no `v2 destination(s)` or `owner unit` columns) |
| 066 | clean-tree-precondition-row-misnames-blank-line-as-rule-start            | fixed  | low  | The `clean-tree-precondition` out-of-scope row's annotation said `clean-tree rule at L277-283`, but L277 is structurally a blank line; the rule body actually starts at L278 | matrix-row-corrected (annotation now reads `clean-tree rule body at L278-283`, with the blank at L277 explicitly named as structural and unassigned by convention) |
| 067 | confirmation-state-routing-readme-l178-l188-collides-with-readme-helper-ledger-row | fixed | low | The out-of-scope `confirmation-state-routing` row cited README L178-188 for the `### Confirmation State` section, but the mapped `readme-helper-ledger-and-turn-protocol` row claimed L161-189, double-claiming the same lines | matrix-rows-corrected (mapped row clipped to `L161-175, L239-258, L348-414`; out-of-scope row extended to `README L176-189` so the full `### Confirmation State` section sits in the out-of-scope table; mapped row's current-contract cell gets a pointer note) |
| 068 | probe-startup-route-v1-source-anchor-off-by-one                         | fixed  | low  | `probe-startup-route` cited `issue-to-pr.md L307-313` for the routing language, but sweep-6 row 056 extended the `confirmation-state-routing` out-of-scope row to start at L306 (sentence opener); the probe row's anchor was stale | matrix-row-corrected (probe row v1 source updated from `L307-313` to `L306-313` to match the post-sweep-6 routing-language range) |
| 069 | probe-cli-state-v1-source-anchor-includes-out-of-scope-line              | fixed  | low  | `probe-cli-state` cited `issue-to-pr.md L304-306` for the helper-command reference, but L306 is the sentence opener owned by the `confirmation-state-routing` out-of-scope row post-sweep-6 | matrix-row-corrected (probe row v1 source narrowed to `issue-to-pr.md L304` for the helper-command bullet, with an explicit cross-reference noting that the routing prose at L306-313 lives in the out-of-scope row) |
| 070 | schema-invariant-field-name-mismatches-probe-target-column               | fixed  | low  | The schema row's `Field` cell named `invariant` for both the prose-only invariants table (header column `invariant`) and the probe targets table (header column `probe target`), but the names don't match literally | schema-row-corrected (Field cell now reads `\`invariant\` / \`probe target\``, with the `Tables` cell naming which sub-table uses which header literally) |
| 071 | probe-startup-route-multi-destination-not-explicitly-sliced              | fixed  | low  | `probe-startup-route` listed two v2 destinations but the cell qualified them only by role, not by the v1 slice each owned; sibling multi-destination rows used explicit slice qualifications | matrix-row-corrected (destinations cell now reads `cli.ts state --json (planned, U4) owns the deterministic route facts at README L239-258; router reference in runbooks/issue-to-pr-v2/issue-to-pr.md (planned, U7) owns the prose pointer to the routing language at issue-to-pr.md L306-313`) |
| 072 | schema-invariant-field-tables-cell-omits-out-of-scope-and-removed-by-design | fixed | low | The `invariant` / `probe target` schema-row's `Tables` cell only listed `prose-only invariants` and `probe targets`, but the Out-of-scope rows table and the Removed-by-design rows table also use `invariant` as a column header. Same under-scoping pattern row 064 fixed for `status`. | schema-row-corrected (`Tables` cell extended to `prose-only invariants (invariant); probe targets (probe target); Out-of-scope rows (invariant); Removed-by-design rows (invariant)`) |
| 073 | host-readiness-row-post-dispatch-anchor-includes-pre-dispatch-lines      | fixed  | low  | The `host-readiness-vs-infra-failure` row cited `issue-to-pr.md L702-714 (pre-dispatch) and L1042-1054 (post-dispatch)`, but L1042-1044 is the pre-dispatch retry guard (`host-builder-tools-unavailable`, second occurrence inside `## Inner loop`), not the post-dispatch `builder-infrastructure-failure` rule which actually runs L1046-1054 | matrix-row-corrected (v1 source split into three discrete spans: `L702-714` for Stage 4 pre-dispatch, `L1039-1044` for the inner-loop pre-dispatch repeat, and `L1046-1054` for the post-dispatch rule, each labeled with which blocked_reason it owns) |
| 074 | stage-4-row-omits-host-adapters-destination-for-l702-l714                | fixed  | low  | Line-map `issue-to-pr-stage-4-batch-loop` (L683-753) routed everything to `stage-4-batch-loop.md`, but `host-readiness-vs-infra-failure` invariant routed L702-714 to `host-adapters.md`; the line-map row's current-contract cell named "host readiness" without crediting the second destination | matrix-row-corrected (Stage 4 row now lists two destinations qualified by v1 slice: `stage-4-batch-loop.md` at L683-701 + L715-753, and `host-adapters.md` at L702-714) |
| 075 | stage-5-row-omits-stage-4-batch-loop-destination-for-l806-l886           | fixed  | low  | Line-map `issue-to-pr-stage-5-final-review` (L755-901) routed everything to `stage-5-final-review.md`, but `final-review-patch-decision-tree` (L806-886) and `smallest-contract-patch-heuristic` (L872-879) invariants routed the patch-batch logic to `stage-4-batch-loop.md` per the U2 plan note ("Move final-review patch-batch remediation into stage-4-batch-loop.md; keep stage-5-final-review.md as a read-only review gate") | matrix-row-corrected (Stage 5 row now lists two destinations qualified by v1 slice: `stage-5-final-review.md` at L755-805 + L887-901 (read-only gate), and `stage-4-batch-loop.md` at L806-886 (patch-batch decision tree + smallest-contract-patch heuristic)) |
| 076 | inner-loop-row-omits-host-adapters-destination-for-l1042-l1054           | fixed  | low  | Line-map `issue-to-pr-inner-loop-and-builder-rules` claimed post-dispatch readiness routing at L1038-1055 → `stage-4-batch-loop.md`, but `host-readiness-vs-infra-failure` invariant routed L1042-1054 (and L1039-1044 after row 073 correction) to `host-adapters.md`; two contradictory destinations for the same lines | matrix-row-corrected (inner-loop row now lists three destinations qualified by v1 slice: `builder-dispatch.md` at L1056-1109 (Builder rules), `stage-4-batch-loop.md` at L1017-1035 + L1038, L1055 (loop diagram + inner-loop framing), and `host-adapters.md` at L1039-1044 + L1046-1054 (host-readiness boundary)) |
| 077 | mechanical-diff-fallback-line-map-destination-contradicts-invariant-destination | fixed | low | Line-map `issue-to-pr-stage-5-final-review`'s first slice (L755-805 → `stage-5-final-review.md`) included L784-793 (Mechanical-diff fallback), but the prose-only invariant row `mechanical-diff-fallback` (closed by row 009) routed L784-793 to `findings-and-validators.md`. Latent cross-table destination contradiction that pre-dated sweep-9 and wasn't surfaced earlier. | matrix-row-corrected (Stage 5 row's `stage-5-final-review.md` slice carved into `L755-783 + L794-805 + L888-901`; new third destination `findings-and-validators.md` added qualified by L784-793; current-contract cell gains a pointer note referencing the `mechanical-diff-fallback` invariant) |
| 078 | stage-5-row-destination-slice-claims-structural-blank-at-l887            | fixed  | low  | Stage 5 row's `stage-5-final-review.md` slice annotation read `at L755-805 and L887-901`, but L887 is a structural blank between the patch-batch inner loop (L886) and step 5 (L888); per the convention, structural blanks are unassigned by design | matrix-row-corrected (folded into the row 077 fix — the closure slice now reads `L888-901` so L887 sits as an unassigned bridging blank between the L806-886 stage-4-batch-loop.md slice and the closure slice) |
| 079 | inner-loop-row-destination-slice-claims-structural-blanks-l1038-l1055     | fixed  | low  | Inner-loop row's `stage-4-batch-loop.md` slice annotation named structural blanks L1038 and L1055 as substantive content anchors ("inner-loop framing/iteration-cap context at L1038, L1055"), contradicting the convention that structural blanks are unassigned by design | matrix-row-corrected (slice annotation now names only the loop diagram at L1017-1035 as substantive content; current-contract cell explicitly notes that the blanks at L1038, L1045, L1055 bridge slices and are unassigned by convention) |
| 080 | stage-5-row-slice-claims-bridging-blanks-at-l783-and-l794                 | fixed  | low  | Row 077's three-destination Stage 5 split introduced new bridging blanks at L783 (between step 2 prose and Mechanical-diff fallback) and L794 (between fallback and step 3); only L887 was carved out cleanly by row 078, leaving L783/L794 still claimed as substantive content in the `stage-5-final-review.md` slice annotation | matrix-row-corrected (Stage 5 row's `stage-5-final-review.md` slice anchors changed from `L755-783 and L794-805` to `L755-782 and L795-805`; current-contract cell now explicitly enumerates all three bridging blanks L783, L794, L887 as unassigned by convention) |
| 081 | mechanic-discipline-readme-glossary-cross-table-destination-unresolved   | fixed  | low  | The `mechanic-discipline` prose-only invariant cited `README.md L343-344` as a second v1 source and routed it to `builder-dispatch.md`, but the line-map row `readme-fix-risk-and-glossary` claimed `README.md L260-346` (including L343-344) routed to `findings-and-validators.md`; cross-table destination contradiction for the two-line glossary pointer | matrix-row-corrected (the `mechanic-discipline` invariant's v1 source narrowed to `issue-to-pr.md L133-138` (the canonical rule body); a note explains the two-line README glossary pointer at L343-344 stays with the `readme-fix-risk-and-glossary` line-map row as a definitional cross-reference, with the v2 findings-and-validators glossary keeping a pointer to the canonical rule in builder-dispatch.md) |
| 082 | host-readiness-readme-glossary-cross-table-destination-unresolved        | fixed  | low  | The `host-readiness-vs-infra-failure` prose-only invariant cited `README.md L337-342` (Host Builder readiness failure + Builder infrastructure failure glossary entries) and routed them to `host-adapters.md`, but the line-map row `readme-fix-risk-and-glossary` claimed `README.md L260-346` (including L337-342) routed to `findings-and-validators.md`; same cross-table destination contradiction shape as row 081 but at a different README slice | matrix-row-corrected (the invariant's v1 source narrowed to the three `issue-to-pr.md` canonical anchors (L702-714, L1039-1044, L1046-1054); a note explains the two-line README glossary entries at L337-342 stay with the `readme-fix-risk-and-glossary` line-map row as definitional cross-references; v2 findings-and-validators glossary keeps a pointer to the canonical boundary in host-adapters.md, mirroring the row 081 resolution) |
| 083 | probe-cli-state-readme-l180-l182-overlap-not-noted                      | fixed  | low  | The `probe-cli-state` row's parenthetical only noted that `issue-to-pr.md L306-313` falls within the out-of-scope `confirmation-state-routing` row, but README L180-182 (the helper invocation block also cited in that row) also falls within the out-of-scope row's L176-189 range; row 069's precedent established that source-range overlaps with out-of-scope rows should be explicitly noted | matrix-row-corrected (parenthetical now reads that both L180-182 and L306-313 fall within ranges tracked separately in the out-of-scope row, and clarifies that the out-of-scope row carries no v2 destination so no destination contradiction is induced) |

## Notes

### Sweep 1 corroborating evidence

The first /ce-code-review wave returned 26 findings across four personas. Dedupe collapsed them to 21 unique rows above. Roll-up findings from ce-project-standards-reviewer (`prose-rows-missing-v1-source-anchors`, `rows-missing-v1-v2-scenario-evidence`, `rows-missing-v2-destination`, `prose-rows-missing-owner-unit`) are corroborating evidence for the per-row `*-no-v2-home` findings, not separate rows.

### Risk classification

Rows 001-021 were **low risk** per `docs/runbooks/issue-to-pr-v2-refactor/README.md#risk-classification-auto-fix-gate`. Allowed auto-fix scope is:

- Additive rows in `runbooks/issue-to-pr-v2/references/regression-matrix.md`
- Edits to existing matrix rows (filling _TBD_ cells with v1 source anchors, v2 destinations, scenario evidence, owner units)
- Typo and link fixes inside the matrix

### Sweep 1 resolution summary (turn 2)

Rows 001-021 closed in turn 2 via low-risk additive edits:

- Rows 001-017 (`*-no-v2-home`): filled the regression matrix with v1 source anchors, v2 destinations (mostly `references/builder-dispatch.md`, `references/stage-4-batch-loop.md`, `references/findings-and-validators.md`, `references/host-adapters.md` per U2's planned file list; `cli.ts state --json` and `cli.ts diagnose --json` per U4 for probe targets), v1/v2 scenario sentences, and owner units. All `_TBD_` cells now hold content.
- Row 018 (`source-plan-link-broken`): extracted `docs/plans/2026-05-22-002-refactor-issue-to-pr-v2-runbook-plan.md` from commit `eff9591` (branch `codex/issue-to-pr-v2-runbook-plan`) so the link resolves on this branch. Plan file is now untracked locally, ready to commit alongside the matrix and ledger updates.
- Rows 019, 020 (`*-not-in-matrix`): closed with `not-in-u1-scope` after recording both in the matrix's new "Out-of-scope rows" section so future sweeps don't re-surface them. The matrix names the likely future seam for each (U7 hot-router cutover, U2 + U7 stage shells).
- Row 021 (`probe-installed-reference-presence-owner-unit-contradicts-probe-column`): corrected the matrix row's owner unit from U6 to U4. U4 owns the `cli.ts diagnose --json` surface per the plan; the previous U6 pre-fill was a stub error.

### Sweep 2 review patch (turn 3)

Rows 024-028 closed via low-risk documentation edits:

- Row 024 (`u1-line-map-missing`): updated the seam runbook to require U1 line-map coverage, then added `## Current contract line-map (U1 scope)` to the matrix. The line-map covers major sections in `issue-to-pr.md`, `README.md`, and `issue-N-ledger.template.md`, plus grouped `decompose.ts` command modes.
- Row 025 (`installed-reference-presence-v1-anchor-wrong`): corrected the installed reference/template presence row from the confirmation-state lines to the actual ledger template copy instruction.
- Row 026 (`fix-protocol-placeholder`): replaced the README placeholder with a concrete shared fix protocol for low/high risk findings, read-only source boundaries, ledger updates, and re-review.
- Row 027 (`runbook-version-row-unescaped-table-pipes`): rewrote the version-skew values without raw pipe separators so the matrix row stays parseable as Markdown.
- Row 028 (`shadow-v2-folder-topology-not-reflected`): updated the plan, seam runbook, README, and regression matrix so the v2 build target is `runbooks/issue-to-pr-v2/` and v1 remains the runnable/reference source.

### Open-decision rows (pending-nathan) — RESOLVED

Rows 019 and 020 are now closed with `not-in-u1-scope` per the seam's "Closing a finding without fixing it" convention. The default "close with `not-in-u1-scope`" path was taken because the safer option lets U1 converge and both invariants are now recorded in the matrix's out-of-scope section, so they will not silently disappear from a future seam's reach.

### Sweep 3 review patch (turn 4)

Rows 028-036 closed via low-risk additive matrix edits. Sweep ran the four
suggested personas in parallel (`ce-correctness-reviewer`,
`ce-coherence-reviewer`, `ce-scope-guardian-reviewer`,
`ce-project-standards-reviewer`) against the expanded seam (line-map + prose
invariants + probe targets). After dedupe across persona reports:

- Row 028 (`scoped-audit-prompt-row-status-contradicts-destination`): the
  row's `status: removed` + `removed-by-design:` destination disagreed with
  the destination text, which actually preserves the rule (load review
  references; ce-code-review keeps the prompt). Flipped to `status: mapped`
  pointing at `references/stage-5-final-review.md`.
- Rows 029, 030, 031, 032 (line-map overlap and uncovered-section findings):
  partitioned the helper rows into non-overlapping `decompose.ts` spans,
  partitioned the README rows into discrete non-overlapping spans, and
  extended the invocation/driver row to cover both `## Why these seams`
  (L140-145) and `## What this area deliberately does not do` (L434-459).
- Row 033 (`close-and-loop-fallback-range-truncated`): extended the range
  from `L1288-1310` to `L1288-1313` to cover the closing fence of the `/loop`
  code block.
- Row 034 (`helper-default-plan-emit-mode-not-in-line-map`): added
  `helper-decompose-default-mode` for the flag-less `decompose.ts <plan-path>`
  parse-and-emit behavior; v2 destination is `lib/validate.ts` for parse plus
  the `decompose.ts` compatibility shim for emit.
- Row 035 (`personas-findings-and-hatches-mixed-destination`): split the
  L982-1211 row into a persona+findings row (→ `findings-and-validators.md`)
  and an inner-loop+Builder-rules row (→ `builder-dispatch.md` for Builder
  rules and `stage-4-batch-loop.md` for loop structure, iteration cap, and
  post-dispatch readiness routing).
- Row 036 (`line-range-convention-undocumented`): added a convention note to
  the line-map header naming the trailing-blank-line rule, the non-overlapping
  partition requirement, and the discrete-span form used by rows whose v2
  destination covers non-contiguous v1 regions.

### Sweep 4 review patch (turn 5)

Rows 037-046 closed via low-risk matrix-only edits to the migrated matrix at
`runbooks/issue-to-pr-v2/references/regression-matrix.md`. Sweep-4 ran the same
four personas (`ce-correctness-reviewer`, `ce-coherence-reviewer`,
`ce-scope-guardian-reviewer`, `ce-project-standards-reviewer`) against the
post-sweep-3 matrix. Mid-sweep, the matrix was migrated to a shadow v2 folder
per the externally added row 028 (`shadow-v2-folder-topology-not-reflected`);
sweep-4 fixes were applied to the migrated copy. After dedupe:

- Rows 037, 041 (partition violations the sweep-3 fixes left behind):
  `helper-decompose-default-mode` and `helper-patch-proposal-mode` claimed
  decompose.ts lines that belong to the shared dispatcher (L2144, L2157-2159).
  Both lines moved into `helper-compat-entrypoint-and-usage`; the two
  helper-mode rows now only span their mode-specific code.
- Rows 038, 039 (mid-content cuts): extended `issue-to-pr-builder-dispatch-contract`
  to L265 and `readme-fix-risk-and-glossary` to L346 so the rows include
  the trailing sentences they previously cut.
- Row 040 (ledger template gap): added `ledger-template-title-and-pointer`
  for `issue-N-ledger.template.md L22-27`, the title placeholder and
  format/protocol pointer prose that had no v2 home.
- Row 042 (escape-hatches collision): clipped
  `issue-to-pr-personas-and-findings`'s upper span from L1211 to L1195 so
  the L1196-1211 escape-hatches range only appears in the Out-of-scope rows
  section, restoring the partition.
- Rows 043, 044 (dual-destination rows without convention support): expanded
  the line-range convention note to explicitly authorize multi-destination
  cells when a single coherent v1 unit splits cleanly across v2
  destinations (parse vs. emit; Builder rules vs. loop structure).
- Row 045 (too-strong partition claim): softened the convention from "a line
  belongs to exactly one row" to "each substantive content line belongs to
  exactly one row," with structural blanks and `---` separators explicitly
  unassigned.
- Row 046 (ledger id collision): both rows numbered 028 stay as-is; the
  resolution notes that the externally added `shadow-v2-folder-topology-not-reflected`
  row predated this sweep's renumbering opportunity, and future citations
  treat it as `028a` to avoid ambiguity.

### Sweep 5 review patch (turn 5, continued)

Rows 047-052 closed via low-risk matrix-only edits. Sweep-5 re-ran the four
personas after sweep-4 fixes. Two persona reports (correctness,
project-standards) returned ZERO NEW FINDINGS. The remaining two found six new
issues across two themes:

- Rows 047, 048 (intro/header contradicts convention): renamed the column
  header from `primary v2 destination` to `v2 destination(s)` and rewrote the
  intro paragraph to say "one or more v2 destinations" so the schema, intro,
  and convention all agree.
- Rows 049, 050, 051, 052 (partition collisions with out-of-scope rows):
  three remaining out-of-scope/mapped collisions (`clean-tree-precondition`
  at L277-283, `confirmation-state-routing` at L307-313, `iteration-cap` at
  L1036-1037) were the same shape as row 042's escape-hatches collision and
  applied the same fix pattern: clip the mapped row to a non-contiguous span
  that carves out the out-of-scope lines, with a pointer note in the mapped
  row's current-contract cell. Row 052 additionally trimmed the
  `iteration-cap` out-of-scope row's range to remove an L1056-1057 overshoot
  that claimed lines owned by the Builder rules mapping.

### Sweep 6 review patch (turn 6)

Rows 053-058 closed via low-risk matrix-only edits. After sweep-5 returned
zero new findings from two of four personas, sweep-6 ran the same four
personas to verify and uncovered residual artifacts from the partial
clean-tree/confirmation-state carve-outs and a forgotten schema row update.

- Rows 053, 054 (schema row left behind): the `## How rows work` field
  description and field name lagged behind the column-header rename. Updated
  the schema to use `v2 destination(s)` with multi-destination authorization,
  added a `Tables` column, and added a `current contract` row for the
  line-map.
- Rows 055, 056, 057 (full clean-tree + resumed-routing carve-outs): the
  earlier carve-outs were narrower than the v1 invariant footprints. Sweep-6
  extended `clean-tree-precondition` to span `L276-291` (heading + all three
  paragraphs) and `confirmation-state-routing` to span `L306-313` (full
  sentence + four-state catalog). The mapped row now claims only
  `L295-305, L314-337` — the genuinely stage-routing prose around the helper
  command, leaving the two carved-out invariants entirely in the Out-of-scope
  rows section.
- Row 058 (pointer-note convention): closed as `not-in-u1-scope`; the
  pointer-note pattern is a one-line readability aid and codifying a formal
  convention risks scope creep. A future seam (likely U2 or U8) can codify
  the `current contract` cell format when it's ready.

### Post-Ralph seam alignment patch

Rows 059-062 closed after the sweep-6 matrix fixes. These were seam-language
alignment issues rather than new matrix coverage gaps: the scoped audit prompt,
shared fix protocol, startup-route probe destination, and local U1 plan now all
agree with the shadow-folder model and the matrix's multi-destination convention.

### Sweep 7 review patch (turn 7)

Rows 063-071 closed via low-risk matrix-only edits. Sweep-7 ran the four
personas after sweep-6 fixes, finding nine new findings around three themes:

- Rows 063, 064, 065, 070 (schema/header drift): sweep-5 renamed the line-map
  header to `v2 destination(s)` and sweep-6 updated the schema row, but the
  prose-only invariants and probe targets table headers stayed singular and
  the schema's `Tables: all` scope overclaimed (Out-of-scope and
  Removed-by-design tables use different schemas). Sweep-7 renamed both
  remaining headers to `v2 destination(s)`, narrowed the schema's `Tables`
  cells for `v2 destination(s)`, `owner unit`, and `status` to the three
  destination-carrying tables, and declared the Removed-by-design schema
  explicitly. Sweep-7 also fixed the `invariant`/`probe target` field-name
  mismatch in the schema row.
- Rows 066, 067 (README partition residues): the sweep-6 fixes for
  `clean-tree-precondition` and `confirmation-state-routing` were applied to
  the issue-to-pr.md anchors but missed the README L178-188 citation (which
  the mapped `readme-helper-ledger-and-turn-protocol` row claimed at L161-189)
  and a blank-line misnamed as rule-body in the annotation. Sweep-7 clipped
  the README mapped row to `L161-175, L239-258, L348-414` and extended the
  out-of-scope row to the full `### Confirmation State` section at L176-189;
  corrected the rule-body anchor from L277 to L278.
- Rows 068, 069, 071 (probe-row stale anchors): the sweep-6 extension of
  `confirmation-state-routing` to start at L306 left two probe rows with
  stale anchors that double-claimed the new out-of-scope lines, and the
  `probe-startup-route` row's multi-destination cell qualified by role rather
  than v1 slice. Sweep-7 narrowed `probe-cli-state` to the helper-command
  bullet at L304, updated `probe-startup-route` to L306-313, and rewrote its
  destinations cell to qualify each destination by the v1 slice it owns.

### Sweep 9 review patch (turn 8)

Rows 073-076 closed via low-risk matrix-only edits. Sweep-9 ran the four
personas after sweep-8's schema fix; three personas (coherence, scope-guardian,
project-standards) returned ZERO NEW FINDINGS. Correctness surfaced four new
findings about cross-table destination contradictions between line-map rows
and prose-only invariant rows:

- Row 073 fixed the `host-readiness-vs-infra-failure` v1 source range. The
  previous cite of `L1042-1054` for post-dispatch mixed pre-dispatch retry
  guard lines (L1042-1044) with the post-dispatch rule (L1046-1054). Split
  into three discrete spans labeled by which `blocked_reason` each owns.
- Rows 074, 075, 076 fixed three line-map rows that named single
  destinations even though prose-only invariants within their ranges routed
  to different references. Stage 4 now credits `host-adapters.md` for the
  pre-dispatch host-readiness check (L702-714). Stage 5 now credits
  `stage-4-batch-loop.md` for the patch-batch decision tree (L806-886) per
  the U2 plan's "move final-review patch-batch remediation into
  stage-4-batch-loop.md" approach. The inner-loop-and-builder-rules row now
  credits `host-adapters.md` for the inner-loop pre-dispatch repeat
  (L1039-1044) and post-dispatch infra-failure rule (L1046-1054).

All multi-destination cells are qualified by the v1 slice each destination
owns, per the convention.

### Sweep 10 review patch and final convergence (turn 9)

Rows 077-083 closed via low-risk matrix-only edits. The final sweep cleaned up
the remaining cross-table destination contradictions and source-overlap notes
that appeared after the Stage 4, Stage 5, inner-loop, glossary, and
confirmation-state slices were split into qualified destinations.

After those fixes, Ralph's convergence pass reported ZERO NEW FINDINGS from all
four U1 reviewer personas:

- `ce-correctness-reviewer`
- `ce-coherence-reviewer`
- `ce-scope-guardian-reviewer`
- `ce-project-standards-reviewer`

Every ledger row is now `fixed` or `closed`; U1 has no known open findings.

### Source plan availability (finding 018) — RESOLVED

Plan file extracted via `git show eff9591:docs/plans/2026-05-22-002-refactor-issue-to-pr-v2-runbook-plan.md > docs/plans/2026-05-22-002-refactor-issue-to-pr-v2-runbook-plan.md`. The file is currently untracked on this branch (`codex/48-issue-to-pr-v2-runbook-refactor`) and needs to be committed alongside the matrix and ledger updates. Once the codex plan PR merges to main, this file will already exist and the local copy can be reconciled in the merge.
