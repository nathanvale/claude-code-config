#!/usr/bin/env bun

/**
 * Issue-to-PR v2 helper compatibility entrypoint (U3 slice S5).
 *
 * This file is a thin dispatcher over the modules in `./lib/`. Behavior
 * matches v1 `runbooks/issue-to-pr/decompose.ts` byte-for-byte: same flags,
 * same stdout/stderr shape, same exit codes, same argument handling. The
 * char suite at `./decompose.test.ts` is the regression net.
 *
 * Public flags (unchanged from v1):
 *   decompose.ts --plan-digest <plan-path>
 *   decompose.ts --ac-digest <ledger-path>
 *   decompose.ts --confirmation-state <ledger-path>
 *   decompose.ts --validate-ledger-batches <ledger-path>
 *   decompose.ts --batch-contract-digest <ledger-path>
 *   decompose.ts --validate-findings <ledger-path>
 *   decompose.ts --assert-no-open-p0p1 <ledger-path>
 *   decompose.ts <plan-path>
 *   decompose.ts <plan-path> --candidate-contract-digest
 *   decompose.ts <plan-path> --validate-ac-coverage <ledger-path>
 *   decompose.ts <plan-path> --patch-proposal <ledger-path>
 *
 * v2-only flags (no v1 counterpart):
 *   decompose.ts --assert-stage5-readonly <ledger-path> <commit-ref>
 */

import { spawnSync } from "node:child_process";
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
} from "./lib/ledger";

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
const patchProposalMode = args.length === 3 && args[1] === "--patch-proposal";
const validateCoverage = args.length === 3 && args[1] === "--validate-ac-coverage";
const candidateContractDigest = args.length === 2 && args[1] === "--candidate-contract-digest";
if (
  !args[0] ||
  args[0].startsWith("-") ||
  (args.length !== 1 && !patchProposalMode && !validateCoverage && !candidateContractDigest)
) {
  fail(
    "usage: decompose.ts <plan-path> [--candidate-contract-digest | --validate-ac-coverage <ledger-path> | --patch-proposal <ledger-path>] | --plan-digest <plan-path> | --ac-digest <ledger-path> | --confirmation-state <ledger-path> | --validate-ledger-batches <ledger-path> | --batch-contract-digest <ledger-path> | --validate-findings <ledger-path> | --assert-no-open-p0p1 <ledger-path> | --assert-stage5-readonly <ledger-path> <commit-ref>",
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
 */
function assertStage5ReadOnly(ledgerPath: string, ref: string): void {
  const context = "stage-5 read-only gate";
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

/** Normalize a path to repo-relative POSIX form for equality comparison. */
function normalizePath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

/**
 * Return the repo-relative paths a commit touched, mirroring the
 * `git diff-tree` invocation used by `lib/ledger.ts`'s private
 * `touchedFilesForCommit`. Renames and copies expand to all named paths.
 */
function touchedFilesForRef(ref: string, context: string): string[] {
  const diff = spawnSync(
    "git",
    ["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", "-M", ref],
    { encoding: "utf8" },
  );
  if (diff.status !== 0) fail(`${context}: commit "${ref}" touched files could not be read from git`);
  const files = new Set<string>();
  for (const raw of diff.stdout.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const parts = line.split("\t").filter((part) => part.length > 0);
    if (parts.length < 2) continue;
    const status = parts[0];
    const paths = status.startsWith("R") || status.startsWith("C") ? parts.slice(1) : [parts[1]];
    for (const file of paths) files.add(file);
  }
  return [...files];
}
