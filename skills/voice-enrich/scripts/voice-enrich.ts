#!/usr/bin/env bun

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, parse, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadIdentityCandidates, type IdentityCandidate } from "../../people-enrich/scripts/people-note.ts";
import { slugify } from "../../people-enrich/scripts/lib.ts";
import {
  applyReviewPartialEditPlan,
  buildReviewPartialEditPlan,
  hasAppliableReviewEdits,
} from "./review-partial-edit.ts";

export type Mode = "rewrite" | "review" | "create";

export type EvidenceItem = {
  kind:
    | "analyst-report"
    | "enrichment-report"
    | "text-message"
    | "thread-summary"
    | "email"
    | "psychometrics"
    | "qmd-findings"
    | "argument-summary"
    | "note";
  path: string;
  content: string;
  format: "json" | "markdown";
};

export type BundleTarget = {
  name: string;
  source: "profile" | "summary";
  content: string;
  path?: string;
};

export type ResolvedTarget = {
  candidate: IdentityCandidate;
  notePath: string;
  noteContent: string;
};

export type BundleInput = {
  mode: Mode;
  taskBrief: string;
  nathanProfileContent: string;
  target: BundleTarget;
  guidance: {
    confidence: "full" | "fallback";
    recommendProfileCreation: boolean;
  };
  evidence: EvidenceItem[];
  outputContractPath: string;
  outputContractContent: string;
};

export type ArtifactPaths = {
  artifactStem: string;
  bundlePath: string;
  usesWriter: boolean;
  reportPath?: string;
  previewPath?: string;
  reviewPath?: string;
  reviewPatchPath?: string;
  reviewPreviewPath?: string;
};

export type WorkflowSmokeCase = {
  label: string;
  prompt: string;
  contract: string;
  downstream: string;
};

type DispatchResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

type EnrichmentReport = {
  summary?: string;
  relationship_profile: Array<{ heading: string; content: string }>;
  signals?: string[];
  signal_mode?: "append" | "replace";
  open_questions?: string[];
  open_questions_mode?: "append" | "replace";
  conflicts?: string[];
  aliases?: string[];
  source_handles?: Record<string, string[]>;
  relationship_type?: string;
  related_people?: string[];
  enrichment?: {
    source: string;
    tier?: number;
    last_run_at?: string;
  };
};

const MY_SECOND_BRAIN_ROOT = "/Users/nathanvale/code/my-second-brain";
const CLAUDE_CONFIG_ROOT = "/Users/nathanvale/code/claude-code-config";
const PEOPLE_DIR = join(MY_SECOND_BRAIN_ROOT, "memory/people");
const RUNTIME_TMP_DIR = join(
  MY_SECOND_BRAIN_ROOT,
  "runtime/people-enrichment/tmp",
);
const NATHAN_PROFILE_PATH = join(PEOPLE_DIR, "nathan-vale.md");
const APPLY_ENRICHMENT_SCRIPT = join(
  CLAUDE_CONFIG_ROOT,
  "skills/people-enrich/scripts/apply-enrichment.ts",
);
const OUTPUT_CONTRACT_PATHS: Record<Mode, string> = {
  rewrite: join(CLAUDE_CONFIG_ROOT, "context/contract-people-note.md"),
  review: join(CLAUDE_CONFIG_ROOT, "context/contract-people-note-review.md"),
  create: join(CLAUDE_CONFIG_ROOT, "context/contract-people-note-create.md"),
};
const REPORT_SUFFIX = "-enrichment-report.json";

export const WORKFLOW_SMOKE_CASES: WorkflowSmokeCase[] = [
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
];

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      mode: { type: "string" },
      "analyst-report": { type: "string" },
      "emit-review-patch": { type: "boolean", default: false },
      "preview-review-patch": { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });

  const requestedName = parsed.positionals.join(" ").trim();
  if (!requestedName) {
    throw new Error(
      "Usage: bun run voice-enrich.ts <name> [--mode rewrite|review|create] [--analyst-report /abs/path.md]",
    );
  }

  const requestedMode = parseMode(parsed.values.mode);
  const analystReportPath = normalizeOptionalAbsolutePath(
    parsed.values["analyst-report"],
    "--analyst-report",
  );
  const emitReviewPatch =
    parsed.values["emit-review-patch"] || parsed.values["preview-review-patch"];
  const previewReviewPatch = parsed.values["preview-review-patch"];

  await mkdir(RUNTIME_TMP_DIR, { recursive: true });

  const target = await resolveTarget(requestedName);
  const existingReport = await resolveEnrichmentReport(target.candidate);
  const mode = selectMode(requestedMode, Boolean(existingReport));
  assertModePreconditions({
    mode,
    existingReportPath: existingReport?.path,
    analystReportPath,
  });
  assertReviewPatchPreconditions({ mode, emitReviewPatch, previewReviewPatch });

  const nathanProfileContent = await readFile(NATHAN_PROFILE_PATH, "utf-8");
  const outputContractPath = OUTPUT_CONTRACT_PATHS[mode];
  const outputContractContent = await readFile(outputContractPath, "utf-8");

  const evidence: EvidenceItem[] = [];
  if (existingReport && (mode === "rewrite" || mode === "review")) {
    evidence.push({
      kind: "enrichment-report",
      path: existingReport.path,
      content: existingReport.content,
      format: "json",
    });
  }
  if (analystReportPath) {
    evidence.push({
      kind: "analyst-report",
      path: analystReportPath,
      content: await readFile(analystReportPath, "utf-8"),
      format: "markdown",
    });
  }

  const artifactPaths = buildArtifactPaths({
    mode,
    targetSlug: target.candidate.slug,
    existingReportPath: existingReport?.path,
  });

  const taskBrief = buildTaskBrief(mode, target.candidate.title);
  const bundle = renderBundle({
    mode,
    taskBrief,
    nathanProfileContent,
    target: buildProfileBundleTarget(target),
    guidance: {
      confidence: "full",
      recommendProfileCreation: false,
    },
    evidence,
    outputContractPath,
    outputContractContent,
  });
  await writeFile(artifactPaths.bundlePath, bundle, "utf-8");

  const result =
    mode === "review"
      ? await runReviewFlow({
          bundle,
          reviewPath: artifactPaths.reviewPath!,
          reviewPatchPath: artifactPaths.reviewPatchPath,
          reviewPreviewPath: artifactPaths.reviewPreviewPath,
          bundlePath: artifactPaths.bundlePath,
          outputContractPath,
          target,
          emitReviewPatch,
          previewReviewPatch,
        })
      : await runJsonFlow({
          mode,
          bundle,
          reportPath: artifactPaths.reportPath!,
          previewPath: artifactPaths.previewPath!,
          bundlePath: artifactPaths.bundlePath,
          outputContractPath,
          target,
        });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseMode(value: string | undefined): Mode | undefined {
  if (!value) return undefined;
  if (value === "rewrite" || value === "review" || value === "create") {
    return value;
  }
  throw new Error(`Unsupported mode: ${value}`);
}

function normalizeOptionalAbsolutePath(
  input: string | undefined,
  flagName: string,
): string | undefined {
  if (!input) return undefined;
  if (!isAbsolute(input)) {
    throw new Error(`${flagName} must be an absolute path.`);
  }
  return resolve(input);
}

export function selectMode(
  requestedMode: Mode | undefined,
  hasExistingReport: boolean,
): Mode {
  if (requestedMode) return requestedMode;
  return hasExistingReport ? "rewrite" : "review";
}

export function assertModePreconditions(input: {
  mode: Mode;
  existingReportPath?: string;
  analystReportPath?: string;
}): void {
  if (input.mode === "rewrite" && !input.existingReportPath) {
    throw new Error(
      `Rewrite mode requires an existing enrichment report in ${RUNTIME_TMP_DIR}.`,
    );
  }

  if (input.mode !== "create") return;

  if (input.existingReportPath) {
    throw new Error(
      `Create mode is for fresh reports. Found existing report at ${input.existingReportPath}; use rewrite instead.`,
    );
  }

  if (!input.analystReportPath) {
    throw new Error(
      "Create mode requires explicit upstream evidence. Pass --analyst-report /absolute/path.md and do not rely on the note alone.",
    );
  }
}

async function resolveTarget(requestedName: string): Promise<ResolvedTarget> {
  const directPath = normalizeOptionalAbsolutePath(
    requestedName.endsWith(".md") ? requestedName : undefined,
    "<name>",
  );
  if (directPath) {
    const content = await readFile(directPath, "utf-8");
    const candidates = await loadIdentityCandidates(PEOPLE_DIR);
    const candidate = candidates.find(
      (entry) => entry.filePath && resolve(entry.filePath) === directPath,
    );
    if (!candidate) {
      throw new Error(`Could not resolve a people note at ${directPath}.`);
    }
    return { candidate, notePath: directPath, noteContent: content };
  }

  const candidates = await loadIdentityCandidates(PEOPLE_DIR);
  const slugInput = slugify(requestedName);
  const normalizedName = normalizePhrase(requestedName);
  const match = resolveTargetCandidate(requestedName, candidates);
  if (!match.filePath) {
    throw new Error(`Resolved ${match.title} without a backing file path.`);
  }

  return {
    candidate: match,
    notePath: match.filePath,
    noteContent: await readFile(match.filePath, "utf-8"),
  };
}

export function resolveTargetCandidate(
  requestedName: string,
  candidates: IdentityCandidate[],
): IdentityCandidate {
  const slugInput = slugify(requestedName);
  const normalizedName = normalizePhrase(requestedName);
  const stages = [
    {
      label: "exact slug",
      matches: candidates.filter((candidate) => candidate.slug === slugInput),
    },
    {
      label: "exact title",
      matches: candidates.filter(
        (candidate) => normalizePhrase(candidate.title) === normalizedName,
      ),
    },
    {
      label: "exact alias",
      matches: candidates.filter((candidate) =>
        candidate.aliases.some((alias) => normalizePhrase(alias) === normalizedName),
      ),
    },
    {
      label: "slug prefix",
      matches: candidates.filter((candidate) => candidate.slug.startsWith(slugInput)),
    },
    {
      label: "title prefix",
      matches: candidates.filter((candidate) =>
        normalizePhrase(candidate.title).startsWith(normalizedName),
      ),
    },
  ] as const;

  for (const stage of stages) {
    if (stage.matches.length === 1) {
      return stage.matches[0];
    }
    if (stage.matches.length > 1) {
      throw new Error(
        `Target "${requestedName}" is ambiguous at ${stage.label}: ${stage.matches
          .map((candidate) => candidate.filePath ?? candidate.title)
          .join(", ")}`,
      );
    }
  }

  throw new Error(
    `Could not resolve a people note for "${requestedName}" in ${PEOPLE_DIR}.`,
  );
}

async function resolveEnrichmentReport(
  candidate: IdentityCandidate,
): Promise<{ path: string; content: string } | null> {
  const files = (await readdir(RUNTIME_TMP_DIR)).filter((name) =>
    name.endsWith(REPORT_SUFFIX),
  );
  const reportFileName = resolveMatchingReportFile(candidate, files);
  if (!reportFileName) return null;

  const reportPath = join(RUNTIME_TMP_DIR, reportFileName);
  return {
    path: reportPath,
    content: await readFile(reportPath, "utf-8"),
  };
}

export function resolveMatchingReportFile(
  candidate: IdentityCandidate,
  fileNames: string[],
): string | null {
  const exactFileName = `${candidate.slug}${REPORT_SUFFIX}`;
  if (fileNames.includes(exactFileName)) {
    return exactFileName;
  }

  const tokenSet = new Set<string>([
    candidate.slug,
    ...candidate.slug.split("-"),
    slugify(candidate.title),
    ...slugify(candidate.title).split("-"),
    ...candidate.aliases.map((alias) => slugify(alias)),
  ]);

  const matches = fileNames.filter((fileName) => {
    const stem = stripReportSuffix(fileName);
    return tokenSet.has(stem);
  });

  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `Multiple enrichment reports match ${candidate.title}: ${matches
        .map((name) => join(RUNTIME_TMP_DIR, name))
        .join(", ")}`,
    );
  }

  return matches[0];
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function stripReportSuffix(fileName: string): string {
  return fileName.endsWith(REPORT_SUFFIX)
    ? fileName.slice(0, -REPORT_SUFFIX.length)
    : parse(fileName).name;
}

export function deriveArtifactStem(input: {
  mode: Mode;
  targetSlug: string;
  existingReportPath?: string;
}): string {
  return input.mode === "rewrite" && input.existingReportPath
    ? stripReportSuffix(basename(input.existingReportPath))
    : input.targetSlug;
}

export function buildArtifactPaths(input: {
  mode: Mode;
  targetSlug: string;
  existingReportPath?: string;
}): ArtifactPaths {
  const artifactStem = deriveArtifactStem(input);
  const bundlePath = join(RUNTIME_TMP_DIR, `${artifactStem}-${input.mode}-bundle.md`);

  if (input.mode === "review") {
    return {
      artifactStem,
      bundlePath,
      usesWriter: false,
      reviewPath: join(RUNTIME_TMP_DIR, `${artifactStem}-review.md`),
      reviewPatchPath: join(
        RUNTIME_TMP_DIR,
        `${artifactStem}-review-partial-edit.json`,
      ),
      reviewPreviewPath: join(
        RUNTIME_TMP_DIR,
        `${artifactStem}-review-partial-edit-proposed.md`,
      ),
    };
  }

  if (input.mode === "rewrite") {
    return {
      artifactStem,
      bundlePath,
      usesWriter: true,
      reportPath: join(RUNTIME_TMP_DIR, `${artifactStem}-voiced-report.json`),
      previewPath: join(RUNTIME_TMP_DIR, `${artifactStem}-voiced-proposed.md`),
    };
  }

  return {
    artifactStem,
    bundlePath,
    usesWriter: true,
    reportPath: join(RUNTIME_TMP_DIR, `${artifactStem}-created-report.json`),
    previewPath: join(RUNTIME_TMP_DIR, `${artifactStem}-created-proposed.md`),
  };
}

export function buildTaskBrief(mode: Mode, title: string): string {
  switch (mode) {
    case "rewrite":
      return `Mode: rewrite\nTask: Rewrite the supplied EnrichmentReport for ${title} with Perel-Baldwin voice. Preserve report shape, keep non-prose fields unchanged, and operate only on the supplied artifacts.`;
    case "review":
      return `Mode: review\nTask: Review the supplied people-note prose for ${title}. Return structured markdown critique and concise suggested rewrites without mutating the note or emitting EnrichmentReport JSON.`;
    case "create":
      return `Mode: create\nTask: Author a fresh EnrichmentReport for ${title} from the supplied context and explicit upstream evidence only. Stay conservative, omit unsupported depth, and keep open questions concrete where uncertainty remains.`;
  }
}

export function buildProfileBundleTarget(target: ResolvedTarget): BundleTarget {
  return {
    name: target.candidate.title,
    source: "profile",
    path: target.notePath,
    content: target.noteContent,
  };
}

export function buildSummaryBundleTarget(input: {
  name: string;
  content: string;
  path?: string;
}): BundleTarget {
  return {
    name: input.name,
    source: "summary",
    path: input.path,
    content: input.content,
  };
}

export function renderBundle(input: BundleInput): string {
  const evidenceSections =
    input.evidence.length === 0
      ? "_No additional evidence supplied._"
      : input.evidence
          .map((item, index) =>
            [
              `### Evidence ${index + 1}`,
              `Kind: ${item.kind}`,
              `Path: ${item.path}`,
              fence(item.format === "json" ? "json" : "md", item.content),
            ].join("\n\n"),
          )
          .join("\n\n");

  return [
    "# Perel-Baldwin ContextBundle",
    "",
    "## 1. Task Brief",
    "",
    input.taskBrief,
    "",
    "## 2. Nathan Profile",
    "",
    "Source: profile",
    `Path: ${NATHAN_PROFILE_PATH}`,
    "",
    fence("md", input.nathanProfileContent),
    "",
    "## 3. Target Person",
    "",
    `Name: ${input.target.name}`,
    `Source: ${input.target.source}`,
    ...(input.target.path ? [`Path: ${input.target.path}`] : []),
    "",
    fence("md", input.target.content),
    "",
    "## 4. Guidance",
    "",
    `Confidence: ${input.guidance.confidence}`,
    `Recommend profile creation: ${String(input.guidance.recommendProfileCreation)}`,
    "",
    "## 5. Evidence",
    "",
    evidenceSections,
    "",
    "## 6. Output Contract",
    "",
    `Load: ${toContextReference(input.outputContractPath)}`,
    `Path: ${input.outputContractPath}`,
    "",
    fence("md", input.outputContractContent),
    "",
  ].join("\n");
}

function fence(language: string, content: string): string {
  return `\`\`\`${language}\n${content.trim()}\n\`\`\``;
}

function toContextReference(path: string): string {
  if (!path.startsWith(join(CLAUDE_CONFIG_ROOT, "context/"))) {
    return path;
  }
  return `@context/${basename(path)}`;
}

async function runJsonFlow(input: {
  mode: "rewrite" | "create";
  bundle: string;
  reportPath: string;
  previewPath: string;
  bundlePath: string;
  outputContractPath: string;
  target: ResolvedTarget;
}): Promise<Record<string, unknown>> {
  const dispatch = await runClaude({
    prompt: buildJsonPrompt(input.mode, input.bundle, input.bundlePath, input.outputContractPath),
    jsonSchema: buildEnrichmentReportSchema(),
  });
  const report = parseClaudeJson<EnrichmentReport>(dispatch.stdout);
  assertEnrichmentReport(report);

  await writeFile(input.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  await runApplyEnrichment({
    notePath: input.target.notePath,
    reportPath: input.reportPath,
    outputPath: input.previewPath,
  });

  return {
    mode: input.mode,
    note_path: input.target.notePath,
    bundle_path: input.bundlePath,
    report_path: input.reportPath,
    preview_path: input.previewPath,
  };
}

async function runReviewFlow(input: {
  bundle: string;
  reviewPath: string;
  reviewPatchPath?: string;
  reviewPreviewPath?: string;
  bundlePath: string;
  outputContractPath: string;
  target: ResolvedTarget;
  emitReviewPatch: boolean;
  previewReviewPatch: boolean;
}): Promise<Record<string, unknown>> {
  const dispatch = await runClaude({
    prompt: buildReviewPrompt(input.bundle, input.bundlePath, input.outputContractPath),
  });
  const review = dispatch.stdout.trim();
  assertReviewMarkdown(review);

  await writeFile(input.reviewPath, `${review}\n`, "utf-8");

  const result: Record<string, unknown> = {
    mode: "review",
    note_path: input.target.notePath,
    bundle_path: input.bundlePath,
    review_path: input.reviewPath,
  };

  if (input.emitReviewPatch) {
    if (!input.reviewPatchPath) {
      throw new Error("Review patch path is required when review patch emission is enabled.");
    }

    const reviewPatch = buildReviewPartialEditPlan(review);
    await writeFile(
      input.reviewPatchPath,
      `${JSON.stringify(reviewPatch, null, 2)}\n`,
      "utf-8",
    );
    result.review_patch_path = input.reviewPatchPath;
    result.review_patch_operation_count = reviewPatch.operations.length;

    if (input.previewReviewPatch) {
      if (!input.reviewPreviewPath) {
        throw new Error(
          "Review preview path is required when review patch preview is enabled.",
        );
      }
      if (!hasAppliableReviewEdits(reviewPatch)) {
        throw new Error(
          "Review output did not include any explicit rewrite suggestions to preview.",
        );
      }

      const preview = applyReviewPartialEditPlan(
        input.target.noteContent,
        reviewPatch,
        new Date().toISOString().slice(0, 10),
      );
      await writeFile(input.reviewPreviewPath, preview, "utf-8");
      result.review_preview_path = input.reviewPreviewPath;
    }
  }

  return result;
}

export function buildJsonPrompt(
  mode: "rewrite" | "create",
  bundle: string,
  bundlePath: string,
  outputContractPath: string,
): string {
  const modeSpecificInstruction =
    mode === "rewrite"
      ? "Return only a valid EnrichmentReport JSON object. Rewrite prose fields only and preserve all pass-through fields from the supplied report."
      : "Return only a valid EnrichmentReport JSON object. Author conservatively from the supplied evidence only, and omit unsupported fields instead of inventing them.";

  return [
    `The ContextBundle at ${bundlePath} has already been assembled in deterministic order.`,
    `The output contract is ${outputContractPath}.`,
    "Do not read any files or widen scope. Treat the bundle below as the entire allowed context.",
    modeSpecificInstruction,
    "",
    bundle,
  ].join("\n");
}

export function buildReviewPrompt(
  bundle: string,
  bundlePath: string,
  outputContractPath: string,
): string {
  return [
    `The ContextBundle at ${bundlePath} has already been assembled in deterministic order.`,
    `The output contract is ${outputContractPath}.`,
    "Do not read any files or widen scope. Treat the bundle below as the entire allowed context.",
    "Return only structured markdown matching the review contract exactly. Do not emit JSON.",
    "",
    bundle,
  ].join("\n");
}

export async function runClaude(input: {
  prompt: string;
  jsonSchema?: Record<string, unknown>;
}): Promise<DispatchResult> {
  const command = [
    "claude",
    "-p",
    "--agent",
    "perel-baldwin",
    "--no-session-persistence",
    "--tools",
    "",
  ];

  if (input.jsonSchema) {
    command.push(
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(input.jsonSchema),
    );
  }

  command.push("--", input.prompt);

  const proc = Bun.spawn({
    cmd: command,
    cwd: CLAUDE_CONFIG_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readSpawnStream(proc.stdout),
    readSpawnStream(proc.stderr),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `perel-baldwin failed with exit ${exitCode}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`,
    );
  }

  return { stdout, stderr, exitCode };
}

export function parseClaudeJson<T>(stdout: string): T {
  const parsed = JSON.parse(stdout) as {
    result?: unknown;
    structured_output?: unknown;
  };
  const candidate = parsed.structured_output ?? parsed.result ?? parsed;
  if (typeof candidate === "string") {
    return JSON.parse(candidate) as T;
  }
  return candidate as T;
}

export function buildEnrichmentReportSchema(): Record<string, unknown> {
  const stringArraySchema = {
    type: "array",
    items: { type: "string" },
  } as const;

  return {
    type: "object",
    additionalProperties: false,
    required: ["relationship_profile"],
    properties: {
      summary: { type: "string" },
      relationship_profile: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["heading", "content"],
          properties: {
            heading: { type: "string" },
            content: { type: "string" },
          },
        },
      },
      signals: stringArraySchema,
      signal_mode: { type: "string", enum: ["append", "replace"] },
      open_questions: stringArraySchema,
      open_questions_mode: { type: "string", enum: ["append", "replace"] },
      conflicts: stringArraySchema,
      aliases: stringArraySchema,
      source_handles: {
        type: "object",
        additionalProperties: {
          type: "array",
          items: { type: "string" },
        },
      },
      relationship_type: { type: "string" },
      related_people: stringArraySchema,
      enrichment: {
        type: "object",
        additionalProperties: false,
        required: ["source"],
        properties: {
          source: { type: "string" },
          tier: { type: "number" },
          last_run_at: { type: "string" },
        },
      },
    },
  };
}

export function assertEnrichmentReport(
  value: unknown,
): asserts value is EnrichmentReport {
  if (!isRecord(value) || !Array.isArray(value.relationship_profile)) {
    throw new Error("Model output is not a valid EnrichmentReport.");
  }

  for (const block of value.relationship_profile) {
    if (
      !isRecord(block) ||
      typeof block.heading !== "string" ||
      typeof block.content !== "string"
    ) {
      throw new Error("relationship_profile must contain heading/content strings.");
    }
  }

  assertOptionalString(value.summary, "summary");
  assertOptionalStringArray(value.signals, "signals");
  assertOptionalEnum(value.signal_mode, "signal_mode", ["append", "replace"]);
  assertOptionalStringArray(value.open_questions, "open_questions");
  assertOptionalEnum(value.open_questions_mode, "open_questions_mode", [
    "append",
    "replace",
  ]);
  assertOptionalStringArray(value.conflicts, "conflicts");
  assertOptionalStringArray(value.aliases, "aliases");
  assertOptionalString(value.relationship_type, "relationship_type");
  assertOptionalStringArray(value.related_people, "related_people");

  if (value.source_handles !== undefined) {
    if (!isRecord(value.source_handles)) {
      throw new Error("source_handles must be an object of string arrays.");
    }
    for (const handles of Object.values(value.source_handles)) {
      if (!Array.isArray(handles) || handles.some((item) => typeof item !== "string")) {
        throw new Error("source_handles values must be string arrays.");
      }
    }
  }

  if (value.enrichment !== undefined) {
    if (
      !isRecord(value.enrichment) ||
      typeof value.enrichment.source !== "string"
    ) {
      throw new Error("enrichment must contain a string source.");
    }
    if (
      value.enrichment.tier !== undefined &&
      typeof value.enrichment.tier !== "number"
    ) {
      throw new Error("enrichment.tier must be a number when present.");
    }
    assertOptionalString(value.enrichment.last_run_at, "enrichment.last_run_at");
  }
}

function assertReviewMarkdown(content: string): void {
  const requiredHeadings = [
    "# People Note Review",
    "## Overall Assessment",
    "## Block Reviews",
    "## Missing Or Risky Headings",
    "## Summary Suggestion",
    "## Cautions",
  ];

  for (const heading of requiredHeadings) {
    if (!content.includes(heading)) {
      throw new Error(`Review output is missing required heading: ${heading}`);
    }
  }
}

function assertReviewPatchPreconditions(input: {
  mode: Mode;
  emitReviewPatch: boolean;
  previewReviewPatch: boolean;
}): void {
  if (!input.emitReviewPatch && !input.previewReviewPatch) return;
  if (input.mode !== "review") {
    throw new Error("Review patch flags are only supported in review mode.");
  }
}

export async function runApplyEnrichment(input: {
  notePath: string;
  reportPath: string;
  outputPath: string;
}): Promise<void> {
  const proc = Bun.spawn({
    cmd: [
      "bun",
      "run",
      APPLY_ENRICHMENT_SCRIPT,
      "--note",
      input.notePath,
      "--report",
      input.reportPath,
      "--output",
      input.outputPath,
    ],
    cwd: CLAUDE_CONFIG_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    readSpawnStream(proc.stdout),
    readSpawnStream(proc.stderr),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `apply-enrichment failed with exit ${exitCode}\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`,
    );
  }
}

function normalizePhrase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function assertOptionalString(value: unknown, label: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`${label} must be a string when present.`);
  }
}

function assertOptionalStringArray(value: unknown, label: string): void {
  if (
    value !== undefined &&
    (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
  ) {
    throw new Error(`${label} must be a string array when present.`);
  }
}

function assertOptionalEnum(
  value: unknown,
  label: string,
  allowed: string[],
): void {
  if (value !== undefined && (typeof value !== "string" || !allowed.includes(value))) {
    throw new Error(`${label} must be one of ${allowed.join(", ")}.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readSpawnStream(
  stream: ReadableStream<Uint8Array> | null,
): Promise<string> {
  if (!stream) return "";
  return new Response(stream).text();
}

if (import.meta.main) {
  await main();
}
