/**
 * Validation entry points for the Issue-to-PR v2 helper.
 *
 * Re-exports the public validation surface that `decompose.ts` dispatches
 * to. The actual function bodies live in `./ledger.ts` because v1's batch,
 * patch-proposal, AC-coverage, findings, Builder attempt, and supersedes
 * validation is deeply interleaved with the parser/IO helpers and shares
 * the same `fail()` sink. Re-exporting from one place keeps the plan's
 * conceptual split visible to readers while preserving behavior.
 *
 * Issue #51 AC4 lands jointly here and in `./ledger.ts`: "Ledger parsing
 * and validation still cover confirmation state, batch contracts,
 * replacement batches, Builder attempts, findings, and AC coverage."
 */

export {
  emitContractDigest,
  parse,
  validateAcCoverage,
  validateFindingsData,
  validateLedgerBatches,
} from "./ledger";
export type { ParseOptions } from "./ledger";
