# Workflow

The script. Pass `args: { root, lenses? }` — `lenses` defaults to all four.

Agent count is `4 scanners + N verifiers + 1 synthesiser`. N is the number of findings, so a clean repo runs 5 agents and a drifted one runs more. Cap findings per lens to keep a bad scan from fanning out unboundedly.

```js
export const meta = {
  name: 'docs-drift',
  description: 'Check whether ADRs, CONTEXT.md, AGENTS.md, and docs/ still describe the code',
  phases: [
    { title: 'Scan', detail: 'one scanner per drift lens' },
    { title: 'Verify', detail: 'adversarially refute each claimed finding' },
    { title: 'Synthesise', detail: 'dedup across lenses and report' },
  ],
}

const MAX_PER_LENS = 12

const LENSES = {
  reference: {
    hunt: 'A doc names a path, script, command, env var, or flag that does not resolve on disk.',
    evidence: 'Resolve every named path and command against the repo. A path that does not exist is the finding.',
  },
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

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          doc: { type: 'string', description: 'file:line of the doc making the claim' },
          code: { type: 'string', description: 'file:line of the contradicting code, or "" when the finding is an absence' },
          claim: { type: 'string', description: 'what the doc asserts, quoted' },
          contradiction: { type: 'string', description: 'one line: why the code disagrees' },
        },
        required: ['doc', 'claim', 'contradiction'],
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
const lenses = (args?.lenses ?? Object.keys(LENSES)).filter((l) => LENSES[l])

const results = await pipeline(
  lenses,

  // Scan — mechanical. Cheap model, low effort.
  (lens) =>
    agent(
      `Repo: ${root}

Find DRIFT of one kind: ${LENSES[lens].hunt}

Doc surface: AGENTS.md, CLAUDE.md, CONTEXT.md, CONTEXT-MAP.md, README.md, docs/**.
Evidence required: ${LENSES[lens].evidence}

An ADR marked superseded or deprecated is NOT drift — it correctly records history.
Report at most ${MAX_PER_LENS} findings, strongest first. Report zero if the docs hold.`,
      { label: `scan:${lens}`, phase: 'Scan', schema: FINDINGS, model: 'haiku', effort: 'low' },
    ),

  // Verify — judgement. Inherit the session model; refute by default.
  (scan, lens) =>
    parallel(
      (scan?.findings ?? []).slice(0, MAX_PER_LENS).map((f) => () =>
        agent(
          `Try to REFUTE this claimed documentation drift.

Doc:  ${f.doc}
Code: ${f.code || '(absence — nothing to point at)'}
Claim: ${f.claim}
Alleged contradiction: ${f.contradiction}

Read both sides yourself. Refute it when: the doc is actually correct, the ADR is
marked superseded, the claim is aspirational rather than factual, or the wording is
merely awkward without asserting anything false.

Default to refuted=true when uncertain. A survivor must be a doc stating something
the code contradicts today.`,
          { label: `verify:${lens}`, phase: 'Verify', schema: VERDICT },
        ).then((v) => ({ ...f, lens, verdict: v })),
      ),
    ),
)

// Barrier earned: dedup needs every lens at once.
const confirmed = results
  .flat()
  .filter(Boolean)
  .filter((f) => f.verdict && !f.verdict.refuted)

log(`${confirmed.length} confirmed across ${lenses.length} lenses`)

if (confirmed.length === 0) {
  return { confirmed: [], lenses, summary: 'No drift survived verification.' }
}

phase('Synthesise')
const report = await agent(
  `Write a docs-drift report from these verified findings.

${JSON.stringify(confirmed, null, 2)}

Group by lens in this order: reference, claim, vocabulary, decision.
Collapse findings that are the same underlying drift seen from two lenses.
Each entry: the doc (file:line), the code (file:line), and one line on the contradiction.
State per-lens counts including zeros. Do not propose edits — this is report-only.`,
  { label: 'synthesise', phase: 'Synthesise' },
)

return { confirmed, lenses, report }
```

## Tuning

- **Too noisy** — drop `vocabulary` and `decision` from `lenses`; they carry the most judgement and the weakest evidence.
- **Too slow** — lower `MAX_PER_LENS`, or scan a subdirectory by narrowing `root`.
- **Verifier refuting real drift** — the refute-by-default bias is deliberate. Loosen the last paragraph of the verify prompt before touching anything else.

## Resume

Every invocation persists its script and returns a `runId`. To iterate, edit the persisted file and re-invoke with `{ scriptPath, resumeFromRunId }` — unchanged `agent()` calls return cached results, so only edited stages re-run.
