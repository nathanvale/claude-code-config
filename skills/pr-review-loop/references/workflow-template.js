// PR Review Loop — workflow template
// Caller substitutes: REPO, PKG, BASE_REF, MAX_ROUNDS, MAX_FINDINGS_PER_LENS, RUN_ID, LENSES_BLOCK
// Do NOT add import statements — workflow scripts cannot use ES imports.
// Do NOT use Date.now(), Math.random(), or new Date() — caller passes runId via args.

export const meta = {
  name: "pr-review-loop",
  description: "Run a bounded multi-lens PR review. Saves review artifacts outside the repo.",
  phases: [
    { title: "Scout", detail: "Collect diff, exports, and package context" },
    { title: "Review", detail: "Fan-out lenses concurrently" },
    { title: "Triage", detail: "Dedup, verify, filter resolved findings" },
    { title: "Synthesize", detail: "Produce final report and write findings file" },
  ],
};

// ── Config (substituted by skill generator) ──────────────────────────────────
const REPO = "{{REPO}}";
const PKG = `${REPO}/{{PKG}}`;
const BASE_REF = safeGitRef((args && args.baseRef) ? args.baseRef : null, "{{BASE_REF}}");
const DIFF_RANGE = `${BASE_REF}...HEAD`;
const MAX_ROUNDS = positiveInt((args && args.maxRounds) ? String(args.maxRounds) : null, {{MAX_ROUNDS}});
const MAX_FINDINGS_PER_LENS = positiveInt(
  (args && args.maxFindingsPerLens) ? String(args.maxFindingsPerLens) : null,
  {{MAX_FINDINGS_PER_LENS}},
);
const RUN_ID = safeRunId((args && args.runId) ? String(args.runId) : "default");
const ARTIFACT_DIR = `/tmp/pr-review-loop/${RUN_ID}`;
const FINDINGS_PATH = `${ARTIFACT_DIR}/findings.json`;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeGitRef(value, fallback) {
  if (!value) return fallback;
  return /^[A-Za-z0-9._/@-]+$/.test(value) ? value : fallback;
}

function safeRunId(value) {
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`Invalid runId: "${value}" — must match ^[A-Za-z0-9._-]+$`);
  }
  return value;
}

// ── Schemas ───────────────────────────────────────────────────────────────────
const FINDING_SCHEMA = {
  type: "object",
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "lens", "severity", "title", "file", "line", "description", "evidence", "fix"],
        properties: {
          id: { type: "string" },
          lens: { type: "string" },
          severity: { type: "string", enum: ["blocking", "major", "minor", "suggestion"] },
          title: { type: "string" },
          file: { type: "string" },
          line: { type: "number" },
          description: { type: "string" },
          evidence: { type: "string" },
          fix: { type: "string" },
          resolved: { type: "boolean" },
        },
      },
    },
  },
};

const VERDICT_SCHEMA = {
  type: "object",
  required: ["stillPresent", "reason"],
  properties: {
    stillPresent: { type: "boolean" },
    reason: { type: "string" },
  },
};

const SUMMARY_SCHEMA = {
  type: "object",
  required: ["round", "totalOpen", "blocking", "major", "minor", "suggestion", "newThisRound", "resolvedThisRound", "done"],
  properties: {
    round: { type: "number" },
    totalOpen: { type: "number" },
    blocking: { type: "number" },
    major: { type: "number" },
    minor: { type: "number" },
    suggestion: { type: "number" },
    newThisRound: { type: "number" },
    resolvedThisRound: { type: "number" },
    done: { type: "boolean" },
    narrative: { type: "string" },
  },
};

function findingKey(f) {
  return [f.lens, f.file, f.title.trim().toLowerCase().replace(/\s+/g, " ")].join("::");
}

// ── Model tiers ──────────────────────────────────────────────────────────────
// haiku:     scout, snapshot writers, file writers (shell commands + paste output)
// sonnet:    review lenses, synthesize (structured code review + counting)
// inherited: verify/refute (hardest — must read code and reason about false positives)

// ── Scout phase ───────────────────────────────────────────────────────────────
phase("Scout");

const [diffSummary, exportsList, changedFiles] = await parallel([
  () => agent(
    `Collect context about the PR diff for a review.

Repo: ${REPO}
Package: ${PKG}

Run these commands and return a structured summary:
1. \`git diff --stat ${DIFF_RANGE} -- {{PKG}}/ | tail -20\`
2. \`git diff --name-only ${DIFF_RANGE} -- {{PKG}}/src/ | head -60\`

Return a prose summary (under 400 words): what changed, which files were added/removed/modified.`,
    { label: "scout:diff", phase: "Scout", model: "haiku" },
  ),

  () => agent(
    `Collect public exports from the package.

Working dir: ${REPO}
Run: \`find {{PKG}}/src -name "index.ts" | xargs grep -l "export" | head -5\`
Then: \`cat {{PKG}}/src/ui/index.ts 2>/dev/null || cat {{PKG}}/src/index.ts 2>/dev/null | head -80\`

Return a summary of the export surface.`,
    { label: "scout:exports", phase: "Scout", model: "haiku" },
  ),

  () => agent(
    `Get ALL changed files in {{PKG}}/ relative to ${BASE_REF}.

Working dir: ${REPO}
Run: \`git diff --name-only ${DIFF_RANGE} -- {{PKG}}/\`

Return the full list as newline-separated paths, nothing else.`,
    { label: "scout:changed-files", phase: "Scout", model: "haiku" },
  ),
]);

log(`Scout complete. Starting review round 1.`);

// ── Lenses ────────────────────────────────────────────────────────────────────
// {{LENSES_BLOCK}}
// Default: 4 built-in lenses. Replaced by skill generator when caller passes custom lenses.

const LENSES = [
  {
    key: "correctness",
    label: "Correctness",
    idPrefix: "COR",
    prompt: (round, prior) => `You are a Correctness reviewer for a PR on package {{PKG}}.

CONTEXT:
- Repo: ${REPO}
- Package: {{PKG}}
- Round: ${round}

DIFF SUMMARY:
${diffSummary}

CHANGED FILES:
${changedFiles}

PREVIOUSLY FOUND (do not re-report):
${prior || "none yet"}

YOUR TASK — find NEW findings only:
1. Props defined but never used in render
2. Required props missing from interfaces
3. TypeScript errors or any \`any\` casts introduced
4. Component exports missing from barrel (index.ts)
5. Test coverage gaps — components changed with no test change
6. Deleted files still imported (ghost imports)
7. Components that broke their public API (renamed/removed props)

Run targeted checks like:
\`git diff ${DIFF_RANGE} -- {{PKG}}/ | grep -E "^-.*import|^+.*import" | head -30\`
\`cat {{PKG}}/src/ui/index.ts 2>/dev/null | head -60\`

Working dir: ${REPO}

Return findings as structured JSON. Use id prefix COR-${round}XX. Max ${MAX_FINDINGS_PER_LENS} findings.
Blocking if broken export or ghost import. Major if API changed without docs.`,
  },
  {
    key: "design-system",
    label: "Design System",
    idPrefix: "DS",
    prompt: (round, prior) => `You are a Design System reviewer for a PR on package {{PKG}}.

CONTEXT:
- Repo: ${REPO}
- Package: {{PKG}}
- Round: ${round}

DIFF SUMMARY:
${diffSummary}

CHANGED FILES:
${changedFiles}

PREVIOUSLY FOUND (do not re-report):
${prior || "none yet"}

YOUR TASK — find NEW findings only:
1. Arbitrary Tailwind values (e.g. \`w-[123px]\`) instead of token utilities
2. Hardcoded hex/rgb color values in className
3. Icon imports from lucide-react (use Ellucian @ellucian/ds-icons or local src/icons/)
4. Raw HTML elements (p, h1-h6, button) instead of design system components
5. Missing focus-visible ring on interactive components
6. Dead CSS tokens still referenced (removed named spacing tokens)

Run targeted checks:
\`git diff ${DIFF_RANGE} -- {{PKG}}/src/ | grep "^+" | grep -E "\\[.+\\]|#[0-9a-fA-F]{3,6}|lucide-react|<p |<h[1-6]" | head -30\`
\`grep -rn "lucide-react" {{PKG}}/src/ 2>/dev/null | head -20\`

Working dir: ${REPO}

Return findings as structured JSON. Use id prefix DS-${round}XX. Max ${MAX_FINDINGS_PER_LENS} findings.
Blocking: lucide-react imports, raw HTML. Major: arbitrary values in shared components.`,
  },
  {
    key: "pr-readiness",
    label: "PR Readiness",
    idPrefix: "PR",
    prompt: (round, prior) => `You are a PR Readiness reviewer for a PR on package {{PKG}}.

CONTEXT:
- Repo: ${REPO}
- Package: {{PKG}}
- Round: ${round}

DIFF SUMMARY:
${diffSummary}

CHANGED FILES:
${changedFiles}

PREVIOUSLY FOUND (do not re-report):
${prior || "none yet"}

YOUR TASK — find NEW findings only:
1. Does a changeset exist? Run: \`ls .changeset/ 2>/dev/null | grep -v README || echo "NO CHANGESET"\`
2. Debug artifacts (console.log, debugger) in production code
3. Deleted components still imported anywhere
4. README/docs accurate for new state?
5. Uncommitted files that should be staged: \`git status --short {{PKG}}/\`
6. New dependencies in package.json that need explanation

Run targeted checks:
\`grep -rn "console\.log\\|debugger" {{PKG}}/src/ | grep -v node_modules | grep -v ".test." | grep -v ".stories." | head -20\`
\`git diff ${DIFF_RANGE} -- {{PKG}}/package.json | head -30\`

Working dir: ${REPO}

Return findings as structured JSON. Use id prefix PR-${round}XX. Max ${MAX_FINDINGS_PER_LENS} findings.
Blocking: missing changeset, ghost imports of deleted components.`,
  },
  {
    key: "storybook",
    label: "Storybook",
    idPrefix: "SB",
    prompt: (round, prior) => `You are a Storybook reviewer for a PR on package {{PKG}}.

CONTEXT:
- Repo: ${REPO}
- Package: {{PKG}}
- Round: ${round}

PUBLIC EXPORTS:
${exportsList}

DIFF SUMMARY:
${diffSummary}

PREVIOUSLY FOUND (do not re-report):
${prior || "none yet"}

YOUR TASK — find NEW findings only:
1. Publicly exported components with no story file
2. New components added in this PR with no story
3. Story titles in wrong taxonomy folder
4. Stories missing Default variant
5. Deprecated stories with no @deprecated code annotation

Run targeted checks:
\`find {{PKG}}/src -name "*.stories.tsx" | sort\`
\`grep -r "title:" {{PKG}}/src --include="*.stories.tsx" | head -40\`

Working dir: ${REPO}

Return findings as structured JSON. Use id prefix SB-${round}XX. Max ${MAX_FINDINGS_PER_LENS} findings.`,
  },
];

// ── Review loop ───────────────────────────────────────────────────────────────
const seen = new Set();
const allFindings = [];
let round = 0;
let dry = 0;

async function writeSnapshot(stage, summary) {
  const content = JSON.stringify(
    { generatedAt: RUN_ID, branch: "current checkout", baseRef: BASE_REF, diffRange: DIFF_RANGE,
      maxRounds: MAX_ROUNDS, maxFindingsPerLens: MAX_FINDINGS_PER_LENS, round, stage, summary: summary || null, findings: allFindings },
    null, 2,
  );
  await agent(
    `Run these shell commands exactly:\nmkdir -p ${ARTIFACT_DIR}\ncat > ${FINDINGS_PATH} << 'JSONEOF'\n${content}\nJSONEOF\nReturn "written" when done.`,
    { label: `snapshot:${stage}`, phase: "Triage", effort: "low", model: "haiku" },
  );
}

while (dry < 2 && round < MAX_ROUNDS) {
  round++;
  phase("Review");
  log(`Round ${round} — fanning out ${LENSES.length} lenses`);

  const roundFindings = await parallel(
    LENSES.map((lens) => () => {
      const prior = allFindings
        .filter((f) => f.lens === lens.key)
        .map((f) => f.id + ": " + f.title)
        .join("\n");
      return agent(lens.prompt(round, prior), {
        label: `review:${lens.key}:r${round}`,
        phase: "Review",
        schema: FINDING_SCHEMA,
        model: "sonnet",
      });
    }),
  );

  phase("Triage");
  const roundSeen = new Set();
  const fresh = roundFindings
    .filter(Boolean)
    .flatMap((r) => r.findings || [])
    .filter((f) => {
      const key = findingKey(f);
      if (seen.has(key) || roundSeen.has(key)) return false;
      roundSeen.add(key);
      return true;
    });

  if (fresh.length === 0) {
    dry++;
    log(`Round ${round}: 0 new findings. Dry run ${dry}/2.`);
  } else {
    dry = 0;
    log(`Round ${round}: ${fresh.length} new findings. Verifying...`);

    const verified = await parallel(
      fresh.map((f) => () =>
        agent(
          `Verify this finding is real and not a false positive. Try to REFUTE it.

Finding:
- ID: ${f.id}
- Lens: ${f.lens}
- Title: ${f.title}
- File: ${f.file}:${f.line}
- Description: ${f.description}
- Evidence: ${f.evidence}

Repo: ${REPO}
Read the actual file and run targeted searches.`,
          { label: `verify:${f.id}`, phase: "Triage", schema: VERDICT_SCHEMA },
        ).then((v) => ({ f, v })),
      ),
    );

    const confirmed = verified.filter(Boolean).filter(({ v }) => v && v.stillPresent).map(({ f }) => f);
    confirmed.forEach((f) => seen.add(findingKey(f)));
    allFindings.push(...confirmed);
    log(`Round ${round}: ${confirmed.length} verified. Total open: ${allFindings.length}`);
  }

  await writeSnapshot(`round-${round}`);
}

if (round >= MAX_ROUNDS && dry < 2) {
  log(`Stopped at max rounds (${MAX_ROUNDS}).`);
}

// ── Synthesize ────────────────────────────────────────────────────────────────
phase("Synthesize");

const summary = await agent(
  `Synthesize the PR review findings into a final report.

Rounds: ${round}. Total findings: ${allFindings.length}.

FINDINGS:
${JSON.stringify(allFindings, null, 2)}

Return JSON with these required fields:
- round: current round number (${round})
- totalOpen: count of open (unresolved) findings
- blocking / major / minor / suggestion: counts by severity
- newThisRound: findings added in the final round
- resolvedThisRound: findings resolved in the final round
- done: true if blocking = 0 AND major = 0
- narrative: prose paragraph summarising the review`,
  { label: "synthesize", phase: "Synthesize", schema: SUMMARY_SCHEMA, model: "sonnet" },
);

const output = {
  generatedAt: RUN_ID, branch: "current checkout", baseRef: BASE_REF, diffRange: DIFF_RANGE,
  maxRounds: MAX_ROUNDS, maxFindingsPerLens: MAX_FINDINGS_PER_LENS, rounds: round,
  artifactDir: ARTIFACT_DIR, findingsPath: FINDINGS_PATH, summary, findings: allFindings,
};

await agent(
  `Run these shell commands exactly:\nmkdir -p ${ARTIFACT_DIR}\ncat > ${FINDINGS_PATH} << 'JSONEOF'\n${JSON.stringify(output, null, 2)}\nJSONEOF\nReturn "written" when done.`,
  { label: "write-final", phase: "Synthesize", effort: "low", model: "haiku" },
);

log(`Done. ${allFindings.length} findings. Blocking: ${summary.blocking}. File: ${FINDINGS_PATH}`);

return output;
