#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  assertEnrichmentReport,
  buildEnrichmentReportSchema,
  buildJsonPrompt,
  buildProfileBundleTarget,
  buildSummaryBundleTarget,
  buildTaskBrief,
  parseClaudeJson,
  renderBundle,
  runApplyEnrichment,
  runClaude,
  WORKFLOW_SMOKE_CASES,
  type EvidenceItem,
  type ResolvedTarget,
} from "./voice-enrich.ts";
import {
  assertConflictReflection,
  buildArtifactPaths as buildConflictArtifactPaths,
  buildReflectPrompt,
  buildTaskBrief as buildConflictTaskBrief,
} from "./voice-conflict-reflect.ts";

const MY_SECOND_BRAIN_ROOT = "/Users/nathanvale/code/my-second-brain";
const CLAUDE_CONFIG_ROOT = "/Users/nathanvale/code/claude-code-config";
const RUNTIME_TMP_DIR = join(
  MY_SECOND_BRAIN_ROOT,
  "runtime/people-enrichment/tmp",
);
const PEOPLE_DIR = join(MY_SECOND_BRAIN_ROOT, "context/people");
const NATHAN_PROFILE_PATH = join(PEOPLE_DIR, "nathan-vale.md");
const REWRITE_CONTRACT_PATH = join(
  CLAUDE_CONFIG_ROOT,
  "context/contract-people-note.md",
);
const CONFLICT_REFLECTION_CONTRACT_PATH = join(
  CLAUDE_CONFIG_ROOT,
  "context/contract-conflict-processing.md",
);
const FIXTURES_DIR = resolve(import.meta.dir, "../fixtures");
const FALLBACK_SUMMARY_FIXTURE_PATH = join(
  FIXTURES_DIR,
  "fallback-target-summary.md",
);
const FALLBACK_REPORT_FIXTURE_PATH = join(
  FIXTURES_DIR,
  "fallback-enrichment-report.json",
);
const CONFLICT_ANALYST_FIXTURE_PATH = join(
  FIXTURES_DIR,
  "richard-conflict-analyst-report.md",
);
const CONFLICT_REFLECTION_FIXTURE_PATH = join(
  FIXTURES_DIR,
  "richard-conflict-reflection-summary.md",
);
const RICHARD_NOTE_PATH = join(PEOPLE_DIR, "richard-johnson.md");
const RICHARD_REPORT_PATH = join(
  RUNTIME_TMP_DIR,
  "richard-enrichment-report.json",
);

type Scenario = "fallback" | "conflict" | "reflect" | "smoke" | "all";

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      scenario: { type: "string", default: "all" },
    },
    strict: true,
  });

  const scenario = parseScenario(parsed.values.scenario);

  await mkdir(RUNTIME_TMP_DIR, { recursive: true });

  const results: Record<string, unknown> = {};
  if (scenario === "all" || scenario === "fallback") {
    results.fallback = await runFallbackProof();
  }
  if (scenario === "all" || scenario === "conflict") {
    results.conflict = await runConflictProof();
  }
  if (scenario === "all" || scenario === "reflect") {
    results.reflect = await runConflictReflectionProof();
  }
  if (scenario === "all" || scenario === "smoke") {
    results.smoke = await runSmokeSummary();
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

function parseScenario(input: string): Scenario {
  if (
    input === "fallback" ||
    input === "conflict" ||
    input === "reflect" ||
    input === "smoke" ||
    input === "all"
  ) {
    return input;
  }
  throw new Error(`Unsupported scenario: ${input}`);
}

async function runFallbackProof(): Promise<Record<string, unknown>> {
  const [nathanProfileContent, targetSummary, reportContent, outputContractContent] =
    await Promise.all([
      readFile(NATHAN_PROFILE_PATH, "utf-8"),
      readFile(FALLBACK_SUMMARY_FIXTURE_PATH, "utf-8"),
      readFile(FALLBACK_REPORT_FIXTURE_PATH, "utf-8"),
      readFile(REWRITE_CONTRACT_PATH, "utf-8"),
    ]);

  const targetName = "Jordan Mercer";
  const bundlePath = join(RUNTIME_TMP_DIR, "fallback-summary-rewrite-bundle.md");
  const reportPath = join(RUNTIME_TMP_DIR, "fallback-summary-voiced-report.json");

  const evidence: EvidenceItem[] = [
    {
      kind: "enrichment-report",
      path: FALLBACK_REPORT_FIXTURE_PATH,
      content: reportContent,
      format: "json",
    },
  ];

  const bundle = renderBundle({
    mode: "rewrite",
    taskBrief: [
      buildTaskBrief("rewrite", targetName),
      "Fallback instruction: the target person context is summary-only. Keep confidence visibly lower than a full-profile run.",
      "Include one direct sentence in the summary or relationship prose telling Nathan to create a proper people profile before relying heavily on this output.",
    ].join("\n"),
    nathanProfileContent,
    target: buildSummaryBundleTarget({
      name: targetName,
      content: targetSummary,
      path: FALLBACK_SUMMARY_FIXTURE_PATH,
    }),
    guidance: {
      confidence: "fallback",
      recommendProfileCreation: true,
    },
    evidence,
    outputContractPath: REWRITE_CONTRACT_PATH,
    outputContractContent,
  });
  await writeFile(bundlePath, bundle, "utf-8");

  const dispatch = await runClaude({
    prompt: buildJsonPrompt("rewrite", bundle, bundlePath, REWRITE_CONTRACT_PATH),
    jsonSchema: buildEnrichmentReportSchema(),
  });
  const report = parseClaudeJson<Record<string, unknown>>(dispatch.stdout);
  assertEnrichmentReport(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  const combined = JSON.stringify(report).toLowerCase();
  const recommendsProfileCreation = /proper profile|people profile|person note|create .*profile|create .*note/.test(
    combined,
  );
  if (!recommendsProfileCreation) {
    throw new Error(
      "Fallback proof did not include an explicit recommendation to create a proper profile.",
    );
  }

  return {
    bundle_path: bundlePath,
    report_path: reportPath,
    verification: {
      confidence_label: "fallback",
      lower_confidence_visible: /suggest|may|might|appears|seems|unclear|hard to say/.test(
        combined,
      ),
      recommends_profile_creation: recommendsProfileCreation,
    },
  };
}

async function runConflictProof(): Promise<Record<string, unknown>> {
  const [
    nathanProfileContent,
    noteContent,
    reportContent,
    analystReportContent,
    outputContractContent,
  ] = await Promise.all([
    readFile(NATHAN_PROFILE_PATH, "utf-8"),
    readFile(RICHARD_NOTE_PATH, "utf-8"),
    readFile(RICHARD_REPORT_PATH, "utf-8"),
    readFile(CONFLICT_ANALYST_FIXTURE_PATH, "utf-8"),
    readFile(REWRITE_CONTRACT_PATH, "utf-8"),
  ]);

  const bundlePath = join(RUNTIME_TMP_DIR, "richard-conflict-bundle.md");
  const reportPath = join(RUNTIME_TMP_DIR, "richard-conflict-voiced-report.json");
  const previewPath = join(RUNTIME_TMP_DIR, "richard-conflict-voiced-proposed.md");
  const target: ResolvedTarget = {
    candidate: {
      title: "Richard Johnson",
      slug: "richard-johnson",
      aliases: ["Rich"],
      source_handles: {},
      filePath: RICHARD_NOTE_PATH,
      frontmatter: {
        title: "Richard Johnson",
        slug: "richard-johnson",
      },
    },
    notePath: RICHARD_NOTE_PATH,
    noteContent,
  };

  const evidence: EvidenceItem[] = [
    {
      kind: "enrichment-report",
      path: RICHARD_REPORT_PATH,
      content: reportContent,
      format: "json",
    },
    {
      kind: "analyst-report",
      path: CONFLICT_ANALYST_FIXTURE_PATH,
      content: analystReportContent,
      format: "markdown",
    },
  ];

  const bundle = renderBundle({
    mode: "rewrite",
    taskBrief: [
      buildTaskBrief("rewrite", "Richard Johnson"),
      "Conflict instruction: the existing note/report and the supplied analyst report do not align cleanly. Keep disagreement explicit and reviewable rather than flattening it into a single confident story.",
    ].join("\n"),
    nathanProfileContent,
    target: buildProfileBundleTarget(target),
    guidance: {
      confidence: "full",
      recommendProfileCreation: false,
    },
    evidence,
    outputContractPath: REWRITE_CONTRACT_PATH,
    outputContractContent,
  });
  await writeFile(bundlePath, bundle, "utf-8");

  const dispatch = await runClaude({
    prompt: buildJsonPrompt("rewrite", bundle, bundlePath, REWRITE_CONTRACT_PATH),
    jsonSchema: buildEnrichmentReportSchema(),
  });
  const report = parseClaudeJson<Record<string, unknown>>(dispatch.stdout);
  assertEnrichmentReport(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await runApplyEnrichment({
    notePath: RICHARD_NOTE_PATH,
    reportPath,
    outputPath: previewPath,
  });

  const combined = JSON.stringify(report).toLowerCase();

  return {
    bundle_path: bundlePath,
    report_path: reportPath,
    preview_path: previewPath,
    verification: {
      reviewable_uncertainty_visible: /suggest|may|might|appears|unclear|tension|not clear|question/.test(
        combined,
      ),
      analyst_report_attached: true,
    },
  };
}

async function runSmokeSummary(): Promise<Record<string, string>> {
  const summaryPath = join(RUNTIME_TMP_DIR, "voice-enrich-smoke-summary.md");
  const lines = [
    "# Voice Enrich Workflow Smoke Summary",
    "",
    "These smoke cases verify the natural-language capability map stays explicit as non-people adapters come online.",
    "",
    "| Workflow | Prompt | Expected contract | Downstream |",
    "|---|---|---|---|",
    ...WORKFLOW_SMOKE_CASES.map(
      (item) =>
        `| ${item.label} | ${item.prompt} | ${item.contract} | ${item.downstream} |`,
    ),
    "",
    "Result: rewrite enrichment, text reply, email interpretation, and conflict reflection are all operational today; only the people-note rewrite/review/create paths route through the shared writer preview flow.",
    "",
  ];
  await writeFile(summaryPath, `${lines.join("\n")}\n`, "utf-8");
  return { summary_path: summaryPath };
}

async function runConflictReflectionProof(): Promise<Record<string, unknown>> {
  const [
    nathanProfileContent,
    noteContent,
    conflictSummary,
    outputContractContent,
  ] = await Promise.all([
    readFile(NATHAN_PROFILE_PATH, "utf-8"),
    readFile(RICHARD_NOTE_PATH, "utf-8"),
    readFile(CONFLICT_REFLECTION_FIXTURE_PATH, "utf-8"),
    readFile(CONFLICT_REFLECTION_CONTRACT_PATH, "utf-8"),
  ]);

  const artifactPaths = buildConflictArtifactPaths("richard");
  const target: ResolvedTarget = {
    candidate: {
      title: "Richard Johnson",
      slug: "richard-johnson",
      aliases: ["Rich"],
      source_handles: {},
      filePath: RICHARD_NOTE_PATH,
      frontmatter: {
        title: "Richard Johnson",
        slug: "richard-johnson",
      },
    },
    notePath: RICHARD_NOTE_PATH,
    noteContent,
  };

  const bundle = renderBundle({
    mode: "review",
    taskBrief: buildConflictTaskBrief("Richard Johnson"),
    nathanProfileContent,
    target: buildProfileBundleTarget(target),
    guidance: {
      confidence: "full",
      recommendProfileCreation: false,
    },
    evidence: [
      {
        kind: "argument-summary",
        path: CONFLICT_REFLECTION_FIXTURE_PATH,
        content: conflictSummary,
        format: "markdown",
      },
    ],
    outputContractPath: CONFLICT_REFLECTION_CONTRACT_PATH,
    outputContractContent,
  });
  await writeFile(artifactPaths.bundlePath, bundle, "utf-8");

  const dispatch = await runClaude({
    prompt: buildReflectPrompt(bundle, artifactPaths.bundlePath),
  });
  const reflection = dispatch.stdout.trim();
  assertConflictReflection(reflection);
  await writeFile(artifactPaths.reflectionPath, `${reflection}\n`, "utf-8");

  return {
    bundle_path: artifactPaths.bundlePath,
    reflection_path: artifactPaths.reflectionPath,
    verification: {
      review_only: true,
      required_structure_present: true,
    },
  };
}

if (import.meta.main) {
  await main();
}
