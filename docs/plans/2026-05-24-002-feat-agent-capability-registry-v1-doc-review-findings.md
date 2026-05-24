---
title: "Doc Review Findings: Agent Capability Registry v1 Plan"
type: review-handoff
status: open
date: 2026-05-24
source_doc: docs/plans/2026-05-24-002-feat-agent-capability-registry-v1-plan.md
review_run: ce-doc-review round 1
reviewers:
  - ce-coherence-reviewer
  - ce-feasibility-reviewer
  - ce-product-lens-reviewer
  - ce-security-lens-reviewer
  - ce-scope-guardian-reviewer
  - ce-adversarial-document-reviewer
already_applied:
  - "Terminology: canonical copy → canonical capability (Summary, R1, Key Tech Decisions ×2)"
  - "U6 Requirements line: added R6"
  - "U7 'Requirements: R1-R18' → 'Verification: R1-R18 (end-to-end integration; primary ownership in U1-U6)'"
---

# Doc Review Handoff: Agent Capability Registry v1

## Purpose

This file is a handoff dossier from ce-doc-review round 1 to whoever picks up the plan next (next agent, future Nathan, or a follow-up implementation agent). It contains:

- The full list of remaining findings (36) with severity, evidence, why-it-matters, and suggested fix.
- A recommended response trade — which findings to apply now, which to defer, which to drop.
- Pointers to the source plan and origin spec so the next agent can verify before acting.

The 6 safe-auto edits already applied to the plan are listed in frontmatter and not repeated below.

---

## How to use this dossier

1. Read the source plan: `docs/plans/2026-05-24-002-feat-agent-capability-registry-v1-plan.md`.
2. Read the origin spec to understand what's settled vs net-new: `docs/specs/agent-capability-registry.md`.
3. Read the child plan that motivates the secret-bearing path: `docs/plans/2026-05-24-001-feat-one-password-capability-plan.md`.
4. Work through Section "Recommended response trade" — those are the calls I'd make if I were the next agent.
5. For each call you accept, edit the plan inline. For each call you reject, mark it in Section "Decisions log" at the bottom so the next round of review can suppress re-surfacing.

Sections "Tier 1 — Manual" and "Tier 2 — Gated-auto" are the full inventory. Section "Tier 3 — FYI" is informational only.

---

## Recommended response trade

The trade-off I'd recommend if you're picking this up cold:

**Apply now (low risk, high clarity gain) — 14 findings:**

- T2-22: Drop bare extensionless CLI files, use `.ts` + shebang (matches every other repo CLI)
- T2-23: Replace the YAML pause-clause with `Bun.YAML.parse` (Bun 1.3.11 ships it natively)
- T2-26: Split R14 into R14a (shape validation, U2) + R14b (collision detection, U5)
- T2-27: Document install-target precedence (per-capability overrides defaults)
- T2-29: Note that each unit composes the same `lib/` surface; U1 establishes module patterns
- T2-30: Split U1/U2 fixture into `shape-valid.yml` and `fully-valid.yml`
- T2-31: Drop `x_` extension namespace from v1
- T2-32: Accept `aliases: []` and `replaces: []` as no-ops in v1
- T2-33: Recognize all 4 risk flags but only `secret_bearing` and `writes_files` trigger validators in v1
- T2-34: Collapse "Scope Boundaries" + "Deferred To Follow-Up Work" into one "Out of scope for v1" section
- T2-35: Absorb U8 into U7's completion checklist (remove U8)
- T1-17: Reword Summary — "prove the read-side lifecycle (snapshot → canonical → validation → dry-run install)" not "the whole lifecycle"
- T1-2: Add path-confinement validation for `canonical_path`/`snapshot_path`/`upstream_path` under `capabilities/`
- T1-3: Name `node:fs/promises.copyFile` (not `Bun.write`) as the file-copy primitive in Key Technical Decisions

**Apply now with conservative defaults (security-critical, can refine later) — 4 findings:**

- T1-4: Constrain `collision_policy.replaces` entries to paths under the declared install target root
- T1-9: Add snapshot leakage scan to `add-from-source` (block real token prefixes and PEM blocks; warn elsewhere)
- T1-10: Name a minimum pattern floor (PEM, AWS AKIA `AKIA[A-Z0-9]{16}`, 1Password `ops_`, JWT, SSH key headers) and a concrete entropy threshold (≥40 chars, Shannon ≥ 3.5 bits/char, exclude UUIDs)
- T2-25: Block executable bit on non-text files (assert valid shebang or UTF-8 text)

**Defer (real cost, gain is hypothetical until first consumer arrives) — 6 findings:**

- T1-12: `add-from-source` workflow (U6) — defer to "3rd capability onboarding" plan
- T1-13: Overlay application code (U5 `lib/overlay.ts`) — defer until first capability needs a real harness edge
- T1-14: Codex dry-run install — defer to v1.5; ship Claude Code only in v1
- T1-15: `installed` and `retired` lifecycle status validation — defer to real-install plan
- T1-16: `ADAPTATIONS.md` per canonical — defer to update/three-way-diff plan
- T1-18: `source.yml` schema — defer to update/three-way-diff plan

**Manual decisions for Nathan (do not apply unilaterally) — 8 findings:**

- T1-1: Overlay rules subsection — write it before U5 implementation. Block on this one; an implementer cannot proceed without it.
- T1-5: Bootstrap paradox — pick: install `ce-plan` under a different name, or block install with explicit shadow warning.
- T1-6: Dry-run-only v1 value-shape — Nathan to confirm whether v1 ships infrastructure or shrinks to validation-plus-add.
- T1-7: Bundling `one-password` + `ce-plan` — Nathan to choose coupled vs sequenced ship.
- T1-8: Cross-harness primitive mismatch for `ce-plan` — pick: drop, overlay-replace, or harness-neutral rewrite.
- T1-11: Per-source leakage blocklist — Nathan to confirm the `leakage_blocklist:` shape on source entries.
- T1-19: Add `marketplace:` field to `local-plugin` source kind — Nathan to confirm naming.
- T1-20: Snapshot content hash — Nathan to choose hash-verify vs demote `pinned` to provenance.

**Apply opportunistically — 4 findings:**

- T1-21: Rename negative fixtures from `SKILL.md` to `SKILL.unsafe-fixture.md`. Apply when implementing U3/U4.
- T2-24: Note in U5 Approach that Codex collisions will hit plugin-installed skills. Apply when implementing U5.
- T2-28: Define "likely dependency reference" as `[[name]]` markdown wiki links matching declared capabilities. Apply when implementing U2.
- T2-36: Add fallback note to "Source Inputs For First Slice" — plugin cache is the fallback if canonical `ce-plan` adaptation breaks. Apply when documenting `ce-plan`.

**Reject (low value relative to cost or contradicts plan intent) — 0 findings.**

---

## Tier 1 — Manual (21 findings)

### T1-1 — Overlay rules claimed deterministic but never specified
- **Severity:** manual | **Confidence:** 100 | **Reviewers:** feasibility, adversarial
- **Section:** U5 Approach
- **Evidence:** "Apply target overlays by mirrored folder replacement/merge rules that are deterministic and easy to explain."
- **Why:** Undefined cases will lock in accidental semantics: (a) overlay file not in canonical — add or error? (b) overlay file at same path — replace or merge frontmatter? (c) overlay has `SKILL.md` while canonical has `SKILL.md.tmpl` — two outputs or replace? (d) executable bit precedence? (e) directory merge or wholesale replace? (f) can overlay delete a canonical file? Bootstrap-paradox finding implies ce-plan likely needs (f).
- **Fix:** Add "Overlay Application Rules" subsection to U5 with numbered rule per case; each rule becomes a U5 test scenario.

### T1-2 — Path traversal in manifest paths unguarded
- **Severity:** manual | **Confidence:** 100 | **Reviewer:** security
- **Section:** Manifest Schema, U2, U3
- **Evidence:** `upstream_path: skills/one-password`, `canonical_path: capabilities/canonical/skills/one-password` — all user-controlled strings parsed from YAML.
- **Why:** A manifest with `canonical_path: ../../etc/passwd` or `upstream_path: ../../../home/peter/.ssh/id_rsa` would be accepted by a naive parser. `add-from-source` performs file copies using `upstream_path`. Complete privilege boundary failure.
- **Fix:** U2 must normalize and confine all path fields under `capabilities/` relative to repo root. Emit hard error `capability.path_traversal` if any path escapes. Check runs before any file system operation.

### T1-3 — `Bun.write` strips executable bits; R17 will silently break
- **Severity:** manual | **Confidence:** 100 | **Reviewer:** feasibility
- **Section:** R17, U3, U5, U6
- **Evidence:** R17 asserts executable bit preservation. Plan doesn't name copy primitive.
- **Why:** Verified: `Bun.write(path, contents)` writes at mode 0644 regardless of source; `node:fs/promises.copyFile` preserves source mode. If implementer reaches for Bun-idiomatic `Bun.write(dst, Bun.file(src))`, install and add-from-source silently strip exec bit, then validation in U3 flags the files the installer just wrote.
- **Fix:** Key Technical Decisions: "File copies that must preserve mode bits use `node:fs/promises.copyFile`. `Bun.write` is content-only and resets mode to 0644 — never use it for snapshot/canonical/overlay/install file copies." Add U3 test: copy 0755 fixture, assert destination is 0755.

### T1-4 — `collision_policy.replaces` has no cap on what can be replaced
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** security
- **Section:** Manifest Schema, R14
- **Evidence:** `collision_policy: { owns_existing: false, replaces: [] }` — no constraint stated.
- **Why:** `replaces: ["~/.claude/CLAUDE.md"]` would bypass collision block. Manifest-controlled bypass with no path constraint.
- **Fix:** U2 validation must constrain `replaces` entries to paths under the install target root for the relevant harness, and inside the installing capability's expected subtree.

### T1-5 — Bootstrap paradox: ce-plan shadow collision with plugin cache
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** adversarial
- **Section:** U7, Key Technical Decisions (ce-plan selection)
- **Evidence:** `~/.claude/skills` is a symlink to this repo's `skills/` (verified via install.sh). Installing canonical `ce-plan` collides with `~/.claude/plugins/cache/every-marketplace/compound-engineering/3.8.4/skills/ce-plan/`.
- **Why:** Claude Code skill discovery is name-based. Two skills called `ce-plan` will collide. Plan doesn't specify discovery winner or how user knows which version ran.
- **Fix:** Add U5 test scenario: "When canonical `ce-plan` would install alongside a plugin-supplied `ce-plan`, validation MUST block by default and dry-run output MUST surface the shadow." Or scope `ce-plan` to install under a non-conflicting name.

### T1-6 — Dry-run-only v1 ships infrastructure with no usable capabilities
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** product
- **Section:** Summary, Scope Boundaries, U5
- **Evidence:** "Do not install into real Claude Code or Codex skill/agent directories in v1 until dry-run output and collision checks are proven."
- **Why:** After v1 ships, `one-password` and `ce-plan` exist in `capabilities/canonical/` but aren't usable. v1 delivers governance without use. Motivation decays between v1 ship and follow-up real-install plan.
- **Fix:** Either (a) include real writes for `one-password` only behind dry-run preview, or (b) remove the installer from v1 and ship validation + add-from-source only. Or make the v1 user-value statement explicit in Summary.

### T1-7 — Bundling `one-password` + `ce-plan` couples ship dates
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** product
- **Section:** Summary, Source Inputs, U7
- **Evidence:** "The first implementation slice should prove the whole lifecycle with two capabilities."
- **Why:** `one-password` exercises secret-bearing (hardest); `ce-plan` exercises writes-file (lower novelty). Bundling means a rework in either blocks v1. Sequencing `one-password` first lets v1 land sooner with hardest case proven.
- **Fix:** Split U7 into U7a (one-password) and U7b (ce-plan). Or name the coupling bet explicitly.

### T1-8 — Cross-harness primitive mismatch unresolved for `ce-plan`
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** adversarial
- **Section:** Leakage policy, U5, U7
- **Evidence:** ce-plan in compound-engineering plugin likely uses `AskUserQuestion`. Manifest declares `install.claude-code: true, codex: true`. Validator blocks wrong-harness primitives.
- **Why:** Three options, none chosen: drop primitive from canonical (breaks Claude Code prompting), keep canonical and overlay-remove for Codex (but overlay deletes undefined per T1-1), or rewrite canonical as harness-neutral (substantial rewrite contradicting U7's "smallest necessary adaptations").
- **Fix:** Pick now and add to U7: "Canonical ce-plan uses harness-neutral phrasing; overlays inject the concrete primitive at named insertion points." Add U5 test for overlay-injected primitive replacing a canonical placeholder token.

### T1-9 — Snapshot leakage not scanned
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** security
- **Section:** Leakage policy, U4
- **Evidence:** "Check canonical plus overlay output, not snapshots, for install-blocking leakage."
- **Why:** Snapshots are git-committed. Real tokens in upstream snapshots persist in this repo's history even after canonical is cleaned. History scrubbing is costly and disruptive.
- **Fix:** Add snapshot-admission check in `add-from-source` — block for real token prefixes, PEM blocks, `op://` references with non-placeholder vault names. Warn for ambiguous.

### T1-10 — Leakage pattern families unnamed; entropy threshold undefined
- **Severity:** manual | **Confidence:** 75-100 | **Reviewer:** security
- **Section:** Leakage policy, U4
- **Evidence:** "Common real token prefixes, long high-entropy values, private key blocks" — only three classes called out; no threshold for "long" or "high-entropy."
- **Why:** Validator ships with known gaps. SSH keys, JWT, OAuth, AWS AKIA, 1Password `ops_` prefix unnamed. "Long high-entropy" has no min length or algorithm, so implementer picks arbitrary threshold causing false positives on UUIDs/hashes — or permissive threshold missing real secrets.
- **Fix:** Enumerate minimum pattern floor: PEM block headers, `AKIA[A-Z0-9]{16}`, `ops_` prefix, JWT structure (3 base64url segments starting with `eyJ`), SSH key headers. Concrete entropy threshold: strings ≥ 40 chars with Shannon entropy ≥ 3.5 bits/char that aren't UUID-formatted. Or cite gitleaks rule set.

### T1-11 — "Source-specific personal" rule will devolve to hardcoded Peter list
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** adversarial
- **Section:** Leakage policy
- **Evidence:** "Source-specific personal names, accounts, vaults, tokens, socket names, or absolute paths."
- **Why:** Validator can't distinguish `Molty` (Peter-specific) from `Production` (generic) without per-source curation. Broad heuristics eat legitimate terms. Per-source curation is the only honest answer.
- **Fix:** Extend source entries with optional `leakage_blocklist:` field listing string literals known personal to that upstream (e.g., `["Molty", "steipete", "/Users/steipete"]`). Validation matches canonical text against union of blocklists.

### T1-12 — `add-from-source` ships before its pain exists
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** scope
- **Section:** U6, R16
- **Evidence:** Both v1 capabilities manually staged in U7. U6 builds CLI with no current consumer.
- **Why:** ~5 files of investment for a feature with zero current callers inside the plan.
- **Fix:** Remove U6 from v1. Defer to "3rd capability onboarding."

### T1-13 — Overlay system shipped without real consumer
- **Severity:** manual | **Confidence:** 50-75 | **Reviewers:** scope, product
- **Section:** R5, U1, U5, U7
- **Evidence:** U7: "Add overlays only for real harness differences discovered while adapting ce-plan." Both capabilities currently ship with no overlays.
- **Why:** Overlay application code exercised only by synthetic fixtures.
- **Fix:** Keep overlay directory stubs. Defer `overlay.ts` and overlay logic in `install-plan.ts` until first capability actually needs a harness edge.

### T1-14 — Dual-harness day-one doubles surface without confirmed Codex need
- **Severity:** manual | **Confidence:** 50-75 | **Reviewers:** scope, product
- **Section:** R15, U5, Manifest Schema
- **Evidence:** Manifest defaults both targets to true. U5 tests both. Origin spec doesn't require both on day one.
- **Why:** Claude Code is the primary active harness. Codex install tested only against fixtures since real writes deferred.
- **Fix:** Make Claude Code required v1 target; Codex optional. Add Codex when real writes land.

### T1-15 — `installed`/`retired` lifecycle unreachable in v1
- **Severity:** manual | **Confidence:** 50-75 | **Reviewers:** scope, adversarial
- **Section:** R8, U1, U2
- **Evidence:** "Validate lifecycle statuses: draft, tracked, installed, retired." U7: "Set both to tracked." Real install deferred.
- **Why:** Validator must accept `installed` but nothing legitimately reaches it. Behavior undefined: silent acceptance (manifest lies, validator agrees) or hard error?
- **Fix:** Either drop `installed` and `retired` from v1 enum (re-add when real install lands), or accept them but emit "not supported in v1" warning.

### T1-16 — No captured diff between snapshot and canonical
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** adversarial
- **Section:** Summary, Vocabulary, U7
- **Evidence:** Spec sells "reviewable: upstream snapshots and local adaptations are diffable" but plan never produces or stores diff.
- **Why:** Future upgrade workflow can't distinguish intentional adaptations from drift. Starts from amnesia.
- **Fix:** Add R19 + U2/U7 deliverable: each canonical capability folder includes `ADAPTATIONS.md` listing per-file intentional change categories.

### T1-17 — Summary's "prove the whole lifecycle" contradicts Scope Boundaries
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** scope
- **Section:** Summary, Scope Boundaries, U7
- **Evidence:** Summary: "prove the whole lifecycle with two capabilities." Scope: "Do not install into real Claude Code or Codex skill/agent directories in v1."
- **Why:** v1 proves draft + tracked only; `installed` and `retired` explicitly out. Calling this "the whole lifecycle" misleads reviewers and may give future implementers permission to add real install writes.
- **Fix:** Reword: "prove the registry read-side lifecycle (snapshot, canonical, validation, dry-run install) with two capabilities before any real harness writes."

### T1-18 — `source.yml` schema and consumer undefined
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** scope
- **Section:** U7, Manifest Schema
- **Evidence:** U7 creates `snapshots/.../source.yml` but plan never describes contents or readers.
- **Why:** Dead weight or hidden contract.
- **Fix:** Define `source.yml` schema explicitly in plan, or remove and defer snapshot-level manifests to update/three-way-diff plan.

### T1-19 — `local-plugin` source kind missing `marketplace` field
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** adversarial
- **Section:** Manifest Schema (compound-engineering source), U6, U7
- **Evidence:** Path requires `every-marketplace/...` but manifest doesn't record it.
- **Why:** Breaks on machines with different marketplace layouts or where the plugin isn't installed at all.
- **Fix:** Add `marketplace: every-marketplace` field. State that committed snapshot is source of truth after capture (cache only consulted by `add-from-source`). Make `add-from-source` error clearly when requested plugin/version not in local cache.

### T1-20 — Pinned commit not integrity-verified
- **Severity:** manual | **Confidence:** 50-75 | **Reviewers:** adversarial, security
- **Section:** Manifest Schema, U1, U3
- **Evidence:** Pinned SHA + committed snapshot, no byte-equivalence check.
- **Why:** Editing files in snapshot directory (accident, "fixing a typo," malice) passes validation silently. Pinning becomes decorative.
- **Fix:** Add `snapshot_hash` field (SHA-256 of deterministic tar) to `source.yml`. Validator recomputes and compares offline. Or demote `pinned` from contract to provenance label.

### T1-21 — Negative-fixture `SKILL.md` files are attractive nuisance
- **Severity:** manual | **Confidence:** 75 | **Reviewer:** adversarial
- **Section:** U3, U4 fixture files
- **Evidence:** `unsafe-one-password/SKILL.md` containing Peter-specific Molty defaults and `op item list` examples lives in repo.
- **Why:** Fixtures currently safe because not under `skills/`. But future refactor or human grep finds them. Real-looking unsafe content sitting in repo.
- **Fix:** Rename to `SKILL.unsafe-fixture.md` or similar non-discoverable pattern. Add `fixtures/README.md` warning. Add validator self-test that fixtures live only under `capabilities/scripts/fixtures/`.

---

## Tier 2 — Gated-auto (15 findings)

### T2-22 — CLI dual-file contract has no repo precedent
- **Severity:** gated_auto | **Confidence:** 75 | **Reviewers:** coherence, feasibility
- **Section:** U2, U5, U6 Files lists
- **Evidence:** Files list pairs `capabilities/scripts/validate` (extensionless) with `capabilities/scripts/validate.ts`. Existing repo pattern (e.g., `skills/voice-enrich/scripts/voice-enrich.ts`, `runbooks/issue-to-pr-v2/decompose.ts`) is a single `.ts` with `#!/usr/bin/env bun` shebang and exec bit on the `.ts`.
- **Fix:** Drop bare extensionless files. Single `.ts` per command with shebang and `chmod +x`.

### T2-23 — Replace YAML pause-clause with `Bun.YAML`
- **Severity:** gated_auto | **Confidence:** 100 | **Reviewer:** feasibility
- **Section:** U2 Approach (and U3 frontmatter)
- **Evidence:** "Parse YAML with the smallest approved dependency surface. If native tooling is insufficient, pause for dependency approval."
- **Why:** Bun 1.3.11 ships `Bun.YAML.parse` as a first-class native API. The pause clause will never fire but wastes a planning loop when the implementer discovers it.
- **Fix:** "Parse manifest and frontmatter with `Bun.YAML.parse` (native in Bun ≥ 1.2). No additional dependency required."

### T2-24 — Codex collision detection will hit plugin-installed skills
- **Severity:** gated_auto | **Confidence:** 100 | **Reviewer:** feasibility
- **Section:** Manifest Schema (targets.roots.codex), U5
- **Evidence:** `/Users/nathanvale/.codex/skills/compound-engineering/` already exists on this machine; first dry-run will collide.
- **Fix:** Add to U5 Approach: "Codex target collision detection runs against real `~/.codex/skills/` and `~/.codex/agents/`, which include plugin-installed skills. `collision_policy.owns_existing` must be set to `true` when the registry takes over a previously plugin-managed skill name."

### T2-25 — Executable bits without content-type validation
- **Severity:** gated_auto | **Confidence:** 75 | **Reviewer:** security
- **Section:** R17, U3, U6
- **Evidence:** Plan preserves exec bits from snapshot through install with no content check.
- **Why:** Compromised snapshot with `.sh` extension + binary content + exec bit becomes installed runnable.
- **Fix:** U3 validation must assert any executable file is text (valid shebang, or UTF-8). Binaries with exec bits = hard blocker. Runs at snapshot admission and install.

### T2-26 — R14 split across U2 (shape) and U5 (detection) muddled
- **Severity:** gated_auto | **Confidence:** 75 | **Reviewer:** coherence
- **Section:** R14, U2, U5
- **Evidence:** R14 in both unit Requirements lists; U2 validates "collision policy shape," U5 detects "target collisions."
- **Fix:** Split: "R14a: Validate collision policy shape (U2). R14b: Detect and block collisions before write (U5)."

### T2-27 — R2 install-targets precedence undefined
- **Severity:** gated_auto | **Confidence:** 75 | **Reviewer:** coherence
- **Section:** Manifest Schema, R2
- **Evidence:** Manifest shows both global `targets.defaults` and per-capability `install` booleans; precedence not stated.
- **Fix:** Add clarifying sentence: "Per-capability `install` targets override global defaults; if a capability does not declare `install`, it inherits defaults."

### T2-28 — Inferred dependency detection has no defined input
- **Severity:** gated_auto | **Confidence:** 75 | **Reviewer:** adversarial
- **Section:** R10, U2 test scenarios
- **Evidence:** U2 test: "Likely dependency reference not declared produces a warning." Plan never defines "likely dependency reference."
- **Fix:** Define explicitly: "A likely dependency reference is any markdown wiki link matching `[[name]]` where `name` is a declared capability." Or defer detection entirely.

### T2-29 — R6 not fully covered; library architecture ad-hoc
- **Severity:** gated_auto | **Confidence:** 75 | **Reviewer:** coherence
- **Section:** R6, U1-U6
- **Evidence:** Each unit creates lib files ad-hoc (`lib/schema.ts`, `lib/manifest.ts`, etc.) with no unit owning library composition.
- **Fix:** Add sentence to U1 establishing library module structure and export patterns for later units.

### T2-30 — U1 fixture "valid" semantics shifts under later units
- **Severity:** gated_auto | **Confidence:** 50 | **Reviewer:** adversarial
- **Section:** U1 test scenarios, U2/U3/U4 fixtures
- **Evidence:** U1's "valid" means shape-valid (no filesystem checks). U3 adds "missing canonical path fails for tracked." Same fixture, two definitions.
- **Fix:** Split: `fixtures/manifest/shape-valid.yml` (U1/U2, uses `status: draft`, no canonical path) and `fixtures/manifest/fully-valid.yml` (U3+, has on-disk content).

### T2-31 — `x_` extension namespace is speculative complexity
- **Severity:** gated_auto | **Confidence:** 50 | **Reviewer:** adversarial
- **Section:** Manifest Schema closing note, U1
- **Evidence:** "Validation should fail on unknown top-level keys in v1 unless under `x_` extension namespace."
- **Why:** No declared use case. Creates silent-state vector contradicting reviewability ethos.
- **Fix:** Drop `x_`. Make all unknown keys fail. Re-add when concrete extension need exists.

### T2-32 — Aliases and `replaces` validated but unused
- **Severity:** gated_auto | **Confidence:** 50 | **Reviewer:** scope
- **Section:** R7, U2, Manifest Schema
- **Evidence:** Both first capabilities have `aliases: []` and `replaces: []`. U2 tests duplicate alias detection.
- **Fix:** Accept empty arrays as no-ops in v1. Defer non-empty alias/replaces validation to when a capability uses them.

### T2-33 — All 4 risk flags validated but only 2 exercised
- **Severity:** gated_auto | **Confidence:** 50 | **Reviewer:** scope
- **Section:** R9, U1
- **Evidence:** Only `secret_bearing` (one-password) and `writes_files` (ce-plan) used. `side_effecting` and `networked` false for both.
- **Fix:** Parse and store all four (schema needs them). Trigger validators only when flag is true and a checker exists. `side_effecting` and `networked` recognized-but-inert in v1.

### T2-34 — Scope Boundaries + Deferred sections overlap
- **Severity:** gated_auto | **Confidence:** 50 | **Reviewer:** scope
- **Section:** Scope Boundaries, Deferred To Follow-Up Work
- **Evidence:** Both sections cover `install.sh` integration and upstream promotion.
- **Fix:** Collapse into "Out of scope for v1" with inline notes (deferred vs permanent boundary).

### T2-35 — U8 documentation unit thin for a unit boundary
- **Severity:** gated_auto | **Confidence:** 50 | **Reviewer:** scope
- **Section:** U8
- **Evidence:** One requirement (R18), three optional files, test scenarios that amount to consistency checks already in U7's checklist.
- **Fix:** Absorb README update into U7 completion step. Remove U8.

### T2-36 — `ce-plan` self-reference no acknowledged fallback
- **Severity:** gated_auto | **Confidence:** 75 | **Reviewer:** product
- **Section:** Source Inputs For First Slice
- **Evidence:** "ce-plan is the first Compound Engineering capability because it is high-value, already used to create registry plans."
- **Why:** If canonical `ce-plan` adaptation breaks, the tool that authors fix-plans is broken.
- **Fix:** Add short note acknowledging self-reference. Name plugin cache as the fallback if canonical breaks.

---

## Tier 3 — FYI (5 findings, informational only)

- **T3-37** — Document frontmatter `status: active` vs capability `status: tracked` — same word, different scope. Optional clarifying note in Manifest Schema.
- **T3-38** — Pinned commit `8b8aa71ffb905eb488b97f1c0b9d1035af6d1b8d` verified as real upstream commit by Peter Steinberger dated 2026-05-22.
- **T3-39** — Codex skills/agents paths (`~/.codex/skills`, `~/.codex/agents`) verified as real directories with plugin-installed content.
- **T3-40** — `capabilities/` adds 9th top-level concept; repo identity shifts. Origin spec settled placement. Consider one-line position in `capabilities/README.md`.
- **T3-41** — `draft` lifecycle status has no v1 producer if `add-from-source` is deferred per T1-12. Treat as recognized-but-unused alias for snapshot-only state.

---

## Decisions log

Use this section to record which findings the next agent accepts, rejects, or defers — preserves round-2 review suppression context.

| Finding | Decision | Reason | Date |
|---|---|---|---|
| T1-1 | needs Nathan | Added as a pending Nathan decision; overlay application remains deferred until deterministic rules are chosen. | 2026-05-24 |
| T1-2 | accepted | Added path normalization/confinement rules and `capability.path_traversal` diagnostic. | 2026-05-24 |
| T1-3 | accepted | Named `node:fs/promises.copyFile` as the mode-preserving copy primitive and added the 0755 test expectation. | 2026-05-24 |
| T1-4 | accepted with conservative default | Non-empty `replaces` is unsupported in v1; future support must confine entries under the target root and expected capability subtree. | 2026-05-24 |
| T1-5 | needs Nathan | Added as a pending Nathan decision for `ce-plan` plugin-shadow handling. | 2026-05-24 |
| T1-6 | needs Nathan | Added as a pending Nathan decision; plan records the provisional v1 value shape as validation plus Claude Code dry-run planning. | 2026-05-24 |
| T1-7 | needs Nathan | Added as a pending Nathan decision for bundled vs sequenced first-slice shipping. | 2026-05-24 |
| T1-8 | needs Nathan | Added as a pending Nathan decision for the `ce-plan` cross-harness primitive strategy. | 2026-05-24 |
| T1-9 | accepted with conservative default | Added snapshot admission leakage checks before committed snapshots are accepted. | 2026-05-24 |
| T1-10 | accepted with conservative default | Added minimum token/key pattern floor and concrete entropy threshold. | 2026-05-24 |
| T1-11 | needs Nathan | Added as a pending Nathan decision for optional source-level `leakage_blocklist:` shape. | 2026-05-24 |
| T1-12 | accepted as defer | Removed add-from-source from v1 implementation units and marked it for third-capability onboarding. | 2026-05-24 |
| T1-13 | accepted as defer | Kept overlay directories as reserved slots and deferred overlay application code. | 2026-05-24 |
| T1-14 | accepted as defer | Made Claude Code dry-run required for v1 and disabled Codex install by default while keeping Codex path validation visible. | 2026-05-24 |
| T1-15 | accepted as defer | Limited v1 lifecycle support to `draft` and `tracked`; `installed` and `retired` now fail with an unsupported-status diagnostic. | 2026-05-24 |
| T1-16 | accepted as defer | Marked `ADAPTATIONS.md` as update/three-way-diff follow-up work. | 2026-05-24 |
| T1-17 | accepted | Reworded Summary to read-side lifecycle rather than whole lifecycle. | 2026-05-24 |
| T1-18 | accepted as defer | Removed `source.yml` deliverables from v1 and deferred snapshot-level manifests. | 2026-05-24 |
| T1-19 | needs Nathan | Added as a pending Nathan decision for local-plugin `marketplace:` metadata. | 2026-05-24 |
| T1-20 | needs Nathan | Added as a pending Nathan decision for future snapshot integrity semantics. | 2026-05-24 |
| T1-21 | accepted opportunistically | Renamed unsafe fixture path to `SKILL.unsafe-fixture.md` and added fixture-safety expectations. | 2026-05-24 |
| T2-22 | accepted | Replaced extensionless CLI files with executable `.ts` entrypoints and shebang guidance. | 2026-05-24 |
| T2-23 | accepted | Replaced YAML dependency pause clause with `Bun.YAML.parse`. | 2026-05-24 |
| T2-24 | accepted opportunistically | Added Codex plugin-installed collision note for the deferred Codex install path. | 2026-05-24 |
| T2-25 | accepted with conservative default | Added executable-content validation: executable files must be UTF-8 text or have a valid text shebang. | 2026-05-24 |
| T2-26 | accepted | Split R14 into R14a manifest shape validation and R14b collision detection. | 2026-05-24 |
| T2-27 | accepted | Documented per-capability install target precedence over defaults. | 2026-05-24 |
| T2-28 | accepted opportunistically | Defined likely dependency references as markdown wiki links matching declared capabilities. | 2026-05-24 |
| T2-29 | accepted | Added U1 library module/export pattern guidance. | 2026-05-24 |
| T2-30 | accepted | Split manifest fixtures into `shape-valid.yml` and `fully-valid.yml`. | 2026-05-24 |
| T2-31 | accepted | Removed the speculative `x_` extension namespace and made all unknown top-level keys fail. | 2026-05-24 |
| T2-32 | accepted | Limited `aliases` and `replaces` to empty-array no-ops in v1. | 2026-05-24 |
| T2-33 | accepted | Recognized all four risk flags while only enabling extra v1 validators for `secret_bearing` and `writes_files`. | 2026-05-24 |
| T2-34 | accepted | Collapsed scope and deferred material into a single `Out Of Scope For V1` section. | 2026-05-24 |
| T2-35 | accepted | Removed U8 and moved README/documentation checks into U7. | 2026-05-24 |
| T2-36 | accepted opportunistically | Added plugin-cache `ce-plan` as the fallback if canonical `ce-plan` breaks. | 2026-05-24 |
| T3-37 | FYI | No source-plan change; lifecycle wording now distinguishes document status from capability lifecycle. | 2026-05-24 |
| T3-38 | FYI | No action needed; commit verification remains reference context. | 2026-05-24 |
| T3-39 | FYI | Reflected in the deferred Codex collision note. | 2026-05-24 |
| T3-40 | FYI | Added a U7 README expectation to explain `capabilities/` as a top-level subsystem. | 2026-05-24 |
| T3-41 | FYI | No extra action; `draft` remains supported even though add-from-source is deferred. | 2026-05-24 |

---

## Cross-reference

- Source plan: `/Users/nathanvale/code/claude-code-config/docs/plans/2026-05-24-002-feat-agent-capability-registry-v1-plan.md`
- Origin spec: `/Users/nathanvale/code/claude-code-config/docs/specs/agent-capability-registry.md`
- Child plan (first slice): `/Users/nathanvale/code/claude-code-config/docs/plans/2026-05-24-001-feat-one-password-capability-plan.md`
- CONTEXT.md (terminology source): `/Users/nathanvale/code/claude-code-config/CONTEXT.md`
- Verified runtime path: `~/.claude/skills` → `claude-code-config/skills/` (install.sh symlink)
- Verified plugin cache: `~/.claude/plugins/cache/every-marketplace/compound-engineering/3.8.4/skills/ce-plan/`
