# Bootstrap

No `docs/agents/doc-targets.yml` means the repo has never been mapped. **Stop.** Do not run a partial audit and do not write anything yet.

Without the manifest the skill reads the filesystem and nothing else: no doc gets checked against the artifact that settles its claims, and nothing is declared unverifiable. That run finds little and looks like it worked — the same silence-read-as-success this skill exists to prevent.

## 1. Report the gap

Say plainly what is missing and what it costs. Do not start work.

> No `docs/agents/doc-targets.yml` in this repo, so I can only resolve broken paths — I cannot check any document against the workflow, script, or config that settles its claims, and nothing is marked as not-checkable. That is not an audit.
>
> I can scan the doc surface and propose a manifest. It costs about one cheap agent per markdown file, reads only, and writes nothing until you approve it. Want me to?

Then wait. No discovery until the user says yes.

## 2. Discover, one agent per doc

On approval, enumerate the doc surface — root `*.md`, `docs/**`, and any `SKILL.md` or notices shipped inside the payload — and give **each file its own agent**. One agent sweeping the whole repo is the scoping failure the target-scoped design fixes: it will not open every workflow to see what each doc specifies.

Each agent answers four questions about one file:

```
Repo: {root}
Document: {path}

1. CLAIM DENSITY — how many checkable factual assertions? A claim is something
   that could be true or false about code, config, or workflows. Prose,
   rationale, and stated intent are not claims.

2. VERIFICATION TARGET — name the exact artifacts that settle them. Not "the
   code": `.github/workflows/release.yml`, `scripts/build.ts`, `package.json`.
   Read enough of the repo to name real paths.

3. CHECKABLE AT ALL? — can anything IN THIS REPO settle these claims? External
   CLI behaviour, hosted CI runs, human receipts, and third-party settings
   cannot. Say which.

4. FROZEN? — is this a superseded ADR or a historical plan? Those record
   history correctly and are not drift.

Return: density, targets[], unverifiable reason (or null), frozen (bool).
```

Run these with `haiku` at `low` effort. Naming a doc's target is cheap; the expensive judgement comes later, in the audit itself.

## 3. Propose, do not write

Assemble the results into manifest shape ([manifest.md](manifest.md)) and show it in full. Lead with what the map means, because the counts are the reviewable part:

> Scanned 29 files. Proposed: **14 targets**, **4 unverifiable**, **3 frozen globs**, 8 deliberately uncovered.
>
> The dense ones: `docs/publishing.md` (~28 claims) and `docs/release-repair.md` (~30) both specify `.github/workflows/release.yml`. `docs/adr/0003` carries ~55 claims about the same file.
>
> Not checkable from this repo: `docs/installing.md` (~90 claims about external Claude and Codex CLI surface), `docs/native-capability-qualification.md` (human receipts), `docs/canary-qualification.md` (hosted CI).
>
> Write this to `docs/agents/doc-targets.yml`?

Call out anything worth arguing with — a doc you could not find a target for, a split file whose claims are half-checkable, a `frozen` guess. The user is reviewing your judgement, not just a file.

## 4. Write, then stop

On approval, write `docs/agents/doc-targets.yml` and **stop there**. Do not run the audit.

The write and the run are two decisions. The user should read the manifest, commit it if they want it, and choose separately whether to spend the agents on a full audit. Say what the run would cost when they ask for it.

## Refusing the scan

If the user declines discovery, do not fall back to a partial audit. Point at [manifest.md](manifest.md) for the schema and offer the deterministic lens alone — named for what it is:

> Running the reference lens only. It resolves broken paths and nothing else: no document is checked against its artifact, and zero findings for anything else means nothing.
