#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadIdentityCandidates } from "../../people-enrich/scripts/people-note.ts";
import {
  buildProfileBundleTarget,
  renderBundle,
  resolveTargetCandidate,
  runClaude,
  type BundleTarget,
} from "./voice-enrich.ts";

type EmailArtifactPaths = {
  bundlePath: string;
  interpretationPath: string;
};

type EmailEvidence = {
  kind: "email" | "thread-summary";
  path: string;
  content: string;
};

const MY_SECOND_BRAIN_ROOT = "/Users/nathanvale/code/my-second-brain";
const CLAUDE_CONFIG_ROOT = "/Users/nathanvale/code/claude-code-config";
const PEOPLE_DIR = join(MY_SECOND_BRAIN_ROOT, "context/people");
const RUNTIME_TMP_DIR = join(
  MY_SECOND_BRAIN_ROOT,
  "runtime/people-enrichment/tmp",
);
const NATHAN_PROFILE_PATH = join(PEOPLE_DIR, "nathan-vale.md");
const OUTPUT_CONTRACT_PATH = join(
  CLAUDE_CONFIG_ROOT,
  "context/contract-email-interpretation.md",
);

async function main(): Promise<void> {
  const parsed = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "email-file": { type: "string" },
      "thread-summary": { type: "string" },
    },
    allowPositionals: true,
    strict: true,
  });

  const requestedName = parsed.positionals.join(" ").trim();
  if (!requestedName) {
    throw new Error(
      "Usage: bun run voice-email-interpret.ts <name> --email-file /abs/path.md [--thread-summary /abs/path.md]",
    );
  }

  const emailFile = normalizeAbsolutePath(parsed.values["email-file"], "--email-file");
  const threadSummaryPath = normalizeOptionalAbsolutePath(
    parsed.values["thread-summary"],
    "--thread-summary",
  );

  await mkdir(RUNTIME_TMP_DIR, { recursive: true });

  const target = await resolveTarget(requestedName);
  const [nathanProfileContent, outputContractContent, incomingEmail] =
    await Promise.all([
      readFile(NATHAN_PROFILE_PATH, "utf-8"),
      readFile(OUTPUT_CONTRACT_PATH, "utf-8"),
      readFile(emailFile, "utf-8"),
    ]);

  const evidence: EmailEvidence[] = [
    {
      kind: "email",
      path: emailFile,
      content: incomingEmail,
    },
  ];

  if (threadSummaryPath) {
    evidence.push({
      kind: "thread-summary",
      path: threadSummaryPath,
      content: await readFile(threadSummaryPath, "utf-8"),
    });
  }

  const artifactPaths = buildArtifactPaths(target.candidate.slug);
  const bundle = renderBundle({
    mode: "review",
    taskBrief: buildTaskBrief(target.target.name),
    nathanProfileContent,
    target: target.target,
    guidance: {
      confidence: "full",
      recommendProfileCreation: false,
    },
    evidence: evidence.map((item) => ({
      ...item,
      format: "markdown" as const,
    })),
    outputContractPath: OUTPUT_CONTRACT_PATH,
    outputContractContent,
  });
  await writeFile(artifactPaths.bundlePath, bundle, "utf-8");

  const dispatch = await runClaude({
    prompt: buildInterpretPrompt(bundle, artifactPaths.bundlePath),
  });
  const interpretation = dispatch.stdout.trim();
  assertEmailInterpretation(interpretation);

  await writeFile(artifactPaths.interpretationPath, `${interpretation}\n`, "utf-8");

  process.stdout.write(
    `${JSON.stringify(
      {
        workflow: "email-interpretation",
        note_path: target.notePath,
        bundle_path: artifactPaths.bundlePath,
        interpretation_path: artifactPaths.interpretationPath,
      },
      null,
      2,
    )}\n`,
  );
}

type ResolvedEmailTarget = {
  notePath: string;
  target: BundleTarget;
  candidate: { slug: string };
};

async function resolveTarget(requestedName: string): Promise<ResolvedEmailTarget> {
  const candidates = await loadIdentityCandidates(PEOPLE_DIR);
  const candidate = resolveTargetCandidate(requestedName, candidates);
  if (!candidate.filePath) {
    throw new Error(`Resolved ${candidate.title} without a backing file path.`);
  }

  const notePath = resolve(candidate.filePath);
  const noteContent = await readFile(notePath, "utf-8");
  return {
    notePath,
    target: buildProfileBundleTarget({
      candidate,
      notePath,
      noteContent,
    }),
    candidate: { slug: candidate.slug },
  };
}

function normalizeAbsolutePath(input: string | undefined, flagName: string): string {
  if (!input) {
    throw new Error(`${flagName} is required.`);
  }
  if (!isAbsolute(input)) {
    throw new Error(`${flagName} must be an absolute path.`);
  }
  return resolve(input);
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

export function buildArtifactPaths(targetSlug: string): EmailArtifactPaths {
  return {
    bundlePath: join(RUNTIME_TMP_DIR, `${targetSlug}-email-interpretation-bundle.md`),
    interpretationPath: join(
      RUNTIME_TMP_DIR,
      `${targetSlug}-email-interpretation.md`,
    ),
  };
}

export function buildTaskBrief(targetName: string): string {
  return [
    "Mode: interpret",
    `Task: Interpret the supplied incoming email from ${targetName} using only the provided context.`,
    "Return structured markdown matching the email interpretation contract exactly.",
    "Keep the plain reading separate from relational inference, and include a concise suggested reply only if the supplied context makes one useful.",
  ].join("\n");
}

export function buildInterpretPrompt(bundle: string, bundlePath: string): string {
  return [
    `The ContextBundle at ${bundlePath} has already been assembled in deterministic order.`,
    `The output contract is ${OUTPUT_CONTRACT_PATH}.`,
    "Do not read any files or widen scope. Treat the bundle below as the entire allowed context.",
    "Return only structured markdown matching the email interpretation contract.",
    "",
    bundle,
  ].join("\n");
}

export function assertEmailInterpretation(content: string): void {
  const requiredHeadings = [
    "# Email Interpretation",
    "## Surface Read",
    "## Relational Read",
    "## Response Strategy",
    "## Suggested Reply",
  ];

  for (const heading of requiredHeadings) {
    if (!content.includes(heading)) {
      throw new Error(`Email interpretation is missing required heading: ${heading}`);
    }
  }
}

if (import.meta.main) {
  await main();
}
