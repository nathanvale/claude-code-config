# Workflow

The script. Pass `args: { root, lenses? }` — `lenses` defaults to all four.

`reference` resolves in-process (no agent), so agent count is `3 scanners + N verifiers + 1 synthesiser` where N counts judged findings only. A clean repo costs 3 agents.

```js
export const meta = {
  name: 'docs-drift',
  description: 'Check whether ADRs, CONTEXT.md, AGENTS.md, and docs/ still describe the code',
  phases: [
    { title: 'Scan', detail: 'resolve references deterministically; one scanner per judged lens' },
    { title: 'Verify', detail: 'read both sides first, then compare against the claim' },
    { title: 'Synthesise', detail: 'dedup across lenses and report by confidence' },
  ],
}

const MAX_PER_LENS = 12

// `reference` is absent: it resolves in-process below, never as an agent.
const LENSES = {
  claim: {
    hunt: 'A doc asserts behaviour the code contradicts.',
    evidence: 'Read the doc claim and the implementing code. Quote both.',
  },
  vocabulary: {
    hunt: 'A domain term is used in code or ADRs but missing from the glossary, or the glossary defines a term nothing uses.',
    evidence: 'Name the term and where it appears (or fails to).',
  },
  decision: {
    hunt: 'A hard-to-reverse, non-obvious architectural choice is visible in the code with no ADR recording it.',
    evidence: 'Name the choice, where it lives, and why a future reader would ask "why is this like this".',
  },
}

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
          code: { type: 'string', description: 'file:line of the relevant code, or "" when the finding is an absence' },
          claim: { type: 'string', description: 'what the doc states, quoted verbatim' },
          observation: {
            type: 'string',
            description:
              'Neutral two-part statement: what the doc states, and what the code does. No verdict words, no emphasis, no conclusion. Write "doc says X; code does Y" — not "the doc is clearly wrong".',
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
const requested = args?.lenses ?? ['reference', ...Object.keys(LENSES)]
const judgedLenses = requested.filter((l) => LENSES[l])
const wantReference = requested.includes('reference')

// ---------------------------------------------------------------------------
// reference lens — deterministic, in-process, no agent.
//
// Resolving a path is `test -e`, not a judgement call. LLM judges run ~0.65
// AUROC on this class of verification while mechanical detectors reach
// 0.83-0.95 (arXiv 2606.09863), so this lens never reaches the verify stage
// and its findings ship as confidence:'deterministic'.
//
// resolveReferences() is supplied by the caller (see SKILL.md "Run"): it greps
// the doc surface for backticked paths/scripts/flags, resolves each against
// the repo, and returns the non-resolvers.
// ---------------------------------------------------------------------------
const referenceFindings = wantReference
  ? (await resolveReferences(root)).slice(0, MAX_PER_LENS).map((f) => ({
      ...f,
      lens: 'reference',
      confidence: 'deterministic',
      verdict: { refuted: false, why: 'path does not resolve on disk' },
    }))
  : []

const results = await pipeline(
  judgedLenses,

  // Scan — mechanical. Cheap model, low effort.
  (lens) =>
    agent(
      `Repo: ${root}

Find DRIFT of one kind: ${LENSES[lens].hunt}

Doc surface: AGENTS.md, CLAUDE.md, CONTEXT.md, CONTEXT-MAP.md, README.md, docs/**.
Evidence required: ${LENSES[lens].evidence}

Write every \`observation\` as a neutral two-part statement — what the doc states,
what the code does — and stop there. Do not add a verdict, and do not use these
words: ${BANNED_VOCAB.join(', ')}. A later step decides whether it is drift.

An ADR marked superseded or deprecated is NOT drift — it correctly records history.
Report at most ${MAX_PER_LENS} findings, strongest first. Report zero if the docs hold.`,
      { label: `scan:${lens}`, phase: 'Scan', schema: FINDINGS, model: 'haiku', effort: 'low' },
    ),

  // Verify — commit-first. The verifier forms its own reading of both sides
  // BEFORE the finding is revealed, then compares. Anchored judges score
  // plausibility over correctness; committing first drops false positives
  // sharply on exact-match tasks (arXiv 2607.05904). For `vocabulary` and
  // `decision` there is no ground truth to commit to, so this reduces the
  // anchoring bias without eliminating it — hence confidence:'judged'.
  (scan, lens) =>
    parallel(
      (scan?.findings ?? []).slice(0, MAX_PER_LENS).map((f) => () =>
        agent(
          `Two steps, in order. Do not skip step 1.

STEP 1 — commit first. Read these two locations and write down, in your own
words, what each one actually says. Do this before reading step 2.
  Doc:  ${f.doc}
  Code: ${f.code || '(absence — nothing to point at)'}

STEP 2 — compare. Another process reported:
  Doc states: ${f.claim}
  Observation: ${f.observation}

Does YOUR step-1 reading match that observation? Refute it when your own reading
disagrees, the doc is correct, the ADR is marked superseded, the claim is
aspirational rather than factual, or the wording is awkward without asserting
anything false.

Default to refuted=true when uncertain. A survivor must be a doc stating
something the code contradicts today, confirmed by your own reading.`,
          { label: `verify:${lens}`, phase: 'Verify', schema: VERDICT },
        ).then((v) => ({ ...f, lens, confidence: 'judged', verdict: v })),
      ),
    ),
)

// Barrier earned: dedup needs every lens at once.
const judged = results
  .flat()
  .filter(Boolean)
  .filter((f) => f.verdict && !f.verdict.refuted)

const confirmed = [...referenceFindings, ...judged]
const lenses = [...(wantReference ? ['reference'] : []), ...judgedLenses]

log(
  `${confirmed.length} confirmed (${referenceFindings.length} deterministic, ${judged.length} judged) across ${lenses.length} lenses`,
)

if (confirmed.length === 0) {
  return { confirmed: [], lenses, summary: 'No drift found.' }
}

phase('Synthesise')
const report = await agent(
  `Write a docs-drift report from these verified findings.

${JSON.stringify(confirmed, null, 2)}

Group by confidence, deterministic first:

  1. "Broken references" — confidence:'deterministic'. These resolved on disk and
     are objectively wrong. State them plainly.
  2. "Judged findings" — confidence:'judged'. These passed an LLM verifier that
     runs near 0.65 AUROC on this class of check. Introduce the group with one
     line saying they need human confirmation, then list them.

Within each group, order by lens: reference, claim, vocabulary, decision.
Collapse findings that are the same underlying drift seen from two lenses.
Each entry: the doc (file:line), the code (file:line), and the observation.
State per-lens counts including zeros. Do not propose edits — this is report-only.`,
  { label: 'synthesise', phase: 'Synthesise' },
)

return { confirmed, lenses, report }
```

## `resolveReferences(root, opts?)`

Ships with the skill: [`scripts/resolve-references.mjs`](../scripts/resolve-references.mjs). Import it, or run it standalone to see the deterministic lens alone:

```sh
node skills/docs-drift/scripts/resolve-references.mjs <repo-root>
```

Returns `[{ doc, code: '', claim, observation }]` — one entry per non-resolving reference:

```js
{
  doc: 'AGENTS.md:12',
  code: '',
  claim: 'runtime/skill-catalog.json',
  observation: 'doc names runtime/skill-catalog.json; path does not exist in the repo',
}
```

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

`bun run <script>` resolves against `package.json` scripts rather than the filesystem. Fenced code blocks are skipped entirely.

Pass `{ excludeDirs: [...] }` to override the `docs/plans/` default when a repo keeps historical material elsewhere.

## Confidence

Two tiers, and the distinction is the point:

- **`deterministic`** — `reference` only. A path resolves or it does not. No verifier, no false positives.
- **`judged`** — `claim`, `vocabulary`, `decision`. An LLM verifier decided. Best-in-class judges reach ~0.65 AUROC on completion-style verification (arXiv 2606.09863), so treat these as leads for a human, not conclusions. Adding more verifiers does not fix this: a three-judge ensemble still accepted 55% of wrong answers (arXiv 2607.05904).

## Tuning

- **Too noisy** — pass `lenses: ['reference']` for the deterministic lens alone.
- **Too slow** — lower `MAX_PER_LENS`, or narrow `root` to a subdirectory.
- **Verifier refuting real drift** — refute-by-default is deliberate. Loosen the last paragraph of the STEP 2 prompt before touching anything else.
- **Scanner writing verdicts anyway** — extend `BANNED_VOCAB`. The neutral `observation` is what keeps the verifier comparing rather than rating.

## Resume

Every invocation persists its script and returns a `runId`. To iterate, edit the persisted file and re-invoke with `{ scriptPath, resumeFromRunId }` — unchanged `agent()` calls return cached results, so only edited stages re-run.
