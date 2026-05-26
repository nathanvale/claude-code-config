import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { routeRequiredReferenceEntries } from "./lib/route";

const repoRoot = join(import.meta.dir, "..", "..");

const u1PolicyDocs = [
  "docs/adr/0001-stage-4-context-isolation.md",
  "docs/adr/0003-stage-4-keeps-always-on-validator-wave.md",
  "skills/issue-to-pr/SKILL.md",
  "runbooks/issue-to-pr-v2/issue-to-pr.md",
  "runbooks/issue-to-pr-v2/references/stage-4-batch-loop.md",
  "runbooks/issue-to-pr-v2/references/builder-dispatch.md",
] as const;

const activeStage4References = [
  ...u1PolicyDocs,
  "runbooks/issue-to-pr-v2/references/findings-and-validators.md",
  "runbooks/issue-to-pr-v2/references/host-adapters.md",
  "runbooks/issue-to-pr-v2/references/regression-matrix.md",
  "runbooks/issue-to-pr-v2/templates/builder-work-packet.md",
] as const;

async function readRepoFile(path: string): Promise<string> {
  return Bun.file(join(repoRoot, path)).text();
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function expectToContainAll(text: string, snippets: string[], context: string) {
  for (const snippet of snippets) {
    expect(text, `${context} must contain ${snippet}`).toContain(snippet);
  }
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
      "before Builder exists",
      "pre-dispatch host-readiness",
      "pre-dispatch readiness",
      "pre-vs-post-dispatch boundary",
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

  test("U3 host readiness stays a pre-implementation gate for every Stage 4 attempt", async () => {
    const host = compact(
      await readRepoFile("runbooks/issue-to-pr-v2/references/host-adapters.md"),
    );
    const stageLoop = compact(
      await readRepoFile(
        "runbooks/issue-to-pr-v2/references/stage-4-batch-loop.md",
      ),
    );
    const v2Template = compact(
      await readRepoFile("runbooks/issue-to-pr-v2/issue-N-ledger.template.md"),
    );
    const hotRouter = compact(
      await readRepoFile("runbooks/issue-to-pr-v2/issue-to-pr.md"),
    );
    const skill = compact(await readRepoFile("skills/issue-to-pr/SKILL.md"));
    const findings = compact(
      await readRepoFile(
        "runbooks/issue-to-pr-v2/references/findings-and-validators.md",
      ),
    );
    const builderPacket = compact(
      await readRepoFile(
        "runbooks/issue-to-pr-v2/templates/builder-work-packet.md",
      ),
    );
    const frontmatterBlockedRefs = routeRequiredReferenceEntries().find(
      (entry) => entry.route_id === "blocked-frontmatter-blocked-reason",
    )?.required_reference_ids;

    expect(host).toContain(
      "Before any batch status mutation or resumed Stage 4 implementation attempt",
    );
    expect(host).toContain("Pre-implementation: host readiness check");
    expect(host).toContain("Post-dispatch: builder-infrastructure-failure");
    expect(host).toContain(
      "including Builder dispatch, bounded Orchestrator-inline work, and resumed repair dispatches",
    );
    expect(host).toContain(
      "do not append Builder or Orchestrator-inline attempt evidence",
    );
    expect(host).toContain("do not fall back to Orchestrator-inline");
    // Post-dispatch builder-infrastructure-failure keeps its own behavioral
    // consequences pinned (not just the section header), so deleting the
    // no-Validators / in-progress / no-builder_attempts bullets fails the test.
    expect(host).toContain("leave the batch `in-progress` (status unchanged)");
    expect(host).toContain("do not append `builder_attempts`");
    expect(host).toContain("do not dispatch Validators");
    // The two blocked_reason values must stay distinguishable by their When
    // semantics: host-builder-tools-unavailable is pre-implementation (covers
    // any later repair), builder-infrastructure-failure is post-dispatch.
    expect(host).toContain(
      "Pre-implementation: host cannot create the Builder sub-agent or grant required capabilities for the Stage 4 attempt and any later repair",
    );
    expect(host).toContain(
      "Post-dispatch: host began dispatch but timeout/permission/tool/serialization/schema/envelope failure prevented a well-formed Builder envelope",
    );
    // Host-readiness failure keeps NEITHER attempt lane out of the audit trail
    // (inline lane named explicitly, not just builder_attempts).
    expect(host).toContain(
      "Neither lane appended",
    );
    // Pre-implementation readiness failure freezes EVERY batch (distinct from
    // post-dispatch, which leaves only "the batch in-progress"). This pins the
    // all-batches-vs-current-batch distinction the post-dispatch assertion
    // above does not cover.
    expect(host).toContain("leave every batch status unchanged");

    const downstreamDocs: Array<{
      context: string;
      text: string;
      snippets: string[];
    }> = [
      {
        context: "stage-4-batch-loop reference",
        text: stageLoop,
        snippets: [
          "pre-implementation gate",
          "every Stage 4 implementation attempt",
          "host-adapters.md",
        ],
      },
      {
        context: "v2 ledger template",
        text: v2Template,
        snippets: [
          "host-builder-tools-unavailable",
          "Stage 4 implementation attempt",
          "bounded Orchestrator-inline",
          "dispatch no Validators",
        ],
      },
      {
        context: "v2 hot router",
        text: hotRouter,
        snippets: [
          "pre-implementation host-readiness failure",
          "Stage 4 implementation attempt",
          "bounded Orchestrator-inline",
          "host-adapters.md",
        ],
      },
      {
        context: "skill control plane",
        text: skill,
        snippets: [
          "Host readiness failure before any Stage 4 implementation attempt",
          "bounded inline work",
          "host-adapters.md",
        ],
      },
      {
        context: "findings reference glossary",
        text: findings,
        snippets: [
          "Host Builder readiness failure",
          "Stage 4 implementation attempt",
          "host-adapters.md",
        ],
      },
      {
        context: "builder work packet template",
        text: builderPacket,
        snippets: [
          "host-adapters.md",
          "pre-implementation host readiness gate",
          "before this packet arrived",
        ],
      },
    ];

    for (const { context, text, snippets } of downstreamDocs) {
      expectToContainAll(text, snippets, context);
    }

    expect(frontmatterBlockedRefs).toEqual([
      "ledger-and-helper.md",
      "findings-and-validators.md",
      "host-adapters.md",
    ]);
  });
});
