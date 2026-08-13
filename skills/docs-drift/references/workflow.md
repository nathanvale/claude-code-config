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
          code: {
            type: 'string',
            description:
              'file:line in the artifact holding the CORRECT value — the line that shows what the doc should have said. Not a line you think needs changing: the artifact is the source of truth, the doc is what is wrong. Empty when the finding is an absence.',
          },
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

// Three states, not two. A negative control planted two false claims; the
// verifier confirmed one and refused the other — while noting in its own words
// that a real defect existed at a different location than the scanner reported.
// A binary schema discards that. `misfiled` keeps the defect and records where
// it actually is.
const VERDICT = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['confirmed', 'misfiled', 'refuted'],
      description:
        'confirmed = drift, reported at the right location. misfiled = a real defect exists, but this finding names the wrong file, line, or fault site. refuted = not drift.',
    },
    why: { type: 'string' },
    actualLocation: {
      type: 'string',
      description:
        'Required when verdict is "misfiled": file:line where the defect actually is, and one line on what is wrong there.',
    },
  },
  required: ['verdict', 'why'],
}

// `args` can arrive as a real object or as a JSON string, depending on how the
// host serialises it in transit. Normalise, because a string silently yields
// `manifest === undefined`, zero targets, and a synthesis over nothing — a run
// that looks complete having checked no document.
const input = typeof args === 'string' ? JSON.parse(args) : (args ?? {})

const root = input.root ?? '.'
const manifest = input.manifest ?? {}
const targets = Object.entries(manifest.targets ?? {})
const unverifiable = Object.entries(manifest.unverifiable ?? {})

// A manifest that parsed to zero targets is a misconfiguration, not a clean repo.
if (input.manifest && targets.length === 0) {
  throw new Error('manifest supplied but targets is empty — check the manifest shape.')
}

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
  verdict: { verdict: 'confirmed', why: 'path does not resolve on disk' },
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

Pay attention to exact identifier strings the document quotes: artifact names,
environment names, job names, input names. Those are the assertions an artifact
settles definitively.

THE DOC IS THE FAULT SITE. You are auditing the document, not the artifact.
When a doc quotes an identifier the artifact does not have, the defect is the
doc's wording — set \`code\` to the artifact line holding the CORRECT value, and
say in the observation what the doc names versus what that line actually says.
Never report the artifact as needing a change. If two artifacts have similar
names, be explicit about which one the doc is describing; naming the wrong one
gets a real finding thrown away.

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

Does YOUR step-1 reading match that observation? Choose one verdict:

  confirmed — the doc states something the artifact contradicts today, and the
    finding names the right location. Your own reading must show this.
  misfiled — a real defect IS present, but this finding points at the wrong
    file, line, or fault site (for example: it blames the artifact when the
    doc's wording is what is wrong, or it cites a similarly-named artifact).
    Set actualLocation to where the defect really is. Do NOT discard a real
    defect over a bookkeeping error.
  refuted — not drift. Your reading disagrees, the doc is correct, the claim is
    aspirational rather than factual, or the wording is awkward without
    asserting anything false.

Default to refuted when uncertain — but before you do, ask whether a real
defect exists somewhere near what was reported. If it does, that is misfiled,
not refuted.`,
          { label: `verify:${doc.split('/').pop()}`, phase: 'Verify', schema: VERDICT },
        ).then((v) => ({ ...f, target: artifacts.join(', '), confidence: 'judged', verdict: v })),
      ),
    ),
)

// Barrier earned: dedup needs every doc at once.
const verified = results.flat().filter(Boolean)
const judged = verified.filter((f) => f.verdict?.verdict === 'confirmed')
const misfiled = verified.filter((f) => f.verdict?.verdict === 'misfiled')

const confirmed = [...referenceFindings, ...judged]

log(
  `${confirmed.length} confirmed (${referenceFindings.length} deterministic, ${judged.length} judged), ${misfiled.length} misfiled, across ${targets.length} docs; ${unverifiable.length} not checkable from this repo`,
)

phase('Synthesise')
const report = await agent(
  `Write a docs-drift report.

CONFIRMED FINDINGS:
${JSON.stringify(confirmed, null, 2)}

MISFILED — real defects reported at the wrong location:
${JSON.stringify(misfiled, null, 2)}

NOT CHECKABLE FROM THIS REPO:
${JSON.stringify(unverifiable, null, 2)}

DOCS CHECKED: ${targets.map(([d]) => d).join(', ') || '(none — no manifest)'}

Three sections, in this order:

  1. "Broken references" — confidence:'deterministic'. Resolved on disk, so
     objectively wrong. State them plainly. Omit the section if empty.
  2. "Judged findings" — confidence:'judged'. These passed an LLM verifier that
     runs near 0.65 AUROC on this class of check. Introduce with one line saying
     they need human confirmation. Omit the section if empty.
  2b. "Misfiled" — a verifier found a real defect but the finding named the
     wrong location. Report each using its actualLocation, not the reported one.
     Omit the section if empty.
  3. "Not checkable from this repo" — list each doc and its reason verbatim.
     Say plainly that these were NOT scanned and that zero findings for them
     means nothing. Never omit this section when the list is non-empty.

Within sections, order by doc path. Collapse findings that are the same
underlying drift. Each entry: the doc (file:line), the artifact (file:line),
and the observation. State how many docs were checked and how many findings
each produced, including zeros. Do not propose edits — this is report-only.`,
  { label: 'synthesise', phase: 'Synthesise' },
)

return { confirmed, misfiled, unverifiable, docsChecked: targets.map(([d]) => d), report }
```

## Reading the manifest

The caller parses `docs/agents/doc-targets.yml` and passes it as `args.manifest`. Schema and a worked example: [manifest.md](manifest.md).

```js
// Bun
const manifest = Bun.YAML.parse(await Bun.file(`${root}/docs/agents/doc-targets.yml`).text())
Workflow({ script, args: { root, manifest } })
```

No manifest means `targets` is empty and only the deterministic lens runs. Do not reach for that silently: when the repo has no manifest the skill stops and offers to build one first ([bootstrap.md](bootstrap.md)). Run it lens-only when the user has declined discovery, and name it for what it is in the report.

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
- **Scanner blaming the artifact** — observed: a `haiku` scanner set `code` to a similarly-named artifact and framed the workflow as needing the change, despite the prompt saying otherwise. The `misfiled` verdict recovers it, at the cost of a verifier turn. If it recurs often, raise scan `effort` rather than adding more prompt text — the instruction is already stated twice, in the prompt and in the `code` field description.
- **Verifier refuting real drift** — refute-by-default is deliberate. Loosen the last paragraph of STEP 2 before touching anything else.

## Resume

Every invocation persists its script and returns a `runId`. To iterate, edit the persisted file and re-invoke with `{ scriptPath, resumeFromRunId }` — unchanged `agent()` calls return cached results, so only edited stages re-run.
