---
title: "feat: Multi-forge git config for productivity-sync (GitHub + Bitbucket stubs)"
type: feat
status: completed
date: 2026-05-14
deepened: 2026-05-14
---

# Multi-forge git config for productivity-sync (GitHub + Bitbucket stubs)

## Summary

Generalise `productivity-sync`'s GitHub-only forge support into a multi-forge `git:` schema in `.productivity.yml`, keyed by forge name, with first-class support for GitHub today and stubbed Bitbucket (Cloud + Server) so a second machine can land its `git:` block without the adapter existing yet. Implicit-mode sweep is removed — POS Yellow's `.productivity.yml` gains an explicit `git:` block in the same commit so the schema change doesn't break it. Two auth modes ship (`gh`, `env`); `keychain` defers until a real consumer needs it.

---

## Problem Frame

`productivity-sync`'s spec describes a single-forge `github:` block in `.productivity.yml`, but two real-world signals contradict that:

1. **A second machine of mine uses the same skill against a Bitbucket-hosted codebase.** Without a multi-forge schema, that machine can't express its config — it either omits forge sync entirely or hand-rolls a side path. The skill's promise of "drop a `.productivity.yml` and go" doesn't survive the second forge.
2. **POS Yellow's `.productivity.yml` has *no* `github:` block today, yet GitHub sync runs every sync.** The skill's spec is silent on what should happen; in practice the executing agent (me) opportunistically sweeps known repos from memory (`gms.app`, `gms.api`, `voucher`). That's not a sustainable contract — the spec under-describes reality and the behaviour can't be reproduced on another machine.

The 2026-05-14 sync also surfaced a related gap: when M365 was down, the meeting-notes substep silently skipped (that's healed in a separate commit, not in scope here). Today's plan is the forge-schema piece.

---

## Requirements

- R1. A single `.productivity.yml` shape can describe one or more git forges (GitHub, Bitbucket Cloud, Bitbucket Server) without coupling to a specific provider.
- R2. Each forge entry can specify its own auth mode. Two modes ship: `gh` (GitHub-only, depends on the `gh` CLI being authed) and `env` (generic, reads `<FORGE>_TOKEN` and `<FORGE>_USER` from env). `keychain` is reserved as a future mode but not implemented in this plan.
- R3. The GitHub adapter retains today's behaviour with **semantic parity**: same PRs reach the same drift buckets, same report sections. Today's `gh pr list --json ...` invocation is preserved verbatim; no script extraction, no field renaming.
- R4. The Bitbucket Cloud and Bitbucket Server stubs validate at config-load time, surface as ✅ in pre-flight, but emit a visible warning line in the final report on every sync when a stub forge is configured. Warning text carries a version sentinel: `⚠️ <forge-name> — config valid, sweep skipped (stub adapter v0, see Deferred to Follow-Up Work)`. The real adapter, when it ships, **must not** emit this text — missing config fields produce a distinct config-load error in pre-flight.
- R5. Legacy `.productivity.yml` files with the old `github:` block continue to work via a one-time read-side migration into `git: { github-default: { type: github, ...legacy } }`. A one-line deprecation note appears in the sync report (not pre-flight) recommending migration.
- R6. **Implicit-mode sweep is removed.** Every consumer of `productivity-sync` must have an explicit `git:` block in `.productivity.yml` to get forge sync. POS Yellow's existing `.productivity.yml` gains a `git:` block in this same commit so the schema change doesn't strand it.
- R7. The cursor schema migrates from `connectors.github` to `connectors.git_forges.<forge-name>` keyed by forge name, preserving `last_sync` / `ok` / `error` / `consecutive_failures` per forge. Migration writes are atomic (write-tmp-then-rename). A mid-rename crash leaves the original cursor intact and the next run re-migrates; no per-cycle state machine is required.
- R8. Forge name map keys must match `^[a-z][a-z0-9-]{0,62}$` at config-load time. Forge names render verbatim into cursor JSON and the sync report; the allowlist closes a keychain-injection vector (deferred but reserved by R2) and keeps the names safe as display labels.
- R9. Token values (`BITBUCKET_TOKEN`, `GITHUB_TOKEN`, `BITBUCKET_USER`, etc.) are never interpolated into report text, warning lines, or cursor `error` strings. Only sanitised messages like `auth failed (HTTP 401)` or `auth failed (token missing required scope)` are recorded. U1 enumerates every error path that touches auth results with the exact sanitised text; U5 includes a negative test (`BITBUCKET_TOKEN=secret-canary-value` → trigger probe failure → assert canary string does not appear in cursor or report).
- R10. `base_url` (required on `bitbucket-server` forge entries) is validated at config-load time. The value must match `^https://[a-z0-9.-]+(\:[0-9]+)?(/.*)?$` (HTTPS scheme mandatory, no `http://`, no other schemes) AND must not resolve to RFC1918 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) or link-local (169.254.0.0/16) addresses. Stub enforces this even though it makes no REST calls — schema-load is the load-bearing validation surface, the follow-up adapter inherits a validated `base_url`.

---

## Scope Boundaries

- This plan does **not** implement the Bitbucket Cloud or Bitbucket Server REST query logic. Those adapters exist as stubs that satisfy the probe contract and emit the warning from R4. Real REST implementation is deferred to a follow-up plan triggered when the Bitbucket-using machine is the active context.
- This plan does **not** add GitLab, Azure DevOps, or any other forge type. The schema's `type:` field is open for future values, but no new types ship today.
- This plan does **not** add the `keychain` auth mode. The reserved-but-unimplemented status is documented in R2; the actual probe + script wiring lands when a real adapter consumes it.
- This plan does **not** auto-detect forge type from `.git/config` remote URLs. Forge type and repo list are declared in `.productivity.yml` only — no path resolution, no remote sniffing, no `.git/config` reading.
- This plan does **not** rewrite the drift bucket logic. Buckets stay identical; only the *mapping* from forge-native fields to bucket changes per adapter (and only GitHub's mapping is implemented).
- This plan does **not** extract the GitHub query into a separate script file. The existing inline `gh pr list` block stays in `SKILL.md`. Adapter extraction lands when there's a second real consumer.
- This plan does **not** add a `productivity-setup` wizard step for git forges. The wizard step lands in the follow-up plan when the Bitbucket adapter is real and the wizard choice produces something that actually works end-to-end.
- This plan does **not** touch token rotation drift detection (e.g., surfacing "your Bitbucket token expired" as a memory entry). That belongs to the follow-up Bitbucket adapter work.

### Deferred to Follow-Up Work

- **Bitbucket Cloud adapter implementation** (REST 2.0, Workspace API token auth): separate plan once the Bitbucket-using machine is the active context. Real adapter MUST emit distinct status surfaces (e.g., PR data, config-load errors, auth errors) — never re-uses the `stub adapter v0` warning text.
- **Bitbucket Server adapter implementation** (REST 1.0, PAT auth, configurable base URL): same trigger; same constraint on warning text.
- **GitHub query extraction to `scripts/forges/github.sh`**: ships with the Bitbucket adapter so the extraction has a second consumer justifying the abstraction.
- **`productivity-setup` wizard update**: ships with the Bitbucket adapter so the wizard option produces a working config, not a stub-warning trap.
- **`keychain` auth mode**: ships when a real adapter consumes it. The forge-name allowlist (R8) pre-closes the injection vector so adding `keychain` later is a low-risk extension.
- **Token rotation drift detection**: ships with the first real Bitbucket adapter.

---

## Context & Research

### Relevant Code and Patterns

- `skills/productivity-sync/SKILL.md` — single-file skill. The `**GitHub**` section sits at L415-490 today and is the primary edit surface.
- `~/code/bunnings-pos-yellow/.productivity.yml` — real-world consumer with no `github:` block today. Gains a `git:` block in U6 of this plan.
- `~/code/bunnings-pos-yellow/.productivity-sync-cursor.json` — real-world cursor with `connectors.github` shape today. Migration target.
- Today's heal commit `02bd7e0` on `feat/new-sprint-skill-heal` — adds `consecutive_failures` to the cursor schema and a per-forge probe table. This plan extends that table; no conflict.

### Institutional Learnings

- The 2026-05-14 productivity-sync heal taught the rule "spec must match reality" — the calendar-down failure mode hid for 4 runs because the spec gated behaviour behind a precondition that didn't apply. Removing implicit mode (R6) closes the same drift trap for forges: there is no longer a "spec says X, behaviour does Y" gap because the only legitimate behaviour is what the explicit config declares.
- `feedback_verify_pr_state_against_github.md`: verify PR state via `gh` before treating verbal updates as authoritative. Validates keeping `auth: gh` as a mode — `gh auth status` is the canonical truth source for GitHub.

### External References

None needed for this round. The Bitbucket REST surface is documented at developer.atlassian.com but is only consulted when the real adapter is implemented in the follow-up plan. Today's stub doesn't call any Bitbucket endpoint.

---

## Key Technical Decisions

- **Top-level `git:` map keyed by forge name** (not list, not nested under `connectors:`). The map key becomes the stable cursor ID and the unique forge identifier in reports. Connectors stay scalar-valued; forges are inherently many-per-domain. **Accepted asymmetry:** user-facing config places `git:` as a top-level peer of `connectors:` while the cursor nests state under `connectors.git_forges`. User config favours flat readability; cursor favours grouped state. The asymmetry is documented here so the next many-per-domain need (chat threads, vault paths, etc.) inherits a deliberate choice rather than an emergent one.
- **`repos:` field uses forge-native identifiers, not local paths.** GitHub: `org/repo` (e.g., `Bunnings-Technology-Delivery/gms.app`). Bitbucket Cloud: `workspace/repo_slug`. Bitbucket Server: `projectKey/repoSlug` plus a `base_url` field on the forge entry. The adapter parses each forge's shape — same field name, forge-aware split. No path resolution, no `.git/config` reading, no implicit discovery. Cross-machine portable because identifiers don't change with filesystem layout.
- **Two auth modes for v1: `gh` and `env`.** `keychain` is reserved (named in R2 spec, allowlist already accommodates it via R8) but not implemented. Adding it later is a low-risk extension because the injection vector is closed up front.
- **Stub-emits-warning rule (R4) is load-bearing, and the version sentinel matters.** The warning text suffix `stub adapter v0` is the distinguishing token a future real adapter must not re-use. Without that token, a real adapter that ships with a config bug would emit the same warning and the user would assume "still stubbed" indefinitely.
- **Adapter contract is documented as prose inside U1, not lifted to its own unit or named four-query interface.** With only one real consumer today, a freestanding "adapter contract" abstraction is speculative — it would constrain a Bitbucket adapter that hasn't been written against API responses that haven't been seen. The follow-up Bitbucket plan can lift the contract when it has a second concrete implementation to ground it.
- **Cursor migration is atomic, no per-cycle state machine.** Read-side: if `connectors.github` exists and `connectors.git_forges` doesn't, treat it as `connectors.git_forges.github-default = <legacy>` in memory and write under the new shape only. Write-side: serialise to `<cursor>.tmp` then atomic `rename()`. A mid-rename crash leaves the original cursor file intact (the rename either fires or it doesn't); the next run re-reads the legacy shape and re-migrates. `consecutive_failures` history is preserved because the original file never enters a partial state. Reviewer round 2 flagged a "legacy-key retention" rule earlier in this plan as unnecessary belt-and-suspenders given the atomic rename — it was removed; this bullet documents the simplified design.
- **Implicit-mode sweep is removed entirely.** R6 in earlier drafts proposed codifying it as `github-implicit`; reviewer feedback surfaced that this would (a) silently lose heal-escalation tracking for POS Yellow (the only no-config consumer), (b) create an asymmetry with R4's "stubs must announce themselves" principle, and (c) leave a malformed-`git:`-block footgun where a typo could disable forge sync without escalating. Removing the mode and migrating POS Yellow to explicit config in the same commit closes all three issues.

---

## Open Questions

### Resolved During Planning

- **Where does the plan + commit live?** `claude-code-config` repo, on the existing `feat/new-sprint-skill-heal` branch alongside today's heal commit. Same scope, same branch already in flight.
- **List vs map for `git:`?** Map keyed by forge name. Avoids a separate `name:` field; the key *is* the name.
- **Codify implicit mode, narrow it, or remove it?** Remove. Three reviewer findings converged on this being a regression vector; the cost of migrating POS Yellow's `.productivity.yml` once is lower than the cost of maintaining the implicit-mode behaviour indefinitely.
- **Local paths or forge-native identifiers in `repos:`?** Forge-native identifiers. Both `gh` and Bitbucket REST natively address PRs by identifier; local paths would add `.git/config` reading and cwd-matters failure modes for zero benefit.
- **Three auth modes or two?** Two (`gh`, `env`). `keychain` deferred to the adapter that needs it.
- **Deprecation note throttling for legacy `github:` blocks.** Once per cursor cycle, tracked via sentinel `connectors.git_forges._migrated_from_legacy_github: <iso-date>` written on the first migration cycle. The sentinel is mandatory, not optional.

### Deferred to Implementation

- **Exact wording of the config-load error for an invalid forge entry.** Pin during U1; the rule is "fail loudly in pre-flight with the forge name + the specific field that failed validation."

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Schema shape (worked example):**

```yaml
# .productivity.yml (new shape)
connectors:
  # ...unchanged scalar connectors (calendar, email, project-tracker, etc.)

git:
  github-bunnings:
    type: github
    user: nathanvale-bunnings
    auth: gh
    ticket-prefix: POS
    review-as-me: true
    repos:                                # org/repo identifiers
      - Bunnings-Technology-Delivery/gms.app
      - Bunnings-Technology-Delivery/gms.api
      - Bunnings-Technology-Delivery/voucher

  bitbucket-other-machine:
    type: bitbucket-cloud
    user: nathan.example
    auth: env                             # reads BITBUCKET_TOKEN, BITBUCKET_USER
    ticket-prefix: PROJ
    review-as-me: true
    repos:                                # workspace/repo_slug
      - example-workspace/some-repo

  bitbucket-internal:                     # example only; not shipping in this plan
    type: bitbucket-server
    user: nathan.example
    auth: env                             # reads BITBUCKET_TOKEN, BITBUCKET_USER
    base_url: https://bitbucket.example.com
    ticket-prefix: INT
    review-as-me: true
    repos:                                # projectKey/repoSlug
      - PROJ/internal-tooling
```

**Read path at sync time:**

```
.productivity.yml ──┐
                    ├──► config-loader ──► [forge1, forge2, ...]
legacy github: ─────┘   (shim merges       │  (forge name allowlist validates here;
                         legacy block       ▼   invalid forge → pre-flight error)
                         as github-default)
                                    pre-flight probe
                                    (per forge, auth-mode-specific)
                                           │
                                           ▼
                                    for forge in forges:
                                      if forge.type == github:
                                        inline `gh pr list ...` (unchanged from today)
                                        → drift buckets
                                      elif forge.type starts with bitbucket-:
                                        emit `⚠ stub adapter v0` warning, skip query
                                           │
                                           ▼
                                    cursor write (atomic; per-forge keys;
                                                   legacy `connectors.github` key
                                                   retained one extra cycle)
```

**Drift bucket mapping for GitHub** is unchanged and owned by `skills/productivity-sync/SKILL.md` (the GitHub drift-bucket section); this plan does not restate the field-to-bucket semantics. The Bitbucket mapping defers to the follow-up adapter plan where field names can be verified against real API responses.

---

## Implementation Units

<!-- U-IDs in the current plan: U1 (schema), U2 (probe), U3 (cursor migration),
     U4 (POS Yellow config), U5 (E2E verification), U6 (commit). The pre-deepening
     draft had a different shape: U3 was a GitHub-script-extraction unit (dropped),
     U6 was a productivity-setup wizard unit (dropped), and U7 was the E2E
     verification (renumbered to U5 in the current plan). Per the U-ID stability
     rule, dropped U-IDs are not reused for new concepts; the current U6 (commit
     step) and the dropped U6 (wizard) are different units that happen to share
     a number because the wizard was dropped before commit. -->

### U1. Spec the `git:` schema, auth modes, allowlist, back-compat shim, and stub-warning rule in SKILL.md

**Goal:** Replace the existing single-forge `**GitHub**` section with a multi-forge `**Git forges**` section that defines the new schema, the two implemented auth modes (`gh`, `env`), the forge-name allowlist, the `base_url` validation rule, the legacy back-compat shim, the stub-warning rule with its version sentinel, the token-scrubbing rule (with explicit error-path enumeration), and the sentinel grep-test contract. This is the load-bearing spec edit.

**Requirements:** R1, R2, R3, R4, R5, R6, R7, R8, R9, R10 (the spec edit codifies all ten; R7's cursor schema details are implemented in U3, but the spec-side description of "the cursor uses `connectors.git_forges.<name>` keyed by forge name" lands here in U1)

**Dependencies:** None — this is the foundation.

**Files:**
- Modify: `skills/productivity-sync/SKILL.md` (replace L415-490 with the new section)

**Approach:**
- Find the current heading at `skills/productivity-sync/SKILL.md` L415: `**GitHub** (if configured -- `github:` block in `.productivity.yml`):` — replace it (and the section body L415-490) with `**Git forges** (configured via `git:` block in `.productivity.yml`):` followed by the new section body described below.
- Document the new `git:` map schema with the worked example from the High-Level Technical Design section.
- Document the two implemented auth modes in a small table: `gh` (GitHub-only, probes via `gh auth status`) and `env` (any forge type, probes for `<FORGE>_TOKEN` + `<FORGE>_USER` presence). Note `keychain` as reserved-for-future, not implemented.
- Document the forge-name allowlist: map keys must match `^[a-z][a-z0-9-]{0,62}$`. Clarify explicitly: **the allowlist applies only to `git:` map keys (forge names), not to repo identifiers in `repos:` lists** — `Bunnings-Technology-Delivery/gms.app` is a valid repo entry even though it has uppercase characters and dots, because repos are forge-native identifiers and not subject to the allowlist. Config-load surfaces a specific pre-flight error naming the offending forge name when the allowlist fails.
- Document the `base_url` validation rule (R10): `bitbucket-server` forge entries require a `base_url` field. At config-load, the value must match `^https://[a-z0-9.-]+(\:[0-9]+)?(/.*)?$` (HTTPS-only — `http://` is rejected) AND must not resolve to RFC1918 (10/8, 172.16/12, 192.168/16) or link-local (169.254/16) addresses. Pre-flight emits a specific error if validation fails.
- Document the legacy-shim rule: on read, if `.productivity.yml` has a top-level `github:` block and no `git:` block, treat it as `git: { github-default: { type: github, ...legacy } }` in memory and emit a one-line deprecation note in the sync report (not pre-flight) recommending migration. The legacy key gets the same allowlist validation as new keys (`github-default` is allowlist-valid).
- Document the stub-warning rule: when a sync would have queried a `bitbucket-cloud` or `bitbucket-server` forge, queue the warning text verbatim (`⚠ <forge-name> — config valid, sweep skipped (stub adapter v0, see Deferred to Follow-Up Work)`) for the final report. Once per sync, not throttled. Add a forward-compat note: "real adapter MUST NOT emit this text under any failure mode; missing config fields produce a distinct config-load error in pre-flight. This constraint is enforced via grep-test in this unit's verification and via a memory entry consulted by future plans."
- Document the token-scrubbing rule (R9) with an explicit enumeration of every error path that touches auth results: (a) env-mode missing token → `auth failed (env var <NAME> not set)`; (b) env-mode token rejected by API → `auth failed (HTTP <status>)`; (c) `gh auth status` non-zero exit → `auth failed (gh not authenticated)`; (d) `base_url` validation failure → `config error (base_url must be HTTPS, no RFC1918)`. **Never** include the env-var value, response body, or token substring in any of these strings. The rule applies to cursor `error` field writes, pre-flight error lines, and final-report warnings.
- Keep the inline `gh pr list --state all --author "@me" --json ... --limit 30` and `gh search prs --review-requested "@me" --state open ...` blocks in place — no script extraction. Behaviour is unchanged for the GitHub path.

**Patterns to follow:**
- The existing connector-table pattern at L53-66 of SKILL.md for the auth-mode table.
- Today's heal commit's anti-patterns callout style for the stub-warning + token-scrubbing rules.

**Test scenarios:**
- *Test expectation: spec edit; behavioural verification deferred to U5 (Run 1 validates the explicit-config path described here; Run 2 validates the stub-warning interaction; Run 3 validates the legacy-shim path). U1 is the load-bearing spec foundation U5 depends on.*

**Verification:**
- The new `**Git forges**` section exists and replaces the old `**GitHub**` section cleanly.
- `grep -n "git:" SKILL.md` shows the worked example with all three forge types.
- The allowlist rule (with name-vs-repo clarification), `base_url` validation rule, legacy-shim rule, stub-warning rule (with `stub adapter v0` sentinel), and token-scrubbing rule with full error-path enumeration are all described with explicit triggers and explicit outputs.
- The drift-bucket table for GitHub is preserved (no field renaming; no normalised shape).
- **Sentinel uniqueness contract (enforces R4):** Running `grep -c "stub adapter v0" skills/productivity-sync/SKILL.md` after this edit returns **exactly 1** (the canonical warning-text definition in the stub-warning rule). After the follow-up Bitbucket-adapter plan ships, the same grep run against the post-adapter SKILL.md must STILL return exactly 1 — any additional emission is a regression that the follow-up plan's reviewer must catch. This grep is the load-bearing enforcement mechanism for R4's "MUST NOT" constraint; document it in U1's spec body too so future-me sees it during the follow-up plan's grounding pass.

---

### U2. Update the pre-flight probe to handle per-forge auth modes and the stub-handling rule

**Goal:** Extend the pre-flight probe table so each forge in `git:` is probed independently per its `auth:` mode. Bitbucket stubs validate ✅ when their env vars are present and ❌ when missing. The post-sync report emits the R4 warning whenever a stub forge was in scope. Malformed forge entries that leave zero valid forges surface as a top-level `NO FORGES SYNCED` pre-flight error, not just a config-load line.

**Requirements:** R2, R4, R8, R9, R10

**Dependencies:** U1 (schema + allowlist + base_url validation)

**Files:**
- Modify: `skills/productivity-sync/SKILL.md` (pre-flight section + final-report section)

**Approach:**
- Update the pre-flight probe table to add rows: `type: github` + `auth: gh` (existing `gh auth status` check), `type: github` + `auth: env` (`GITHUB_TOKEN` present), `type: bitbucket-cloud` + `auth: env` (`BITBUCKET_TOKEN` + `BITBUCKET_USER` present), `type: bitbucket-server` + `auth: env` (same plus `base_url` field present AND validated per R10 — HTTPS-only, no RFC1918/link-local addresses; pre-flight emits the R10 sanitised error if validation fails).
- Add a "Stub forge handling" callout in the sync flow: after the probe passes, if `forge.type` is `bitbucket-cloud` or `bitbucket-server`, skip the query loop and queue the stub-warning line (verbatim from U1) for the final report.
- Add a "Zero-valid-forges" callout: if config-load + probe leave zero forges in a sync-able state (all forges failed validation, all auth probes failed, etc.), surface a top-level pre-flight error `NO FORGES SYNCED — git block configured but no forge is sync-able. Fix the validation errors above.` Don't silently proceed with no forge sync.
- Partial validity (some valid, some invalid forges) syncs the valid ones; invalid forges surface their specific errors per-forge in pre-flight. The valid forges proceed normally; their `consecutive_failures` track independently.

**Patterns to follow:**
- Today's heal commit's pre-flight escalation pattern (`consecutive_failures: N`) — same surface, same one-line-hint style.
- The final-report bucket layout at L450+ of SKILL.md.

**Test scenarios:**
- *Test expectation: spec edit. Behavioural verification happens in U5 against real configs.*

**Verification:**
- Probe table covers all four `type` × `auth` combinations implemented in v1.
- Stub-warning rule cross-references the verbatim text pinned in U1.
- Zero-valid-forges error is described with the exact pre-flight message text.
- Partial-validity behaviour is explicit (some valid syncs, some surface errors, cursor tracks independently).
- `base_url` validation row in the probe table cross-references R10's regex + RFC1918/link-local rejection rules.

---

### U3. Migrate the cursor schema from `connectors.github` to `connectors.git_forges.<name>` with atomic writes

**Goal:** Update the cursor schema documentation in Step 1a so per-forge state is keyed by the forge's map key from `git:`. Cursor writes are atomic (write-tmp-then-rename). The legacy `connectors.github` key is retained for one additional successful cycle after migration as a recovery anchor.

**Requirements:** R5, R7

**Dependencies:** U1 (forge naming convention)

**Files:**
- Modify: `skills/productivity-sync/SKILL.md` (Step 1a cursor schema block)

**Approach:**
- Update the JSON example schema to show `connectors.git_forges.<forge-name>` instead of `connectors.github`. Preserve all existing fields (`last_sync`, `ok`, `error`, `consecutive_failures`) per forge.
- Add a `Migration` paragraph under the cursor schema: on read, if `connectors.github` exists and `connectors.git_forges` is absent, treat it as `connectors.git_forges.github-default = <legacy>` in memory and write only under the new shape. No legacy-key retention — the atomic write below provides the crash-safety guarantee on its own.
- Add a `Write atomicity` paragraph: cursor writes always serialise to `<cursor>.tmp` first, then atomic `rename()` to the real path. A mid-rename crash leaves the original cursor file unchanged (the rename either fires or it doesn't); the next run re-reads the legacy shape and re-migrates. `consecutive_failures` history is preserved across crashes because the original file never enters a partial state. No two-write state machine is needed.
- Write a sentinel `connectors.git_forges._migrated_from_legacy_github: <iso-date>` on the first migration cycle so the deprecation note (per R5) fires once per cursor cycle rather than every sync. Sentinel is mandatory (Resolved During Planning, not optional).

**Patterns to follow:**
- Today's heal commit's cursor schema example block — same JSON layout, just nested one level deeper for forges.
- Write-tmp-then-rename is a standard pattern; spec it once and don't bikeshed.

**Test scenarios:**
- *Test expectation: spec edit. Behavioural verification in U5 against POS Yellow's real cursor (which has `connectors.github` shape today).*

**Verification:**
- Cursor JSON example shows `connectors.git_forges.<forge-name>` with at least two entries to demonstrate per-forge keying.
- Migration and write-atomicity paragraphs are present and explicit. Legacy-key retention is explicitly NOT present (the atomic write provides the crash-safety guarantee on its own — round 2 deepening removed the retention rule as unnecessary belt-and-suspenders).
- The sentinel for deprecation-note throttling is documented.

---

### U4. Add a `git:` block to POS Yellow's `.productivity.yml`

**Goal:** Migrate POS Yellow from the no-`github:`-block / no-`git:`-block state (which relied on the now-removed implicit-mode sweep) to an explicit `git:` block listing the three repos the agent currently sweeps from memory.

**Requirements:** R6

**Dependencies:** U1 (schema must be specified before the consumer can target it)

**Files:**
- Modify: `~/code/bunnings-pos-yellow/.productivity.yml` (append `git:` block)

**Approach:**
- Append the following to the existing `.productivity.yml`:
  ```yaml
  git:
    github-bunnings:
      type: github
      user: nathanvale-bunnings
      auth: gh
      ticket-prefix: POS
      review-as-me: true
      repos:
        - Bunnings-Technology-Delivery/gms.app
        - Bunnings-Technology-Delivery/gms.api
        - Bunnings-Technology-Delivery/voucher
  ```
- The existing `connectors:` block is untouched.
- This is the only consumer-config change in this plan; the schema change in U1-U3 plus this single migration covers the full surface.

**Patterns to follow:**
- The existing `.productivity.yml` format and indentation in POS Yellow.

**Test scenarios:**
- *Test expectation: config file change. Behavioural verification in U5 Run 2 (explicit-config path).*

**Verification:**
- POS Yellow's `.productivity.yml` has a `git:` block matching the worked example.
- `connectors:` block is unchanged.
- The agent's typical sweep (`gms.app`, `gms.api`, `voucher`) is now reproducible from the config alone, without relying on memory.

---

### U5. End-to-end verification on POS Yellow + dry-run new schema

**Goal:** Run `/productivity-sync` against POS Yellow with the new `git:` block (verifies explicit-config path), then add a stubbed Bitbucket forge entry temporarily and re-run (verifies stub-warning + zero-Bitbucket-side-effects), then revert. Captures any spec gaps before commit. Bounded to one fold-back iteration if a gap surfaces; if a second gap appears, abort and re-plan.

**Requirements:** R3, R4, R5, R6, R7

**Dependencies:** U1, U2, U3, U4

**Files:**
- Read-only: `~/code/bunnings-pos-yellow/.productivity-sync-cursor.json` (real cursor with `connectors.github` shape today)
- Modify (temporarily, revert after Run 3): `~/code/bunnings-pos-yellow/.productivity.yml`

**Approach:**
- **Run 1 — explicit GitHub config (U4's edit in place).** Verify pre-flight shows `github-bunnings` (not `github-implicit` — that mode is gone). Cursor reads legacy `connectors.github` on first run, writes both legacy and new keys (per U3's legacy-key retention rule). Output matches today's drift report semantically (same PRs, same buckets, same report sections — R3).
- **Run 2 — same config, second pass.** Verify cursor now has `connectors.git_forges.github-bunnings` populated. The legacy `connectors.github` key is removed (second successful write). The deprecation note for legacy block did NOT fire because POS Yellow never had a legacy `github:` block in `.productivity.yml` — only the cursor had the legacy key.
- **Run 3 — add stubbed Bitbucket forge.** Add the following block temporarily:
  ```yaml
    bitbucket-test:
      type: bitbucket-cloud
      user: stub
      auth: env
      ticket-prefix: TEST
      repos:
        - stub-workspace/stub-repo
  ```
  Set `BITBUCKET_TOKEN=stub BITBUCKET_USER=stub` for the invocation. Verify: pre-flight shows `bitbucket-test` ✅, final report emits the R4 warning text verbatim with `stub adapter v0` sentinel, no Bitbucket REST calls happen, no Bitbucket-side cursor state is written beyond the standard per-forge tracking.
- **Revert.** Remove the `bitbucket-test:` block from `.productivity.yml`. Unset env vars: `unset BITBUCKET_TOKEN BITBUCKET_USER`. The `connectors.git_forges.bitbucket-test` cursor entry will age out naturally on the next sync (it'll have a stale `last_sync` but no active config to query, so it's a no-op).
- **Bounded fold-back.** If Run 1, Run 2, or Run 3 surfaces a spec gap, fold back into U1/U2/U3 once and re-run the affected run(s). If a second gap surfaces after the first fold-back, **abort, revert, and re-plan**:
  - Revert SKILL.md to its pre-U1 state (e.g., `git checkout -- skills/productivity-sync/SKILL.md` in claude-code-config, assuming no other staged changes — verify with `git status` first).
  - Revert POS Yellow's `.productivity.yml` to its pre-U4 state.
  - Re-planning resumes from the clean spec, not from half-applied edits.
  - Reason: SKILL.md is the live skill file used by every Claude session on this machine. Leaving half-validated edits in place during "re-plan time" (hours/days) means every parallel agent invocation uses degraded behaviour. The revert keeps the machine usable while re-planning happens out-of-band.

- **Negative token-scrubbing test (R9 verification).** Run an explicit canary test as part of Run 3 setup or as a fourth dedicated run: set `BITBUCKET_TOKEN=secret-canary-value-do-not-leak` and `BITBUCKET_USER=stub` (canary value chosen so a grep can spot it). Invoke sync. After the run completes, assert `grep -q "secret-canary-value-do-not-leak" ~/code/bunnings-pos-yellow/.productivity-sync-cursor.json` returns non-zero (no match) AND the same grep against the rendered final report returns non-zero. The canary value must not appear in either surface. If it does, R9's scrubbing rule failed — fold back into U1 and re-spec the error-path enumeration.

**Execution note:** This is the only unit that touches a real repo's config beyond U4's intentional change. Keep Run 3's edits minimal; revert immediately on completion including the env-var unset.

**Patterns to follow:**
- The cursor revert pattern used in today's sync (Read → Write back the original JSON).

**Test scenarios:**
- Happy path: Run 1 produces identical drift output (semantic parity) to the last real sync against POS Yellow.
- Happy path: Run 2 cursor has `connectors.git_forges.github-bunnings` and legacy key is gone.
- Happy path: Run 3 emits the R4 warning text verbatim, no Bitbucket side effects, env vars present at probe time.
- Error path: malformed `git:` block (e.g., misspelled `typ: github` instead of `type:`) → pre-flight surfaces specific config-load error + `NO FORGES SYNCED` top-level error if no other forges are valid.
- Edge case: legacy `github:` block alone (no `git:`) → migration shim runs in memory, sync produces identical output to Run 1, deprecation note appears in report.
- Edge case: forge name with invalid character (e.g., `github bunnings` with a space) → pre-flight error names the offending key.

**Verification:**
- All three runs produce expected output.
- POS Yellow's `.productivity.yml` is back to U4's state (no `bitbucket-test` block) after Run 3.
- All test env vars (`BITBUCKET_TOKEN`, `BITBUCKET_USER`) are unset after Run 3.
- Cursor is in its post-Run-2 state (new keys, no legacy).
- **Token-scrubbing canary test passed:** `secret-canary-value-do-not-leak` does not appear in the cursor file or the final report.
- **Sentinel uniqueness verified:** `grep -c "stub adapter v0" skills/productivity-sync/SKILL.md` returns exactly 1.
- Any spec gap discovered is folded back once into U1/U2/U3 before commit. If a second gap appears, **abort + revert SKILL.md and POS Yellow .productivity.yml** to their pre-edit states, then re-plan from clean spec.

---

### U6. Commit on `feat/new-sprint-skill-heal` branch

**Goal:** Single conventional commit landing U1-U4 on the existing branch in `~/code/claude-code-config`. U5's transient `bitbucket-test:` edits are reverted and not committed; U4's permanent `git:` block addition to POS Yellow's `.productivity.yml` IS committed (in the POS Yellow repo, not claude-code-config) — see below.

**Requirements:** R1-R9 (all delivered)

**Dependencies:** U1, U2, U3, U4, U5

**Files:**
- Stage in `~/code/claude-code-config`: `skills/productivity-sync/SKILL.md`
- Stage in `~/code/bunnings-pos-yellow`: `.productivity.yml`

**Approach:**
- Two commits because two repos. The skill commit lands on `feat/new-sprint-skill-heal` in claude-code-config. The POS Yellow commit lands on POS Yellow's **current branch (`fix/meeting-orchestrator-skill-healing`)** — verified empirically: POS Yellow has no `main` or `master` branch, only the one active feature branch. Scope-mixing is acceptable here because the `.productivity.yml` change is small (one block) and the user is the sole consumer of both branches.
- **claude-code-config commit message:**
  ```
  feat(productivity-sync): multi-forge git config with bitbucket stubs

  - New `git:` map schema in .productivity.yml supports GitHub and stubbed
    Bitbucket Cloud / Server forges keyed by forge name
  - Two auth modes per forge: gh (GitHub-only) and env (generic);
    keychain reserved for future
  - Forge name allowlist closes injection vector before keychain ships
  - Legacy `github:` block migrated read-side to `git: github-default`
    with one-cycle legacy-key retention for crash recovery
  - Bitbucket stubs validate config + emit visible warning with
    `stub adapter v0` sentinel when sync would have queried them
  - Implicit-mode sweep removed; explicit `git:` block required for
    forge sync
  - Cursor schema migrates connectors.github → connectors.git_forges.<name>
    with atomic writes
  - Token values never interpolated into report/cursor error text
  ```
- **POS Yellow commit message:**
  ```
  chore(productivity): add explicit git block to .productivity.yml

  Replaces the agent-memory-driven implicit sweep with an explicit
  config matching the new productivity-sync schema. No behavioural
  change in normal operation; ensures sweep is reproducible across
  machines.
  ```
- Verify each repo's staged diff matches the expected files (no accidental stagings).

**Patterns to follow:**
- Today's heal commit `02bd7e0` on the same branch in claude-code-config — same conventional-commit format, same HEREDOC syntax in the commit body.

**Test scenarios:**
- *Test expectation: commit step.*

**Verification:**
- `git log --oneline -2` in claude-code-config shows the new commit on top of `02bd7e0`.
- `git show --stat HEAD` in claude-code-config lists exactly one file (`skills/productivity-sync/SKILL.md`).
- `git log --oneline -1` in bunnings-pos-yellow shows the POS Yellow config commit.
- `git show --stat HEAD` in bunnings-pos-yellow lists exactly one file (`.productivity.yml`).
- Branches are correct: `feat/new-sprint-skill-heal` in claude-code-config, `fix/meeting-orchestrator-skill-healing` in POS Yellow.
- **Memory entry for sentinel enforcement** has been written to `~/.claude/projects/-Users-s1010081-code-bunnings-pos-yellow/context/feedback_stub_adapter_v0_sentinel.md` (or claude-code-config memory if more appropriate) documenting: "When implementing the follow-up Bitbucket adapter, never re-use `stub adapter v0` warning text. Run `grep -c 'stub adapter v0' skills/productivity-sync/SKILL.md` before and after; the count must remain exactly 1." This ensures the constraint surfaces during the follow-up plan's `ce-learnings-researcher` grounding pass.

---

## System-Wide Impact

- **Interaction graph:** `productivity-sync` consumes `.productivity.yml`; the schema change ripples to every consumer of that file. `productivity-setup` also consumes the file but is NOT updated in this plan — the wizard step is deferred to the follow-up Bitbucket-adapter plan where the wizard option produces a working config. Other skills do not read this file directly today.
- **Error propagation:** A malformed `git:` block fails config load with a specific line message identifying the offending forge name and field, surfaced in pre-flight. Zero-valid-forges surfaces as a top-level `NO FORGES SYNCED` pre-flight error. Partial-validity syncs the valid forges and surfaces per-forge errors for the rest.
- **State lifecycle risks:** Cursor migration is atomic (write-tmp-then-rename) with legacy-key retention for one cycle. Mid-write crash leaves either the original cursor (rename hasn't fired) or the new shape with the legacy key still present. No state where `consecutive_failures` history is silently lost — the legacy `connectors.github` key serves as the recovery anchor until the new key is proven readable on a subsequent run.
- **API surface parity:** None — neither skill exports anything for external consumers. The contract is between user-authored `.productivity.yml` and the skill.
- **Integration coverage:** U5 is the integration check. Mocks alone won't prove that the legacy-shim, explicit-config, and stub-warning paths all produce expected output against POS Yellow's real cursor + real GitHub.
- **Unchanged invariants:** All non-forge connectors in `.productivity.yml` are untouched (`connectors.calendar`, `connectors.email`, etc. keep their scalar shape). Today's heal commit's `consecutive_failures` field is preserved at the same nesting level (now under `connectors.git_forges.<name>` instead of `connectors.github`). The drift bucket logic itself is unchanged — only the field-to-bucket mapping per forge changes, and only GitHub's mapping is implemented. GitHub's `gh pr list --json ...` invocation is preserved verbatim; no normalisation, no script wrapping.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Cursor migration corrupts mid-write and loses `consecutive_failures` history | U3 specifies write-tmp-then-rename atomic rename. A mid-rename crash leaves the original cursor file unchanged; next run re-migrates. No state machine, no retention complexity. |
| Stub warning becomes invisible after habituation | Warning fires every sync (not throttled), in the final report (not pre-flight). Version sentinel (`stub adapter v0`) means future real adapters can't accidentally re-emit it. Reassess if the user reports ignoring it. |
| Legacy-shim doesn't fire for users with the old `github:` block | U1 documents the shim trigger condition explicitly. U5 includes an edge-case scenario for legacy-block sync. The shim is a read-side rename — minimal logic, low risk of silent failure. |
| Malformed `git:` block silently disables forge sync | U2 spec: malformed entries surface specific config-load errors per-forge; zero-valid-forges surfaces as top-level `NO FORGES SYNCED` pre-flight error. No silent fallback. |
| Token value leaks into the sync report or cursor error field | U1 enumerates every auth error path with exact sanitised text (R9). U5 canary test asserts `secret-canary-value-do-not-leak` does not appear in cursor or report after a deliberate auth failure. |
| Compromised `base_url` becomes SSRF / credential-harvesting vector when real Bitbucket Server adapter ships | R10 validates `base_url` at schema-load: HTTPS-only regex + RFC1918/link-local rejection. Stub enforces this even though it makes no calls, so the follow-up adapter inherits a validated value. |
| Future Bitbucket adapter re-uses the stub-warning text, defeating the sentinel | U1 verification + U6 land a memory entry pinning the `grep -c "stub adapter v0" SKILL.md` enforcement contract. The follow-up plan's `ce-learnings-researcher` pass picks up the memory entry. |
| U5 abort leaves SKILL.md + POS Yellow .productivity.yml in half-validated state during re-plan window | U5 abort handler explicitly reverts both files to pre-edit state before re-planning resumes. Machine returns to clean baseline; re-plan happens out-of-band. |
| Forge name injection via keychain entry name | R8 allowlist (`^[a-z][a-z0-9-]{0,62}$`) closes the vector before `keychain` mode ships. When the follow-up plan adds keychain support, the allowlist already protects it. |
| Test env vars (`BITBUCKET_TOKEN=stub`) persist across shell sessions after U5 Run 3 | U5 Verification explicitly includes `unset BITBUCKET_TOKEN BITBUCKET_USER` in the revert checklist. |
| U5 fold-back loop becomes unbounded | Bounded to one fold-back iteration. Second gap triggers abort + revert (see preceding row) and re-plan rather than patch-and-rerun. |

---

## Documentation / Operational Notes

- **No external docs to update.** The skills are the docs.
- **No rollout coordination needed.** Single user (me), two machines, single branch in claude-code-config + a one-file commit in bunnings-pos-yellow. The Bitbucket-using machine pulls the new branch when ready and lands its own `git:` block at that time.
- **No monitoring/observability changes.** The skill is interactive; the final-report block *is* the observability.
- **A future PR description from `ce-work` should reference this plan path** so reviewers (future-me) can trace the schema decision back to its rationale, including the deepening pass that trimmed U3 + U6 from the original draft.

---

## Sources & References

- This conversation's prior turns (Phase 0.4 bootstrap + Phase 0.7 synthesis + Phase 5.3.8 ce-doc-review walk-through)
- Today's productivity-sync heal commit: `~/code/claude-code-config` branch `feat/new-sprint-skill-heal` commit `02bd7e0`
- `~/.claude/skills/productivity-sync/SKILL.md` (current GitHub block at L415-490)
- `~/code/bunnings-pos-yellow/.productivity.yml` (real-world consumer; gains `git:` block in U4)
- `~/code/bunnings-pos-yellow/.productivity-sync-cursor.json` (real-world cursor with today's schema; migration target)
- Memory: `~/.claude/projects/-Users-s1010081-code-bunnings-pos-yellow/context/feedback_verify_pr_state_against_github.md`
- **Deepening pass round 1** (6 reviewers — coherence, feasibility, product-lens, security, scope-guardian, adversarial): 4 safe-auto fixes applied silently; 14 manual findings walked through interactively; 2 FYI skipped. Trim outcomes: dropped U3 (script extraction) + U6-original (productivity-setup wizard); removed R6-original (implicit-mode codification); demoted four-query adapter contract from unit to KTD prose; added R8 (allowlist) + R9 (token scrubbing); added U4 (POS Yellow migration).
- **Deepening pass round 2** (5 reviewers — coherence, feasibility, security, scope-guardian, adversarial): 4 safe-auto fixes applied silently; 8 manual findings walked through interactively; 3 lower-confidence findings skipped per user decision. Round 2 outcomes: dropped legacy-key retention rule (atomic write alone is sufficient); POS Yellow commit branch corrected from "main (likely)" to empirically-verified `fix/meeting-orchestrator-skill-healing`; added R10 (`base_url` validation at schema-load); added token-scrubbing negative test (canary value) to U5; added sentinel-uniqueness grep contract + memory entry for future-plan grounding; U5 abort handler now explicitly reverts both files.
