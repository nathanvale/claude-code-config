# Workflow

The script. Pass `args: { root, manifest? }` — `manifest` defaults to `docs/agents/doc-targets.yml`, read by the caller and passed in parsed.

`reference` resolves in-process (no agent). Each `targets` entry gets one agent with its artifacts named. `unverifiable` and `frozen` cost nothing. Agent count is `T scanners + N verifiers + 1 synthesiser`, where T is the number of `targets` entries.

```js
export const meta = {
  name: 'docs-drift',
  description: 'Check whether ADRs, CONTEXT.md, AGENTS.md, and docs/ still describe the code',
  phases: [
    { title: 'Scan', detail: 'one agent per doc, with its verification target named' },
    { title: 'Verify', detail: 'read both sides first, then compare against the claim' },
    { title: 'Synthesise', detail: 'report by confidence, including what was not checkable' },
  ],
}

const MAX_PER_DOC = 8

// Judges anchor on confident assertion language, scoring assertive trajectories
// 0.27-0.36 higher regardless of outcome (arXiv 2606.09863). `observation` is
// deliberately neutral so the verifier compares two statements rather than
// rating a confident claim.
const BANNED_VOCAB = ['successfully', 'clearly', 'obviously', 'definitely', 'certainly', 'proves']

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          doc: { type: 'string', description: 'file:line of the doc making the claim' },
          code: { type: 'string', description: 'file:line in the named target artifact, or empty when the finding is an absence' },
          claim: { type: 'string', description: 'what the doc states, quoted verbatim' },
          observation: {
            type: 'string',
            description:
              'Neutral two-part statement: what the doc states, and what the artifact does. No verdict words, no emphasis, no conclusion. Write "doc says X; workflow does Y" — not "the doc is wrong".',
          },
        },
        required: ['doc', 'claim', 'observation'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean', description: 'true when this is not drift' },
    why: { type: 'string' },
  },
  required: ['refuted', 'why'],
}

const root = args?.root ?? '.'
const manifest = args?.manifest ?? {}
const targets = Object.entries(manifest.targets ?? {})
const unverifiable = Object.entries(manifest.unverifiable ?? {})

// ---------------------------------------------------------------------------
// reference lens — deterministic, in-process, no agent.
// Resolving a path is `test -e`, not a judgement call. LLM judges run ~0.65
// AUROC on this class of check while mechanical detectors reach 0.83-0.95
// (arXiv 2606.09863), so this never reaches the verify stage.
// resolveReferences() ships at scripts/resolve-references.mjs.
// ---------------------------------------------------------------------------
const referenceFindings = (await resolveReferences(root)).map((f) => ({
  ...f,
  target: 'filesystem',
  confidence: 'deterministic',
  verdict: { refuted: false, why: 'path does not resolve on disk' },
}))

const results = await pipeline(
  targets,

  // Scan — one doc, its artifacts named. The naming is the whole point: a
  // scanner told to "find drift in the repo" will not open a 1000-line
  // workflow file, so the ~130 claims those docs make go unread.
  ([doc, artifacts]) =>
    agent(
      `Repo: ${root}

Check ONE document against its verification target.

  Document: ${doc}
  Verify against: ${artifacts.join(', ')}

Read the document. Read every artifact listed above — in full, not by grep.
For each factual assertion the document makes about those artifacts, decide
whether the artifact still does what the document says.

Write every observation as a neutral two-part statement — what the doc states,
what the artifact does — and stop there. Do not add a verdict, and do not use
these words: ${BANNED_VOCAB.join(', ')}. A later step decides whether it is drift.

Ignore prose, rationale, and stated intent. A claim is checkable only if the
named artifacts can settle it. Skip anything needing external CLI behaviour,
a hosted CI run, or a human receipt — those are handled separately.

Report at most ${MAX_PER_DOC} findings, strongest first. Report zero if the
document holds.`,
      { label: `scan:${doc.split('/').pop()}`, phase: 'Scan', schema: FINDINGS, model: 'haiku', effort: 'low' },
    ),

  // Verify — commit-first. The verifier forms its own reading of both sides
  // BEFORE the finding is revealed, then compares. Anchored judges score
  // plausibility over correctness; committing first drops false positives
  // sharply where ground truth exists (arXiv 2607.05904).
  (scan, [doc, artifacts]) =>
    parallel(
      (scan?.findings ?? []).slice(0, MAX_PER_DOC).map((f) => () =>
        agent(
          `Two steps, in order. Do not skip step 1.

STEP 1 — commit first. Read these two locations in ${root} and write down, in
your own words, what each one actually says. Do this before reading step 2.
  Doc:      ${f.doc}
  Artifact: ${f.code || artifacts.join(', ')}

STEP 2 — compare. Another process reported:
  Doc states: ${f.claim}
  Observation: ${f.observation}

Does YOUR step-1 reading match that observation? Refute it when your own reading
disagrees, the doc is correct, the claim is aspirational rather than factual, or
the wording is awkward without asserting anything false.

Default to refuted=true when uncertain. A survivor must be a doc stating
something the artifact contradicts today, confirmed by your own reading.`,
          { label: `verify:${doc.split('/').pop()}`, phase: 'Verify', schema: VERDICT },
        ).then((v) => ({ ...f, target: artifacts.join(', '), confidence: 'judged', verdict: v })),
      ),
    ),
)

// Barrier earned: dedup needs every doc at once.
const judged = results
  .flat()
  .filter(Boolean)
  .filter((f) => f.verdict && !f.verdict.refuted)

const confirmed = [...referenceFindings, ...judged]

log(
  `${confirmed.length} confirmed (${referenceFindings.length} deterministic, ${judged.length} judged) across ${targets.length} docs; ${unverifiable.length} not checkable from this repo`,
)

phase('Synthesise')
const report = await agent(
  `Write a docs-drift report.

CONFIRMED FINDINGS:
${JSON.stringify(confirmed, null, 2)}

NOT CHECKABLE FROM THIS REPO:
${JSON.stringify(unverifiable, null, 2)}

DOCS CHECKED: ${targets.map(([d]) => d).join(', ') || '(none — no manifest)'}

Three sections, in this order:

  1. "Broken references" — confidence:'deterministic'. Resolved on disk, so
     objectively wrong. State them plainly. Omit the section if empty.
  2. "Judged findings" — confidence:'judged'. These passed an LLM verifier that
     runs near 0.65 AUROC on this class of check. Introduce with one line saying
     they need human confirmation. Omit the section if empty.
  3. "Not checkable from this repo" — list each doc and its reason verbatim.
     Say plainly that these were NOT scanned and that zero findings for them
     means nothing. Never omit this section when the list is non-empty.

Within sections, order by doc path. Collapse findings that are the same
underlying drift. Each entry: the doc (file:line), the artifact (file:line),
and the observation. State how many docs were checked and how many findings
each produced, including zeros. Do not propose edits — this is report-only.`,
  { label: 'synthesise', phase: 'Synthesise' },
)

return { confirmed, unverifiable, docsChecked: targets.map(([d]) => d), report }
```

## Reading the manifest

The caller parses `docs/agents/doc-targets.yml` and passes it as `args.manifest`. Schema and a worked example: [manifest.md](manifest.md).

```js
// Bun
const manifest = Bun.YAML.parse(await Bun.file(`${root}/docs/agents/doc-targets.yml`).text())
Workflow({ script, args: { root, manifest } })
```

No manifest means `targets` is empty and only the deterministic lens runs. That is a valid cheap mode, not an error — but say so in the report rather than presenting it as a full audit.

## `resolveReferences(root, opts?)`

Ships at [`scripts/resolve-references.mjs`](../scripts/resolve-references.mjs). Run it standalone for the deterministic lens alone:

```sh
node skills/docs-drift/scripts/resolve-references.mjs <repo-root>
```

Returns `[{ doc, code: '', claim, observation }]` per non-resolving reference.

**The filters are the hard part, and each one was earned.** Against a real repo the raw heuristic produced 39 findings, all false positives. What it must skip:

| Class | Example | Why |
|---|---|---|
| Slash commands | `/hooks`, `/triage` | CLI commands, not paths |
| Module specifiers | `@rollup/plugin-node-resolve`, `fs/promises` | npm, not repo |
| Git refs | `origin/main` | not a path |
| Env / home paths | `$XDG_STATE_HOME/…`, `~/.local/state` | runtime, not repo |
| Declared dependencies | `zod` | in `package.json` |
| Superseded ADRs | whole file | records history correctly |
| Absence assertions | "this repo has no `src/`" | the doc is *right* |
| Historical plans | `docs/plans/**` | rationale, not current claims |

`bun run <script>` resolves against `package.json` scripts. Fenced code blocks are skipped. Pass `{ excludeDirs: [...] }` to override the `docs/plans/` default.

## Confidence

Three tiers:

- **`deterministic`** — the reference lens. A path resolves or it does not.
- **`judged`** — a doc×target agent found it and a commit-first verifier confirmed it. Best-in-class judges reach ~0.65 AUROC (arXiv 2606.09863), so these are leads for a human. Adding verifiers does not help: a three-judge ensemble still accepted 55% of wrong answers (arXiv 2607.05904).
- **`unverifiable`** — declared in the manifest, never scanned, always named in the report. Zero findings for these docs is not a clean bill.

## Tuning

- **Too slow / too many agents** — trim `targets` to the workflow-coupled docs; they carry the highest claim density.
- **Deterministic lens only** — omit `manifest`.
- **Scanner skimming instead of reading** — raise `effort` on the scan agent for docs whose target is a long workflow file.
- **Verifier refuting real drift** — refute-by-default is deliberate. Loosen the last paragraph of STEP 2 before touching anything else.

## Resume

Every invocation persists its script and returns a `runId`. To iterate, edit the persisted file and re-invoke with `{ scriptPath, resumeFromRunId }` — unchanged `agent()` calls return cached results, so only edited stages re-run.
