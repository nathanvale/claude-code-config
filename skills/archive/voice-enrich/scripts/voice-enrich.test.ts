import { describe, expect, test } from "bun:test";
import {
  assertModePreconditions,
  buildArtifactPaths,
  buildProfileBundleTarget,
  buildSummaryBundleTarget,
  buildTaskBrief,
  renderBundle,
  resolveMatchingReportFile,
  resolveTargetCandidate,
  selectMode,
  WORKFLOW_SMOKE_CASES,
  type ResolvedTarget,
} from "./voice-enrich.ts";
import type { IdentityCandidate } from "../../people-enrich/scripts/people-note.ts";

const RICHARD: IdentityCandidate = {
  title: "Richard Johnson",
  slug: "richard-johnson",
  person_id: "person_richard_johnson",
  relationship_type: "close-friend",
  aliases: ["Rich"],
  source_handles: { imessage: ["+61497848278"] },
  filePath: "/tmp/richard-johnson.md",
  frontmatter: {
    title: "Richard Johnson",
    slug: "richard-johnson",
  },
};

const MELANIE: IdentityCandidate = {
  title: "Melanie",
  slug: "melanie",
  person_id: "person_melanie",
  relationship_type: "partner",
  aliases: ["Bestie"],
  source_handles: { imessage: ["+61412667520"] },
  filePath: "/tmp/melanie.md",
  frontmatter: {
    title: "Melanie",
    slug: "melanie",
  },
};

const MELANIE_STRANG: IdentityCandidate = {
  title: "Melanie Strang",
  slug: "melanie-strang",
  person_id: "person_melanie_strang",
  relationship_type: "partner",
  aliases: [],
  source_handles: {},
  filePath: "/tmp/melanie-strang.md",
  frontmatter: {
    title: "Melanie Strang",
    slug: "melanie-strang",
  },
};

describe("selectMode", () => {
  test("defaults to rewrite when an enrichment report already exists", () => {
    expect(selectMode(undefined, true)).toBe("rewrite");
  });

  test("defaults to review when no enrichment report exists", () => {
    expect(selectMode(undefined, false)).toBe("review");
  });

  test("preserves an explicit mode request", () => {
    expect(selectMode("create", true)).toBe("create");
  });
});

describe("assertModePreconditions", () => {
  test("fails rewrite when no existing report is available", () => {
    expect(() =>
      assertModePreconditions({ mode: "rewrite" }),
    ).toThrow("Rewrite mode requires an existing enrichment report");
  });

  test("fails create when explicit upstream evidence is missing", () => {
    expect(() =>
      assertModePreconditions({ mode: "create" }),
    ).toThrow("Create mode requires explicit upstream evidence");
  });

  test("allows create when analyst evidence is supplied and no report exists", () => {
    expect(() =>
      assertModePreconditions({
        mode: "create",
        analystReportPath: "/tmp/analyst.md",
      }),
    ).not.toThrow();
  });

  test("fails create when an existing report already exists", () => {
    expect(() =>
      assertModePreconditions({
        mode: "create",
        existingReportPath: "/tmp/richard-enrichment-report.json",
        analystReportPath: "/tmp/analyst.md",
      }),
    ).toThrow("Create mode is for fresh reports");
  });
});

describe("resolveTargetCandidate", () => {
  test("prefers exact slug matches", () => {
    expect(resolveTargetCandidate("richard-johnson", [RICHARD, MELANIE]).slug).toBe(
      "richard-johnson",
    );
  });

  test("can resolve by exact alias", () => {
    expect(resolveTargetCandidate("Bestie", [RICHARD, MELANIE]).slug).toBe(
      "melanie",
    );
  });

  test("refuses ambiguous prefix matches", () => {
    expect(() =>
      resolveTargetCandidate("mel", [MELANIE, MELANIE_STRANG]),
    ).toThrow('Target "mel" is ambiguous');
  });
});

describe("resolveMatchingReportFile", () => {
  test("prefers the exact slug report when it exists", () => {
    expect(
      resolveMatchingReportFile(RICHARD, [
        "richard-enrichment-report.json",
        "richard-johnson-enrichment-report.json",
      ]),
    ).toBe("richard-johnson-enrichment-report.json");
  });

  test("refuses ambiguous fuzzy matches", () => {
    expect(() =>
      resolveMatchingReportFile(RICHARD, [
        "richard-enrichment-report.json",
        "rich-enrichment-report.json",
      ]),
    ).toThrow("Multiple enrichment reports match Richard Johnson");
  });
});

describe("buildArtifactPaths", () => {
  test("marks review as a markdown-only path", () => {
    const paths = buildArtifactPaths({
      mode: "review",
      targetSlug: "melanie",
    });

    expect(paths.usesWriter).toBe(false);
    expect(paths.reviewPath).toContain("melanie-review.md");
    expect(paths.reviewPatchPath).toContain("melanie-review-partial-edit.json");
    expect(paths.reviewPreviewPath).toContain(
      "melanie-review-partial-edit-proposed.md",
    );
    expect(paths.reportPath).toBeUndefined();
  });

  test("reuses the input report stem for rewrite previews", () => {
    const paths = buildArtifactPaths({
      mode: "rewrite",
      targetSlug: "richard-johnson",
      existingReportPath:
        "/Users/nathanvale/code/my-second-brain/runtime/people-enrichment/tmp/richard-enrichment-report.json",
    });

    expect(paths.usesWriter).toBe(true);
    expect(paths.reportPath).toContain("richard-voiced-report.json");
    expect(paths.previewPath).toContain("richard-voiced-proposed.md");
  });

  test("stays deterministic for repeated planning inputs", () => {
    const first = buildArtifactPaths({
      mode: "create",
      targetSlug: "andrew-lazar",
    });
    const second = buildArtifactPaths({
      mode: "create",
      targetSlug: "andrew-lazar",
    });

    expect(first).toEqual(second);
  });
});

describe("renderBundle", () => {
  test("renders sections in deterministic order", () => {
    const target: ResolvedTarget = {
      candidate: RICHARD,
      notePath: "/tmp/richard-johnson.md",
      noteContent: "# Richard",
    };
    const bundle = renderBundle({
      mode: "rewrite",
      taskBrief: buildTaskBrief("rewrite", "Richard Johnson"),
      nathanProfileContent: "# Nathan",
      target: buildProfileBundleTarget(target),
      guidance: {
        confidence: "full",
        recommendProfileCreation: false,
      },
      evidence: [
        {
          kind: "enrichment-report",
          path: "/tmp/richard-enrichment-report.json",
          content: '{"relationship_profile":[{"heading":"Relationship","content":"x"}]}',
          format: "json",
        },
      ],
      outputContractPath: "/Users/nathanvale/code/claude-code-config/context/contract-people-note.md",
      outputContractContent: "# Contract",
    });

    const sectionOrder = [
      "## 1. Task Brief",
      "## 2. Nathan Profile",
      "## 3. Target Person",
      "## 4. Guidance",
      "## 5. Evidence",
      "## 6. Output Contract",
    ].map((heading) => bundle.indexOf(heading));

    expect(sectionOrder.every((index) => index >= 0)).toBe(true);
    expect(sectionOrder).toEqual([...sectionOrder].sort((a, b) => a - b));
    expect(bundle).toContain("Load: @context/contract-people-note.md");
  });

  test("renders fallback bundles with summary targets and profile-creation guidance", () => {
    const bundle = renderBundle({
      mode: "rewrite",
      taskBrief: buildTaskBrief("rewrite", "Jordan Mercer"),
      nathanProfileContent: "# Nathan",
      target: buildSummaryBundleTarget({
        name: "Jordan Mercer",
        content: "Jordan is a newer friend with warm but lightly documented context.",
        path: "/tmp/jordan-summary.md",
      }),
      guidance: {
        confidence: "fallback",
        recommendProfileCreation: true,
      },
      evidence: [],
      outputContractPath: "/Users/nathanvale/code/claude-code-config/context/contract-people-note.md",
      outputContractContent: "# Contract",
    });

    expect(bundle).toContain("Source: summary");
    expect(bundle).toContain("Path: /tmp/jordan-summary.md");
    expect(bundle).toContain("Confidence: fallback");
    expect(bundle).toContain("Recommend profile creation: true");
  });

  test("profile bundle targets preserve note paths for previewable modes", () => {
    const target: ResolvedTarget = {
      candidate: RICHARD,
      notePath: "/tmp/richard-johnson.md",
      noteContent: "# Richard",
    };

    expect(buildProfileBundleTarget(target)).toEqual({
      name: "Richard Johnson",
      source: "profile",
      path: "/tmp/richard-johnson.md",
      content: "# Richard",
    });
  });
});

describe("workflow smoke cases", () => {
  test("cover the documented capability-map prompts deterministically", () => {
    expect(WORKFLOW_SMOKE_CASES).toEqual([
      {
        label: "rewrite enrichment",
        prompt: "Rewrite this enrichment for Richard Johnson in Perel-Baldwin voice.",
        contract: "@context/contract-people-note.md",
        downstream: "Preview through apply-enrichment.ts",
      },
      {
        label: "text reply",
        prompt: "Help me reply to this text from Melanie.",
        contract: "@context/contract-text-message.md",
        downstream: "Human review",
      },
      {
        label: "email interpretation",
        prompt: "Help me interpret this email from my boss.",
        contract: "@context/contract-email-interpretation.md",
        downstream: "Downstream workflow",
      },
      {
        label: "conflict reflection",
        prompt: "Help me think about this conflict with someone I care about.",
        contract: "@context/contract-conflict-processing.md",
        downstream: "Human review",
      },
    ]);
  });
});
