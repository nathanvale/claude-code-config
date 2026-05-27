#!/usr/bin/env bun

/**
 * Issue-to-PR v2 helper compatibility entrypoint (U3 slice S5).
 *
 * This file is a thin dispatcher over the modules in `./lib/`. It preserves
 * the legacy helper flag surface: same stdout/stderr shape, same exit codes,
 * same argument handling. The char suite at `./decompose.test.ts` is the
 * regression net.
 *
 * Public compatibility flags:
 *   decompose.ts --plan-digest <plan-path>
 *   decompose.ts --ac-digest <ledger-path>
 *   decompose.ts --confirmation-state <ledger-path>
 *   decompose.ts --validate-ledger-batches <ledger-path>
 *   decompose.ts --batch-contract-digest <ledger-path>
 *   decompose.ts --validate-findings <ledger-path>
 *   decompose.ts --validate-workflow-learnings <ledger-path>
 *   decompose.ts --assert-no-open-p0p1 <ledger-path>
 *   decompose.ts <plan-path>
 *   decompose.ts <plan-path> --candidate-contract-digest
 *   decompose.ts <plan-path> --validate-ac-coverage <ledger-path>
 *   decompose.ts <plan-path> --patch-proposal <ledger-path>
 *
 * v2-only flags:
 *   decompose.ts --assert-stage5-readonly <ledger-path> <commit-ref>
 *   decompose.ts --assert-final-metadata-scope <ledger-path>
 *   decompose.ts --assert-final-metadata-commit <ledger-path> <commit-ref>
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { argv, exit } from "node:process";

import {
  emit,
  emitAcDigest,
  emitConfirmationState,
  emitContractDigest,
  emitLedgerBatchContractDigest,
  emitPlanDigest,
  fail,
  parse,
  readLedgerBatchContext,
  validateAcCoverage,
  validateFindingsData,
  validateLedgerBatches,
  validateWorkflowLearnings,
} from "./lib/ledger";
import {
  CANONICAL_REGISTRY_RELATIVE_PATH,
  parseRegistryFromString,
  validateRegistry,
} from "./lib/learnings";

const WORKFLOW_LEARNINGS_REGISTRY_PATH = CANONICAL_REGISTRY_RELATIVE_PATH;

const args = argv.slice(2);
if (args[0] === "--plan-digest") {
  if (args.length !== 2) fail("usage: decompose.ts --plan-digest <plan-path>");
  emitPlanDigest(args[1]);
  exit(0);
}
if (args[0] === "--ac-digest") {
  if (args.length !== 2) fail("usage: decompose.ts --ac-digest <ledger-path>");
  emitAcDigest(args[1]);
  exit(0);
}
if (args[0] === "--confirmation-state") {
  if (args.length !== 2) fail("usage: decompose.ts --confirmation-state <ledger-path>");
  emitConfirmationState(args[1]);
  exit(0);
}
if (args[0] === "--validate-ledger-batches") {
  if (args.length !== 2) fail("usage: decompose.ts --validate-ledger-batches <ledger-path>");
  validateLedgerBatches(args[1]);
  exit(0);
}
if (args[0] === "--batch-contract-digest") {
  if (args.length !== 2) fail("usage: decompose.ts --batch-contract-digest <ledger-path>");
  emitLedgerBatchContractDigest(args[1]);
  exit(0);
}
if (args[0] === "--validate-findings") {
  if (args.length !== 2) fail("usage: decompose.ts --validate-findings <ledger-path>");
  validateFindingsData(args[1]);
  exit(0);
}
if (args[0] === "--validate-workflow-learnings") {
  if (args.length !== 2) fail("usage: decompose.ts --validate-workflow-learnings <ledger-path>");
  validateWorkflowLearnings(args[1]);
  exit(0);
}
if (args[0] === "--assert-no-open-p0p1") {
  if (args.length !== 2) fail("usage: decompose.ts --assert-no-open-p0p1 <ledger-path>");
  validateFindingsData(args[1], { assertNoOpenP0P1: true });
  exit(0);
}
if (args[0] === "--assert-stage5-readonly") {
  if (args.length !== 3)
    fail("usage: decompose.ts --assert-stage5-readonly <ledger-path> <commit-ref>");
  assertStage5ReadOnly(args[1], args[2]);
  exit(0);
}
if (args[0] === "--assert-final-metadata-scope") {
  const json = args[2] === "--json";
  if (args.length !== (json ? 3 : 2))
    fail("usage: decompose.ts --assert-final-metadata-scope <ledger-path> [--json]");
  emitFinalMetadataGateResult(
    assertFinalMetadataScope(args[1]),
    "final metadata scope gate",
    json,
  );
  exit(0);
}
if (args[0] === "--assert-final-metadata-commit") {
  const json = args[3] === "--json";
  if (args.length !== (json ? 4 : 3))
    fail("usage: decompose.ts --assert-final-metadata-commit <ledger-path> <commit-ref> [--json]");
  emitFinalMetadataGateResult(
    assertFinalMetadataCommit(args[1], args[2]),
    "final metadata commit gate",
    json,
  );
  exit(0);
}
const patchProposalMode = args.length === 3 && args[1] === "--patch-proposal";
const validateCoverage = args.length === 3 && args[1] === "--validate-ac-coverage";
const candidateContractDigest = args.length === 2 && args[1] === "--candidate-contract-digest";
if (
  !args[0] ||
  args[0].startsWith("-") ||
  (args.length !== 1 && !patchProposalMode && !validateCoverage && !candidateContractDigest)
) {
  fail(
    "usage: decompose.ts <plan-path> [--candidate-contract-digest | --validate-ac-coverage <ledger-path> | --patch-proposal <ledger-path>] | --plan-digest <plan-path> | --ac-digest <ledger-path> | --confirmation-state <ledger-path> | --validate-ledger-batches <ledger-path> | --batch-contract-digest <ledger-path> | --validate-findings <ledger-path> | --validate-workflow-learnings <ledger-path> | --assert-no-open-p0p1 <ledger-path> | --assert-stage5-readonly <ledger-path> <commit-ref> | --assert-final-metadata-scope <ledger-path> [--json] | --assert-final-metadata-commit <ledger-path> <commit-ref> [--json]",
  );
}

const planPath = args[0];
const validateFlag = args[1];
const ledgerPath = args[2];

const ledgerBatchContext = patchProposalMode
  ? readLedgerBatchContext(ledgerPath ?? fail("--patch-proposal requires a ledger path"))
  : undefined;
const batches = parse(planPath, {
  existingBatchIds: ledgerBatchContext?.allIds,
  externalDependencyIds: ledgerBatchContext?.terminalSuccessIds,
  externalFilePaths: ledgerBatchContext?.files,
  patchProposalMode,
});

if (candidateContractDigest) {
  emitContractDigest(batches);
} else if (validateFlag === "--validate-ac-coverage") {
  validateAcCoverage(batches, ledgerPath ?? fail("--validate-ac-coverage requires a ledger path"));
} else {
  emit(batches);
}

/**
 * Enforce that a Stage 5 (final review) ledger checkpoint commit is
 * read-only: it must touch ONLY the per-issue ledger path. Stage 5 is
 * read-only by contract, but nothing enforced it before this gate (a prior
 * run's commit edited non-ledger files during final review uncaught).
 *
 * Resolves the commit's touched files via `git diff-tree` (same plumbing as
 * the private `touchedFilesForCommit` in `lib/ledger.ts`, which is not
 * exported, so the read is reimplemented locally here to stay in scope) and
 * fails naming the first offending non-ledger path. The `<ledger-path>`
 * argument is the per-issue ledger path, normalized repo-relative for
 * comparison. An empty/no-op commit touches no non-ledger file, so it
 * satisfies the "touches ONLY the ledger" constraint vacuously and passes.
 *
 * A merge commit (2+ parents) is rejected outright before the touched-files
 * check: `git diff-tree` without `-m`/`-c` emits zero rows for a merge, so the
 * touched-file set would be empty and the gate would vacuously PASS even when
 * the merge pulled non-ledger files into the branch. A Stage 5 final-review
 * checkpoint is by contract a single non-merge ledger-only commit, so a merge
 * is never a valid checkpoint and must fail fast.
 */
function assertStage5ReadOnly(ledgerPath: string, ref: string): void {
  const context = "stage-5 read-only gate";
  if (isMergeCommit(ref, context)) {
    fail(
      `${context}: "${ref}" is a merge commit; a final-review checkpoint must be a single non-merge commit touching only the ledger "${ledgerPath}"`,
    );
  }
  const expected = normalizePath(ledgerPath);
  const touched = touchedFilesForRef(ref, context);
  for (const file of touched) {
    if (normalizePath(file) !== expected) {
      fail(
        `${context}: commit "${ref}" touched non-ledger path "${file}" during final review; Stage 5 may touch only the ledger "${ledgerPath}"`,
      );
    }
  }
}

function finalMetadataAllowedPaths(ledgerPath: string): Set<string> {
  return new Set([
    normalizePath(ledgerPath),
    WORKFLOW_LEARNINGS_REGISTRY_PATH,
  ]);
}

type FinalMetadataGateResult = {
  ok: boolean;
  gate: "final-metadata-scope" | "final-metadata-commit";
  allowed_paths: string[];
  offending_path?: string;
  reason?: string;
};

function assertFinalMetadataScope(ledgerPath: string): FinalMetadataGateResult {
  const context = "final metadata scope gate";
  const allowed = finalMetadataAllowedPaths(ledgerPath);
  const changed = gitChanges(["diff", "--name-status"], context);
  const staged = gitChanges(["diff", "--cached", "--name-status"], context);
  const untracked = gitLines(
    ["ls-files", "--others", "--exclude-standard"],
    context,
  );

  for (const file of [
    ...changed.map((change) => change.path),
    ...staged.map((change) => change.path),
    ...untracked,
  ]) {
    const normalized = normalizePath(file);
    if (!allowed.has(normalized)) {
      return finalMetadataFailure("final-metadata-scope", ledgerPath, file, `path "${file}" is outside final metadata scope`);
    }
  }
  const stagedRegistry = staged.find(
    (change) => normalizePath(change.path) === WORKFLOW_LEARNINGS_REGISTRY_PATH,
  );
  if (stagedRegistry !== undefined) {
    if (stagedRegistry.status.startsWith("D")) {
      return finalMetadataFailure("final-metadata-scope", ledgerPath, WORKFLOW_LEARNINGS_REGISTRY_PATH, "staged changes delete the Workflow Learnings registry");
    }
    const registryError = validateIndexRegistry();
    if (registryError !== undefined) {
      return finalMetadataFailure("final-metadata-scope", ledgerPath, WORKFLOW_LEARNINGS_REGISTRY_PATH, registryError);
    }
  }
  const changedRegistry = changed.find(
    (change) => normalizePath(change.path) === WORKFLOW_LEARNINGS_REGISTRY_PATH,
  );
  if (changedRegistry !== undefined) {
    if (changedRegistry.status.startsWith("D")) {
      return finalMetadataFailure("final-metadata-scope", ledgerPath, WORKFLOW_LEARNINGS_REGISTRY_PATH, "working tree changes delete the Workflow Learnings registry");
    }
    const registryError = validateWorkingTreeRegistry();
    if (registryError !== undefined) {
      return finalMetadataFailure("final-metadata-scope", ledgerPath, WORKFLOW_LEARNINGS_REGISTRY_PATH, registryError);
    }
  }
  return finalMetadataOk("final-metadata-scope", ledgerPath);
}

function assertFinalMetadataCommit(ledgerPath: string, ref: string): FinalMetadataGateResult {
  const context = "final metadata commit gate";
  if (isMergeCommit(ref, context)) {
    return finalMetadataFailure("final-metadata-commit", ledgerPath, ref, `"${ref}" is a merge commit`);
  }
  const allowed = finalMetadataAllowedPaths(ledgerPath);
  const changes = changedFilesForRef(ref, context);
  for (const { path: file } of changes) {
    const normalized = normalizePath(file);
    if (!allowed.has(normalized)) {
      return finalMetadataFailure("final-metadata-commit", ledgerPath, file, `commit "${ref}" touched non-metadata path "${file}"`);
    }
  }
  const registryChange = changes.find(
    (change) => normalizePath(change.path) === WORKFLOW_LEARNINGS_REGISTRY_PATH,
  );
  if (registryChange !== undefined) {
    if (registryChange.status.startsWith("D")) {
      return finalMetadataFailure("final-metadata-commit", ledgerPath, WORKFLOW_LEARNINGS_REGISTRY_PATH, "commit deletes the Workflow Learnings registry");
    }
    const registryError = validateRegistryAtRef(ref);
    if (registryError !== undefined) {
      return finalMetadataFailure("final-metadata-commit", ledgerPath, WORKFLOW_LEARNINGS_REGISTRY_PATH, registryError);
    }
  }
  return finalMetadataOk("final-metadata-commit", ledgerPath);
}

function finalMetadataOk(
  gate: FinalMetadataGateResult["gate"],
  ledgerPath: string,
): FinalMetadataGateResult {
  return { ok: true, gate, allowed_paths: [...finalMetadataAllowedPaths(ledgerPath)] };
}

function finalMetadataFailure(
  gate: FinalMetadataGateResult["gate"],
  ledgerPath: string,
  offendingPath: string,
  reason: string,
): FinalMetadataGateResult {
  return {
    ok: false,
    gate,
    allowed_paths: [...finalMetadataAllowedPaths(ledgerPath)],
    offending_path: offendingPath,
    reason,
  };
}

function emitFinalMetadataGateResult(
  result: FinalMetadataGateResult,
  context: string,
  json: boolean,
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) exit(1);
    return;
  }
  if (!result.ok) {
    fail(`${context}: ${result.reason}; allowed paths are ${result.allowed_paths.map((path) => `"${path}"`).join(" and ")}`);
  }
}

/** Normalize a path to repo-relative POSIX form for equality comparison. */
function normalizePath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function gitLines(args: string[], context: string): string[] {
  const out = spawnSync("git", args, { encoding: "utf8" });
  if (out.status !== 0) {
    fail(`${context}: git ${args.join(" ")} failed`);
  }
  return out.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function gitChanges(
  args: string[],
  context: string,
): { status: string; path: string }[] {
  const out = spawnSync("git", args, { encoding: "utf8" });
  if (out.status !== 0) {
    fail(`${context}: git ${args.join(" ")} failed`);
  }
  return parseNameStatus(out.stdout);
}

function validateWorkingTreeRegistry(): string | undefined {
  if (!existsSync(WORKFLOW_LEARNINGS_REGISTRY_PATH)) {
    return "Workflow Learnings registry is missing from the working tree";
  }
  let src: string;
  try {
    src = readFileSync(WORKFLOW_LEARNINGS_REGISTRY_PATH, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `cannot read Workflow Learnings registry: ${message}`;
  }
  return validateRegistryMarkdown(src, WORKFLOW_LEARNINGS_REGISTRY_PATH);
}

function validateIndexRegistry(): string | undefined {
  const spec = `:${WORKFLOW_LEARNINGS_REGISTRY_PATH}`;
  const out = spawnSync("git", ["show", spec], { encoding: "utf8" });
  if (out.status !== 0) {
    return `index does not contain ${WORKFLOW_LEARNINGS_REGISTRY_PATH}`;
  }
  return validateRegistryMarkdown(out.stdout, spec);
}

function validateRegistryAtRef(ref: string): string | undefined {
  const spec = `${ref}:${WORKFLOW_LEARNINGS_REGISTRY_PATH}`;
  const out = spawnSync("git", ["show", spec], { encoding: "utf8" });
  if (out.status !== 0) {
    return `commit does not contain ${WORKFLOW_LEARNINGS_REGISTRY_PATH}`;
  }
  return validateRegistryMarkdown(out.stdout, spec);
}

function validateRegistryMarkdown(src: string, label: string): string | undefined {
  try {
    const registry = parseRegistryFromString(src, label);
    const errors = validateRegistry(registry);
    if (errors.length > 0) {
      return `Workflow Learnings registry is invalid: ${errors.join("; ")}`;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Workflow Learnings registry is invalid: ${message}`;
  }
  return undefined;
}

/**
 * Return true when `ref` resolves to a merge commit (2+ parents). Uses
 * `git rev-list --parents -n 1 <ref>`, which prints `<sha> <parent1>
 * <parent2> ...`; three or more tokens means the commit has 2+ parents.
 * Mirrors `touchedFilesForRef`'s git invocation style (spawnSync, args array,
 * no shell). Fails the gate if the parent list cannot be read.
 */
function isMergeCommit(ref: string, context: string): boolean {
  const out = spawnSync("git", ["rev-list", "--parents", "-n", "1", ref], {
    encoding: "utf8",
  });
  if (out.status !== 0) fail(`${context}: commit "${ref}" parents could not be read from git`);
  const tokens = out.stdout.trim().split(/\s+/).filter((token) => token.length > 0);
  return tokens.length >= 3;
}

/**
 * Return the repo-relative paths a commit touched, mirroring the
 * `git diff-tree` invocation used by `lib/ledger.ts`'s private
 * `touchedFilesForCommit`. Renames and copies expand to all named paths.
 */
function touchedFilesForRef(ref: string, context: string): string[] {
  return changedFilesForRef(ref, context).map((change) => change.path);
}

function changedFilesForRef(
  ref: string,
  context: string,
): { status: string; path: string }[] {
  const diff = spawnSync(
    "git",
    ["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", "-M", ref],
    { encoding: "utf8" },
  );
  if (diff.status !== 0) fail(`${context}: commit "${ref}" touched files could not be read from git`);
  return parseNameStatus(diff.stdout);
}

function parseNameStatus(stdout: string): { status: string; path: string }[] {
  const files = new Map<string, string>();
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const parts = line.split("\t").filter((part) => part.length > 0);
    if (parts.length < 2) continue;
    const status = parts[0];
    const paths = status.startsWith("R") || status.startsWith("C") ? parts.slice(1) : [parts[1]];
    for (const file of paths) files.set(file, status);
  }
  return [...files].map(([path, status]) => ({ path, status }));
}
