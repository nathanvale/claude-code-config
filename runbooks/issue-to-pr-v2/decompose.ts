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
 */

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
const patchProposalMode = args.length === 3 && args[1] === "--patch-proposal";
const validateCoverage = args.length === 3 && args[1] === "--validate-ac-coverage";
const candidateContractDigest = args.length === 2 && args[1] === "--candidate-contract-digest";
if (
  !args[0] ||
  args[0].startsWith("-") ||
  (args.length !== 1 && !patchProposalMode && !validateCoverage && !candidateContractDigest)
) {
  fail(
    "usage: decompose.ts <plan-path> [--candidate-contract-digest | --validate-ac-coverage <ledger-path> | --patch-proposal <ledger-path>] | --plan-digest <plan-path> | --ac-digest <ledger-path> | --confirmation-state <ledger-path> | --validate-ledger-batches <ledger-path> | --batch-contract-digest <ledger-path> | --validate-findings <ledger-path> | --assert-no-open-p0p1 <ledger-path>",
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
