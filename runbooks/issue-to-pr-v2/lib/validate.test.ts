import { describe, expect, test } from "bun:test";

import * as ledger from "./ledger";
import * as validate from "./validate";

/**
 * Module-level tests for `lib/validate.ts` public surface (U3 AC5).
 *
 * `lib/validate.ts` is intentionally a thin re-export of the parser /
 * validator entry points in `lib/ledger.ts`. The tests below pin both
 * presence AND reference identity so a future refactor that accidentally
 * rebinds a re-export (e.g. `export { emit as parse }`) surfaces a fast
 * unit-level failure. Typeof checks alone would silently accept such a
 * rebind. Behavioral correctness is owned by the process-boundary char
 * suite at `runbooks/issue-to-pr-v2/decompose.test.ts`.
 */

describe("validate module re-export surface", () => {
  test("parse is the same function as ledger.parse", () => {
    expect(validate.parse).toBe(ledger.parse);
  });

  test("validateLedgerBatches is the same function as ledger.validateLedgerBatches", () => {
    expect(validate.validateLedgerBatches).toBe(ledger.validateLedgerBatches);
  });

  test("validateFindingsData is the same function as ledger.validateFindingsData", () => {
    expect(validate.validateFindingsData).toBe(ledger.validateFindingsData);
  });

  test("validateAcCoverage is the same function as ledger.validateAcCoverage", () => {
    expect(validate.validateAcCoverage).toBe(ledger.validateAcCoverage);
  });

  test("emitContractDigest is the same function as ledger.emitContractDigest", () => {
    expect(validate.emitContractDigest).toBe(ledger.emitContractDigest);
  });
});
