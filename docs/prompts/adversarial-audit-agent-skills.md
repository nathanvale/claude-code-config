# Adversarial Audit — `runtime/agent-skills` (v2 instance)

Filled-in instance of `docs/prompts/adversarial-audit-v2.md` for the agent-skills
package. The workflow skeleton, convergence loop, and helper definitions live in
the template — this file supplies only the target-specific goal prompt.

Context: a v1 single-pass audit (2026-07-03) produced 20 verified findings;
fixes shipped on `fix/agent-skills-projection-hardening` and are recorded in
`docs/decisions/2026-07-03-agent-skills-projection-hardening.md`. This v2 run
audits the hardened code to convergence. Pre-seed the dedup memory with the 20
v1 findings so only genuinely new flaws (or bypasses of the shipped fixes)
count as fresh.

---

## The goal (paste this to run)

Tuned to fit the `/goal` 4000-char limit (3993 chars). The full-detail v1
narrative frame lives in git history; the finders recover the fine grain by
reading the source, `CONTEXT.md`, and the decision log named below.

> Adversarial audit of `runtime/agent-skills` (all `src/`) to convergence — confirmed reproducible flaws ranked by severity, not one pass. Use a Workflow per `docs/prompts/adversarial-audit-v2.md`. First read the source + `CONTEXT.md` + the decision log `docs/decisions/2026-07-03-agent-skills-projection-hardening.md`; inject source excerpts + CONTEXT.md invariants into every finder prompt.
>
> Dedup seed: the 20 v1 findings in the decision log are known. Fresh = new, or a bypass of a shipped fix (canonical id fold, benign self-install, apply-time revalidation, classifier ordering, visible-only catalog_conflict, lstat tolerance). A v1 finding rediscovered as-shipped-fixed is not fresh.
>
> Threat frame: attacker (or uncoordinated second writer) controls skills-lock.json + projection roots (.agents/skills, .claude/skills), not the skills/ catalog or agent-skills source. Six concurrent writers exist. APFS case-insensitive + NFC-normalizing. In-model: hostile lock ids (traversal, case/NFC, non-single-component keys), hostile symlink targets, plan/apply TOCTOU. Out-of-model unless shown worse than documented: has_hash presence-only, destructive-blocker dead-end, agent/skills sibling tree.
>
> Invariants to break:
> - Canonical-id everywhere (case fold + NFC, raw display-only); symlink-into-catalog classifies managed/broken before lock recognition; catalog_conflict only for visible entries; benign self-install (sourceType local, source in catalog) aliases.
> - Fail-closed on any blocker (external recognition never weakens it); applyProjection re-reads lock + re-classifies each path pre-mutate, ownership surprise → unmanaged_blocker; mutate only managed links, never rm real dirs/blockers/externals.
> - Lock read-only; parse failure → zero externals + named diagnostic (empty lock is not a failure), never crash/silent-empty; CLI envelopes + stations + next/failure actions deterministic per command-contract.ts and branch-station-catalog.ts.
>
> Finder lenses (parallel), each: concrete reproducible findings only, exact inputs→wrong-output, empty if none:
> 1. Ownership collisions — id-fold edges beyond case/NFC (width, confusables, trailing dots/spaces, reserved names); one id claimed by catalog+lock+disk.
> 2. Trust-boundary — hostile lock records: key-validation gaps, source/sourceType abuse faking benign self-install, shape spoofing.
> 3. Filesystem/symlink — foreign-symlink misclassification, realpath vs raw disagreement, catalog entry or projection root that is itself a symlink/file, nested/relative targets.
> 4. Concurrency/TOCTOU — races the revalidation misses, readdir/lstat gaps, snapshot staleness, two processes racing.
> 5. Cross-component seam drift — auto-default vs explicit config, ignore-rule × folding/externals, renderer misreporting classifier state, station/next-action mismatch.
> 6. Upstream — empirically with bunx skills@latest: real lock/disk shape + -a '*' targets vs classifier assumptions; drift since 1.5.14.
> 7. Operator/workflow — repair-hint dead ends, provenance-destroying next actions, missing_config vs auto-default, wrong unlink semantics.
> 8. Hardening bypass — attack the six fixes: force a variant past the fold, fake benign self-install, race/wedge revalidation, invert managed-before-lock, hide a visible entry from catalog_conflict.
>
> Converge: loop until 2 consecutive rounds find zero new. Every lens runs every shuffle ordering ≥once before dry. Log tried + empties. Anti-bias: shuffle source-file order per finder per round (seed on round index; no Math.random).
>
> Verify: dedup round first (key folds case+NFC), then refute-by-default with 3 skeptics; survive on ≥2 confirmations. Skeptics reproduce against real code (temp-dir probes, bun tests). Drop findings needing repo-source control.
>
> Deliver: confirmed + plausible survivors by severity — file:line, repro scenario, one-line fix, invariant broken. Coverage report: lenses run, rounds to converge, refuted count, any lens never dry, verdict per shipped fix (held/bypassed/not-exercised).

---

## When to run

After the hardening branch merges, or any time `projection.ts`,
`skills-lock.ts`, or the classifier ordering changes materially. Not for docs
or test-only diffs — use `/code-review` there.

---

## v2 run results (2026-07-03, stopped at 3 rounds)

Run `wf_97ae52ac-5c2`. 8 lenses × 3 rounds, N-of-M refute-by-default verify
(≥2 of 3 skeptics, each reproducing against real code via temp-dir bun probes
on this APFS volume). Stopped at round 3 by operator (had not hit 2 dry rounds);
finders were still surfacing repeats of the same families, so the confirmed set
below is stable even though formal convergence was not reached. 54 raw findings
collapsed to **12 defect families**; 114 verifier votes, 102 CONFIRMED, 12
REFUTED (all refutals were minority severity-disputes on families that still
cleared ≥2-of-3 — none killed a family).

### Confirmed survivors — ranked

Every finding below reproduces against the real source; all are fresh (new
seams, or bypasses of a shipped fix), not rediscoveries of the 20 v1 findings
as-fixed. `file:line` is `runtime/agent-skills/src/`.

**1. CRITICAL — `unlink` non-recursively `rm`s a self-install real directory (crashes / data-loss).** `projection.ts:431` (7 findings, 3×critical)
Benign self-install fix (b) promotes a real-dir copy at `.claude/skills/<id>`
from `external` (excluded from unlink) to `managed` (fed to `rm`).
`unlinkManagedProjections` calls `rm(entry.path, {force:true})` **without
`recursive`** and **without** the `removeIfOwnedLink` guard the apply path got.
On a real dir it throws `EISDIR`/`EFAULT` → `internal_error` crash. Repro:
catalog `skills/fallow`, real-dir copy `.claude/skills/fallow`, lock
`{fallow:{source:"./skills/fallow",sourceType:"local"}}`, run `agent-skills
unlink`. This is the exact non-recursive-rm crash v1 fixed for *apply* only;
`unlink` is a separate call site that still calls raw `rm`.
*Fix:* route `unlink` through `removeIfOwnedLink` (or gate `entry.shape==="symlink"` before `rm`).

**2. CRITICAL/HIGH — Symlinked projection root escapes the repo (confused-deputy FS escape).** `projection.ts:484` (3 findings)
The threat frame lets an attacker/second-writer control projection-root
*contents*. Replace a root with a symlink: `ln -s /outside/victim
.claude/skills`. `readProjectionRoot`'s `readdir` follows it; `applyProjection`'s
`mkdir` no-ops on the existing symlink then writes `symlink()` **into** victim;
`unlink`'s `rm` deletes files **inside** victim (proved end-to-end). `unlink`
has no blocker gate at all, so it fires unconditionally. `isValidProjectionRoot`
is purely lexical on the config string — it cannot detect a symlink planted on
disk, and the default roots skip config validation entirely.
*Fix:* `realpath` each `join(repoRoot, root)` and require `isInside(repoRoot, resolved)` before any read/write/rm; treat an escaping root as a blocker.

**3. HIGH — `isSelfInstall` trusts hostile lock `source`/`sourceType` with no id-binding: universal `catalog_conflict` suppressor + external→managed reclassifier.** `projection.ts:55` (bypass of fixes b + e; 11 findings across two forge families)
`isSelfInstall` checks only that `record.source` resolves *inside* `catalogRoot`
— never that it binds to the record's own id. `catalogRoot` always contains
real subdirs, so a forged lock `{<any-id>:{source:"skills",sourceType:"local"}}`
satisfies the predicate for **any** id. Verified: honest lock → 1
`catalog_conflict`, `health=blocked`; forged lock → 0 conflicts,
`health=needs_sync`. Worse (POC-confirmed): with a foreign external at the
projection path, `applyProjection` re-checks `isSelfInstall` (still true), skips
the fail-closed guard, `removeIfOwnedLink` deletes the foreign symlink, and
`symlink()` repoints it at the catalog — a foreign install the user cared about
is silently destroyed and replaced, no blocker surfaced.
*Fix:* bind self-install to identity — require `realpath(diskEntryPath)` (not just `source`) to be inside `catalogRoot` for *this* id; a real-dir/foreign-symlink disk entry with a lock record must classify `external` and still raise `catalog_conflict` for a visible catalog id.

**4. HIGH — `canonicalSkillId` (NFC+`toLowerCase`) under-folds vs APFS case-folding.** `skills-lock.ts:45` (5 findings)
`toLowerCase()` is simple case-mapping, not Unicode full case-folding. APFS
folds ß↔SS, Greek final↔medial sigma (ς↔σ), and compatibility ligatures to one
path; `canonicalSkillId` leaves them distinct. Verified on-machine: `mkdir
"straße"` then `stat "STRASSE"` is one inode, but
`canonicalSkillId("straße")="straße" ≠ "strasse"=canonicalSkillId("STRASSE")`.
Lock `{STRASSE:…}` + catalog `straße` → `catalog_conflict` never fires; sync
dead-ends at an opaque `unmanaged_blocker` with no `why`, or overwrites the
lock-claimed external. The final-sigma pair needs no uppercase at all, so it is
not a v1 case-variant. Fix (a)'s doc-comment claims a variant lock id "cannot
classify one path two ways" — this class does.
*Fix:* fold with Unicode Default Caseless Match (full case-folding), or at minimum `NFKC` + special-case ß/final-sigma; add fixtures asserting the pairs fold equal.

**5. HIGH — `symlink()` at apply has no `EEXIST` guard: check-to-act race crashes as `internal_error` after partial mutation.** `projection.ts:368` (4 findings)
Between `removeIfOwnedLink` clearing a path and `await symlink(target,
linkPath)`, a concurrent writer recreates the path → `symlink` throws `EEXIST`.
Line 368 has no try/catch; `EEXIST` doesn't match the `unmanaged_blocker`
mapping in `cli.ts`, so it falls through to `internal_error` — *after* earlier
paths were already mutated. This is exactly the "ownership surprise" fix (c)
claims to defer; the once-read `freshLock` cannot cover the syscall gap.
*Fix:* wrap line 368 in try/catch; on `EEXIST`/any error set `deferred=true; continue` so it funnels into the fail-closed `unmanaged_blocker` throw.

**6. HIGH — Lock parse failure demotes a legitimate external to a bare `real_entry` blocker with no `why`, luring `rm`.** `projection.ts:230` (1 finding)
A transiently corrupt/half-written lock (a concurrent writer) → zero entries → a
real external dir classifies `blocker:real_entry` with **no `why`** (only
conflict/escaping blockers get one). Structurally identical to a squatter, whose
only documented unwedge is `rm` (deferred #18) — so an agent `rm`s a legitimate
external because the lockfile was momentarily invalid. The parse-failure `note:`
prints as a separate unlinked line.
*Fix:* when `parseFailure` is set, attach a `why` to record-less blockers naming the parse failure and directing repair at the lockfile; or suppress rm-implying next actions while `parseFailure` holds.

**7. HIGH — `removeIfOwnedLink` lstat→rm TOCTOU: symlink swapped for a real non-empty dir crashes on non-recursive `rm`.** `projection.ts:637` (3 findings)
The single-lstat guard cannot close its own two-syscall window. If a symlink is
replaced by a populated real dir between `lstat` (line 632) and `rm` (line 637),
non-recursive `rm` throws `EISDIR` uncaught — the same crash fix (c) claims to
eliminate, structurally reachable after the guard's own lstat.
*Fix:* wrap the `rm` in try/catch → return `false` (defer) instead of letting `EISDIR` escape.

**8. MEDIUM (disputed → confirmed defect) — `unlinkManagedProjections` keys its lock map by RAW id, defeating the canonical fold.** `projection.ts:418` (14 findings — the largest cluster)
The one remaining raw-keyed lock map: `new Map(lock.entries.map(e => [e.id,
e]))` while `readProjectionRoot` looks up `canonicalSkillId(id)`. A case/NFC
variant external classifies `external` under `status` but `blocker` under
`unlink` — same path, two classifications, invariant #1 broken in the unlink
lane. Minority skeptics confirmed the *code fact* but disputed the harm ceiling;
it still cleared ≥2-of-3. (Also passes `catalogRoot` omitted → defaults to
`managedTargets[0]`, so self-install detection is degraded in unlink too.)
*Fix:* use `buildLockRecords(lock.entries)` — the same fold builder `planProjection` uses.

**9. MEDIUM — `freshLock` read once before the apply loops; an entry landing mid-loop is missed for later paths.** `projection.ts:333` (2 findings)
Fix (c)'s comment says "re-classifies each path immediately before mutating,"
but the lock is read exactly once at line 333. A lock entry that lands *during*
the loop is invisible to every not-yet-processed path → apply can overwrite a
concurrently-landed external symlink (v1 #12 reoccurring for post-line-333
arrivals).
*Fix:* before `symlink` at line 368, re-lstat `linkPath`; if it's a symlink whose realpath is outside `catalogRoot`, defer.

**10. MEDIUM — Case/NFC-variant ignore pattern silently fails to suppress a folded `catalog_conflict`.** `catalog.ts:98` (1 finding)
`matchesSkillIdGlob` compiles a case-sensitive, unfolded regex while
`catalogConflictBlockers` folds both sides. On APFS, `ignore: ["fallow"]`
against catalog dir `Fallow` under-matches → the documented non-destructive
unwedge (ignore the id) is inert against the exact variant that trips the fold.
*Fix:* fold both operands — build the regex from `canonicalSkillId(pattern)`, test against `canonicalSkillId(id)`.

**11. MEDIUM — `unlink` silently drops entries it declined to touch.** `projection.ts:426` (1 finding)
`unlinkManagedProjections` returns only managed/broken paths; any entry the
raw-id miss (finding 8) reclassified `blocker` is discarded with no diagnostic.
`unlink` reports `links` + "success" and exit 0 while a status-`managed` entry
is still present — undiagnosable from unlink output alone.
*Fix:* return skipped-blocker paths + reason and surface them in `renderUnlink`; or fix finding 8 so the divergence never arises.

### Per-shipped-fix verdict

| Shipped fix | Verdict |
|---|---|
| (a) canonical id fold | **Bypassed** — under-folds vs APFS case-folding (finding 4); not applied in the ignore matcher (10) or the unlink lane (8) |
| (b) benign self-install | **Bypassed** — attacker-forgeable, no id-binding (finding 3); promotes a real-dir copy into the crashing `unlink` rm (1) |
| (c) apply-time revalidation | **Bypassed** — `freshLock` read once, not per-path (9); no `EEXIST`/`EISDIR` guard on the symlink/rm syscalls (5, 7) |
| (d) classifier ordering (managed-before-lock) | **Held** — no confirmed inversion |
| (e) visible-only `catalog_conflict` | **Bypassed indirectly** — suppressed via forged self-install (3); ignore-fold gap (10) |
| (f) lstat tolerance | **Held** — no confirmed exploit of the skip-on-vanish |

### Coverage report

- **Lenses run:** all 8, each ≥3 rounds (finder count logged in journal).
- **Rounds to convergence:** did **not** converge — stopped at round 3 by
  operator before 2 consecutive dry rounds. Confirmed set is stable (round 2–3
  were re-discoveries), but the honest gap is that formal exhaustion was not
  proven; a 2-more-round run would confirm dryness.
- **Refuted:** 12 of 114 verifier votes, all minority severity-disputes; 0
  families killed.
- **Lens that never came back dry:** all — the loop was cut short, so no lens
  reached its dry state. Highest-yield lenses: cross-component seam (finding 8),
  trust-boundary + hardening-bypass (findings 1, 3), filesystem/symlink (2).
- **Not exercised to completion:** upstream-empirical (lens 7) ran `bunx skills`
  probes but produced no confirmed shape-drift finding within 3 rounds.

### Recommended fix order

Ship 1, 2, 3 first (data-loss / FS-escape / attacker-forgeable fail-open), then
5, 7, 9 (concurrency crash-to-fail-closed), then 4 (Unicode fold), then 6, 8,
10, 11 (legibility + fold-consistency). Findings 5, 7, 9 share one fix shape:
funnel every apply-time syscall surprise into `deferred → unmanaged_blocker`.
