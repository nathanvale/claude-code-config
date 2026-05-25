import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

const u1PolicyDocs = [
  "docs/adr/0001-stage-4-context-isolation.md",
  "docs/adr/0003-stage-4-keeps-always-on-validator-wave.md",
  "skills/issue-to-pr/SKILL.md",
  "runbooks/issue-to-pr/README.md",
  "runbooks/issue-to-pr/issue-to-pr.md",
  "runbooks/issue-to-pr-v2/issue-to-pr.md",
  "runbooks/issue-to-pr-v2/references/stage-4-batch-loop.md",
  "runbooks/issue-to-pr-v2/references/builder-dispatch.md",
] as const;

const activeStage4References = [
  ...u1PolicyDocs,
  "runbooks/issue-to-pr-v2/references/findings-and-validators.md",
  "runbooks/issue-to-pr-v2/references/host-adapters.md",
] as const;

async function readRepoFile(path: string): Promise<string> {
  return Bun.file(join(repoRoot, path)).text();
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

describe("Stage 4 policy drift guards", () => {
  test("U1 policy docs keep future-unit and host-specific prose out of shared policy", async () => {
    const forbiddenPatterns = [
      /\b(?:defined by|added by|lands in)\s+U[0-9]\b/i,
      /\bU[0-9]\b/,
      /Task tool/i,
      /\/codex /i,
      /AskUserQuestion/i,
      /Agent tool/i,
    ];

    for (const path of u1PolicyDocs) {
      const text = await readRepoFile(path);
      for (const pattern of forbiddenPatterns) {
        expect(text, `${path} must not match ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  test("active Stage 4 references do not use stale Builder-only control-plane labels", async () => {
    const staleSnippets = [
      "Orchestrator does not implement Stage 4 directly",
      "another Builder dispatch is needed",
      "before Builder starts",
      "Stage 4 Builder owns one implementation",
      "one combined commit per dispatch",
      "group a wave's fixes",
      "every committed Builder envelope",
      "Orchestrator-direct implementation",
      "run one Builder commit",
      "committed Builder envelope",
      "before Stage 4 Builder dispatch",
      "Host readiness before Builder work",
      "shadow content",
      "Public cutover",
    ];

    for (const path of activeStage4References) {
      const normalized = compact(await readRepoFile(path));
      for (const snippet of staleSnippets) {
        expect(
          normalized,
          `${path} must not contain stale label: ${snippet}`,
        ).not.toContain(snippet);
      }
    }
  });

  test("canonical Stage 4 path policy stays visible in the control-plane docs", async () => {
    const stageLoop = compact(
      await readRepoFile(
        "runbooks/issue-to-pr-v2/references/stage-4-batch-loop.md",
      ),
    );
    const skill = compact(await readRepoFile("skills/issue-to-pr/SKILL.md"));
    const findings = compact(
      await readRepoFile(
        "runbooks/issue-to-pr-v2/references/findings-and-validators.md",
      ),
    );
    const host = compact(
      await readRepoFile("runbooks/issue-to-pr-v2/references/host-adapters.md"),
    );
    const adr = compact(
      await readRepoFile("docs/adr/0001-stage-4-context-isolation.md"),
    );

    expect(stageLoop).toContain("every `tdd` attempt");
    expect(stageLoop).toContain("every `proof_first` attempt");
    expect(stageLoop).toContain("every repair attempt after any open P0/P1");
    expect(stageLoop).toContain("`change_first` may stay Orchestrator-inline");
    expect(stageLoop).toMatch(/the touched-file count is (?:<=|≤)2/);
    expect(stageLoop).toContain("not the third consecutive inline-eligible");
    expect(stageLoop).toContain("Validator wave is path-independent");
    expect(stageLoop).toContain("every committed implementation attempt");
    expect(stageLoop).toContain(
      "another implementation attempt is needed (Builder dispatch or bounded Orchestrator-inline)",
    );

    expect(skill).toContain("implementation-attempt-builder");
    expect(skill).toContain("implementation-attempt-inline");
    expect(skill).toContain(
      "Each repair dispatch targets exactly one committed open P0/P1 finding signature",
    );

    expect(findings).toContain(
      "every committed implementation attempt (Builder envelope or Orchestrator-inline)",
    );
    expect(findings).toContain("the real attempt evidence source");

    expect(host).toContain(
      "before every Stage 4 implementation attempt (Builder dispatch or bounded Orchestrator-inline)",
    );
    expect(host).toContain(
      "Pre-implementation: host cannot create the Builder sub-agent",
    );

    expect(adr).toContain("malformed Orchestrator-inline evidence");
    expect(adr).toContain("the real attempt evidence source");
  });
});
